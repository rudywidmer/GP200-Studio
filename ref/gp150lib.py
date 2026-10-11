"""GP-150 / GP-180 : format .prst, catalogue, encodage / decodage -- reference Python (l'oracle du moteur JS gp150core.js).

Meme role que gp200lib.py pour le GP-200. Le format (1128 octets, entete 11 30 64 04) est partage par le GP-150 et le GP-180 ;
seule la valeur initiale du CRC-16 du fichier differe.

Sources : projet valeton-gp150-editor (MIT, voir data/GP150_THIRD_PARTY.md).  Aucune donnee du depot GP-180 (GPL) n'est copiee.
"""
import json, math, os, re, struct

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

FILE_SIZE = 1128
HEADER = bytes([0x11, 0x30, 0x64, 0x04])
OFF_SLOT = 0x04
OFF_BPM = 0x24
OFF_PATCH_VOL = 0x26
OFF_NAM = 0x2A
OFF_NAME = 0x2C
LEN_NAME = 13
OFF_ORDER = 0x78
MODULES = ["PRE", "WAH", "DST", "NS", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"]
N_MODULES = 12
MODEL_OFF0 = 0x88
MODULE_STRIDE = 0x44
N_FLOATS = 10                    # algId 0..9 dans le catalogue
FXID_NONE = 100663299
CHECK_OFF, CHECK_START, CHECK_END = 0x0E, 0x10, 1124
CHECK_INIT = {"gp150": 0xE011, "gp180": 0x2380}
SLOT_COUNT = 200
NAME_MAX_WRITE = 13


def model_off(k):
    return MODEL_OFF0 + MODULE_STRIDE * k


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower().replace("+", "plus"))


def crc16(buf, init):
    c = init
    for x in buf[CHECK_START:CHECK_END]:
        c ^= x
        for _ in range(8):
            c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
    return c


def fix_checksum(buf, model="gp150"):
    c = crc16(buf, CHECK_INIT[model])
    buf[CHECK_OFF] = c >> 8
    buf[CHECK_OFF + 1] = c & 0xFF
    return buf


def checksum_ok(buf, model="gp150"):
    return crc16(buf, CHECK_INIT[model]) == (buf[CHECK_OFF] << 8 | buf[CHECK_OFF + 1])


def round4(f):
    return round(f, 4)


# ------------------------------------------------------------------ catalogue
class Tables:
    """Catalogue des modeles. model = {id: fxid, cat: indice du module, name, category_label, params:[{name, slot(=algId), min, max, step, default, options?}], slots:[module]}."""

    def __init__(self, path=None):
        raw = json.load(open(path or os.path.join(DATA, "gp150_fxid_ring.json"), encoding="utf-8"))
        self.models = []
        for k, v in raw.items():
            fx = int(k)
            if fx == FXID_NONE:
                # le « modele » vide : sert de reglage de volume au module VOL, et de modele vide aux autres modules
                params = [{"name": p["name"], "slot": p["algId"], "min": p["min"], "max": p["max"], "step": p["step"], "default": p["default"]} for p in v["params"]]
                self.none_params = params
            m = {"id": fx, "cat": v["moduleId"], "name": v["name"], "category_label": v.get("type", ""), "slots": [v["module"] if v["module"] != "N->S" else "NS"],
                 "params": [self._param(p) for p in v["params"]]}
            if v.get("origin"):
                m["origin"] = v["origin"]
            self.models.append(m)
        self.byKey = {(m["id"], m["cat"]): m for m in self.models}
        self._byName = {}
        for m in self.models:
            d = self._byName.setdefault(m["cat"], {})
            k = norm(m["name"])
            if k in d and d[k]["id"] != m["id"]:
                raise ValueError("collision de noms : %r / %r" % (d[k]["name"], m["name"]))
            d[k] = m

    @staticmethod
    def _param(p):
        o = {"name": p["name"], "slot": p["algId"], "min": p["min"], "max": p["max"], "step": p["step"], "default": p["default"]}
        if p.get("options"):
            o["options"] = list(p["options"])
        return o

    def model(self, fxid, cat):
        return self.byKey.get((fxid, cat))

    def models_for_slot(self, slot):
        k = MODULES.index(slot)
        return [m for m in self.models if m["cat"] == k]

    def find(self, slot, name):
        k = MODULES.index(slot)
        m = self._byName.get(k, {}).get(norm(name))
        if m is None:
            raise ValueError("Modele %r introuvable pour le slot %s" % (name, slot))
        return m

    def params_of(self, fxid, cat):
        m = self.byKey.get((fxid, cat))
        if m is not None:
            return m["params"]
        if fxid == FXID_NONE:
            return [self._param({"name": p["name"], "algId": p["slot"], "min": p["min"], "max": p["max"], "step": p["step"], "default": p["default"]}) for p in self.none_params]
        return []


