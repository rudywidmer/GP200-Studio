"""GP-150 / GP-180 : protocole SysEx USB -- reference Python (l'oracle du moteur JS gp150usb.js).

Trame brute (a l'interieur de F0 .. F7) :   7F  K  Llo Lhi  Olo Ohi  T  I  <quartets>
  K  = CRC-8 (poly 0x31, init 0) de raw[2:], sur 7 bits
  L  = longueur totale du message logique, O = decalage de ce morceau (deux octets de 7 bits)
  T  = numero de transaction (repris dans l'accuse de reception), I = indice du morceau
Message logique :   01  C  Nlo Nhi  <charge utile>        (C = CRC-8 de la charge utile, N = sa longueur)
La charge utile est transmise en quartets (un octet = deux demi-octets, poids fort d'abord).
"""
import math
import struct

import gp150lib as L

CHUNK = 119                                    # octets logiques par trame de 248 octets
MODULE_FF = {m: i for i, m in enumerate(L.MODULES)}
HANDSHAKE_HOST = [0x7F, 0x51, 0x00, 0x00, 0x01, 0x03, 0x00, 0x00]
HANDSHAKE_DEVICE = [0x7F, 0x4D, 0x00, 0x00, 0x02, 0x03, 0x00, 0x00]


def crc8(data):
    c = 0
    for b in data:
        c ^= b
        for _ in range(8):
            c = ((c << 1) ^ 0x31) & 0xFF if c & 0x80 else (c << 1) & 0xFF
    return c


def to_nibbles(data):
    out = []
    for b in data:
        out += [(b >> 4) & 15, b & 15]
    return out


def from_nibbles(n):
    return [(n[i] << 4) | n[i + 1] for i in range(0, len(n) - len(n) % 2, 2)]


def wire_tag(raw):
    return crc8(raw[2:]) & 0x7F


def logical(payload):
    """01 C Nlo Nhi + charge utile."""
    return [0x01, crc8(payload), len(payload) & 0xFF, len(payload) >> 8] + list(payload)


def frames(stream, t, first_index=0):
    """Decoupe un message logique en trames brutes (119 octets logiques chacune)."""
    total = len(stream)
    out = []
    for idx, off in enumerate(range(0, max(total, 1), CHUNK)):
        part = stream[off:off + CHUNK]
        raw = [0x7F, 0, total & 0x7F, total >> 7, off & 0x7F, off >> 7, t & 0x7F, (first_index + idx) & 0x7F] + to_nibbles(part)
        raw[1] = wire_tag(raw)
        out.append(raw)
    return out


def ack(t):
    raw = [0x7F, 0, 0, 0, 0, 0, t & 0x7F, 0]
    raw[1] = wire_tag(raw)
    return raw


def sysex(raw):
    return [0xF0] + list(raw) + [0xF7]


# ------------------------------------------------------------------ messages
def msg_select(slot, flag=0, t=1):
    """Selectionne le patch (flag 0) ou le lit sans le selectionner (flag 1). slot 0xFFFF + flag 1 = patch actif."""
    p = [0x03, 0x03, 0x11, 0x30, 0x11, 0x30, 0x02, 0x00, slot & 0xFF, (slot >> 8) & 0xFF, flag]
    return frames(logical(p), t)[0]


def msg_set_param(module, fxid, alg, value, t=1):
    p = [0x00, 0x03, 0x33, 0x30, 0x33, 0x30, 0x10, 0x00] + list(struct.pack(">I", fxid)) + list(struct.pack("<f", value)) + [MODULE_FF[module], alg, 0, 0]
    return frames(logical(p), t)[0]


def msg_enable(module, on, t=1):
    p = [0x00, 0x03, 0x31, 0x30, 0x31, 0x30, 0x08, 0x00, MODULE_FF[module], 1 if on else 0, 0, 0]
    return frames(logical(p), t)[0]


def msg_model_swap(module, fxid, t=1):
    p = [0x00, 0x03, 0x32, 0x30, 0x32, 0x30, 0x0C, 0x00] + list(struct.pack("<I", fxid)) + [MODULE_FF[module], 0, 0, 0]
    return frames(logical(p), t)[0]


def msg_reorder(order, t=1):
    if sorted(order) != sorted(L.MODULES):
        raise ValueError("order doit contenir les 12 modules une fois")
    p = [0x00, 0x03, 0x34, 0x30, 0x34, 0x30, 0x10, 0x00] + [MODULE_FF[m] for m in order]
    return frames(logical(p), t)[0]


def msg_write_preset(body, slot, t=7):
    """Ecriture d'un preset complet dans un emplacement, sans le selectionner : 1136 octets logiques, ~10 trames."""
    if len(body) != L.FILE_SIZE:
        raise ValueError("preset de %d octets au lieu de %d" % (len(body), L.FILE_SIZE))
    if not 0 <= slot < L.SLOT_COUNT:
        raise ValueError("emplacement hors 0..199")
    b = list(body)
    b[4] = slot
    payload = [0x01, 0x03, 0x11, 0x30] + b
    return frames(logical(payload), t)


