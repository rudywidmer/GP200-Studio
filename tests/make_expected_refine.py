#!/usr/bin/env python3
"""Corpus de reference pour refine() : le VRAI code Python (gp200_agent) avec une IA scriptee."""
import json, os, random, sys, tempfile, shutil, copy
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import webdata as W
A, L = W.A, W.L
tb = W.load_tables()
random.seed(4242)
corpus = json.load(open(os.path.join(HERE, "expected.json")))["cases"]
raws = [bytes.fromhex(c["expected"]["raw"]) for c in corpus if "raw" in c["expected"]]
all_raws = raws
raws = random.sample(raws, 40)

def tmp_prst(raw, name="src.prst"):
    d = tempfile.mkdtemp(); p = os.path.join(d, name); open(p, "wb").write(raw); return p

def dec(raw):
    p = tmp_prst(raw); r = L.decode_prst(p, tb); shutil.rmtree(os.path.dirname(p)); return r

def jsonable(x): return json.loads(json.dumps(x))

# ---- 1. decoded_to_spec (texte exact envoye a l'IA) + diff_presets
specs = []
for raw in raws:
    d = dec(raw)
    sp = A.decoded_to_spec(d)
    specs.append({"raw": raw.hex(), "dump": json.dumps(sp, indent=1, ensure_ascii=False)})
# raws a checksum faux et a champs inhabituels
bad = bytearray(raws[0]); bad[-1] ^= 0x55
specs.append({"raw": bytes(bad).hex(), "dump": json.dumps(A.decoded_to_spec(dec(bytes(bad))), indent=1, ensure_ascii=False)})

diffs = []
for i in range(120):
    a, b = random.sample(raws, 2) if i % 3 else (raws[i % 40], raws[i % 40])
    if i % 4 == 0:      # variation fine : meme modeles, parametres decales
        spec = A.decoded_to_spec(dec(a))
        for slot, m in spec["modules"].items():
            if m:
                for k in m["params"]:
                    r = random.random()
                    if r < .3: m["params"][k] = round(m["params"][k] + random.choice([0.004, 0.006, 1, -3.5, 0.0049999]), 4)
                if random.random() < .2: m["on"] = not m["on"]
        spec["name"] = random.choice([spec["name"], "Autre nom"])
        try:
            b = L.encode_prst(spec, tb, os.path.join(W.REF, "template.prst"))[0]
        except ValueError:
            # modele de repli non resolvable (decode d'un corpus aleatoire) : on prend l'autre raw
            pass
    diffs.append({"a": a.hex(), "b": b.hex(), "diff": A.diff_presets(dec(a), dec(b))})

# ---- 2. refine() complet avec IA scriptee
def _ok(raw):
    try: return not A.check_names(tb, A.decoded_to_spec(dec(raw)))
    except Exception: return False
clean = [r for r in all_raws if _ok(r)]
rr = random.Random(77); clean = rr.sample(clean, min(30, len(clean)))
print("raws propres :", len(clean), "/", len(all_raws))
def mutate(spec, kind, rng):
    s = copy.deepcopy(spec)
    mods = s["modules"]
    if kind == "params":
        for slot, m in mods.items():
            if m and m["params"] and rng.random() < .5:
                k = rng.choice(list(m["params"]))
                m["params"][k] = round(m["params"][k] * rng.choice([.5, 1.2, 0.9]) + rng.choice([0, 1, -1]), 2)
    elif kind == "swap":
        slot = rng.choice(["MOD", "DLY", "RVB", "DST", "AMP"])
        pool = [m["name"] for m, _ in tb.models_for_slot(slot)]
        mods[slot] = {"model": rng.choice(pool), "on": True, "params": {}}
    elif kind == "onoff":
        for slot, m in mods.items():
            if m and rng.random() < .3: m["on"] = not m["on"]
    elif kind == "rename":
        s["name"] = rng.choice(["Nouveau nom", "", "Un nom beaucoup trop long pour le preset", "Cafe é"]) 
    elif kind == "remove":
        mods[rng.choice(list(mods))] = None
    return s

def payload_for(spec, extra=None):
    p = {"analyse": "j'ai compris", "changements": ["x -> y"], "avertissements": "", "spec": spec}
    if extra: p.update(extra)
    return json.dumps(p, ensure_ascii=False)

