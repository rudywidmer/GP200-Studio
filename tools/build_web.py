#!/usr/bin/env python3
"""Assemble dist/index.html : UN seul fichier, aucune ressource externe.

    python3 tools/build_web.py

Les donnees (tables du firmware, prompts, catalogue) viennent du code Python via
webdata.py ; le moteur JS (gp200core.js) est celui qui est teste octet par octet
contre gp200lib.py (voir tests/).
"""
import base64, datetime, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
import webdata as W  # noqa: E402

SRC = os.path.join(ROOT, "web", "src")
DIST = os.path.join(ROOT, "web", "dist")
REPO = "https://github.com/rudywidmer/GP200-Studio"
WEB_VERSION = "0.28"      # 0.1 = generation IA, 0.2 = envoi USB, 0.3 = harmonisation du volume (LUFS), 0.4 = affiner un preset, CTRL, reglage en direct, 0.5 = poste de travail (ergonomie), 0.6 = audit pedale (confirmation 12/0C, baffle, Time), 0.7 = injection par slot (ecriture + selection), 0.8 = interface : focus sur le rack + fenetres flottantes, 0.9 = ecoute de la pedale (bidirectionnel), 0.10 = harmonisation par lot (selection libre dans la bibliotheque), 0.11 = lot sans preset charge + ouverture multiple fiable, 0.12 = info-bulles sur tous les controles, 0.13 = chenillard du rack pendant la generation (rack vide compris), 0.14 = reglages tournes en facade suivis par la page (12/10 decode : module, slot, valeur), 0.15 = menus de blocs conformes a la pedale (26 modeles corriges : PRE, SnapTone) + validation de la generation par menu, 0.16 = continuer sans cle IA (ouvrir, pedale, volumes sans IA), 0.17 = plus de faux « cle invalide » (indice seulement si la cle est celle d'un autre fournisseur), 0.18 = volume du patch dans le reglage en direct, 0.19 = le volume du patch passe au-dessus de la chaine du signal, 0.20 = messages d'etat discrets dans la barre du bas, 0.21 = reglages du module : 6 par ligne, 0.22 = boutons et champs compacts (32 px comme la barre du haut), 0.23 = aide du module pleine largeur, message « applique » dans la barre du bas, 0.24 = Set list (♥, noms, ecriture en masse dans la pedale), 0.25 = « Signaler un probleme » (rapport de diagnostic sans cle API), 0.26 = mode filaire Android (USB OTG), 0.26.1 = rapport sans adresse de page locale + message clair si le MIDI est refuse sur une page ouverte hors http(s), 0.27 = lecture du patch charge sur la pedale (au branchement, a chaque changement de patch, bouton « Lire le patch en cours »), 0.27.1 = pedale debranchee puis rebranchee (ou eteinte puis rallumee) : le patch lu est relu et remplace l'ancien, 0.28 = colonne « Memoire de la pedale » (noms des 256 emplacements, clic = selection + affichage)
CONNECT = ["https://generativelanguage.googleapis.com", "https://api.anthropic.com", "https://openrouter.ai"]


def read(p):
    return open(os.path.join(SRC, p), encoding="utf-8").read()


def examples():
    import gp200_i18n as I
    out = {}
    for lang in ("fr", "en"):
        I.set_lang(lang)
        out[lang] = [I.T("ex_%d" % i) for i in range(1, 9)]
    return out


def build_stamp():
    """Date/heure de fabrication affichee en pied de page (GP200_BUILD_TIME=ISO pour un build reproductible)."""
    iso = os.environ.get("GP200_BUILD_TIME")
    if not iso:
        iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"version": WEB_VERSION, "iso": iso}


def main():
    tb = W.load_tables()
    prov = {k: {kk: v[kk] for kk in ("default_model", "models", "keys_url")}
            for k, v in W.providers().items() if k in ("gemini", "openrouter", "anthropic")}
    bundle = {"tables": W.trimmed_tables(tb), "prompts": W.prompts(tb), "template": W.template_b64(),
              "audit": W.audit(), "providers": prov, "examples": examples(), "repo": REPO, "build": build_stamp()}
    bj = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    bj = bj.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    js = "\n".join(read(f) for f in ("gp200core.js", "gp200usb.js", "gp200lufs.js", "gp200tune.js", "gp200setlist.js", "gp200tips.js", "app.js"))
    if re.search(r"</script", js, re.I):
        sys.exit("le JS contient </script : echappe-le")
    digest = base64.b64encode(hashlib.sha256(js.encode("utf-8")).digest()).decode()
    csp = ("default-src 'none'; script-src 'sha256-%s'; style-src 'unsafe-inline'; img-src data:; "
           "connect-src %s; base-uri 'none'; form-action 'none'" % (digest, " ".join(CONNECT)))

    html = read("index.template.html")
    html = (html.replace("{{CSP}}", csp).replace("{{CSS}}", read("style.css"))
                .replace("{{BUNDLE}}", bj).replace("{{JS}}", js))
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print("%s : %.0f Ko (donnees %.0f Ko, js %.0f Ko)" % (out, len(html.encode()) / 1024, len(bj) / 1024, len(js) / 1024))


if __name__ == "__main__":
    main()