# ------------------------------------------------------------------ lecture / ecriture
def load_skeleton(path=None):
    return bytearray(open(path or os.path.join(DATA, "gp150_skeleton.prst"), "rb").read())


def get_name(buf):
    s = ""
    for i in range(OFF_NAME, OFF_NAME + LEN_NAME):
        if buf[i] == 0:
            break
        s += chr(buf[i])
    return s.strip()


def put_name(buf, name):
    for i in range(LEN_NAME):
        buf[OFF_NAME + i] = ord(name[i]) & 0xFF if i < len(name) else 0


def decode_prst(buf, tables=None, model="gp150"):
    if len(buf) != FILE_SIZE:
        raise ValueError("Taille inattendue: %d (attendu %d)" % (len(buf), FILE_SIZE))
    if bytes(buf[:4]) != HEADER:
        raise ValueError("En-tete inattendu (ce n'est pas un preset GP-150 / GP-180)")
    chain = list(buf[OFF_ORDER:OFF_ORDER + N_MODULES])
    if sorted(chain) != list(range(N_MODULES)):
        chain = None
    out = {"name": get_name(buf), "author": "", "description": "", "chain_order": chain,
           "chain_readable": [MODULES[i] for i in chain] if chain else None, "modules": {}}
    for k, slot in enumerate(MODULES):
        o = model_off(k)
        fx = struct.unpack_from("<I", buf, o)[0]
        floats = [struct.unpack_from("<f", buf, o + 4 + 4 * i)[0] for i in range(N_FLOATS)]
        e = {"module_index": k, "on": bool(buf[o - 4]), "model_id": fx, "category": k, "flags": 0, "raw_floats": [round4(f) for f in floats]}
        if tables is not None:
            m = tables.model(fx, k)
            e["model"] = m["name"] if (m and fx != FXID_NONE) or (m and slot == "VOL") else None
            e["category_label"] = m["category_label"] if m else None
            e["params"] = {p["name"]: floats[p["slot"]] for p in tables.params_of(fx, k) if p["slot"] < N_FLOATS}
        out["modules"][slot] = e
    out["ctrl"] = {}
    out["patch_vol"] = struct.unpack_from("<h", buf, OFF_PATCH_VOL)[0]
    out["bpm"] = struct.unpack_from("<h", buf, OFF_BPM)[0]
    out["slot"] = buf[OFF_SLOT]
    ok = checksum_ok(buf, model)
    out["checksum"] = {"stored": buf[CHECK_OFF] << 8 | buf[CHECK_OFF + 1], "computed": crc16(buf, CHECK_INIT[model]), "valid": ok}
    return out