scen = []
for i in range(36):
    rng = random.Random(900 + i)
    raw = rng.choice(clean)
    d = dec(raw); sp_in = A.decoded_to_spec(d)
    kind = rng.choice(["params", "swap", "onoff", "rename", "remove", "params", "swap"])
    good = mutate(sp_in, kind, rng)
    mode = "live" if i % 9 == 8 else "refine"
    lang = rng.choice(["fr", "en", "es"])
    name = rng.choice(["Mon son.prst", "preset_A.prst", "Rock n Hell RYTH.prst", "a.b.c.prst", ".prst", "é.PRST", "x" * 60 + ".prst"])
    scr = []
    flavour = i % 6
    if flavour == 1:
        bad = copy.deepcopy(good); bad["modules"]["AMP"] = {"model": "Marshal JCM", "on": True, "params": {}}
        scr = [payload_for(bad), payload_for(good)]
    elif flavour == 2:
        scr = ["desole je ne peux pas", "```json\n" + payload_for(good) + "\n```"]
    elif flavour == 3:
        bad = copy.deepcopy(good); bad["modules"]["DLY"] = {"model": "Pure", "params": {"Bogus": 3}}
        scr = [payload_for(bad), payload_for(bad), payload_for(good)]
    elif flavour == 4 and i % 12 == 4:
        bad = copy.deepcopy(good); bad["modules"]["AMP"] = {"model": "Marshal JCM", "on": True, "params": {}}
        scr = [payload_for(bad)] * 3                       # echec definitif
    else:
        scr = [payload_for(good, {"avertissements": "slot deja pris" if i % 5 == 0 else ""})]
    scen.append({"raw": raw.hex(), "name": name, "mode": mode, "lang": lang, "instr": rng.choice(["Trop de reverb, il manque un flanger", "plus de gain é", "x" * 50]),
                 "script": scr, "cfg": {"max_retries": rng.choice([2, 2, 1])}})

out = []
for sc in scen:
    calls = []; script = list(sc["script"])
    def fake(cfg, system, msgs, log=print):
        calls.append({"system": system, "msgs": json.loads(json.dumps(msgs))})
        return script.pop(0)
    A.call_api = fake
    tmp = tempfile.mkdtemp()
    cfg = {"provider": "gemini", "output_dir": tmp, "lang": sc["lang"], "max_retries": sc["cfg"]["max_retries"], "model": "gemini-3.5-flash"}
    path = tmp_prst(bytes.fromhex(sc["raw"]), sc["name"])
    rec = dict(sc); rec["calls"] = calls
    try:
        if sc["mode"] == "live":
            payload, outp, diff = A.refine_live(cfg, tb, path, log=lambda *a: None)
        else:
            payload, outp, diff = A.refine(cfg, tb, path, sc["instr"], log=lambda *a: None)
        rec["folder"] = os.path.basename(os.path.dirname(outp))
        rec["filename"] = os.path.basename(outp)
        rec["hex"] = open(outp, "rb").read().hex()
        rec["diff"] = diff
        rec["payload"] = payload
        rec["spec"] = payload["spec"]
    except Exception as e:
        rec["error"] = type(e).__name__
    shutil.rmtree(tmp, ignore_errors=True)
    out.append(rec)
print("refine:", sum(1 for r in out if "error" in r), "echecs attendus ;", sum(1 for r in out if "hex" in r), "ok ; appels", sum(len(r["calls"]) for r in out))
# ---- 3. CTRL : write_ctrl + checksum (CtrlDialog._save)
import struct
ctrls = []
rc = random.Random(31)
for raw in raws[:25]:
    spec = {n: [m for m in L.MODULES if rc.random() < .25] for n in range(1, 9)}
    d = bytearray(raw)
    L.write_ctrl(d, spec)
    struct.pack_into(">H", d, len(d) - 2, L.checksum(d))
    ctrls.append({"raw": raw.hex(), "spec": {str(k): v for k, v in spec.items()}, "hex": bytes(d).hex(), "read": L.read_ctrl(d)})
patches = []
rp = random.Random(55)
for raw in raws[:25]:
    d = bytearray(raw); ops = []
    rec0 = d.find(L.REC_MAGIC)
    for _ in range(6):
        if rp.random() < .7:
            k, i, v = rp.randrange(11), rp.randrange(15), rp.choice([0, 1, 33.3, 100, -7.25, 1234.5678, rp.random() * 100])
            struct.pack_into("<f", d, rec0 + k * 72 + 12 + i * 4, v); ops.append(["p", k, i, v])
        else:
            k, on = rp.randrange(11), rp.random() < .5
            d[rec0 + k * 72 + 5] = 1 if on else 0; ops.append(["o", k, on])
        struct.pack_into(">H", d, len(d) - 2, L.checksum(d))
    patches.append({"raw": raw.hex(), "ops": ops, "hex": bytes(d).hex()})
mfs = {sl: [[(x[0].get('name')), x[1], (x[0].get('model_id') if x[1] == 10 else x[0]['id'])] for x in tb.models_for_slot(sl)] for sl in L.MODULES}
bundle = {"tables": W.trimmed_tables(tb), "prompts": W.prompts(tb), "template": W.template_b64()}
json.dump({"specs": specs, "diffs": diffs, "refine": out, "ctrls": ctrls, "mfs": mfs, "patches": patches}, open(os.path.join(HERE, "expected_refine.json"), "w"), ensure_ascii=False)
json.dump(bundle, open(os.path.join(HERE, "bundle.json"), "w"), ensure_ascii=False)
