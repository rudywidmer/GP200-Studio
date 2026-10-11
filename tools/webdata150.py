"""Donnees GP-150 / GP-180 embarquees dans la page, produites a partir de ref/gp150lib.py (source unique, comme webdata.py pour le GP-200)."""
import base64, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.environ.get("GP200_REF") or os.path.join(HERE, "..", "ref")
sys.path.insert(0, REF)
import gp150lib as L       # noqa: E402
import gp150_agent as A    # noqa: E402


def load_tables():
    return L.Tables()


def trimmed_tables(tb):
    models = []
    for m in tb.models:
        o = {"id": m["id"], "cat": m["cat"], "name": m["name"], "category_label": m.get("category_label", ""),
             "params": [dict(p) for p in m["params"]], "slots": list(m["slots"])}
        if m.get("origin"):
            o["origin"] = m["origin"]
        models.append(o)
    return {"models": models, "desc": {}}


def skeleton_b64():
    return base64.b64encode(bytes(L.load_skeleton())).decode()


def prompts(tb):
    """Consignes IA du GP-150 / GP-180 : tout vient de ref/gp150_agent.py (source unique)."""
    return {
        "SYSTEM": A.SYSTEM,
        "catalogFull": A.compact_catalog(tb, light=False),
        "catalogLight": A.compact_catalog(tb, light=True),
        "ROLE_HINT": A.ROLE_HINT,
        "pickup": {k: A.pickup_instruction(k) for k in ("auto", "humbucker", "single", "p90", "active")},
        "lang": {k: A.lang_instruction(k) for k in ("fr", "en", "es")},
        "SYSTEM_REFINE": A.SYSTEM_REFINE,
        "SYSTEM_LIVE_READY": A.SYSTEM_LIVE_READY,
        "LIVE_READY_INSTRUCTION": A.LIVE_READY_INSTRUCTION,
    }