# ------------------------------------------------------------------ reception
def parse_chunk(inner):
    """inner = octets entre F0 et F7 -> (t, indice, quartets) ou None si ce n'est pas une trame de donnees."""
    if len(inner) <= 8 or inner[0] != 0x7F:
        return None
    return inner[6], inner[7], list(inner[8:])


def reassemble(chunks):
    """chunks = [(indice, quartets)] d'une meme transaction -> octets, ou None si incomplet (indices 1..n requis)."""
    d = {}
    for i, n in chunks:
        d[i] = n
    if not d:
        return None
    n = max(d)
    if any(i not in d for i in range(1, n + 1)):
        return None
    nib = []
    for i in range(1, n + 1):
        nib += d[i]
    return from_nibbles(nib)


PREFIX = 8


def body_of(stream):
    if len(stream) < PREFIX + L.FILE_SIZE:
        return None
    b = stream[PREFIX:PREFIX + L.FILE_SIZE]
    return bytes(b) if bytes(b[:4]) == L.HEADER else None


def decode_names(stream):
    """Reponse « noms » : 12 octets d'en-tete + 200 enregistrements de 20 octets (u32 + 16 caracteres)."""
    if len(stream) < 12 or (len(stream) - 12) % 20:
        raise ValueError("reponse des noms inattendue (%d octets)" % len(stream))
    out = []
    for i in range((len(stream) - 12) // 20):
        rec = stream[12 + 20 * i: 32 + 20 * i]
        idx = rec[0] | rec[1] << 8 | rec[2] << 16 | rec[3] << 24
        nm = ""
        for c in rec[4:]:
            if c == 0:
                break
            nm += chr(c)
        out.append((idx, nm.strip()))
    return out


def bank_and_pc(slot):
    """Selection CC0 + PC (fiable seulement une fois par session) : emplacement 0..199 -> (banque, programme)."""
    if not 0 <= slot <= 199:
        raise ValueError("emplacement hors 0..199")
    return (0, slot) if slot < 128 else (1, slot - 128)


# ------------------------------------------------------------------ catalogues, infos du patch, messages de la pedale
def msg_read(code, t=0):
    """Requete de catalogue : 0x70 info, 0x10 noms, 0x42 IR utilisateur, 0x52 SnapTones, 0x92 NAM."""
    return frames(logical([0x03, 0x01, code, 0x10, code, 0x10, 0x02, 0x00]), t)[0]


def msg_preset_info(data80, t=1):
    """Structure « infos du patch » (80 octets pris dans le corps lu : BPM, volume du patch, ...)."""
    if len(data80) != 80:
        raise ValueError("80 octets attendus")
    return frames(logical([0x00, 0x03, 0x20, 0x30, 0x20, 0x30, 0x50, 0x00] + list(data80)), t)[0]


def payload_of(stream):
    if not stream or len(stream) < 4 or stream[0] != 1:
        return None
    n = stream[2] | stream[3] << 8
    return list(stream[4:]) if len(stream) == 4 + n else None


def body_of_stream(stream):
    if not stream or len(stream) != PREFIX + L.FILE_SIZE:
        return None
    if list(stream[4:8]) != [3, 3, 0x11, 0x30]:
        return None
    b = bytes(stream[PREFIX:])
    return b if b[:4] == L.HEADER else None


def parse_notify(stream):
    """Message spontane de la pedale (message logique complet) -> evenement (dict) ou None."""
    body = body_of_stream(stream)
    if body is not None:
        return {"kind": "body", "slot": body[4]}
    p = payload_of(stream)
    if not p or len(p) < 8 or p[0] != 3 or p[1] != 3:
        return None
    code = p[2] | p[3] << 8
    if code == 0x3031 and len(p) >= 10 and p[8] <= 11 and p[9] <= 1:
        return {"kind": "bypass", "module": p[8], "on": p[9] == 1}
    if code == 0x3033 and len(p) >= 18 and p[16] <= 11:
        v = struct.unpack("<f", bytes(p[12:16]))[0]
        if not math.isfinite(v):
            return None
        return {"kind": "panel", "module": p[16], "param": p[17], "value": v, "fxid": struct.unpack("<I", bytes(p[8:12]))[0]}
    if code == 0x3032 and len(p) >= 13 and p[12] <= 11:
        return {"kind": "model", "module": p[12], "fxid": struct.unpack("<I", bytes(p[8:12]))[0]}
    if code == 0x3034 and len(p) >= 20:
        return {"kind": "order", "order": list(p[8:20])}
    if code == 0x3020 and len(p) >= 12:
        return {"kind": "patchvol", "v": struct.unpack("<h", bytes(p[10:12]))[0], "bpm": struct.unpack("<h", bytes(p[8:10]))[0]}
    return None


def device_frames(stream, t):
    """Comment la pedale envoie un message : memes trames, indices a partir de 1."""
    return frames(stream, t, first_index=1)
