#!/usr/bin/env python3
"""Corpus de reference pour gp200usb.js : trames et sequences d'envoi calculees par gp200_usb.py."""
import json, os, random, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import gp200_usb as U

random.seed(424242)
time.sleep = lambda s: None       # pas d'attente reelle
cases = json.load(open(os.path.join(HERE, "expected.json")))["cases"]
raws = [bytes.fromhex(c["expected"]["raw"]) for c in cases if "raw" in c["expected"]]

frames = []
for i in range(300):
    raw = random.choice(raws)
    slot = random.randint(1, 64)
    letter = random.choice(["A", "B", "C", "D", "a", 0, 1, 2, 3])
    pc = U.slot_to_pc(slot, letter)
    ch = U.build_sysex_chunks(raw, pc)
    frames.append({"raw": raw.hex(), "slot": slot, "letter": letter, "pc": pc,
                   "payload": U.prst_to_device_payload(raw, pc).hex(),
                   "chunks": [c.hex() for c in ch], "hs": U.build_handshake_sysex(pc).hex()})

errors = []
for slot, letter in [(0, "A"), (65, "A"), (1, "E"), (1, 4), (1, -1), (-3, "B")]:
    try:
        U.slot_to_pc(slot, letter); errors.append({"slot": slot, "letter": letter, "ok": True})
    except Exception as e:
        errors.append({"slot": slot, "letter": letter, "ok": False})
try:
    U.prst_to_device_payload(b"\0" * 100, 3); sizeerr = False
except ValueError:
    sizeerr = True

# ---- sequences completes avec un faux backend
class FakeIn:
    def __init__(self, dev, ack_after): self.dev, self.ack_after = dev, ack_after
    def iter_pending(self):
        n = sum(1 for k, _ in self.dev.sent if k == "sx" and len(_) == 30 and _[8:10] == b"\x12\x08")
        if self.ack_after is not None and n >= self.ack_after and not self.dev.acked:
            self.dev.acked = True
            class M: type = "sysex"; data = tuple(range(40))
            return [M()]
        return []

def run(slot, letter, raw, ack_after, blind, push):
    dev = U.GP200USB(verbose=False)
    dev.sent = []; dev.acked = False
    dev.connected = True; dev._backend = "fake"
    dev._inport = None if blind else FakeIn(dev, ack_after)
    dev._send_sysex = lambda b: dev.sent.append(("sx", bytes(b)))
    dev._send_short = lambda st, d1, d2=0: dev.sent.append(("sh", bytes([st, d1] + ([d2] if (st & 0xF0) == 0xB0 else []))))
    dev._flush_input = lambda timeout=0.2: None
    if push: dev.push_preset(slot, letter, raw)
    else: dev.write_preset(slot, letter, raw)
    return [{"kind": k, "hex": b.hex()} for k, b in dev.sent]

seqs = []
for slot, letter, ack_after, blind, push in [
    (1, "A", 1, False, True), (12, "B", 3, False, True), (50, "D", None, False, False), (33, "A", 1, False, True),
    (64, "D", 2, False, True), (7, "C", None, True, True), (21, "A", 5, False, False), (32, "D", 1, False, True)]:
    raw = random.choice(raws)
    seqs.append({"slot": slot, "letter": letter, "ack_after": ack_after, "blind": blind, "push": push,
                 "raw": raw.hex(), "sent": run(slot, letter, raw, ack_after, blind, push)})

# select_preset (octets MIDI courts)
sel = []
for slot in (1, 32, 33, 50, 64):
    for letter in "ABCD":
        for ch in (0, 5):
            sent = []
            dev = U.GP200USB(verbose=False); dev.connected = True
            dev._send_short = lambda st, d1, d2=0, s=sent: s.append(bytes([st, d1] + ([d2] if (st & 0xF0) == 0xB0 else [])).hex())
            dev.select_preset(slot, letter, ch)
            sel.append({"slot": slot, "letter": letter, "ch": ch, "sent": sent})


# ---- param update / patch volume (mises a jour temps reel)
live = []
for i in range(400):
    raw = random.choice(raws)
    mod = random.randint(0, 10); par = random.randint(0, 14)
    val = random.choice([random.uniform(0, 100), float(random.randint(0, 100)), random.uniform(-5, 200), 0.0, 100.0, 1e-3])
    live.append({"raw": raw.hex(), "mod": mod, "par": par, "val": val,
                 "msg": U.build_param_update_msg(mod, par, val, prst_data=raw, rec0=raw.find(b"\x14\x00\x44\x00")).hex(),
                 "msg2": U.build_param_update_msg(mod, par, val, prst_data=bytearray(raw)).hex()})
pv = []
for v in [0, 1, 15, 16, 35, 50, 99, 100, 101, 250, -5, 33.7]:
    sent = []
    dev = U.GP200USB(verbose=False); dev.connected = True
    dev._send_sysex = lambda m, s=sent: s.append(bytes(m).hex())
    dev.send_patch_vol_update(v)
    pv.append({"v": v, "msg": sent[0]})

ec = []
for blk in range(0, 11):
    for mid, cat in [(0, 0), (1, 1), (17, 3), (255, 10), (256, 2), (300, 15), (7, 4), (129, 8)]:
        ec.append({"blk": blk, "mid": mid, "cat": cat, "msg": U.build_effect_change_msg(blk, mid, cat).hex()})
for blk in (0, 3, 10, 11, 200):
    ec.append({"blk": blk, "mid": 5, "cat": 5, "msg": U.build_effect_change_msg(blk, 5, 5).hex()})
byp = [{"mod": k, "on": a, "msg": U.build_bypass_msg(k, a).hex()} for k in range(11) for a in (True, False)]
json.dump({"ec": ec, "byp": byp, "live": live, "pv": pv, "frames": frames, "errors": errors, "sizeerr": sizeerr, "seqs": seqs, "select": sel,
           "names": [[pc, "%02d-%s" % (pc // 4 + 1, "ABCD"[pc % 4])] for pc in (0, 1, 4, 35, 127, 128, 199)]},
          open(os.path.join(HERE, "expected_usb.json"), "w"))
print("frames", len(frames), "seqs", len(seqs), "select", len(sel))
print([ (s["slot"], len(s["sent"])) for s in seqs])
