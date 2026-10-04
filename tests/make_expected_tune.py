#!/usr/bin/env python3
"""Corpus de reference pour gp200tune.js : on fait tourner le VRAI code de gp200_batch.py
(BatchWindow._analyze_params / _play_current_preset / _update_meters / _apply / _send_*_tweak_bg)
sur un faux "self", avec une horloge simulee, et on enregistre tout ce qu'il decide."""
import sys, os, json, random, types, math, hashlib, tempfile, struct
from unittest.mock import MagicMock
HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "..", "ref")
sys.path.insert(0, REF)
for m in ("tkinter", "tkinter.ttk", "tkinter.messagebox", "tkinter.filedialog"):
    sys.modules[m] = types.ModuleType(m)
sys.modules["tkinter"].Toplevel = type("Toplevel", (), {})
sys.modules["tkinter"].ttk = sys.modules["tkinter.ttk"]
sys.modules["tkinter"].messagebox = sys.modules["tkinter.messagebox"]
sys.modules["tkinter"].filedialog = sys.modules["tkinter.filedialog"]
sys.modules["sounddevice"] = None
import gp200lib as L
import gp200_batch as B

random.seed(777)
tb = L.Tables(os.path.join(REF, "data"))
TEMPLATE = os.path.join(REF, "template.prst")

# ---- T() : renvoie un objet dont "% args" produit (cle, args) -------------------
class HS(str):
    def __mod__(self, args):
        if not isinstance(args, tuple): args = (args,)
        return ("H", str(self), list(args))
B.T = lambda key, *a, **kw: HS(key)

# ---- horloge simulee + threads synchrones ---------------------------------------
class Clock:
    t = 1000.0
    def time(self): return Clock.t
    def sleep(self, s): pass
B.time = Clock()
class SyncThread:
    def __init__(self, target=None, args=(), daemon=None, **kw): self.t, self.a = target, args
    def start(self): self.t(*self.a)
B.threading = types.SimpleNamespace(Thread=SyncThread)

# ---- faux self -------------------------------------------------------------------
class Rec:
    def __init__(self): self.v = None; self.n = 0
    def set(self, v): self.v = v; self.n += 1
    def get(self): return self.v
class Cfg:
    def __init__(self): self.calls = []
    def config(self, **kw): self.calls.append(kw)

class FakeUsb:
    def __init__(self): self.calls = []
    def send_param_update(self, mod, par, val, prst_data=None, rec0=None):
        self.calls.append(["param", mod, par, val]); return True
    def send_patch_vol_update(self, v):
        self.calls.append(["patch", v]); return True
    def write_preset(self, *a, **k): self.calls.append(["write"])
    def select_preset(self, *a, **k): self.calls.append(["select"])

def make_self(entry, usb_mode=True):
    s = MagicMock()
    s._presets = [entry]; s._cur_idx = 0
    s._tables = tb; s._usb_mode = usb_mode; s._usb_dev = FakeUsb() if usb_mode else None
    s._usb_busy = False; s._midi = None
    s._engine = types.SimpleNamespace(resets=0, reset=lambda: None)
    s._smoothed_delta = None; s._last = (None, None, None)
    s._outdir = tempfile.mkdtemp()
    s._v_hint, s._v_delta, s._v_mom, s._v_st, s._v_itg = Rec(), Rec(), Rec(), Rec(), Rec()
    s._lbl_delta, s._btn_apply = Cfg(), Cfg()
    s._v_slot_n = types.SimpleNamespace(get=lambda: 1); s._v_slot_l = types.SimpleNamespace(get=lambda: "A")
    for n in ("_update_meters", "_apply", "_analyze_params", "_play_current_preset", "_resend_current",
              "_send_amp_tweak_bg", "_send_patch_tweak_bg", "_send_cab_tweak_bg", "_send_gain_tweak_bg"):
        setattr(s, n, types.MethodType(getattr(B.BatchWindow, n), s))
    s.after = lambda ms, fn=None, *a: None
    if usb_mode:
        s._apply_push_bg = lambda *a: s._usb_dev.calls.append(["apply_push"])
    return s

