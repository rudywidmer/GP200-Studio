#!/usr/bin/env python3
"""Cas de reference pour fill_default_cab (baffle par defaut de l'ampli, audit du 04/10), rejoues cote JS par run_cab_tests.js."""
import copy, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "ref"))
import gp200_agent as A
import gp200lib as L

tb = L.Tables(os.path.join(HERE, "..", "ref", "data"))
cases = []


def add(name, spec):
    inp = copy.deepcopy(spec)
    out = A.fill_default_cab(copy.deepcopy(spec), tb)
    cases.append({"name": name, "in": inp, "out": out})


for m in tb.models:
    if m["cat"] in (7, 8, 15):
        add("amp:" + m["name"], {"name": "t", "modules": {"AMP": {"model": m["name"], "on": True, "params": {}}}})
add("cab donnee", {"modules": {"AMP": {"model": "J-120 CL", "on": True}, "CAB": {"model": "Mess", "on": True}}})
add("cab donnee OFF", {"modules": {"AMP": {"model": "J-120 CL", "on": True}, "CAB": {"model": "Mess", "on": False}}})
add("cab sans modele", {"modules": {"AMP": {"model": "J-120 CL", "on": True}, "CAB": {"on": True, "params": {"Volume": 70}}}})
add("cab null", {"modules": {"AMP": {"model": "J-120 CL"}, "CAB": None}})
add("ampli OFF", {"modules": {"AMP": {"model": "J-120 CL", "on": False}}})
add("ampli on=0", {"modules": {"AMP": {"model": "J-120 CL", "on": 0}}})
add("ampli sans on", {"modules": {"AMP": {"model": "Tweedy"}}})
add("ampli inconnu", {"modules": {"AMP": {"model": "Nope 9000", "on": True}}})
add("ampli vide", {"modules": {"AMP": {"model": "", "on": True}}})
add("ampli null", {"modules": {"AMP": None, "DST": {"model": "Green OD"}}})
add("sans AMP", {"modules": {"DST": {"model": "Green OD", "on": True}}})
add("modules vide", {"modules": {}})
add("modules null", {"modules": None})
add("sans modules", {"name": "x"})
add("nom approximatif", {"modules": {"AMP": {"model": "j-120 cl", "on": True}}})
json.dump(cases, open(os.path.join(HERE, "expected_cab.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("cas :", len(cases), "| baffles posees :", sum(1 for c in cases if (c["out"].get("modules") or {}).get("CAB") != (c["in"].get("modules") or {}).get("CAB")))
