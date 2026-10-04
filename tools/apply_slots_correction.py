#!/usr/bin/env python3
"""Correction de l'appartenance aux blocs (champ `slots`) de 26 modeles de ref/data/gp200_models_all.json.

Constat (Alan Sheers, valide sur la pedale de Rudy le 4/10/2026) :
  * PRE : le menu de la pedale (31 modeles) contient OD 9, Yellow OD, Penesas, Super OD, Blues OD, Auto Swell,
    Hold, Freeze ; il ne contient PAS Guitar EQ 1/2, Bass EQ 1/2, Mess EQ, Hyper EQ, Detune, Bit Smash.
    (8 entrees + 8 sorties : le total reste 31, d'ou un controle par comptage aveugle.)
  * SnapTone : le menu DST de la pedale donne SnapTone 1..5 = ids 5..9 (capture 12/0C du 4/10/2026 : module 2,
    categorie 15, ids 5,6,7,8,9). Donc ids 0-4 ("SnapTone 1-5" dans la base) = AMP, ids 5-9 ("SnapTone 6-10") = DST.
    Les ids 0-4 cote AMP se deduisent (5 + 5) ; ils n'ont pas ete lus directement.
  * Source des menus : <Catalog Name="BLOCK"> de algorithm.xml (editeur Valeton 1.8.1, SHA-256 D95D6E01...8E0E),
    pedale en firmware V1.8.0.

Seul `slots` change (aucun parametre, aucune valeur). Le script est idempotent et refuse de s'appliquer si l'etat
de depart n'est pas celui attendu (ni avant, ni apres correction).

    python3 tools/apply_slots_correction.py            # applique
    python3 tools/apply_slots_correction.py --check    # verifie seulement (code 0 = base corrigee)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "ref", "data", "gp200_models_all.json")

# nom -> (slots avant, slots apres)
CHANGES = {
    "OD 9":        (["DST"], ["DST", "PRE"]),
    "Yellow OD":   (["DST"], ["DST", "PRE"]),
    "Penesas":     (["DST"], ["DST", "PRE"]),
    "Super OD":    (["DST"], ["DST", "PRE"]),
    "Blues OD":    (["DST"], ["DST", "PRE"]),
    "Auto Swell":  (["MOD", "NR"], ["MOD", "NR", "PRE"]),
    "Hold":        (["MOD"], ["MOD", "PRE"]),
    "Freeze":      (["MOD"], ["MOD", "PRE"]),
    "Guitar EQ 1": (["EQ", "PRE"], ["EQ"]),
    "Guitar EQ 2": (["EQ", "PRE"], ["EQ"]),
    "Bass EQ 1":   (["EQ", "PRE"], ["EQ"]),
    "Bass EQ 2":   (["EQ", "PRE"], ["EQ"]),
    "Mess EQ":     (["EQ", "PRE"], ["EQ"]),
    "Hyper EQ":    (["EQ", "PRE"], ["EQ"]),
    "Detune":      (["MOD", "PRE"], ["MOD"]),
    "Bit Smash":   (["MOD", "PRE"], ["MOD"]),
}
for i in range(5):
    CHANGES["SnapTone %d" % (i + 1)] = (["DST"], ["AMP"])        # ids 0-4
    CHANGES["SnapTone %d" % (i + 6)] = (["AMP"], ["DST"])        # ids 5-9

# Menu PRE releve sur la pedale d'Alan (firmware 1.8.0), dans l'ordre du menu
PRE_MENU = ["COMP", "COMP4", "S-Comp", "Micro Boost", "AC Boost", "B-Boost", "P-Boost", "14 Boost", "FAT BB", "Boost",
            "OD 9", "Yellow OD", "Penesas", "Super OD", "Blues OD", "AC Refiner", "AC Sim", "T-Wah", "A-WAH",
            "Step Filter", "OCTA", "Pitch", "P-Bend", "Hammy", "Harmonizer 1", "Harmonizer 2", "Ring Mod", "Saturate",
            "Auto Swell", "Hold", "Freeze"]
COUNTS = {"PRE": 31, "WAH": 6, "DST": 43, "AMP": 76, "NR": 4, "EQ": 6, "MOD": 28, "DLY": 22, "RVB": 15, "VOL": 1}


def verify(d):
    """Etat apres correction : renvoie la liste des anomalies."""
    bad = []
    by = {m["name"]: m for m in d if m["name"] in CHANGES}
    for n, (_, after) in CHANGES.items():
        if sorted(by[n]["slots"]) != sorted(after):
            bad.append("%s : slots %r au lieu de %r" % (n, by[n]["slots"], after))
    pre = sorted(m["name"] for m in d if "PRE" in m["slots"])
    if pre != sorted(PRE_MENU):
        bad.append("menu PRE != releve pedale : en trop %r, manquants %r"
                   % (sorted(set(pre) - set(PRE_MENU)), sorted(set(PRE_MENU) - set(pre))))
    for s, n in COUNTS.items():
        got = sum(1 for m in d if s in m["slots"])
        if got != n:
            bad.append("bloc %s : %d modeles, attendu %d" % (s, got, n))
    snap = {m["id"]: m["slots"] for m in d if m["cat"] == 15}
    if sorted(snap) != list(range(10)) or any(snap[i] != ["AMP"] for i in range(5)) \
            or any(snap[i] != ["DST"] for i in range(5, 10)):
        bad.append("SnapTone : ids 0-4 doivent etre AMP, ids 5-9 DST (obtenu %r)" % snap)
    return bad


def main():
    check = "--check" in sys.argv[1:]
    d = json.load(open(DB, encoding="utf-8"))
    assert len(d) == 216, "216 modeles attendus"
    # "Tube" existe deux fois (DST et DLY) : sans importance ici, les 26 noms corriges sont uniques
    for n in CHANGES:
        assert sum(1 for m in d if m["name"] == n) == 1, "nom absent ou en double : " + n
    if check:
        bad = verify(d)
        print("base corrigee" if not bad else "ECART :\n  " + "\n  ".join(bad))
        return 1 if bad else 0
    if not verify(d):
        print("rien a faire : la base est deja corrigee")
        return 0
    n = 0
    for m in d:
        if m["name"] in CHANGES:
            old, new = CHANGES[m["name"]]
            if sorted(m["slots"]) != sorted(old):
                sys.exit("ETAT INATTENDU : %s a slots=%r (attendu %r) -- aucune ecriture" % (m["name"], m["slots"], old))
            m["slots"] = list(new)
            n += 1
    assert n == 26, n
    bad = verify(d)
    if bad:
        sys.exit("verification apres correction KO :\n  " + "\n  ".join(bad))
    with open(DB, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(d, ensure_ascii=True, indent=2))
    print("%d modeles corriges (slots uniquement) ; menu PRE = releve pedale (31), comptes des autres blocs inchanges" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
