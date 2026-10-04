"""Prepare les donnees embarquees dans la page web a partir du code PYTHON.

Source unique de verite : le catalogue compact et tous les prompts viennent de
gp200_agent.py (pas de re-implementation en JS -> pas de derive possible).
"""
import base64, csv, json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Dossier contenant gp200lib.py, gp200_agent.py, gp200_i18n.py, template.prst et data/
REF = os.environ.get("GP200_REF") or os.path.join(HERE, "..", "ref")
sys.path.insert(0, REF)
import gp200lib as L          # noqa: E402
import gp200_agent as A       # noqa: E402

PARAM_KEYS = ("name", "slot", "min", "max", "step", "default")


def trimmed_tables(tb):
    models = []
    for m in tb.models:
        models.append({
            "id": m["id"], "cat": m["cat"], "name": m["name"],
            "category_label": m.get("category_label", ""),
            "params": [{k: p[k] for k in PARAM_KEYS if k in p} for p in m["params"]],
            **({"slots": list(m["slots"])} if "slots" in m else {}),
            **({"defcab": m["defcab"]} if m.get("defcab") is not None else {}),
        })
    cabs = [{"model_id": c["model_id"], "name": c["name"], "user_slot": bool(c["user_slot"]),
             "speaker_config": c.get("speaker_config", "")} for c in tb.cabs]
    desc = {k: {"short": v.get("short", "")} for k, v in tb.desc.items()}
    return {"models": models, "cabs": cabs, "desc": desc}


def prompts(tb):
    pk = {k: A.pickup_instruction(k) for k in ("auto", "humbucker", "single", "p90", "active")}
    return {
        "SYSTEM": A.SYSTEM,
        "catalogFull": A.compact_catalog(tb, light=False),
        "catalogLight": A.compact_catalog(tb, light=True),
        "ROLE_HINT": A.ROLE_HINT,
        "pickup": pk,
        "lang": {k: A.lang_instruction(k) for k in ("fr", "en", "es")},
        "SYSTEM_REFINE": A.SYSTEM_REFINE,
        "SYSTEM_LIVE_READY": A.SYSTEM_LIVE_READY,
        "LIVE_READY_INSTRUCTION": A.LIVE_READY_INSTRUCTION,
    }


def providers():
    out = {}
    for k, v in A.PROVIDERS.items():
        out[k] = {kk: vv for kk, vv in v.items() if isinstance(vv, (str, int, float, bool, list, dict, type(None)))}
    return out


def template_b64():
    return base64.b64encode(open(os.path.join(REF, "template.prst"), "rb").read()).decode()


def load_tables():
    return L.Tables(os.path.join(REF, "data"))


# ------------------------------------------------------------ audit autoprobe
STATUS_CODE = {"ok_after_preset_load": "a", "inaudible_with_test_signal": "i", "not_verified": "n"}


def audit():
    """Donnees de l'audit automatique du 04/10 (gp200_autoprobe.py), embarquees telles quelles.

    ps : "id,cat" -> {slot: code} pour les seuls reglages qui NE repondent PAS en direct
         (a = muet en live mais pris en compte apres chargement par preset, i = inaudible avec le signal
         de test, n = non verifie). Les 978 autres (ok_live) ne sont pas listes.
    lv : "id,cat" -> niveau de sortie (dBFS, bruit rose a -26 dBFS, reglages par defaut) pour AMP et DST.
    med : mediane de ces niveaux pour les amplis / distorsions hors SnapTone.
    """
    d = os.path.join(REF, "audit")
    ps = {}
    for e in json.load(open(os.path.join(d, "gp200_param_support.json"), encoding="utf-8")):
        bad = {str(p["slot"]): STATUS_CODE[p["status"]] for p in e["params"] if p["status"] in STATUS_CODE}
        if bad:
            ps["%d,%d" % (e["id"], e["cat"])] = bad
    lv, groups = {}, {"AMP": [], "DST": []}
    for r in csv.DictReader(open(os.path.join(d, "gp200_model_levels.csv"), encoding="utf-8")):
        if r["module"] not in groups:
            continue
        v = float(r["level_noise_dBFS"])
        lv["%s,%s" % (r["id"], r["cat"])] = round(v, 1)
        if r["cat"] != "15":
            groups[r["module"]].append(v)
    med = {k: round(statistics.median(v), 1) for k, v in groups.items()}
    return {"ps": ps, "lv": lv, "med": med}
