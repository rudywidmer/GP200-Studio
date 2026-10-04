#!/usr/bin/env python3
"""Cas de reference pour parse_notify (notifications de la pedale : bypass, patch, volume du patch), rejoues cote JS par run_notify_tests.js.
Les messages 12/10 (reglage en facade) n'existent pas cote Python : la valeur attendue est calculee ici avec struct."""
import json, os, random, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import gp200_usb as U

NUX = bytes([0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32])
cases = []


def frame30(sub, p13, p14, p15, b22=0, b24=0, b25=0, b26=0, tail=None):
    b = bytearray(30)
    b[0] = 0xF0; b[1:8] = NUX; b[8] = 0x12; b[9] = 0x08
    b[13], b[14], b[15] = p13, p14, p15
    b[18] = 0x04
    b[22] = b22; b[24] = b24
    if tail is not None:
        b[25:29] = tail
    else:
        b[25], b[26] = b25, b26
    b[29] = 0xF7
    return bytes(b)


def add(name, b):
    r = U.parse_notify(b)
    if r is None:
        exp = None
    elif r[0] == "bypass":
        exp = {"kind": "bypass", "module": r[1], "on": r[2], "source": r[3]}
    elif r[0] == "patch":
        exp = {"kind": "patch", "pc": r[1]}
    elif r[0] == "patchvol":
        exp = {"kind": "patchvol", "v": r[1]}
    else:
        raise SystemExit("type inattendu " + str(r))
    cases.append({"name": name, "hex": bytes(b).hex(), "kind": "notify", "exp": exp})


FS, PANEL = U._TAIL_FS, U._TAIL_PANEL
for m in range(0, 13):
    for on in (0, 1):
        for tail, tn in ((FS, "fs"), (PANEL, "panel"), (b"\x01\x02\x03\x04", "autre")):
            add("bypass m%d on%d %s" % (m, on, tn), frame30(0, 0x01, 0x05, 0, b22=m, b24=on, tail=tail))
add("bypass etat 2", frame30(0, 0x01, 0x05, 0, b22=3, b24=2, tail=FS))
for pc in range(0, 256):
    add("patch %d" % pc, frame30(0, 0x00, 0x08, 0x01, b25=pc >> 4, b26=pc & 15))
add("patch nibble haut invalide", frame30(0, 0x00, 0x08, 0x01, b25=0x10, b26=0))
add("patch nibble bas invalide", frame30(0, 0x00, 0x08, 0x01, b25=0, b26=0x11))
for v in list(range(0, 130, 1)):
    add("patchvol %d" % v, frame30(0, 0x00, 0x06, 0x00, b25=(v >> 4) & 0x0F, b26=v & 0x0F))
add("patchvol 255", frame30(0, 0x00, 0x06, 0x00, b25=0x0F, b26=0x0F))
add("patchvol nibble invalide", frame30(0, 0x00, 0x06, 0x00, b25=0x1F, b26=2))
# non pertinents / mal formes
ok = frame30(0, 0x01, 0x05, 0, b22=2, b24=1, tail=FS)
add("longueur 29", ok[:-1])
add("longueur 31", ok + b"\x00")
add("vide", b"")
b = bytearray(ok); b[0] = 0xF1; add("debut invalide", bytes(b))
b = bytearray(ok); b[3] = 0x00; add("id NUX invalide", bytes(b))
b = bytearray(ok); b[9] = 0x0C; add("cmd 12/0C", bytes(b))
b = bytearray(ok); b[18] = 0x03; add("[18] != 4", bytes(b))
# fuzz deterministe : mutations d'octets sur des trames valides
rng = random.Random(20261004)
bases = [ok, frame30(0, 0x00, 0x08, 0x01, b25=3, b26=9), frame30(0, 0x00, 0x06, 0x00, b25=3, b26=2)]
for i in range(1500):
    b = bytearray(rng.choice(bases))
    for _ in range(rng.randint(1, 4)):
        b[rng.randrange(0, 30)] = rng.choice([0, 1, 2, 4, 5, 6, 8, 0x0C, 0x0F, 0x10, 0x12, 0x64, 0x7F, 0xF0, 0xF7])
    add("fuzz %d" % i, bytes(b))

# 12/10 : reglage en facade (46 octets) - valeur float32 en nibbles LE
def panel(value, ctrl=0):
    b = bytearray(46)
    b[0] = 0xF0; b[1:8] = NUX; b[8] = 0x12; b[9] = 0x10
    b[22] = ctrl
    raw = struct.pack("<f", value)
    for i, x in enumerate(raw):
        b[37 + 2 * i] = (x >> 4) & 0x0F
        b[38 + 2 * i] = x & 0x0F
    b[45] = 0xF7
    return bytes(b)


for v, c in ((52.0, 1), (53.0, 1), (54.0, 1), (100.0, 0x0A), (0.0, 3), (-12.5, 2), (0.25, 5), (99.99, 7)):
    b = panel(v, c)
    exp = {"kind": "panel", "ctrl": c, "value": struct.unpack("<f", struct.pack("<f", v))[0]}
    cases.append({"name": "panel %s" % v, "hex": b.hex(), "kind": "panel", "exp": exp})
b = bytearray(panel(52.0)); b[40] = 0x1F
cases.append({"name": "panel nibble invalide", "hex": bytes(b).hex(), "kind": "panel", "exp": None})
cases.append({"name": "panel longueur 45", "hex": panel(52.0)[:-1].hex(), "kind": "panel", "exp": None})

with open(os.path.join(HERE, "expected_notify.json"), "w") as f:
    json.dump(cases, f)
print(len(cases), "cas ecrits")