def snap_entry(e):
    return {k: getattr(e, k) for k in ("patch_vol_new", "patch_vol_orig", "amp_vol_new", "amp_vol_orig", "amp_gain_new",
            "amp_gain_orig", "cab_vol_new", "cab_vol_orig", "status", "tweak_count", "lufs_ok")} | {"data": hashlib.sha1(bytes(e.data)).hexdigest()}

STATUS = {B.STATUS_WAIT: "wait", B.STATUS_RUN: "run", B.STATUS_DONE: "done"}
def norm_hint(h):
    if h is None: return None
    if isinstance(h, str): return [str(h), []]
    _, key, args = h
    out = []
    for a in args:
        if isinstance(a, HS):
            a = {"batch_hint_patch_limit": "LIMIT", "batch_hint_floor": "FLOOR", "batch_hint_ceiling": "CEILING"}.get(str(a), str(a))
        out.append(a)
    return [key, out]

def norm_entry(d):
    d = dict(d); d["status"] = STATUS[d["status"]]; return d

# ---- fabrication de presets ------------------------------------------------------
def make_prst(amp, cab, params=None, patch_vol=None):
    spec = {"name": "T", "modules": {"AMP": {"model": amp, "params": params or {}}, "CAB": {"model": cab}}}
    d = bytearray(L.encode_prst(spec, tb, TEMPLATE)[0])
    if patch_vol is not None:
        d[B.OFF_PATCH_VOL] = patch_vol
        struct.pack_into(">H", d, B.CS_OFFSET, B._checksum(d))
    return bytes(d)

amps = [m for m in tb.models if m["cat"] in (7, 8, 15)]
cabs = [c["name"] for c in tb.cabs if not c["user_slot"]]

def mk_entry(raw, ptype="NORMAL"):
    path = os.path.join(tempfile.mkdtemp(), "t.prst"); open(path, "wb").write(raw)
    e = B.PresetEntry(path); e.ptype = ptype; return e

# ---- 1. analyse sur tous les amplis ---------------------------------------------
analysis = []
for m in amps:
    cab = random.choice(cabs)
    raw = make_prst(m["name"], cab, patch_vol=random.randint(30, 100))
    e = mk_entry(raw); s = make_self(e)
    s._analyze_params(e)
    analysis.append({"raw": raw.hex(), "amp": m["name"], "cat": m["cat"],
                     "f": {k: getattr(e, k) for k in ("amp_idx", "cab_idx", "amp_name", "amp_param_idx", "amp_vol_orig",
                           "amp_gain_param_idx", "amp_gain_orig", "cab_vol_param_idx", "cab_vol_orig", "patch_vol_orig")}})
n_vol = sum(1 for a in analysis if a["f"]["amp_param_idx"] is not None)
n_gain = sum(1 for a in analysis if a["f"]["amp_param_idx"] is None and a["f"]["amp_gain_param_idx"] is not None)
n_none = len(analysis) - n_vol - n_gain
print("amplis: volume=%d gain-seul=%d aucun=%d" % (n_vol, n_gain, n_none))

