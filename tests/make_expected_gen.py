#!/usr/bin/env python3
"""Rejoue generate() PYTHON avec une IA scriptee ; sauvegarde appels, fichiers, erreurs."""
import json, os, random, sys, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import webdata as W
A, L = W.A, W.L
tb = W.load_tables()
random.seed(99)

def valid_spec(name, amp_idx):
    mods = {}
    for slot in L.MODULES:
        if slot in ("NR",) and random.random() < .5:
            continue
        pool = [c["name"] for c in tb.cabs if not c["user_slot"]] if slot == "CAB" else [m["name"] for m, _ in tb.models_for_slot(slot)]
        model = pool[(amp_idx * 7 + len(name)) % len(pool)] if slot in ("AMP", "CAB") else random.choice(pool)
        m, cat = tb.find(slot, model)
        mid = m["model_id"] if cat == 10 else m["id"]
        params = {}
        for p in tb.params_of(mid, cat):
            if random.random() < .6:
                params[p["name"]] = round(random.uniform(min(p["min"], p["max"]), max(p["min"], p["max"])))
        mods[slot] = {"model": model, "on": random.random() < .8, "params": params}
    return {"name": name, "author": "T", "description": "desc " + name, "modules": mods}

def section(nom, role, base):
    return {"nom": nom, "role": role, "raison": "r", "variants": [
        {"label": l, "spec": valid_spec("%s %s" % (base, l), i + 1)} for i, l in enumerate("ABC")]}

def payload(secs, artiste="Metallica", titre="Enter Sandman"):
    return {"artiste": artiste, "titre": titre, "recherche": "x", "structure": "y", "sections": secs}

def j(p): return json.dumps(p, ensure_ascii=False)

good1 = payload([section("Intro", "clean", "Intro")])
good2 = payload([section("Intro", "clean", "Intro"), section("Solo", "lead", "Solo")])
bad_model = json.loads(j(good1)); bad_model["sections"][0]["variants"][0]["spec"]["modules"]["AMP"]["model"] = "Marshal JCM"
bad_param = json.loads(j(good1)); bad_param["sections"][0]["variants"][1]["spec"]["modules"]["DLY"] = {"model": "Pure", "params": {"Bogus": 3}}
two_var = json.loads(j(good1)); two_var["sections"][0]["variants"].pop()
dup = json.loads(j(good1)); dup["sections"][0]["variants"][1] = json.loads(j(dup["sections"][0]["variants"][0]))
dup["sections"][0]["variants"][1]["label"] = "B"; dup["sections"][0]["variants"][1]["spec"]["name"] = "Dup2"
no_art = json.loads(j(good1)); no_art["artiste"] = ""; no_art["titre"] = ""
weird = json.loads(j(good1)); weird["artiste"] = 'AC/DC: "Back"'; weird["titre"] = "Hells Bells? " + "x" * 60
trailing = j(good2)[:-1] + ",}"
no_cab = json.loads(j(good1))                      # l'IA oublie la baffle : celle de l'ampli doit etre posee explicitement
for _v in no_cab["sections"][0]["variants"]:
    _v["spec"]["modules"].pop("CAB", None)
no_cab["sections"][0]["variants"][0]["spec"]["modules"]["AMP"]["on"] = True

