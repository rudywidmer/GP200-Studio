#!/usr/bin/env python3
"""Genere le corpus de reference : specs aleatoires + resultats du code PYTHON.

Le test JS (run_core_tests.js) rejoue exactement les memes entrees et exige des
sorties identiques. Python est la source de verite.
"""
import json, os, random, sys, difflib, struct, base64, hashlib, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "..", "ref")
sys.path.insert(0, REF)
import gp200lib as L
import gp200_agent as A

random.seed(20260610)
tb = L.Tables(os.path.join(REF, "data"))
TEMPLATE = os.path.join(REF, "template.prst")
SLOTS = L.MODULES

def jsonable(x):
    return json.loads(json.dumps(x))

def pool(slot):
    if slot == "CAB":
        return [c["name"] for c in tb.cabs if not c["user_slot"]]
    return [m["name"] for m, _ in tb.models_for_slot(slot)]

def rand_params(slot, model, wild):
    try:
        m, cat = tb.find(slot, model)
    except ValueError:
        return {}
    mid = m["model_id"] if cat == 10 else m["id"]
    pl = tb.params_of(mid, cat)
    out = {}
    for p in pl:
        r = random.random()
        if r < 0.4:
            continue
        lo, hi = min(p["min"], p["max"]), max(p["min"], p["max"])
        if wild and random.random() < 0.15:
            v = random.choice([lo - 7.5, hi + 13, hi * 2 + 1, -1, 1e6, 0.1 + 0.2])
        else:
            v = random.uniform(lo, hi)
            if random.random() < 0.5:
                v = round(v)
            elif random.random() < 0.5:
                v = round(v, 2)
        name = p["name"]
        if random.random() < 0.15:
            name = random.choice([name.lower(), name.upper(), name.replace(" ", ""), name + " "])
        out[name] = v
    if wild and random.random() < 0.2:
        out[random.choice(["Bogus", "Gaine", "Tone2", "Mix Level"])] = 50
    return out

def rand_spec(wild):
    spec = {}
    if random.random() < 0.9:
        spec["name"] = random.choice(["Test", "Rock n Hell RYTH", "A", "", "Cafeé Solo", "X" * 16,
                                      "Y" * 17 if wild else "Z" * 10, "Slash GnR", "Mid-Tempo +"])
    if random.random() < 0.6:
        spec["author"] = random.choice(["Rudy", "Claude", "", "A" * 30, "éè 中"])
    if random.random() < 0.6:
        spec["description"] = random.choice(["metal rythmique", "", "d" * 60, "Tone: crunch + delay"])
    if random.random() < 0.4:
        ch = list(range(11)); random.shuffle(ch)
        if wild and random.random() < 0.15:
            ch[0] = ch[1]
        spec["chain_order"] = ch
    if random.random() < 0.25:
        c = {}
        for _ in range(random.randint(1, 3)):
            k = random.choice([1, 2, 3, 4, 8, "CTRL5", "ctrl2", "7"])
            n_ = int(str(k).upper().replace("CTRL", ""))
            c = {kk: vv for kk, vv in c.items() if int(str(kk).upper().replace("CTRL", "")) != n_}  # pas 2 ecritures du meme CTRL (ordre des cles JSON)
            c[str(k)] = random.sample(SLOTS, random.randint(0, 3))
        if wild and random.random() < 0.1:
            c["9"] = ["PRE"]
        spec["ctrl"] = c
    mods = {}
    for slot in SLOTS:
        r = random.random()
        if r < 0.2:
            continue
        if r < 0.28:
            mods[slot] = None
            continue
        p = pool(slot)
        model = random.choice(p)
        if wild and random.random() < 0.08:
            model = random.choice(["Nope Amp", "Marshal JCM", model.lower(), model.replace(" ", "")])
        ms = {"model": model}
        if random.random() < 0.8:
            ms["on"] = random.random() < 0.75
        if random.random() < 0.9:
            ms["params"] = rand_params(slot, model, wild)
        mods[slot] = ms
    spec["modules"] = mods
    return spec