# ---- 2. scenarios dynamiques -----------------------------------------------------
def scenario(raw, ptype, offset, slopes, rng, usb=True, events=(), noise=0.12, silence=(), ticks=260, strip=()):
    e = mk_entry(raw, ptype); s = make_self(e, usb)
    Clock.t = 1000.0 + rng.random() * 50
    s._analyze_params(e)
    # CAB : le Python utilise l'index 0 (enumerate), le JS le vrai slot 1 -> on aligne pour comparer
    cab_py_idx = e.cab_vol_param_idx
    if e.cab_vol_param_idx is not None: e.cab_vol_param_idx = 1
    if "amp" in strip:
        e.amp_param_idx = e.amp_vol_orig = e.amp_vol_initial = e.amp_vol_new = None
    if "gain" in strip:
        e.amp_gain_param_idx = e.amp_gain_orig = e.amp_gain_initial = e.amp_gain_new = None
    if "cab" in strip:
        e.cab_vol_param_idx = e.cab_vol_orig = e.cab_vol_initial = e.cab_vol_new = None
    t0 = Clock.t
    s._play_current_preset()
    base0 = (B.TARGETS[ptype] + offset)
    # etat "monde" : loudness = base0 + sum(slope * (valeur - valeur initiale))
    init = {"amp": e.amp_vol_orig, "gain": e.amp_gain_orig, "cab": e.cab_vol_orig, "patch": e.patch_vol_orig}
    trace = []
    reset_ticks = 3
    prev_ok = [None]
    done_tick = None
    for tick in range(ticks):
        Clock.t += 0.15
        ev = None
        for (tk, name) in events:
            if tk == tick: ev = name
        if ev == "resend":
            s._resend_current(); reset_ticks = 3; trace.append({"ev": "resend", "t": Clock.t}); 
        cur = {"amp": e.amp_vol_new, "gain": e.amp_gain_new, "cab": e.cab_vol_new, "patch": e.patch_vol_new}
        if ev == "resend": cur = {"amp": e.amp_vol_orig, "gain": e.amp_gain_orig, "cab": e.cab_vol_orig, "patch": e.patch_vol_orig}
        # le pedalier applique reellement le dernier envoye
        world = base0
        for k in cur:
            if cur[k] is not None and init[k] is not None: world += slopes[k] * (cur[k] - init[k])
        # on lit l'etat REEL de l'appareil = dernieres valeurs envoyees (calcule via usb.calls)
        itg = None
        if reset_ticks > 0: reset_ticks -= 1
        else: itg = world + rng.gauss(0, noise)
        if any(a <= tick < b for a, b in silence): itg = world - 60 + rng.gauss(0, noise) if tick % 2 else None
        usb_calls_before = len(s._usb_dev.calls) if s._usb_dev else 0
        hint_n, delta_n = s._v_hint.n, s._v_delta.n
        s._last = (itg, itg, itg)
        s._update_meters(itg, itg, itg)
        calls = s._usb_dev.calls[usb_calls_before:] if s._usb_dev else []
        applied = (e.lufs_ok is not None and e.lufs_ok != prev_ok[0]); prev_ok[0] = e.lufs_ok
        # apply sans usb : _apply n'est jamais appele automatiquement dans le Python ; le test "stable" l'appelle
        step = {"t": Clock.t, "itg": itg, "hint": norm_hint(s._v_hint.v) if s._v_hint.n != hint_n else "-",
                "delta": s._v_delta.v if s._v_delta.n != delta_n else "-",
                "calls": [c for c in calls if c[0] in ("param", "patch")], "applied": applied,
                "entry": norm_entry(snap_entry(e))}
        if calls or applied or s._engine is None: pass
        trace.append(step)
        if calls:
            reset_ticks = 3          # le Python remet le compteur a zero apres chaque reglage / apply
        if applied: reset_ticks = 3
        if step["entry"]["status"] == "done" and done_tick is None: done_tick = tick
        if done_tick is not None and tick > done_tick + 25 and not any(tk > tick for tk, _ in events): break
    return {"raw": raw.hex(), "ptype": ptype, "usb": usb, "trace": trace, "cab_py_idx": cab_py_idx, "t0": t0, "strip": list(strip)}