SCEN = [
  {"name": "clean_pass", "cfg": {"model": "gemini-3.5-flash"}, "roles": None, "script": [{"text": j(good1)}]},
  {"name": "fenced_trailing_comma", "cfg": {"model": "gemini-3.5-flash", "pickup": "humbucker", "lang": "en"}, "roles": None,
   "script": [{"text": "Voici:\n```json\n" + trailing + "\n```"}]},
  {"name": "retry_unknown_model", "cfg": {"model": "gemini-3.5-flash"}, "roles": None,
   "script": [{"text": j(bad_model)}, {"text": j(good1)}]},
  {"name": "retry_bad_param_and_prose", "cfg": {"model": "gemini-2.5-flash", "pickup": "p90"}, "roles": None,
   "script": [{"text": "Je ne peux pas, desole."}, {"text": j(bad_param)}, {"text": j(good2)}]},
  {"name": "truncated_then_ok", "cfg": {"model": "gemini-3.5-flash"}, "roles": ["clean", "lead"],
   "script": [{"text": j(good2)[:900], "truncated": True}, {"text": j(good2)}]},
  {"name": "forced_roles_mismatch", "cfg": {"model": "gemini-3.5-flash"}, "roles": ["clean", "lead"],
   "script": [{"text": j(good1)}, {"text": j(good2)}]},
  {"name": "claude_ignores_style_warnings", "cfg": {"model": "claude-sonnet-5"}, "roles": None,
   "script": [{"text": j(dup)}]},
  {"name": "non_claude_retries_on_warning", "cfg": {"model": "gemini-3.5-flash"}, "roles": None,
   "script": [{"text": j(dup)}, {"text": j(good1)}]},
  {"name": "free_light_catalog", "cfg": {"model": "openrouter/free"}, "roles": None, "script": [{"text": j(good1)}]},
  {"name": "too_few_variants", "cfg": {"model": "gemini-3.5-flash", "max_retries": 1}, "roles": None,
   "script": [{"text": j(two_var)}, {"text": j(two_var)}]},
  {"name": "amp_without_cab", "cfg": {"model": "gemini-3.5-flash"}, "roles": None, "script": [{"text": j(no_cab)}]},
  {"name": "no_artist_fallback_folder", "cfg": {"model": "gemini-3.5-flash"}, "roles": None, "demande": "Un son blues a la BB King, chaud", "script": [{"text": j(no_art)}]},
  {"name": "weird_names", "cfg": {"model": "gemini-3.5-flash"}, "roles": None, "script": [{"text": j(weird)}]},
  {"name": "five_sections_then_ok", "cfg": {"model": "gemini-3.5-flash"}, "roles": None,
   "script": [{"text": j(payload([section("S%d" % i, "", "S%d" % i) for i in range(5)]))}, {"text": j(good2)}]},
]

out = []
for sc in SCEN:
    calls = []
    script = list(sc["script"])
    def fake(cfg, system, msgs, log=print):
        calls.append({"system": system, "msgs": json.loads(json.dumps(msgs))})
        r = script.pop(0)
        cfg["_truncated"] = bool(r.get("truncated"))
        return r["text"]
    A.call_api = fake
    tmp = tempfile.mkdtemp()
    cfg = dict(sc["cfg"]); cfg.setdefault("provider", "gemini"); cfg["output_dir"] = tmp
    cfg.setdefault("max_retries", 2)
    demande = sc.get("demande", "Enter Sandman - Metallica, intro clean puis solo")
    rec = {"name": sc["name"], "cfg": sc["cfg"], "roles": sc["roles"], "demande": demande, "script": sc["script"]}
    try:
        pl, written = A.generate(cfg, tb, demande, log=lambda *a: None, roles=sc["roles"])
        rec["calls"] = calls
        rec["folder"] = os.path.basename(cfg["_last_outdir"])
        rec["files"] = [{"rel": os.path.relpath(p, cfg["_last_outdir"]), "hex": open(p, "rb").read().hex()} for p, s, v in written]
        rec["system_ok"] = True
    except Exception as e:
        rec["calls"] = calls
        rec["error"] = type(e).__name__
    shutil.rmtree(tmp, ignore_errors=True)
    out.append(rec)
    print(sc["name"], "->", rec.get("error") or ("%d fichiers, %d appels" % (len(rec["files"]), len(calls))))
json.dump(out, open(os.path.join(HERE, "expected_gen.json"), "w"), ensure_ascii=False)
json.dump({"tables": W.trimmed_tables(tb), "prompts": W.prompts(tb), "template": W.template_b64()}, open(os.path.join(HERE, "bundle.json"), "w"), ensure_ascii=False)