def py_encode(spec, **kw):
    # le JSON a des cles ctrl en str ; python accepte les deux
    try:
        raw, w = L.encode_prst(spec, tb, TEMPLATE, **kw)
        return {"raw": raw.hex(), "warnings": w}
    except Exception as e:
        return {"error": str(e), "etype": type(e).__name__}

cases = []
for i in range(900):
    wild = i % 3 == 0
    spec = rand_spec(wild)
    kw = {"keep_assignments": random.random() < 0.2,
          "strict": random.random() < 0.7 if wild else True,
          "fill_empty_slots": random.random() < 0.85}
    exp = py_encode(spec, **kw)
    errs = A.check_names(tb, spec)
    case = {"spec": spec, "opts": kw, "expected": exp, "check_names": errs}
    if "raw" in exp:
        raw = bytes.fromhex(exp["raw"])
        with tempfile.NamedTemporaryFile(suffix=".prst", delete=False) as f:
            f.write(raw); p = f.name
        d = L.decode_prst(p, tb); os.unlink(p)
        d["file"] = "x"
        case["decoded"] = jsonable(d)
        # apply_patch_vol
        r2, pv = A.apply_patch_vol(raw, spec)
        case["patchvol"] = {"raw": r2.hex(), "pv": pv}
    cases.append(case)

# --- sections / divergence / payloads
def rand_variant(label, base=None):
    s = rand_spec(False)
    s["name"] = random.choice(["V%d" % random.randint(0, 5), "Same", "Long Name %d" % random.randint(0, 99), "Etoile"])
    return {"label": label, "spec": s}

payloads = []
for i in range(250):
    nsec = random.choice([0, 1, 1, 2, 3, 4, 5])
    secs = []
    for j in range(nsec):
        nv = random.choice([3, 3, 3, 2, 4, 0])
        vs = []
        for k in range(nv):
            v = rand_variant("ABCD"[k % 4])
            if vs and random.random() < 0.3:
                v = json.loads(json.dumps(vs[0])); v["label"] = "ABCD"[k % 4]
                if random.random() < 0.5:
                    v["spec"]["name"] = "Unique%d%d" % (j, k)
            vs.append(v)
        sec = {"nom": random.choice(["Intro", "Couplet", "Solo", "Refrain", "Intro", "?", None]),
               "role": random.choice(["", "clean", "crunch", "disto", "lead", "bogus", None]),
               "variants": vs}
        if sec["nom"] is None:
            del sec["nom"]
        if sec["role"] is None:
            del sec["role"]
        secs.append(sec)
    pl = {"sections": secs} if random.random() < 0.85 else {"variants": secs[0]["variants"] if secs else []}
    if random.random() < 0.2:
        pl = {"variants": [rand_variant("A"), rand_variant("B"), rand_variant("C")]}
    e, w = A.check_sections(tb, A.normalize_payload(pl)) if False else (None, None)
    try:
        npl = A.normalize_payload(pl)
        e, w = A.check_sections(tb, npl)
        payloads.append({"payload": pl, "norm": npl, "errs": e, "warns": w})
    except Exception as ex:
        payloads.append({"payload": pl, "error": type(ex).__name__})

# --- extract_json
EJ = [
    '{"a": 1}', '```json\n{"a": 1,}\n```', 'blabla {"a": [1,2,],} fin', 'Voici:\n```\n{"x":{"y":[1,2,3,],},}\n```',
    'pas de json', '{', '}{', '{"a": "b,}"}', '{"a": 1,\n}', '```JSON\n{"k": "v"}```', 'x {"a":1} y {"b":2} z',
    '{"a": 1e3, "b": -0.5, "c": null, "d": true}', '', '   ', '{"é": "ü"}',
    '{"a":[1,2,3],}', '```json\n{"nom": "Test", "variants": [],\n}', '{"a": "x, ]"}',
]
ej = []
for t in EJ:
    try:
        ej.append({"in": t, "out": A.extract_json(t)})
    except Exception as e:
        ej.append({"in": t, "error": type(e).__name__})