import random as _r
dyn = []
presets = []
# amplis avec volume, avec gain seul, sans rien + un cab quelconque
vol_amps = [a["amp"] for a in analysis if a["f"]["amp_param_idx"] is not None]
gain_amps = [a["amp"] for a in analysis if a["f"]["amp_param_idx"] is None and a["f"]["amp_gain_param_idx"] is not None]
none_amps = [a["amp"] for a in analysis if a["f"]["amp_param_idx"] is None and a["f"]["amp_gain_param_idx"] is None]
pools = [("vol", vol_amps, 30), ("gain", gain_amps, 14), ("vol-nocab", vol_amps, 8), ("gain-nocab", gain_amps, 16), ("none", vol_amps, 8), ("none-nocab", vol_amps, 4)]
sid = 0
for label, pool, count in pools:
    for i in range(count):
        rng = _r.Random(1000 + sid); sid += 1
        amp = rng.choice(pool); cab = rng.choice(cabs)
        params = {}
        pv = rng.choice([100, 98, 60, 37, 35, 50, 80, rng.randint(35, 100)])
        force_quiet = label.startswith("gain-nocab") and rng.random() < 0.7
        if force_quiet: pv = rng.choice([100, 99])
        raw = make_prst(amp, cab, params, patch_vol=pv)
        # valeurs extremes de volume pour tester les limites
        if rng.random() < 0.4:
            e = mk_entry(raw); s = make_self(e); s._analyze_params(e)
            d = bytearray(raw)
            rec0 = d.find(B.REC_MAGIC)
            for idx_attr, mod in (("amp_param_idx", e.amp_idx), ("amp_gain_param_idx", e.amp_idx), ("cab_vol_param_idx", e.cab_idx)):
                pidx = getattr(e, idx_attr)
                if pidx is None: continue
                if idx_attr == "cab_vol_param_idx": pidx = 1
                v = rng.choice([100.0, 25.0, 20.0, 90.0, 99.0, 26.0, 21.0, 100.0, 0.0, 87.0])
                struct.pack_into("<f", d, rec0 + mod * 72 + 12 + pidx * 4, v)
            struct.pack_into(">H", d, B.CS_OFFSET, B._checksum(d)); raw = bytes(d)
        ptype = rng.choice(["NORMAL", "LEAD"])
        offset = rng.choice([-14, -9, -6, -3, -1, 0.1, 0.3, 0, 1.5, 4, 8, 13, 35, -35, rng.uniform(-12, 12), rng.uniform(-12, 12)])
        if force_quiet: offset = rng.choice([-9, -5, -12, -7])
        slopes = {"amp": rng.uniform(0.15, 0.4), "gain": rng.uniform(0.05, 0.25), "cab": rng.uniform(0.1, 0.35), "patch": rng.uniform(0.15, 0.35)}
        events = []
        if rng.random() < 0.3: events.append((rng.randint(60, 140), "resend"))
        silence = [(rng.randint(30, 80), rng.randint(81, 100))] if rng.random() < 0.25 else []
        strip = {"vol": (), "gain": (), "vol-nocab": ("cab",), "gain-nocab": ("cab",), "none": ("amp", "gain"), "none-nocab": ("amp", "gain", "cab")}[label]
        dyn.append(scenario(raw, ptype, offset, slopes, rng, usb=True, events=events, silence=silence,
                            noise=rng.choice([0.0, 0.05, 0.12, 0.4]), strip=strip))
# sans usb
for i in range(6):
    rng = _r.Random(5000 + i)
    raw = make_prst(rng.choice(vol_amps), rng.choice(cabs), {}, patch_vol=70)
    dyn.append(scenario(raw, "NORMAL", rng.choice([-5, 0.1, 6]), {"amp": .25, "gain": .1, "cab": .2, "patch": .25}, rng, usb=False, ticks=80))

stats = {}
for d in dyn:
    last = d["trace"][-1]["entry"] if d["trace"] else {}
    done = any(t.get("entry", {}).get("status") == "done" for t in d["trace"])
    ntw = sum(len(t.get("calls", [])) for t in d["trace"])
    stats["done"] = stats.get("done", 0) + done; stats["tweaks"] = stats.get("tweaks", 0) + ntw
    stats["applied"] = stats.get("applied", 0) + sum(1 for t in d["trace"] if t.get("applied"))
print("scenarios:", len(dyn), stats)
# types d'actions couvertes
kinds = {}
for d in dyn:
    for t in d["trace"]:
        for c in t.get("calls", []): kinds[c[0] + (str(c[1]) if c[0] == "param" else "")] = kinds.get(c[0] + (str(c[1]) if c[0] == "param" else ""), 0) + 1
print("actions:", kinds)
hints = {}
for d in dyn:
    for t in d["trace"]:
        h = t.get("hint")
        if isinstance(h, list): hints[h[0]] = hints.get(h[0], 0) + 1
print("hints:", dict(sorted(hints.items())))
json.dump({"analysis": analysis, "dyn": dyn}, open(os.path.join(HERE, "expected_tune.json"), "w"))