def _f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def encode_prst(spec, tables, skeleton, model="gp150", strict=True):
    """spec = {name, chain_order (permutation 0..11), modules:{slot:{model, on, params}}, patch_vol?, bpm?}. Retourne (octets, avertissements)."""
    data = bytearray(skeleton)
    if len(data) != FILE_SIZE:
        raise ValueError("Squelette invalide")
    warnings = []
    name = spec.get("name", "Untitled")
    if name is None:
        name = ""
    if strict and len(name) > LEN_NAME:
        raise ValueError("Nom trop long (%d > %d): %r" % (len(name), LEN_NAME, name))
    put_name(data, name)
    chain = spec.get("chain_order")
    if chain is None:
        chain = list(range(N_MODULES))
    if sorted(chain) != list(range(N_MODULES)):
        raise ValueError("chain_order doit etre une permutation de 0..11, recu %r" % (chain,))
    for i in range(N_MODULES):
        data[OFF_ORDER + i] = chain[i]
    if spec.get("patch_vol") is not None:
        struct.pack_into("<h", data, OFF_PATCH_VOL, int(spec["patch_vol"]))
    if spec.get("bpm") is not None:
        struct.pack_into("<h", data, OFF_BPM, int(spec["bpm"]))
    mods = spec.get("modules") or {}
    for k, slot in enumerate(MODULES):
        o = model_off(k)
        ms = mods.get(slot)
        if ms and ms.get("keep"):
            data[o - 4] = 1 if ms.get("on", True) else 0     # modele hors catalogue : bloc conserve tel quel, seul l'etat change
            continue
        has_model = bool(ms) and bool(ms.get("model"))
        old_fx = struct.unpack_from("<I", data, o)[0]
        on = bool(ms.get("on", True)) if ms else False
        if has_model:
            m = tables.find(slot, ms["model"])
            fx = m["id"]
            plist = m["params"]
        else:
            fx = FXID_NONE
            plist = tables.params_of(FXID_NONE, k)
            on = False if slot != "VOL" else True
            ms = ms or {}
        if fx != old_fx:
            # le modele change : les reglages de l'ancien ne doivent pas trainer (sinon les valeurs cachees d'un modele inchange sont conservees)
            for i in range(N_FLOATS):
                struct.pack_into("<f", data, o + 4 + 4 * i, 0.0)
        struct.pack_into("<I", data, o, fx)
        data[o - 4] = 1 if on else 0
        given = dict(ms.get("params") or {})
        known = {norm(p["name"]): p for p in plist}
        for g in given:
            if norm(g) not in known:
                msg = "%s/%s : parametre %r inconnu (attendus: %r)" % (slot, ms.get("model"), g, [p["name"] for p in plist])
                if strict:
                    raise ValueError(msg)
                warnings.append(msg)
        if not has_model and fx == old_fx:
            plist = []          # module deja vide : on ne touche pas a ses valeurs (elles different d'un fichier a l'autre)
        for p in plist:
            val = None
            explicit = False
            for g, v in given.items():
                if norm(g) == norm(p["name"]):
                    val = float(v)
                    explicit = True
                    break
            if val is None:
                val = float(p["default"])
            lo, hi = min(p["min"], p["max"]), max(p["min"], p["max"])
            if not (lo <= val <= hi) and not explicit:
                warnings.append("%s/%s/%s : %g hors [%g..%g], borne" % (slot, ms.get("model"), p["name"], val, lo, hi))
                val = max(lo, min(hi, val))
            if p["slot"] < N_FLOATS:
                struct.pack_into("<f", data, o + 4 + 4 * p["slot"], val)
    set_module_mask(data)
    fix_checksum(data, model)
    return bytes(data), warnings


MASK_OFF = 0x444


def set_module_mask(data):
    m = 0
    for k in range(N_MODULES):
        if data[model_off(k) - 4]:
            m |= 1 << k
    data[MASK_OFF] = m & 0xFF
    data[MASK_OFF + 1] = m >> 8


def decoded_to_spec(d):
    mods = {}
    for slot in MODULES:
        e = d["modules"][slot]
        if not e.get("model") or (slot == "VOL" and e["model_id"] == FXID_NONE):
            if slot == "VOL":
                mods[slot] = {"model": "Volume", "on": e["on"], "params": {k: round4(v) for k, v in e.get("params", {}).items()}}
            elif e["model_id"] != FXID_NONE:
                mods[slot] = {"keep": True, "on": e["on"]}
            else:
                mods[slot] = None
            continue
        mods[slot] = {"model": e["model"], "on": e["on"], "params": {k: round4(v) for k, v in e["params"].items()}}
    return {"name": d["name"], "author": "", "description": "", "chain_order": d["chain_order"] or list(range(N_MODULES)), "modules": mods,
            "patch_vol": d["patch_vol"], "bpm": d["bpm"]}


# ------------------------------------------------------------------ modifications « sur place »
def patch_param(raw, module_idx, param_idx, value, model="gp150"):
    if not (0 <= module_idx < N_MODULES) or not (0 <= param_idx < N_FLOATS):
        raise ValueError("slot/parametre hors limites")
    b = bytearray(raw)
    struct.pack_into("<f", b, model_off(module_idx) + 4 + 4 * param_idx, value)
    return bytes(fix_checksum(b, model))


def patch_on(raw, module_idx, on, model="gp150"):
    b = bytearray(raw)
    b[model_off(module_idx) - 4] = 1 if on else 0
    set_module_mask(b)
    return bytes(fix_checksum(b, model))


def replace_record(raw, other, module_idx, model="gp150"):
    b = bytearray(raw)
    a = model_off(module_idx) - 4
    b[a:a + MODULE_STRIDE] = other[a:a + MODULE_STRIDE]
    set_module_mask(b)
    return bytes(fix_checksum(b, model))


def apply_patch_vol(raw, pv=50, model="gp150"):
    b = bytearray(raw)
    struct.pack_into("<h", b, OFF_PATCH_VOL, pv)
    return bytes(fix_checksum(b, model))


def carry_over(src, raw, model="gp150"):
    b = bytearray(raw)
    b[OFF_PATCH_VOL:OFF_PATCH_VOL + 2] = src[OFF_PATCH_VOL:OFF_PATCH_VOL + 2]
    return bytes(fix_checksum(b, model))