# --- misc
names = ["Artiste - Titre", 'a/b\\c:d*e?"f<g>h|i', "  .espaces.  ", "", "...", "Été à Paris", "x" * 50, "a  b   c", "\tTab\n"]
misc = {
    "safe_filename": [[n, A.safe_filename(n)] for n in names],
    "safe_dirname": [[n, A.safe_dirname(n)] for n in names],
    "forced": [[r, A.forced_prompt(r)] for r in [[], ["clean"], ["clean", "lead"], ["crunch", "disto", "lead", "clean"]]],
}

# --- difflib
words = ["Marshal", "JCM800", "Tube Screamer", "TS9", "Plexi", "Fuzz Face", "Deluxe Reverb", "Delay", "Gain", "Presence",
         "Mid", "mid", "Bass", "Trebel", "Level", "Time", "feed back", "FeedBack", "xyz", "", "Rate", "Depth", "Mix", "ab", "aaaa"]
dl = []
allp = set()
for slot in SLOTS:
    allp.update(pool(slot))
for m in tb.models:
    for p in m["params"]:
        allp.add(p["name"])
allp = sorted(allp)
pools = [allp[:40], allp, pool("AMP"), pool("DST"), pool("CAB"), ["Gain", "Bass", "Mid", "Treble", "Presence", "Master", "Volume"]]
for w in words:
    for pi, pl_ in enumerate(pools):
        for n, c in [(4, 0.4), (3, 0.4), (3, 0.6)]:
            dl.append({"w": w, "pool": pi, "n": n, "c": c, "out": difflib.get_close_matches(w, pl_, n=n, cutoff=c)})
rnd = random.Random(7)
for _ in range(200):
    w = rnd.choice(allp); w = "".join(rnd.choice([ch, ch, ch, "x"]) for ch in w) if rnd.random() < .7 else w
    pi = rnd.randrange(len(pools))
    dl.append({"w": w, "pool": pi, "n": 4, "c": 0.4, "out": difflib.get_close_matches(w, pools[pi], n=4, cutoff=0.4)})

# --- %g et round
import math
gv = [0, 1, -1, 0.5, 78, 78.0, 100, 1e5, 123456, 1234567, 0.0001, 0.00001234, 12345.678, 99.99999, 3.14159265, 1e16, -7.5, 62.5, 20001.0,
      0.1 + 0.2, 1 / 3, 1e-5, 2.5e-7, 999999.5, 100000.0, 5e-324 if False else 1e-300, 4.35, 0.15, 1234567.89]
fmt = [[v, "%g" % v] for v in gv]
rv = [0.5, 1.5, 2.5, 3.5, -0.5, -1.5, 4.49, 4.5, 5.5, 6.5, 7.5, 0, 1, 2.675, 62.5, 63.5]
rnd_ = [[v, round(v)] for v in rv]
repr_cases = [["abc", repr("abc")], ["it's", repr("it's")], ['q"q', repr('q"q')], ["a'b\"c", repr("a'b\"c")], ["é", repr("é")],
              ["tab\t", repr("tab\t")], ["nl\n", repr("nl\n")], [["PRE", "WAH"], repr(["PRE", "WAH"])], [[1, 2, 3], repr([1, 2, 3])],
              [3, repr(3)], [3.5, repr(3.5)], [True, repr(True)], [None, repr(None)], [[], repr([])], [{"a": 1}, repr({"a": 1})],
              ["back\\slash", repr("back\\slash")]]

# --- zip / pkce / checksum
pk_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
pkce = {"verifier": pk_verifier,
        "challenge": base64.urlsafe_b64encode(hashlib.sha256(pk_verifier.encode()).digest()).rstrip(b"=").decode()}

out = {"cases": cases, "payloads": payloads, "extract_json": ej, "misc": misc, "difflib": dl, "pools": pools,
       "fmtg": fmt, "round": rnd_, "repr": repr_cases, "pkce": pkce,
       "template_b64": base64.b64encode(open(TEMPLATE, "rb").read()).decode()}
with open(os.path.join(HERE, "expected.json"), "w") as f:
    json.dump(out, f, ensure_ascii=False)
ok = sum(1 for c in cases if "raw" in c["expected"])
print("cases:", len(cases), "ok:", ok, "errors:", len(cases) - ok, "payloads:", len(payloads), "difflib:", len(dl))
