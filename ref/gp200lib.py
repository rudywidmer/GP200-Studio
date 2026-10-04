#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gp200lib — bibliotheque coeur Valeton GP-200 (.prst)

Reverse-engineere depuis le firmware V1.8.0 + patchs reels.
Toutes les tables proviennent de l'extraction firmware (voir data/).

Concepts cles
-------------
* Un modele est identifie par le COUPLE (model_id, category). L'id seul est
  ambigu : (117, cat 7) = Foxy Bass mais (117, cat 8) = Mini Bass.
* L'espace d'id est CREUX. L'id n'est PAS l'index dans la liste du manuel.
* Chaque parametre a un `slot` = index du float dans le payload. Il n'est PAS
  toujours egal a sa position (ex. Ping Pong : slots [0,2,1,3,4]).

API
---
    tb = Tables()                       # charge data/
    patch = decode_prst("x.prst")       # -> dict lisible
    raw   = encode_prst(spec, tb)       # -> bytes prets a ecrire
"""
import json
import os
import re
import struct

# ---------------------------------------------------------------- format .prst
FILE_SIZE      = 1224
OFF_NAME       = 0x44   # char[16]
OFF_AUTHOR     = 0x54   # char[16]
OFF_DESCRIPTION= 0x64   # char[40]
LEN_NAME       = 16
LEN_AUTHOR     = 16
LEN_DESCRIPTION= 40
REC_MAGIC      = b"\x14\x00\x44\x00"   # uint16 20, uint16 68
RECORD_SIZE    = 72
PAYLOAD_SIZE   = 64
N_MODULES      = 11
N_SLOTS        = 15     # floats utilisables par module (slots 0..14)
CHECKSUM_MAGIC = 196

# Table CTRL : 8 enregistrements de 12 o a 0x460, en-tete "0f 00 08 00",
# octet +4 = index CTRL (0..7 = CTRL 1..8), uint32 LE a +8 = masque des modules
# bascules (bit k = MODULES[k], index de module, PAS position dans la chaine).
# CONFIRME par 2 exports de l'editeur officiel (03/10/2026, "VAL Solo Fid",
# chaine NR WAH DST PRE ...) : CTRL3 -> PRE = 0x01, CTRL3 -> DST = 0x04 ;
# seuls l'octet 0x480 et le checksum different. Un masque peut cumuler
# plusieurs modules.
OFF_CTRL       = 0x460
CTRL_REC_SIZE  = 12
N_CTRL         = 8

MODULES = ["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"]
MODULE_INDEX = {m: i for i, m in enumerate(MODULES)}

# categorie ecrite par defaut dans le slot quand on ne precise rien
CATEGORY_BY_SLOT = {"PRE": 0, "WAH": 5, "DST": 3, "AMP": 7, "NR": 0, "CAB": 10,
                    "EQ": 1, "MOD": 4, "DLY": 11, "RVB": 12, "VOL": 6}

# Modele de repli pour un slot non precise.
#
# AUCUN des 128 presets d'usine ne laisse un slot vide : l'appareil garde
# toujours un modele valide dans les 11 slots et se contente de l'octet on/off
# pour desactiver. Ecrire un payload nul mettrait (id=0, cat=0) dans le slot,
# c'est-a-dire le modele COMP (cat 0) -- une categorie que la plupart des slots
# n'acceptent pas. Le slot VOL est le cas critique : il vaut (3, cat 6) sur
# 128/128 presets.
#
# Valeurs choisies = modele le plus frequent observe dans les presets d'usine.
SLOT_FALLBACK = {
    "PRE": "COMP",         # 48/128
    "WAH": "V-Wah",        # 102/128
    "DST": "Green OD",     # 61/128
    "AMP": "J-120 CL",     # 10/128 (48 valeurs distinctes : pas de dominante)
    "NR":  "Gate 1",       # 122/128
    "CAB": "Mess",         # 8/128 (50 valeurs distinctes)
    "EQ":  "Guitar EQ 1",  # 58/128
    "MOD": "G-Chorus",     # 51/128
    "DLY": "Pure",         # 34/128
    "RVB": "Room",         # 35/128
    "VOL": "Volume",       # 128/128 -- unanime
}

# categories qu'un slot accepte.
#   "obs" = observe dans les 128 presets usine (certain)
#   "man" = deduit des listes du manuel (probable, non verifie sur materiel)
SLOT_ACCEPTS = {
    "PRE": [0, 1, 3, 4],   # obs: 0,1  | man: 3 (ODs en pre), 4 (Auto Swell/Hold/Freeze)
    "WAH": [5, 1],         # obs: 5,1  (1 = Hammy)
    "DST": [3, 0, 15],     # CONFIRME par les catalogues de algorithm.xml (15 = SnapTone)
    "AMP": [7, 8, 15],     # CONFIRME par les catalogues de algorithm.xml (15 = SnapTone)
    "NR":  [0, 4],         # obs
    "CAB": [10],           # obs
    "EQ":  [1],            # obs
    "MOD": [4, 1],         # obs
    "DLY": [11],           # obs
    "RVB": [12],           # obs
    "VOL": [6],            # obs
}


def _norm(s):
    """Normalise un nom pour un lookup tolerant.

    Le '+' est CONSERVE : il est signifiant chez Valeton (canal boosté).
    'UK 45' et 'UK 45+' sont deux amplis differents ; les confondre ferait
    charger le mauvais modele en silence.
    """
    return re.sub(r"[^a-z0-9+]", "", str(s).lower())


def _put_str(buf, off, length, s):
    """Ecrit une chaine ASCII null-paddee dans un champ de taille fixe."""
    b = str(s).encode("ascii", errors="replace")[:length]
    buf[off:off + length] = b + b"\x00" * (length - len(b))


def _get_str(buf, off, length):
    raw = bytes(buf[off:off + length])
    i = raw.find(b"\x00")
    return raw[:i if i >= 0 else length].decode("latin1")


# ------------------------------------------------------------------- Tables
class Tables:
    """Charge les tables extraites du firmware."""

    def __init__(self, datadir=None):
        if datadir is None:
            datadir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "..", "data")
        self.datadir = datadir
        self.models = json.load(open(os.path.join(datadir, "gp200_models_all.json"),
                                     encoding="utf-8"))
        self.cabs = json.load(open(os.path.join(datadir, "gp200_cabs.json"),
                                   encoding="utf-8"))
        try:
            self.presets = json.load(open(os.path.join(datadir,
                                          "gp200_factory_presets.json"),
                                          encoding="utf-8"))
        except FileNotFoundError:
            self.presets = []

        # Descriptions officielles (description_en.xml de l'editeur Valeton).
        # Clef "cat,id" -> {name, short, full}. Optionnel : l'absence du fichier
        # ne doit rien casser, le catalogue reste utilisable sans.
        try:
            self.desc = json.load(open(os.path.join(datadir,
                                       "gp200_descriptions.json"),
                                       encoding="utf-8"))
        except FileNotFoundError:
            self.desc = {}

        self.by_key = {(m["id"], m["cat"]): m for m in self.models}
        self.cab_by_id = {c["model_id"]: c for c in self.cabs if not c["user_slot"]}
        self.cab_user = {c["model_id"]: c for c in self.cabs if c["user_slot"]}

        # Index par nom normalise, avec detection de collision : deux modeles
        # d'une meme categorie qui se normalisent pareil rendraient le lookup
        # silencieusement faux (le dernier ecraserait le premier).
        self._by_name = {}
        for m in self.models:
            d = self._by_name.setdefault(m["cat"], {})
            k = _norm(m["name"])
            if k in d and d[k]["id"] != m["id"]:
                raise RuntimeError(
                    "Collision de normalisation en cat %d : %r et %r -> %r. "
                    "Corriger _norm()." % (m["cat"], d[k]["name"], m["name"], k))
            d[k] = m
        self._cab_by_name = {_norm(c["name"]): c for c in self.cabs
                             if not c["user_slot"]}

    # -- lookups ---------------------------------------------------------
    def description(self, model_id, category, full=False):
        """Description officielle (description_en.xml). '' si inconnue.

        full=False -> 1re phrase : l'identification du materiel.
        full=True  -> le texte complet.
        """
        d = self.desc.get("%d,%d" % (category, model_id))
        return (d["full"] if full else d["short"]) if d else ""

    def model(self, model_id, category):
        """Modele exact par (id, categorie). None si inconnu."""
        return self.by_key.get((model_id, category))

    def cab(self, model_id, user=False):
        return (self.cab_user if user else self.cab_by_id).get(model_id)

    def find(self, slot, name):
        """Resout un nom de modele pour un slot donne.

        Cherche dans toutes les categories que le slot accepte.
        Renvoie (model_dict, category). Leve ValueError si introuvable ou
        ambigu -- on ne devine JAMAIS un id.
        """
        if slot not in SLOT_ACCEPTS:
            raise ValueError("Slot inconnu: %r (attendus: %s)" % (slot, MODULES))
        target = _norm(name)

        if slot == "CAB":
            c = self._cab_by_name.get(target)
            if c is None:
                raise ValueError("CAB %r introuvable. Voir data/gp200_cabs.json" % name)
            return c, 10

        hits = []
        for cat in SLOT_ACCEPTS[slot]:
            m = self._by_name.get(cat, {}).get(target)
            if m is not None:
                hits.append((m, cat))
        if not hits:
            raise ValueError(
                "Modele %r introuvable pour le slot %s (categories %s). "
                "Verifier l'orthographe exacte dans data/models_*.json."
                % (name, slot, SLOT_ACCEPTS[slot]))
        if len(hits) > 1:
            raise ValueError("Modele %r ambigu pour %s : %s"
                             % (name, slot, [(h[0]["id"], h[1]) for h in hits]))
        return hits[0]

    def params_of(self, model_id, category):
        """Liste ordonnee des parametres (avec slot/min/max/step/default)."""
        if category == 10:
            m = self.by_key.get((0, 10))     # bloc "CAB IR", commun a tous les cabs
        else:
            m = self.by_key.get((model_id, category))
        return m["params"] if m else []


    def models_for_slot(self, slot):
        """Retourne les modeles valides pour ce slot, groupes par categorie.

        Utilise le champ 'slots' de chaque modele (issu de l'analyse firmware
        V1.8.0) pour un filtrage exact, en respectant l'ordre de SLOT_ACCEPTS.
        Retourne une liste de (model_dict, category).
        """
        if slot == "CAB":
            return [(c, 10) for c in self.cabs if not c["user_slot"]]
        result = []
        seen = set()
        for cat in SLOT_ACCEPTS.get(slot, []):
            for m in self.models:
                if m["cat"] != cat:
                    continue
                if "slots" in m and slot not in m["slots"]:
                    continue
                key = (m["id"], m["cat"])
                if key not in seen:
                    seen.add(key)
                    result.append((m, cat))
        return result

    def models_for_slot_by_cat(self, slot):
        """Meme chose mais retourne un dict {cat: [model_dict, ...]}."""
        from collections import defaultdict
        grouped = defaultdict(list)
        for m, cat in self.models_for_slot(slot):
            grouped[cat].append(m)
        return dict(grouped)


# ------------------------------------------------------------------- decode
def decode_prst(path, tables=None):
    """Decode un .prst en dict lisible."""
    data = open(path, "rb").read()
    if len(data) != FILE_SIZE:
        raise ValueError("Taille inattendue: %d (attendu %d)" % (len(data), FILE_SIZE))

    rec0 = data.find(REC_MAGIC)
    if rec0 < 0:
        raise ValueError("Enregistrements de module introuvables")

    chain = list(data[rec0 - 12:rec0 - 1])
    if sorted(chain) != list(range(N_MODULES)):
        chain = None

    out = {
        "file": os.path.basename(path),
        "name": _get_str(data, OFF_NAME, LEN_NAME),
        "author": _get_str(data, OFF_AUTHOR, LEN_AUTHOR),
        "description": _get_str(data, OFF_DESCRIPTION, LEN_DESCRIPTION),
        "chain_order": chain,
        "chain_readable": [MODULES[i] for i in chain] if chain else None,
        "modules": {},
    }

    for k in range(N_MODULES):
        o = rec0 + k * RECORD_SIZE
        h1, h2, midx, on, h3 = struct.unpack_from("<HHBBH", data, o)
        mid, flags, cat = struct.unpack_from("<HBB", data, o + 8)
        floats = struct.unpack_from("<%df" % N_SLOTS, data, o + 12)

        slot = MODULES[midx] if midx < N_MODULES else "?%d" % midx
        entry = {
            "module_index": midx, "on": bool(on),
            "model_id": mid, "category": cat, "flags": flags,
            "raw_floats": [round(f, 4) for f in floats],
        }
        if tables is not None:
            if cat == 10:
                c = tables.cab(mid) or tables.cab(mid, user=True)
                entry["model"] = c["name"] if c else None
                entry["user_ir"] = c is not None and c.get("user_slot", False)
            else:
                m = tables.model(mid, cat)
                entry["model"] = m["name"] if m else None
                entry["category_label"] = m["category_label"] if m else None
            # NE PAS arrondir : la valeur exacte du float32 doit survivre
            # a un cycle decode -> encode (ex. Gain = 67.62440490722656).
            entry["params"] = {p["name"]: floats[p["slot"]]
                               for p in tables.params_of(mid, cat)
                               if p["slot"] < N_SLOTS}
        out["modules"][slot] = entry

    out["ctrl"] = {"CTRL%d" % (n + 1): mods
                   for n, mods in enumerate(read_ctrl(data)) if mods}

    exp = checksum(data)
    got = struct.unpack_from(">H", data, len(data) - 2)[0]
    out["checksum"] = {"stored": got, "computed": exp, "valid": exp == got}
    return out


# ------------------------------------------------------------------- encode
def checksum(data):
    """(somme de tous les octets sauf les 8 derniers + 196) & 0xFFFF"""
    return (sum(data[:-8]) + CHECKSUM_MAGIC) & 0xFFFF


def read_ctrl(data):
    """-> liste de 8 listes de modules bascules par CTRL 1..8."""
    res = []
    for n in range(N_CTRL):
        o = OFF_CTRL + n * CTRL_REC_SIZE
        mask = struct.unpack_from("<I", data, o + 8)[0]
        res.append([MODULES[k] for k in range(N_MODULES) if mask >> k & 1])
    return res


def write_ctrl(data, ctrl):
    """Ecrit les affectations CTRL. ctrl = {3: ["PRE"], "CTRL1": ["DST"], ...}.

    Seuls les CTRL cites sont modifies ; une liste vide desassigne.
    """
    for key, mods in ctrl.items():
        n = int(str(key).upper().replace("CTRL", "").strip())
        if not 1 <= n <= N_CTRL:
            raise ValueError("CTRL %r hors 1..%d" % (key, N_CTRL))
        if isinstance(mods, str):
            mods = [mods]
        mask = 0
        for m in mods or []:
            m = str(m).upper()
            if m not in MODULE_INDEX:
                raise ValueError("Module %r inconnu (attendus: %s)" % (m, MODULES))
            mask |= 1 << MODULE_INDEX[m]
        o = OFF_CTRL + (n - 1) * CTRL_REC_SIZE
        if data[o:o + 4] != b"\x0f\x00\x08\x00" or data[o + 4] != n - 1:
            raise ValueError("Table CTRL inattendue a 0x%x" % o)
        struct.pack_into("<I", data, o + 8, mask)
    return data


def neutralize_assignments(data):
    """Desassigne les tables EXP/CTRL heritees du template.

    Les 9 enregistrements de 16 o a 0x3b8 portent leur cible en octet +5 ;
    0xff = non assigne (valeur presente dans 7 des 9 enregistrements du
    Petrucci, donc demontrablement valide). Idem pour les 3 x 8 o a 0x448.
    NON VERIFIE SUR MATERIEL -- desactivable via keep_assignments=True.
    """
    for i in range(9):
        data[0x3b8 + i * 16 + 5] = 0xFF
    for i in range(3):
        data[0x448 + i * 8 + 5] = 0xFF
    return data


def encode_prst(spec, tables, template=None, keep_assignments=False,
                strict=True, fill_empty_slots=True):
    """Construit un .prst valide a partir d'un spec.

    spec = {
      "name": "Rock n Hell RYTH",          # <= 16 car.
      "author": "Rudy",                    # <= 16 car., optionnel
      "description": "metal rythmique",    # <= 40 car., optionnel
      "chain_order": [4,0,1,2,3,5,6,7,8,9,10],   # optionnel, defaut 0..10
      "ctrl": {3: ["PRE"]},                # optionnel : FS -> CTRL n -> modules
      "modules": {
         "AMP": {"model": "EV 51", "on": True,
                 "params": {"Gain": 78, "Bass": 55}},
         "DLY": {"on": False},             # module eteint, modele conserve
         "MOD": None,                      # slot vide
      }
    }

    - Les parametres non precises prennent le DEFAUT DU FIRMWARE.
    - Les valeurs sont bornees a [min, max] du firmware.
    - Un nom de modele inconnu leve ValueError (jamais de fallback devinette).
    - fill_empty_slots (defaut True) : un slot non precise recoit son modele de
      repli (SLOT_FALLBACK) avec on=False, au lieu d'un payload nul. Les 128
      presets d'usine remplissent toujours les 11 slots ; un payload nul
      ecrirait (id=0, cat=0) = COMP, categorie invalide pour la plupart des
      slots. Le slot VOL reste actif (on=True, Volume 100) comme sur 128/128
      presets d'usine et sur le patch reel de reference.
    """
    if template is None:
        template = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "template.prst")
    data = bytearray(open(template, "rb").read())
    if len(data) != FILE_SIZE:
        raise ValueError("Template invalide (%d octets)" % len(data))

    name = spec.get("name", "Untitled")
    if strict and len(name) > LEN_NAME:
        raise ValueError("Nom trop long (%d > %d): %r" % (len(name), LEN_NAME, name))
    _put_str(data, OFF_NAME, LEN_NAME, name)
    _put_str(data, OFF_AUTHOR, LEN_AUTHOR, spec.get("author", ""))
    _put_str(data, OFF_DESCRIPTION, LEN_DESCRIPTION, spec.get("description", ""))

    rec0 = data.find(REC_MAGIC)
    chain = list(spec.get("chain_order", range(N_MODULES)))
    if sorted(chain) != list(range(N_MODULES)):
        raise ValueError("chain_order doit etre une permutation de 0..10, recu %r"
                         % chain)
    data[rec0 - 12:rec0 - 1] = bytes(chain)
    data[rec0 - 1] = 0

    warnings = []
    for k in range(N_MODULES):
        slot = MODULES[k]
        o = rec0 + k * RECORD_SIZE
        ms = spec.get("modules", {}).get(slot)

        if fill_empty_slots and not (ms and ms.get("model")):
            # slot non precise -> modele de repli, desactive (VOL reste actif)
            ms = {"model": SLOT_FALLBACK[slot], "on": slot == "VOL",
                  "params": {"Volume": 100.0} if slot == "VOL" else {}}

        struct.pack_into("<HHBBH", data, o, 20, 68, k,
                         1 if (ms and ms.get("on", True)) else 0, 15)

        payload = bytearray(PAYLOAD_SIZE)
        if ms and ms.get("model"):
            m, cat = tables.find(slot, ms["model"])
            mid = m["model_id"] if cat == 10 else m["id"]
            struct.pack_into("<HBB", payload, 0, mid, 0, cat)

            plist = tables.params_of(mid, cat)
            given = dict(ms.get("params") or {})
            known = {_norm(p["name"]): p for p in plist}
            for g in given:
                if _norm(g) not in known:
                    msg = ("%s/%s : parametre %r inconnu (attendus: %s)"
                           % (slot, m.get("name"), g, [p["name"] for p in plist]))
                    if strict:
                        raise ValueError(msg)
                    warnings.append(msg)

            for p in plist:
                val = None
                explicit = False
                for g, v in given.items():
                    if _norm(g) == _norm(p["name"]):
                        val = float(v)
                        explicit = True
                        break
                if val is None:
                    val = float(p["default"])
                lo, hi = min(p["min"], p["max"]), max(p["min"], p["max"])
                if not (lo <= val <= hi):
                    # Une valeur EXPLICITE hors bornes n'est pas forcement fausse :
                    # en mode Sync, Time/Rate est un index de division rythmique,
                    # hors de la plage ms declaree. On respecte alors ce que
                    # l'appelant fournit (typiquement issu d'un preset decode) et
                    # on ne borne QUE les valeurs par defaut que nous choisissons.
                    if explicit:
                        pass
                    else:
                        warnings.append("%s/%s/%s : %g hors [%g..%g], borne"
                                        % (slot, m.get("name"), p["name"], val, lo, hi))
                        val = max(lo, min(hi, val))
                if p["slot"] < N_SLOTS:
                    struct.pack_into("<f", payload, 4 + 4 * p["slot"], val)

        data[o + 8:o + 8 + PAYLOAD_SIZE] = payload

    if not keep_assignments:
        neutralize_assignments(data)
    if spec.get("ctrl"):
        write_ctrl(data, spec["ctrl"])

    struct.pack_into(">H", data, len(data) - 2, checksum(data))
    return bytes(data), warnings
