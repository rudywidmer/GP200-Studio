#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gp200_agent — moteur text-to-preset GP-200.

Ne depend que de la stdlib (urllib) : PyInstaller reste trivial.

Chaine complete :
    description libre -> API Claude -> 3 specs JSON -> validation contre les
    tables firmware -> 3 fichiers .prst

Le modele ne voit qu'un catalogue COMPACT (noms + plages). Il n'a jamais
connaissance des `slot` : c'est gp200lib qui place les floats, donc une
hallucination sur un slot est structurellement impossible.
Une hallucination sur un NOM de modele est rattrapee par la boucle
d'auto-correction (§ generate).
"""
import difflib
import json
import os
import re
import struct
import sys
import urllib.error
import urllib.request

from gp200lib import (Tables, encode_prst, decode_prst, MODULES, SLOT_ACCEPTS,
                     checksum, FILE_SIZE,
                     _norm as _norm_name)
from gp200_i18n import T

# ---------------------------------------------------------------- providers
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

PROVIDERS = {
    "gemini": {
        "label": "Google Gemini (offre gratuite, sans CB)",
        "default_model": "gemini-3.5-flash",
        "models": ["gemini-3.5-flash", "gemini-2.5-flash",
                   "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
        "env": "GEMINI_API_KEY",
        "keys_url": "https://aistudio.google.com/app/apikey",
    },
    "anthropic": {
        "label": "Anthropic Claude (payant a l'usage)",
        "default_model": "claude-sonnet-5",
        "models": ["claude-sonnet-5", "claude-opus-4-8",
                   "claude-haiku-4-5-20251001"],
        "env": "ANTHROPIC_API_KEY",
        "keys_url": "https://console.anthropic.com/settings/keys",
    },
    "perplexity": {
        "label": "Perplexity (payant, recherche web incluse)",
        "default_model": "sonar",
        "models": ["sonar", "sonar-pro", "sonar-reasoning"],
        "env": "PERPLEXITY_API_KEY",
        "keys_url": "https://www.perplexity.ai/settings/api",
    },
    "openrouter": {
        "label": "OpenRouter (connexion en 1 clic, modeles gratuits)",
        # openrouter/free est le ROUTEUR maison d'OpenRouter : il choisit
        # lui-meme un modele gratuit disponible et filtre sur les capacites
        # necessaires. Coder en dur un identifiant ":free" ne tient pas dans
        # le temps -- ils basculent en payant sans preavis, et l'appli
        # renvoie alors un HTTP 404. Le routeur, lui, ne perime pas.
        "default_model": "openrouter/free",
        "models": ["openrouter/free",
                   "google/gemini-2.5-flash",
                   "anthropic/claude-sonnet-4.5",
                   "openai/gpt-4o-mini"],
        "env": "OPENROUTER_API_KEY",
        "keys_url": "https://openrouter.ai/keys",
        # Signale a l'interface que ce fournisseur accepte la connexion par
        # compte : pas besoin d'aller chercher une cle a la main.
        "oauth": "openrouter",
    },
    "openai": {
        "label": "OpenAI (ChatGPT - requiert des credits payants)",
        "default_model": "gpt-4o-mini",
        "models": ["gpt-4o-mini", "gpt-4o"],
        "env": "OPENAI_API_KEY",
        "keys_url": "https://platform.openai.com/api-keys",
    },
}
# Tarifs officiels en $ par million de tokens (entree, sortie).
# Sonnet 5 : tarif d'introduction 2/10 jusqu'au 31/08/2026, puis 3/15.
# Source : https://docs.claude.com/en/docs/about-claude/pricing
PRICES = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
}
WEB_SEARCH_UNIT = 0.01          # $ par recherche (10 $ / 1000)
CACHE_WRITE_MULT = 1.25         # cache 5 min
CACHE_READ_MULT = 0.10          # une lecture de cache coute 10 % du prix d'entree

# Ordre de preference des familles pour les modeles gratuits d'OpenRouter.
# Il ne fige AUCUN identifiant : les modeles precis vont et viennent, les
# familles restent. Une famille inconnue n'est pas exclue, elle passe juste
# apres. Si une famille disparait, les suivantes remontent d'elles-memes.
#
# Critere de classement : capacite a produire un JSON structure valide en
# suivant un catalogue impose. C'est ce que demande l'application, pas de la
# conversation.
OPENROUTER_FAMILY_RANK = (
    "deepseek/",        # tres bon en JSON structure, gratuit de longue date
    "qwen/",
    "meta-llama/",
    "google/",
    "z-ai/",
    "moonshotai/",
    "mistralai/",
    "nvidia/",
    "microsoft/",
    "openai/",
    "anthropic/",
    "x-ai/",
)

# Nombre de modeles gratuits proposes dans le menu. Volontairement court : la
# zone de saisie reste editable pour qui veut un identifiant precis.
OPENROUTER_FREE_MAX = 8

DEFAULT_PROVIDER = "gemini"
DEFAULT_MODEL = PROVIDERS[DEFAULT_PROVIDER]["default_model"]


def resource_path(rel):
    """Chemin d'une ressource, que l'on tourne en script ou en .exe PyInstaller."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def app_dir():
    """Repertoire de l'exe/script (pour config.json et les sorties)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------------ config
def load_config():
    cfg = {"provider": DEFAULT_PROVIDER, "api_key_gemini": "",
           "api_key_anthropic": "", "api_key_perplexity": "",
           "api_key_openai": "", "api_key_openrouter": "",
           "model": "", "web_search": True,
           "output_dir": "", "max_retries": 2, "lang": "", "pickup": "auto",
           "configured": False}
    for path in (os.path.join(app_dir(), "config.json"),
                 os.path.join(os.environ.get("APPDATA", ""), "GP200Studio",
                              "config.json")):
        if path and os.path.isfile(path):
            try:
                cfg.update(json.load(open(path, encoding="utf-8")))
                cfg["_source"] = path
                break
            except Exception as e:
                cfg["_error"] = "%s : %s" % (path, e)
    # retro-compat : ancien champ "api_key" seul
    if cfg.get("api_key") and not cfg.get("api_key_anthropic"):
        cfg["api_key_anthropic"] = cfg["api_key"]
    # Les cles sont stockees chiffrees (dpapi:/plain:) : on les dechiffre en
    # memoire. Une cle en clair (ancienne config) est renvoyee telle quelle.
    try:
        from gp200_secrets import decrypt_key
        for prov in PROVIDERS:          # derive de PROVIDERS, pas en dur
            k = "api_key_" + prov
            if cfg.get(k):
                cfg[k] = decrypt_key(cfg[k])
    except Exception:
        pass
    for prov, meta in PROVIDERS.items():
        env = os.environ.get(meta["env"])
        if env:
            cfg["api_key_" + prov] = env
            cfg["_source"] = "variable d'environnement " + meta["env"]
    if cfg.get("provider") not in PROVIDERS:
        cfg["provider"] = DEFAULT_PROVIDER
    if not cfg.get("output_dir"):
        docs = os.path.join(os.path.expanduser("~"), "Documents")
        # Fallback sur ~ (toujours accessible) et jamais sur app_dir()
        # qui peut pointer vers un dossier protege (Program Files, etc.)
        fallback = os.path.expanduser("~")
        cfg["output_dir"] = os.path.join(
            docs if os.path.isdir(docs) else fallback,
            "GP200_Presets"
        )
    return cfg


def save_config(cfg):
    """Ecrit config.json a cote de l'exe, cles CHIFFREES. Ne persiste pas les
    champs internes prefixes par '_'."""
    from gp200_secrets import encrypt_key
    out = {}
    for k, v in cfg.items():
        if k.startswith("_"):
            continue
        # Liste derivee de PROVIDERS : ajouter un fournisseur suffit,
        # sa cle sera chiffree sans rien modifier ici.
        if k in tuple("api_key_" + p for p in PROVIDERS) and v:
            out[k] = encrypt_key(v)
        else:
            out[k] = v
    path = os.path.join(app_dir(), "config.json")
    try:
        json.dump(out, open(path, "w", encoding="utf-8"),
                  indent=1, ensure_ascii=False)
        return path
    except Exception:
        # app_dir non inscriptible (exe dans Program Files) : repli APPDATA
        alt = os.path.join(os.environ.get("APPDATA", app_dir()), "GP200Studio")
        os.makedirs(alt, exist_ok=True)
        path = os.path.join(alt, "config.json")
        json.dump(out, open(path, "w", encoding="utf-8"),
                  indent=1, ensure_ascii=False)
        return path


def spend_path():
    return os.path.join(app_dir(), "spend.json")


def load_spend():
    try:
        return json.load(open(spend_path(), encoding="utf-8"))
    except Exception:
        return {"total_usd": 0.0, "calls": 0}


def reset_spend():
    try:
        os.remove(spend_path())
    except Exception:
        pass
    return {"total_usd": 0.0, "calls": 0}


def add_spend(cost):
    """Cumule la depense estimee entre les sessions.

    ATTENTION : c'est une ESTIMATION calculee depuis l'objet usage renvoye par
    l'API et les tarifs codes dans PRICES. Elle ignore tout appel fait ailleurs
    et devient fausse si les tarifs changent. La console Anthropic fait foi :
    https://console.anthropic.com/settings/usage
    """
    d = load_spend()
    d["total_usd"] = round(d.get("total_usd", 0.0) + cost, 6)
    d["calls"] = d.get("calls", 0) + 1
    try:
        json.dump(d, open(spend_path(), "w", encoding="utf-8"), indent=1)
    except Exception:
        pass
    return d


def api_key_of(cfg):
    return (cfg.get("api_key_" + cfg.get("provider", DEFAULT_PROVIDER)) or "").strip()


def model_of(cfg):
    return (cfg.get("model") or "").strip() or \
        PROVIDERS[cfg.get("provider", DEFAULT_PROVIDER)]["default_model"]


# ------------------------------------------------- catalogue compact (prompt)
def compact_catalog(tb, light=False):
    """Catalogue condense pour le prompt (~20 Ko au lieu de 222 Ko).

    Les `slot` sont volontairement omis : le modele n'en a pas besoin.

    Chaque modele porte sa description OFFICIELLE (1re phrase de
    description_en.xml, le texte que l'editeur Valeton affiche lui-meme). Elle
    nomme le materiel reel -- "Based on Marshall(R) JCM800*" -- ce qui remplace
    le decodeur de marques qui etait ecrit a la main dans SYSTEM. Ce decodeur
    couvrait ~40 modeles sur 305 et contenait au moins une erreur (C-Chorus
    donne pour un Boss CE-1 alors que c'est un DC-2 Dimension C).
    Cout : ~4300 tokens, mis en cache donc ~0,011 $ par generation.
    """
    fam = [(7, "AMPLIS GUITARE"), (8, "PREAMPS BASSE/ACOUSTIQUE"),
           (3, "DISTOS / OVERDRIVES"), (0, "COMP / BOOST / GATE"),
           (1, "EQ / PITCH / FILTRES"), (5, "WAH"), (4, "MODULATIONS"),
           (11, "DELAYS"), (12, "REVERBS"), (6, "VOLUME")]
    out = []
    for cat, label in fam:
        rows = []
        keep_desc = (not light) or (cat in (7, 8, 3, 1))
        for m in sorted((x for x in tb.models if x["cat"] == cat),
                        key=lambda x: x["name"]):
            ps = ",".join(
                "%s[%g-%g]" % (p["name"], min(p["min"], p["max"]),
                               max(p["min"], p["max"])) for p in m["params"])
            cabhint = ""
            if m.get("defcab") is not None:
                c = tb.cab(m["defcab"])
                if c:
                    cabhint = " cab_def=%s" % c["name"]
            d = tb.description(m["id"], cat) if keep_desc else ""
            rows.append("%s (cat%d, %s)%s : %s%s"
                        % (m["name"], cat, m["category_label"] or "-",
                           cabhint, ps, ("\n    -> " + d) if d else ""))
        out.append("### %s (cat %d) — %d\n%s" % (label, cat, len(rows),
                                                 "\n".join(rows)))
    cabrows = []
    for c in tb.cabs:
        if c["user_slot"]:
            continue
        d = tb.description(c["model_id"], 10) if not light else ""
        cabrows.append("%s (%s)%s" % (c["name"], c["speaker_config"],
                                      (" — " + d) if d else ""))
    out.append("### CABS (slot CAB) — %d\n"
               "Parametres communs : Volume[0-100], Low Cut[19-2000], "
               "High Cut[2000-20001]\n%s"
               % (len(cabrows), "\n".join(cabrows)))
    return "\n\n".join(out)


SYSTEM = """Tu es un ingenieur du son expert, specialiste du multi-effets Valeton GP-200.

Ta mission : a partir d'une description de son (chanson, artiste, ambiance), determiner
QUELLES PARTIES du morceau demandent des sons DIFFERENTS, puis produire 3 presets pour
chacune de ces parties.

ETAPE 1 -- LA STRUCTURE
Cherche la structure reelle du morceau et demande-toi : combien de sons DISTINCTS le
guitariste utilise-t-il vraiment ?
  - Un seul son du debut a la fin      -> UNE seule section
  - Couplet clair + refrain sature     -> DEUX sections
  - Clair + sature + solo lead         -> TROIS sections
REGLE DURE : n'invente JAMAIS de section. Si le couplet et le refrain se jouent avec
le meme son, c'est UNE section, pas deux. Beaucoup de morceaux metal se jouent
integralement avec un seul son rythmique : dans ce cas, une seule section, et c'est
la bonne reponse. Une section = un son reellement different, pas une partie du morceau.
Un solo ne merite sa section que si le son change vraiment (boost, plus de gain,
delay ajoute...), pas juste parce qu'il y a un solo.

ETAPE 2 -- POUR CHAQUE SECTION, 3 presets qui sont trois INTERPRETATIONS du MEME
son, pas trois sons differents. Elles doivent toutes rester reconnaissables comme
le morceau demande, tout en divergeant de facon audible :

  A "Fidele"   : Le rig d'origine reproduit au plus près en utilisant EXPLICITEMENT les marques et modèles historiques identifiés lors de ta recherche web (recherche les équivalents exacts dans ton catalogue JSON). Pas de compromis générique : si Prince/l'artiste utilisait tel ampli ou telle pédale de modulation spécifique (ex: Boss CE-1/CE-3 ou Mesa/Boogie), tu DOIS sélectionner le modèle Valeton correspondant dans le catalogue. Pense-le pour sonner vivant en direct/FRFR.
  
  B "Variante" : Le même son exploré sous un autre angle -- a TOI de choisir
               l'axe le plus pertinent pour CE morceau : un ampli/cab alternatif
               crédible de la même famille (ex: passer d'un Mesa Mark à un Soldano ou un autre clean de référence), OU un dosage différent des effets et du gain (plus/moins de modulation, de disto, de délai/réverb) mais sans exagération.
               Doit rester la même intention sonore, juste une autre couleur sans dénaturer la chanson.
               
  C "Poussee"  : La même base poussée d'un cran mais strictement dans le même univers -- plus mordante, saturée ou présente (ou plus ouverte/dynamique/aérienne), sans jamais changer l'ADN du son d'origine ni trahir le morceau.
  
REGLES ABSOLUES
1. N'utilise QUE des noms de modeles presents dans le catalogue ci-dessous, a l'orthographe
   EXACTE. N'invente JAMAIS un nom. Si le materiel reel n'a pas d'equivalent, prends le plus
   proche disponible et dis-le dans "notes".
2. Respecte les plages [min-max] indiquees pour chaque parametre.
3. Le nom d'un preset fait 16 CARACTERES MAXIMUM (ASCII).
4. Chaque slot n'accepte que certaines familles :
   PRE: cat 0,1,3,4 | WAH: cat 5,1 | DST: cat 3,0 | AMP: cat 7,8 | NR: cat 0,4
   CAB: cabs | EQ: cat 1 | MOD: cat 4,1 | DLY: cat 11 | RVB: cat 12 | VOL: cat 6
5. chain_order = permutation de 0..10 ou chain_order[i] = module en position i.
   Modules : 0=PRE 1=WAH 2=DST 3=AMP 4=NR 5=CAB 6=EQ 7=MOD 8=DLY 9=RVB 10=VOL
   Usuel : [4,0,1,2,3,5,6,7,8,9,10] (gate en tete). Defaut : [0,1,2,3,4,5,6,7,8,9,10].
6. Un slot inutilise vaut null. N'active pas d'effet sans raison musicale.
7. Tu n'as pas besoin de preciser tous les parametres : les non precises prennent le
   defaut du firmware. Ne precise que ce qui compte.
8. LES 3 VARIANTES DOIVENT DIVERGER DE FACON AUDIBLE, MAIS RESTER LE MEME MORCEAU.
   La divergence doit s'ENTENDRE : si on jouait les trois a la suite, on percevrait
   trois versions distinctes du meme son -- pas trois presets quasi identiques (ex.
   juste le gain qui passe de 72 a 68, ca ne compte pas), mais pas non plus trois
   sons sans rapport qui trahissent le morceau. Une vraie divergence peut venir de
   PLUSIEURS leviers, au choix selon le morceau : le couple ampli/cab, une
   declinaison differente du meme ampli (ex. Mess2C+ 2 vs Mess2C+ 1), le niveau de
   gain/saturation, le dosage et le choix des effets (modulation, delai, reverb),
   ou l'equilibre EQ. Tu n'es PAS oblige de changer l'ampli si le morceau ne s'y
   prete pas : faire evoluer nettement les effets et le gain autour du meme ampli
   est une variante parfaitement valable. L'important : que le morceau reste
   reconnaissable dans les trois. Deux SECTIONS differentes peuvent partager le
   meme ampli (une rythmique et un solo sur le meme Mesa).
9. HONNETETE SUR LE RIG. Si tu n'es pas sur du materiel reel, ECRIS-LE dans "recherche"
   avec les mots "je ne suis pas certain". N'ecris jamais "probablement X" en le
   traitant ensuite comme un fait. Un rig faux produit un preset faux.
10. MODELES A EQUIVALENT REEL INCERTAIN -- ne les mets PAS au coeur du son sans raison
   explicite, car personne ne sait quelle pedale reelle ils imitent :
   Chief, Master Dist, La Charger, Lazaro, Empire OD, Revolt, Plustortion, SM Dist,
   Darktale, Red Haze, Sora Fuzz, Power LD, Knights CL/OD/CL+, Z38 CL/OD,
   Eagle 120/120+.
   Prefere les modeles a correspondance etablie (voir le decodeur ci-dessous).
11. Le son d'un ampli sature vient de L'AMPLI, pas d'une pedale de distorsion. Une pedale
   en DST sert a BOOSTER (Gain bas 10-25, Volume haut 75-85), pas a fabriquer le gain.
   Ne mets une disto a fort Gain que si le rig reel en avait une.
12. Le nom d'un preset fait 16 caracteres MAX et doit rendre sa section reconnaissable
   sur l'ecran de l'appareil : "MOP Rythm Fid", "MOP Solo Fid"... Pas deux presets de
   sections differentes avec le meme nom.
13. Un son LEAD (solo) se distingue typiquement par : un boost devant l'ampli, un peu
   plus de gain, des mediums remontes (pour percer), et souvent un delay. Un son CLEAN
   n'a ni DST ni gain d'ampli eleve.

MATERIEL MODELISE
Valeton obfusque les marques dans les NOMS (UK 800, Mess2C+, EV 51...), mais chaque
modele du catalogue ci-dessous porte sa description OFFICIELLE, prefixee par "->".
Elle nomme le materiel reel. Exemple :
  UK 800 (cat7, ...) : Gain[0-100],...
      -> Based on Marshall(R) JCM800*. In 1981, the JCM800* quickly became...
FIE-TOI A CES DESCRIPTIONS, pas a ce que le nom evoque. Elles viennent de
description_en.xml, le fichier dont l'editeur Valeton se sert lui-meme. Si une
description ne nomme aucune marque, c'est que Valeton ne revendique pas de modele
precis : traite l'effet pour ce l'il est, n'invente pas de filiation.

REFERENCE (patch reel de John Petrucci, pour calibrer tes valeurs)
chaine PRE>WAH>DST>AMP>CAB>EQ>MOD>DLY>RVB>VOL>NR
PRE COMP4 (Sustain 30, Attack 30, Volume 70, Clipping 35)
DST Green OD (Gain 12, Tone 55, Volume 78)   <- boost, pas de saturation
AMP Mess2C+ 2 (Gain 67.6, Presence 70, Volume 75, Bass 35, Middle 45, Treble 65)
NR Gate 1 (Threshold 25) | CAB Mess (Volume 78, Low Cut 80, High Cut 10000)
EQ Mess EQ (80Hz +14, 240Hz -4, 750Hz -18, 2.2kHz 0, 6.6kHz +15)  <- V Mesa Mark
DLY Digital Delay S (Mix 12, Time 320, Feedback 10) | RVB Hall (Mix 10, Pre Delay 20, Decay 35)
Recettes : Low Cut 80-100 Hz et High Cut 8-10 kHz assainissent en FRFR.
OD devant ampli sature = Gain bas (10-25) + Volume haut (75-85).
Gate Threshold 25 (leger) a 45-55 (metal palm-mute).

METHODE DE CONSTRUCTION DU SON (ordre de conception, pas ordre de la chaine)
Construis chaque preset dans cet ordre, comme un ingenieur du son :
1. AMP + CAB D'ABORD. Cale le couple ampli/baffle pour obtenir le son de base
   (clair, ou juste au bord de la saturation) AVANT d'ajouter le moindre effet.
   Monter la disto en premier est une erreur. Le CAB doit TOUJOURS etre actif
   (le signal part en direct dans une sono/interface FRFR : sans cab, le son est
   inutilisable). Choisis un cab coherent avec l'ampli (un baffle de la meme
   famille que la tete).
2. Regle le Gain de l'ampli jusqu'au caractere voulu, puis ajuste le Volume de
   l'ampli et le Volume du cab pour un niveau propre, sans saturation parasite.
3. EFFETS ENSUITE, seulement s'ils servent le morceau. Pour chacun, n'ecris QUE
   des parametres qui existent sur le modele choisi (voir catalogue) ; sinon
   laisse le defaut. Principes utiles quand le parametre EXISTE sur le modele :
   - REVERB / DELAY : si le modele a un parametre "Trail", mets-le a 1 pour que la
     traine ne soit pas coupee net. Sur un delay, si le modele a "Sync", le mettre
     a 1 lie le temps au tempo ; la subdivision croche pointee (dotted 1/8) donne
     l'effet galop classique. Reverb : reduire "Pre Delay" resserre l'espace.
   - COMPRESSEUR : privilegie une compression discrete. Si le modele a un parametre
     "Blend", ~50 (compression parallele) epaissit sans ecraser l'attaque.
   - EQ : pour faire ressortir la guitare dans un mix, pousse legerement les
     mediums (autour de 1-4 kHz) plutot que de tout monter.
   - NR (gate) : "Threshold" 20-30 suffit a couper le souffle de micros simples ;
     monte vers 45-55 seulement pour des palm-mutes metal serres.
   - MODULATION : dosage leger par defaut ; un chorus discret suffit souvent.
Ne force JAMAIS un effet ou un parametre absent du modele : mieux vaut un preset
sobre et juste qu'un preset charge d'effets hors sujet.

SORTIE
Reponds UNIQUEMENT par un objet JSON, sans texte autour, sans balises markdown :
{
  "artiste": "l'artiste ou groupe, ou '' si la demande n'en cite pas",
  "titre": "le titre du morceau, ou l'ambiance demandee si pas de morceau precis",
  "recherche": "ce que tu sais du rig reel, et ce dont tu n'es pas sur",
  "structure": "en une phrase : combien de sons distincts, et pourquoi",
  "sections": [
   {
    "nom": "Rythmique",
    "role": "disto",
    "raison": "pourquoi cette section existe, et en quoi son son differe des autres",
    "variants": [
    {
      "label": "A - Fidele",
      "axe": "en une phrase, l'arbitrage de cette variante",
      "ecoute": "ce qu'il faut ecouter en premier pour la departager",
      "spec": {
        "name": "16 car max",
        "author": "Claude",
        "description": "40 car max",
        "chain_order": [4,0,1,2,3,5,6,7,8,9,10],
        "modules": {
          "PRE": null,
          "WAH": null,
          "DST": {"model": "Green OD", "on": true, "params": {"Gain": 15}},
          "AMP": {"model": "EV 51", "on": true, "params": {"Gain": 78}},
          "NR":  {"model": "Gate 2", "on": true, "params": {"Threshold": 45}},
          "CAB": {"model": "EV", "on": true, "params": {"Low Cut": 85, "High Cut": 9000}},
          "EQ": null, "MOD": null,
          "DLY": {"model": "Digital Delay S", "on": true, "params": {"Mix": 15, "Trail": 1}},
          "RVB": {"model": "Room", "on": true, "params": {"Mix": 8, "Trail": 1}},
          "VOL": {"model": "Volume", "on": true, "params": {"Volume": 100}}
        }
      }
    }
    ]
   }
  ],
  "notes": "ecarts assumes vs le rig d'origine, incertitudes"
}

"role" vaut obligatoirement l'un de : clean, crunch, disto, lead.
"nom" fait 12 caracteres max (il sert a nommer les fichiers).
Chaque section contient EXACTEMENT 3 variantes.

CATALOGUE COMPLET DES MODELES DISPONIBLES
"""


# ---------------------------------------------------------------- API call
def _http_json(url, body, headers, timeout=180):
    """Renvoie (donnees, en-tetes). Les en-tetes portent les quotas restants."""
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(raw).get("error", {})
            msg = err.get("message") or raw[:400]
        except Exception:
            err, msg = {}, raw[:400]
        # un 429 "billing" = credit epuise : attendre n'y changera rien
        if e.code == 429 and "credit" in msg.lower():
            msg += ("\n>> Solde de credit epuise. Recharger sur "
                    "https://console.anthropic.com/settings/billing")
        elif e.code == 429:
            ra = e.headers.get("retry-after")
            msg += "\n>> Limite par minute atteinte%s" % (
                " : reessayer dans %ss" % ra if ra else "")
        raise RuntimeError("API HTTP %s : %s" % (e.code, msg))
    except urllib.error.URLError as e:
        raise RuntimeError("Reseau : %s" % e.reason)


def anthropic_cost(model, u):
    """Cout en $ d'un appel, d'apres l'objet usage renvoye par l'API."""
    base, out = PRICES.get(model, (2.0, 10.0))
    c = (u.get("input_tokens", 0) * base
         + u.get("cache_creation_input_tokens", 0) * base * CACHE_WRITE_MULT
         + u.get("cache_read_input_tokens", 0) * base * CACHE_READ_MULT) / 1e6
    c += u.get("output_tokens", 0) * out / 1e6
    c += (u.get("server_tool_use", {}) or {}).get("web_search_requests", 0) \
        * WEB_SEARCH_UNIT
    return c


def _call_anthropic(cfg, system, msgs, log):
    # Le prompt systeme (~7 200 tokens de catalogue) est IDENTIQUE a chaque
    # appel : on le met en cache. Les relectures coutent 10 % du prix d'entree,
    # ce qui rend la boucle d'auto-correction quasi gratuite en entree.
    body = {"model": model_of(cfg),
            "max_tokens": int(cfg.get("max_tokens", 16000)),
            "system": [{"type": "text", "text": system,
                        "cache_control": {"type": "ephemeral"}}],
            "messages": msgs}
    if cfg.get("web_search"):
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search",
                          "max_uses": int(cfg.get("max_searches", 3))}]
    d, hdr = _http_json(ANTHROPIC_URL, body,
                        {"content-type": "application/json",
                         "x-api-key": api_key_of(cfg),
                         "anthropic-version": ANTHROPIC_VERSION})
    u = d.get("usage", {})
    cost = anthropic_cost(model_of(cfg), u)
    cfg["_session_cost"] = cfg.get("_session_cost", 0.0) + cost
    cfg["_spend"] = add_spend(cost)
    cfg["_limits"] = read_rate_limits(hdr)
    nsearch = (u.get("server_tool_use", {}) or {}).get("web_search_requests", 0)
    log(T("log_tokens")
        % (u.get("input_tokens"), u.get("cache_creation_input_tokens", 0),
           u.get("cache_read_input_tokens", 0), u.get("output_tokens"), nsearch))
    log(T("log_cost")
        % (cost, cfg["_session_cost"]))
    if cfg["_limits"]:
        log(T("log_quota", fmt_limits(cfg["_limits"])))

    # Une reponse coupee a max_tokens produit un JSON invalide : sans ce test,
    # l'erreur remonte en "reponse illisible" et l'appel (le plus cher) est
    # perdu. Observe en reel : 8354 tokens de sortie pour max_tokens=8000.
    cfg["_truncated"] = d.get("stop_reason") == "max_tokens"
    if cfg["_truncated"]:
        log(T("log_truncated")
            % (body["max_tokens"], u.get("output_tokens")))
    # on ne garde que les blocs texte (ignore server_tool_use / resultats web)
    return "\n".join(b.get("text", "") for b in d.get("content", [])
                      if b.get("type") == "text").strip()


def read_rate_limits(hdr):
    """Extrait les en-tetes anthropic-ratelimit-*.

    Ce sont des quotas PAR MINUTE, pas un solde de credit. Anthropic n'expose
    aucun endpoint public de solde pour une cle standard (la Rate Limits API
    d'avril 2026 exige une cle Admin).
    """
    h = {k.lower(): v for k, v in (hdr or {}).items()}
    out = {}
    for what in ("requests", "tokens", "input-tokens", "output-tokens"):
        rem = h.get("anthropic-ratelimit-%s-remaining" % what)
        lim = h.get("anthropic-ratelimit-%s-limit" % what)
        if rem is not None:
            out[what] = {"remaining": int(rem),
                         "limit": int(lim) if lim else None,
                         "reset": h.get("anthropic-ratelimit-%s-reset" % what)}
    return out


def fmt_limits(lim):
    parts = []
    for what, v in lim.items():
        parts.append("%s %s/%s" % (what, v["remaining"], v["limit"] or "?"))
    return "  ".join(parts)


def _call_gemini(cfg, system, msgs, log):
    """Gemini a un contrat different d'Anthropic :
      - le systeme va dans `system_instruction`, pas dans les messages
      - le role assistant s'appelle `model`
      - la cle passe par l'en-tete x-goog-api-key
    """
    contents = [{"role": ("model" if m["role"] == "assistant" else "user"),
                 "parts": [{"text": m["content"]}]} for m in msgs]
    body = {"system_instruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": int(cfg.get("max_tokens", 16000)),
                "temperature": 0.7}}
    if cfg.get("web_search"):
        # le grounding Google Search est incompatible avec le mode JSON force
        body["tools"] = [{"google_search": {}}]
    else:
        body["generationConfig"]["responseMimeType"] = "application/json"

    url = "%s/models/%s:generateContent" % (GEMINI_BASE, model_of(cfg))
    d, _hdr = _http_json(url, body, {"content-type": "application/json",
                                     "x-goog-api-key": api_key_of(cfg)})

    u = d.get("usageMetadata", {})
    log(T("log_tokens_simple") % (u.get("promptTokenCount"),
                                      u.get("candidatesTokenCount")))
    cands = d.get("candidates") or []
    if not cands:
        fb = d.get("promptFeedback", {})
        raise RuntimeError("Gemini n'a rien renvoye (%s)" % (fb or "raison inconnue"))
    c = cands[0]
    if c.get("finishReason") in ("SAFETY", "RECITATION", "BLOCKLIST"):
        raise RuntimeError("Reponse bloquee par Gemini : %s" % c["finishReason"])
    cfg["_truncated"] = c.get("finishReason") == "MAX_TOKENS"
    if cfg["_truncated"]:
        log(T("log_truncated_simple"))
    parts = (c.get("content") or {}).get("parts") or []
    # ecarter les blocs de raisonnement des modeles "thinking"
    return "\n".join(p["text"] for p in parts
                      if "text" in p and not p.get("thought")).strip()


def _call_perplexity(cfg, system, msgs, log):
    """Perplexity suit le contrat OpenAI (chat/completions) :
      - system dans un message role=system en tete
      - cle en en-tete Authorization: Bearer
      - recherche web NATIVE (les modeles 'sonar' cherchent toujours) : pas de
        tool a activer, d'ou l'interet pour identifier le vrai rig.
    Pas d'API publique de cout par appel : on ne suit pas la depense ici.
    """
    full = [{"role": "system", "content": system}]
    for m in msgs:
        role = "assistant" if m["role"] == "assistant" else "user"
        full.append({"role": role, "content": m["content"]})
    body = {"model": model_of(cfg),
            "messages": full,
            "max_tokens": int(cfg.get("max_tokens", 16000)),
            "temperature": 0.6}
    d, _hdr = _http_json(PERPLEXITY_URL, body,
                         {"content-type": "application/json",
                          "authorization": "Bearer " + api_key_of(cfg)})
    u = d.get("usage", {})
    log(T("log_tokens_simple")
        % (u.get("prompt_tokens"), u.get("completion_tokens")))
    choices = d.get("choices") or []
    if not choices:
        raise RuntimeError("Perplexity n'a rien renvoye (%s)" % (d.get("error") or "?"))
    ch = choices[0]
    cfg["_truncated"] = ch.get("finish_reason") == "length"
    if cfg["_truncated"]:
        log(T("log_truncated_simple"))
    return (ch.get("message") or {}).get("content", "").strip()


def _call_openai(cfg, system, msgs, log):
    """OpenAI suit un contrat tres proche de Perplexity."""
    full = [{"role": "system", "content": system}]
    for m in msgs:
        role = "assistant" if m["role"] == "assistant" else "user"
        full.append({"role": role, "content": m["content"]})
    
    body = {"model": model_of(cfg),
            "messages": full,
            "temperature": 0.7,
            "max_tokens": int(cfg.get("max_tokens", 16000))}

    d, _hdr = _http_json(OPENAI_URL, body,
                         {"content-type": "application/json",
                          "authorization": "Bearer " + api_key_of(cfg)})
    u = d.get("usage", {})
    log(T("log_tokens_simple")
        % (u.get("prompt_tokens"), u.get("completion_tokens")))
    
    choices = d.get("choices") or []
    if not choices:
        raise RuntimeError("OpenAI n'a rien renvoye (%s)" % (d.get("error") or "?"))
    
    ch = choices[0]
    cfg["_truncated"] = ch.get("finish_reason") == "length"
    if cfg["_truncated"]:
        log(T("log_truncated_simple"))
    
    return (ch.get("message") or {}).get("content", "").strip()


def _call_openrouter(cfg, system, msgs, log):
    """OpenRouter suit exactement le contrat OpenAI.

    Les deux en-tetes HTTP-Referer / X-Title sont facultatifs : ils servent a
    l'attribution de l'application chez OpenRouter.
    """
    full = [{"role": "system", "content": system}]
    for m in msgs:
        role = "assistant" if m["role"] == "assistant" else "user"
        full.append({"role": role, "content": m["content"]})

    body = {"model": model_of(cfg),
            "messages": full,
            "temperature": 0.7,
            "max_tokens": int(cfg.get("max_tokens", 16000))}

    hdrs = {"content-type": "application/json",
            "authorization": "Bearer " + api_key_of(cfg),
            "HTTP-Referer": "https://github.com/rudywidmer/GP200-Studio",
            "X-Title": "GP-200 Studio"}
    try:
        d, _hdr = _http_json(OPENROUTER_URL, body, hdrs)
    except RuntimeError as e:
        # Le catalogue d'OpenRouter bouge : un modele gratuit peut passer en
        # payant du jour au lendemain. Dans ce cas l'API repond 404 en
        # indiquant elle-meme le bon identifiant. On le reprend et on
        # reessaie une fois, plutot que de faire echouer la generation.
        msg = str(e)
        m = re.search(r"use this slug instead:\s*([\w./:-]+)", msg)
        if "404" in msg and m:
            new_model = m.group(1).rstrip(".")
            log("Modele indisponible, bascule automatique sur %s" % new_model)
            body["model"] = new_model
            cfg["model"] = new_model
            d, _hdr = _http_json(OPENROUTER_URL, body, hdrs)
        else:
            raise
    u = d.get("usage", {})
    log(T("log_tokens_simple")
        % (u.get("prompt_tokens"), u.get("completion_tokens")))

    choices = d.get("choices") or []
    if not choices:
        err = d.get("error") or "?"
        raise RuntimeError("OpenRouter n'a rien renvoye (%s)" % err)

    ch = choices[0]
    cfg["_truncated"] = ch.get("finish_reason") == "length"
    if cfg["_truncated"]:
        log(T("log_truncated_simple"))

    return (ch.get("message") or {}).get("content", "").strip()


def call_api(cfg, system, msgs, log=print):
    prov = cfg.get("provider", DEFAULT_PROVIDER)
    if not api_key_of(cfg):
        raise RuntimeError("Aucune cle API pour le fournisseur %r." % prov)
    if prov == "anthropic":
        return _call_anthropic(cfg, system, msgs, log)
    if prov == "gemini":
        return _call_gemini(cfg, system, msgs, log)
    if prov == "perplexity":
        return _call_perplexity(cfg, system, msgs, log)
    if prov == "openai":
        return _call_openai(cfg, system, msgs, log)
    if prov == "openrouter":
        return _call_openrouter(cfg, system, msgs, log)
    raise RuntimeError("Fournisseur inconnu : %r" % prov)


def _openrouter_models(cfg):
    """Liste courte et SURE de modeles OpenRouter capables de faire le travail.

    Principe : ne jamais coder en dur un identifiant de modele gratuit. Le
    catalogue bouge (plus de 340 entrees, et un modele gratuit peut passer en
    payant du jour au lendemain). On classe donc sur des criteres OBJECTIFS
    que l'API declare elle-meme, ce qui reste valable dans le temps.

    Filtres eliminatoires -- un modele qui echoue ici echouera la generation :

      * gratuit : prix d'entree ET de sortie a zero ;
      * fenetre de contexte suffisante : le prompt systeme fait ~12 000 tokens
        et on demande max_tokens en sortie ;
      * sortie maximale suffisante : un modele plafonne a 4 096 tokens
        renverra un JSON tronque, donc un echec garanti ;
      * produit bien du texte.

    Classement -- ce qui compte pour nous, c'est la capacite a rendre du JSON
    valide :

      * structured_outputs   le modele sait contraindre sa sortie   (+4)
      * response_format      mode JSON                              (+3)
      * json_mode            idem, autre nom                        (+3)
      * tools                bon indicateur de suivi d'instructions (+1)
      * grande fenetre de contexte                                  (bonus)

    Reglage : "openrouter_paid": true dans config.json ajoute quelques
    modeles payants reputes fiables a la fin de la liste.
    """
    def price(m):
        """Prix d'entree/sortie. Peut etre une liste (tarifs par paliers)."""
        pr = m.get("pricing")
        if isinstance(pr, list):
            pr = pr[0] if pr else {}
        if not isinstance(pr, dict):
            return None, None
        def f(v):
            try:
                return float(v)
            except (TypeError, ValueError):
                return None
        return f(pr.get("prompt")), f(pr.get("completion"))

    # On assouplit la exigence : 4096 tokens en sortie suffisent amplement 
    # pour un JSON de presets, ouvrant la porte à la majorité des modèles gratuits.
    want_out = min(int(cfg.get("max_tokens", 16000)), 4096)
    need_ctx = 16000  # Contexte total minimal raisonnable

    # Tentative avec les paramètres de filtrage et de tri de l'API
    try:
        url = "https://openrouter.ai/api/v1/models?output_modalities=text&sort=pricing-low-to-high"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8")).get("data", [])
    except Exception:
        # Fallback de sécurité : si l'API rejette les paramètres de requête, 
        # on interroge l'endpoint brut et Python se chargera du filtrage
        url = "https://openrouter.ai/api/v1/models"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8")).get("data", [])

    scored = []
    for m in data:
        mid = m.get("id")
        if not mid or mid == "openrouter/free":
            continue

        pin, pout = price(m)
        if pin is None or pout is None or pin > 0 or pout > 0:
            continue                       # payant, ou tarif illisible

        try:
            ctx = int(m.get("context_length") or 0)
        except (TypeError, ValueError):
            ctx = 0
        if ctx and ctx < need_ctx:
            continue

        top = m.get("top_provider") or {}
        mx = top.get("max_completion_tokens") or m.get("max_completion_tokens")
        try:
            mx = int(mx) if mx else 0
        except (TypeError, ValueError):
            mx = 0
        if mx and mx < want_out:
            continue                       # sortie plafonnee : JSON tronque

        arch = m.get("architecture") or {}
        outs = arch.get("output_modalities") or []
        if outs and "text" not in outs:
            continue

        feats = set(m.get("supported_parameters") or [])
        feats |= set((m.get("features") or []) if isinstance(
            m.get("features"), list) else [])
        sc = 0
        if "structured_outputs" in feats:
            sc += 4
        if "response_format" in feats:
            sc += 3
        if "json_mode" in feats:
            sc += 3
        if "tools" in feats:
            sc += 1
        sc += min(ctx, 400000) / 200000.0          # petit bonus de contexte
        scored.append((sc, ctx, mid))

    # Fonction pour trouver l'index de la famille dans OPENROUTER_FAMILY_RANK
    def get_family_rank(mid):
        for idx, fam in enumerate(OPENROUTER_FAMILY_RANK):
            if mid.startswith(fam):
                return idx
        return len(OPENROUTER_FAMILY_RANK)  # Si la famille n'est pas listée, elle passe après

    # Tri combinant : 
    # 1. Le rang de la famille (les familles prioritaires comme qwen/ ou deepseek/ d'abord)
    # 2. Le score technique (-t[0])
    # 3. La taille du contexte (-t[1])
    scored.sort(key=lambda t: (get_family_rank(t[2]), -t[0], -t[1]))
    out = ["openrouter/free"] + [mid for _sc, _c, mid in scored[:20]]

    if cfg.get("openrouter_paid"):
        # Repli payant, volontairement court : des valeurs sures, pas un
        # catalogue. La zone de saisie du modele reste editable de toute
        # facon, on peut y taper n'importe quel identifiant.
        out += ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5",
                "openai/gpt-4o-mini", "deepseek/deepseek-chat"]
    return out


def list_models(cfg):
    """Interroge le fournisseur pour la liste reelle des modeles.

    Les noms de modeles changent vite (Google a retire gemini-2.0-flash en
    mars 2026) : mieux vaut demander que coder en dur.
    """
    prov = cfg.get("provider", DEFAULT_PROVIDER)
    key = api_key_of(cfg)
    if not key or prov == "perplexity":
        # Perplexity n'expose pas d'endpoint de liste de modeles : liste statique.
        return PROVIDERS[prov]["models"]
    try:
        if prov == "gemini":
            req = urllib.request.Request(
                GEMINI_BASE + "/models?pageSize=200",
                headers={"x-goog-api-key": key})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8"))
            out = [m["name"].split("/")[-1] for m in d.get("models", [])
                   if "generateContent" in (m.get("supportedGenerationMethods")
                                            or m.get("supportedActions") or [])]
        elif prov == "openai":
            req = urllib.request.Request(
                "https://api.openai.com/v1/models",
                headers={"Authorization": "Bearer " + key})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8"))
            out = [m["id"] for m in d.get("data", []) if "gpt-4" in m["id"] or "gpt-3.5" in m["id"]]
        elif prov == "openrouter":
            return _openrouter_models(cfg)
        else:
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/models?limit=100",
                headers={"x-api-key": key,
                         "anthropic-version": ANTHROPIC_VERSION})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8"))
            out = [m["id"] for m in d.get("data", [])]
        return sorted(set(out)) or PROVIDERS[prov]["models"]
    except Exception:
        return PROVIDERS[prov]["models"]


def extract_json(txt):
    # 1. Nettoyer les balises markdown et espaces superflus
    txt = re.sub(r"^\s*```(?:json)?|```\s*$", "", txt.strip(), flags=re.IGNORECASE | re.MULTILINE)
    i, j = txt.find("{"), txt.rfind("}")
    if i < 0 or j < 0:
        raise ValueError("Aucun JSON dans la reponse : %s" % txt[:200])
    
    json_str = txt[i:j + 1]
    
    # 2. CORRECTION AUTOMATIQUE : Supprimer les virgules trainantes (ex: {"a": 1,} -> {"a": 1})
    json_str = re.sub(r",\s*([}\]])", r"\1", json_str)
    
    return json.loads(json_str)


# ------------------------------------------------------------- validation
def check_names(tb, spec):
    """Pre-valide noms de modeles ET noms de parametres, avec suggestions.

    La validation des parametres DOIT se faire ici et pas seulement dans
    encode_prst : sinon un parametre hallucine leve une ValueError apres la
    boucle de correction, et l'appel API est perdu au lieu d'etre rattrape.
    """
    errs = []
    for slot, ms in (spec.get("modules") or {}).items():
        if not ms or not ms.get("model"):
            continue
        if slot not in SLOT_ACCEPTS:
            errs.append("slot %r inconnu (attendus: %s)" % (slot, MODULES))
            continue
        try:
            m, cat = tb.find(slot, ms["model"])
        except ValueError:
            if slot == "CAB":
                pool = [c["name"] for c in tb.cabs if not c["user_slot"]]
            else:
                pool = [m2["name"] for m2 in tb.models
                        if m2["cat"] in SLOT_ACCEPTS[slot]]
            near = difflib.get_close_matches(ms["model"], pool, n=4, cutoff=0.4)
            errs.append("slot %s : le modele %r N'EXISTE PAS. Proches : %s"
                        % (slot, ms["model"], near or pool[:8]))
            continue

        mid = m["model_id"] if cat == 10 else m["id"]
        plist = tb.params_of(mid, cat)
        known = {_norm_name(p["name"]): p for p in plist}
        for g, val in (ms.get("params") or {}).items():
            p = known.get(_norm_name(g))
            if p is None:
                near = difflib.get_close_matches(
                    g, [p2["name"] for p2 in plist], n=3, cutoff=0.4)
                errs.append("slot %s / %s : le parametre %r N'EXISTE PAS. "
                            "Parametres reels : %s%s"
                            % (slot, m.get("name"), g,
                               [p2["name"] for p2 in plist],
                               " (proche : %s)" % near if near else ""))
                continue
            try:
                v = float(val)
            except (TypeError, ValueError):
                errs.append("slot %s / %s / %s : %r n'est pas un nombre"
                            % (slot, m.get("name"), p["name"], val))
                continue
            lo, hi = min(p["min"], p["max"]), max(p["min"], p["max"])
            if not (lo <= v <= hi):
                errs.append("slot %s / %s / %s : %g est hors plage [%g..%g]"
                            % (slot, m.get("name"), p["name"], v, lo, hi))
    n = spec.get("name", "")
    if len(n) > 16:
        errs.append("name %r fait %d caracteres (max 16)" % (n, len(n)))
    ch = spec.get("chain_order")
    if ch is not None and sorted(ch) != list(range(11)):
        errs.append("chain_order %r n'est pas une permutation de 0..10" % (ch,))
    return errs


ROLES = ["clean", "crunch", "disto", "lead"]
ROLE_HINT = {
    "clean": "son clair : pas de DST, gain d'ampli bas",
    "crunch": "crunch : ampli en limite de saturation, gain moyen",
    "disto": "sature : le gain vient de l'ampli",
    "lead": "solo : boost devant, mediums remontes pour percer, souvent un delay",
}


def normalize_payload(payload):
    """Accepte l'ancien schema (variants au 1er niveau) et le nouveau (sections)."""
    if payload.get("sections"):
        return payload
    out = dict(payload)
    out["sections"] = [{"nom": "Preset", "role": "", "raison": "",
                        "variants": payload.get("variants", [])}]
    return out


def check_sections(tb, payload):
    """Valide la structure renvoyee. Renvoie (erreurs_fatales, avertissements_style)."""
    errs = []
    warns = []
    secs = payload.get("sections") or []
    if not secs:
        return ["aucune section : il en faut au moins une"], []
    if len(secs) > 4:
        errs.append("%d sections, c'est trop (4 maximum). Regroupe les parties qui "
                    "partagent le meme son." % len(secs))
    noms = []
    for sec in secs:
        lbl = sec.get("nom") or "?"
        noms.append(lbl)
        if sec.get("role") and sec["role"] not in ROLES:
            errs.append("section %r : role %r invalide (attendus : %s)"
                        % (lbl, sec["role"], ", ".join(ROLES)))
        vs = sec.get("variants") or []
        if len(vs) != 3:
            errs.append("section %r : %d variante(s), il en faut EXACTEMENT 3"
                        % (lbl, len(vs)))
        for v in vs:
            for e in check_names(tb, v.get("spec", {})):
                errs.append("[%s / %s] %s" % (lbl, v.get("label", "?"), e))
        # la divergence se verifie DANS une section, pas entre sections
        for w in check_divergence(sec):
            warns.append("section %r : %s" % (lbl, w))
    if len(set(noms)) != len(noms):
        errs.append("deux sections portent le meme nom : %s" % noms)
    # les noms de presets doivent rester distincts d'une section a l'autre
    allnames = [(v.get("spec") or {}).get("name") for sec in secs
                for v in (sec.get("variants") or [])]
    dupes = {n for n in allnames if n and allnames.count(n) > 1}
    if dupes:
        errs.append("noms de presets dupliques entre sections : %s. Rends-les "
                    "distincts (ex. 'MOP Rythm Fid' et 'MOP Solo Fid')."
                    % sorted(dupes))
    return errs, warns


def _variant_signature(v):
    """Signature d'une variante pour juger si deux variantes sont vraiment
    distinctes. On resume ce qui s'ENTEND : l'ampli, le cab, l'ensemble des
    modules actifs (quels effets sont branches), et le niveau de gain arrondi.
    Deux variantes qui different sur n'importe lequel de ces axes sont musicalement
    distinctes -- pas besoin de changer l'ampli si les effets/gain changent."""
    mods = (v.get("spec") or {}).get("modules") or {}
    amp = (mods.get("AMP") or {}).get("model")
    cab = (mods.get("CAB") or {}).get("model")
    # quels modules d'effet sont actifs (on) : la "recette" d'effets
    active = tuple(sorted(
        k for k in ("PRE", "WAH", "DST", "MOD", "DLY", "RVB", "EQ")
        if (mods.get(k) or {}).get("on") and (mods.get(k) or {}).get("model")))
    # modeles d'effets choisis (un chorus n'est pas un flanger)
    fx_models = tuple((mods.get(k) or {}).get("model") for k in active)
    # gain de l'ampli arrondi par pas de 15 : une vraie difference de saturation
    gain = None
    for gk in ("Gain", "Gain 1", "Drive"):
        gv = ((mods.get("AMP") or {}).get("params") or {}).get(gk)
        if isinstance(gv, (int, float)):
            gain = round(gv / 15)
            break
    return (amp, cab, active, fx_models, gain)


def check_divergence(section):
    """Deux variantes d'une meme section sont trop proches seulement si elles
    sont IDENTIQUES sur tous les axes audibles a la fois : meme ampli, meme cab,
    memes effets actifs, memes modeles d'effet et meme niveau de gain.

    Auparavant on exigeait un couple (AMP, CAB) different, ce qui forcait a changer
    l'ampli meme quand une variation d'effets/gain aurait suffi -- et donnait des
    variantes qui trahissaient le morceau. Desormais une divergence sur les effets,
    le gain ou l'EQ compte comme une vraie variante, ce qui respecte mieux le son
    d'origine.
    """
    seen, errs = {}, []
    for v in section.get("variants", []):
        sig = _variant_signature(v)
        if sig == (None, None, (), (), None):
            continue
        if sig in seen:
            errs.append("les variantes %r et %r sont quasi identiques (meme ampli, "
                        "meme baffle, memes effets et meme gain). Fais-les diverger "
                        "d'un cran de facon audible -- change le dosage ou le choix "
                        "des effets, le niveau de gain/saturation, ou l'ampli/baffle "
                        "-- tout en gardant le son du morceau."
                        % (seen[sig], v.get("label", "?")))
        else:
            seen[sig] = v.get("label", "?")
    return errs


OFF_PATCH_VOL = 0x38   # octet du volume global du preset (0-100), verifie sur
                       # 128 presets d'usine + exports manuels de l'utilisateur


def estimate_patch_vol(spec, role=""):
    """Stub de compatibilité pour gp200_setlist.py (renvoie la valeur par défaut 70)."""
    return 70


def fill_default_cab(spec, tb):
    """Pose explicitement la baffle par defaut de l'ampli quand l'IA n'en donne pas.

    Audit autoprobe du 04/10 : un changement d'ampli fait charger a la pedale sa baffle par
    defaut (71 amplis confirmes, tous d'accord avec `defcab`). Un preset sans CAB heritait donc
    de la baffle de repli (Mess, desactivee) au lieu de celle de l'ampli. Ne touche a rien si
    l'ampli est absent/OFF, si le modele est inconnu ou si une baffle est deja nommee."""
    mods = spec.get("modules") if isinstance(spec, dict) else None
    if not isinstance(mods, dict):
        return spec
    amp = mods.get("AMP")
    if not amp or not amp.get("model") or not amp.get("on", True):
        return spec
    cab = mods.get("CAB")
    if cab and cab.get("model"):
        return spec
    try:
        m, cat = tb.find("AMP", amp["model"])
    except ValueError:
        return spec
    if m.get("defcab") is None:
        return spec
    c = tb.cab(m["defcab"])
    if not c:
        return spec
    mods["CAB"] = {"model": c["name"], "on": True, "params": {}}
    return spec


def apply_patch_vol(raw, spec, role="", log=None):
    """Ecrit un Patch VOL par défaut à 70. L'harmonisation se fera via l'outil de Batch."""
    
    pv = 70
    
    b = bytearray(raw)
    b[OFF_PATCH_VOL] = pv
    cs = checksum(bytes(b))
    struct.pack_into(">H", b, FILE_SIZE - 2, cs)

    return bytes(b), pv


def safe_filename(s):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s).strip("_") or "preset"


def safe_dirname(s):
    """Comme safe_filename mais PRESERVE les espaces (version B du nommage).
    Retire seulement les caracteres interdits par Windows/Mac dans un nom de
    dossier : \\ / : * ? \" < > | et les caracteres de controle."""
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", s)
    s = re.sub(r"\s+", " ", s).strip(" .")     # pas de point/espace final (Windows)
    return s or "preset"


# -------------------------------------------------------------- generation
def forced_prompt(roles):
    """Consigne de forcage quand l'utilisateur impose les sections."""
    if not roles:
        return ""
    return ("\n\nCONSIGNE IMPERATIVE : ne determine PAS la structure toi-meme. "
            "Produis EXACTEMENT %d section(s), une par role demande, dans cet "
            "ordre : %s.\n%s"
            % (len(roles), ", ".join(roles),
               "\n".join("  - %s : %s" % (r, ROLE_HINT[r]) for r in roles)))


def pickup_instruction(pickup):
    """Consigne sur le micro de la guitare. Le micro change le niveau de sortie
    et le contenu harmonique attaquant l'ampli : un humbucker pousse plus fort et
    plus sombre (moins de gain necessaire, moins d'aigus), un simple bobinage est
    plus clair et plus faible (souvent un peu plus de gain/presence), un actif est
    tres chaud et compresse. Le modele doit en tenir compte dans Gain/Presence/EQ."""
    desc = {
        "humbucker": "La guitare a des micros HUMBUCKER (double bobinage) : sortie "
                     "chaude et puissante. Vise un peu MOINS de gain que pour un "
                     "simple bobinage a son egal, et attention aux basses qui "
                     "peuvent devenir boueuses en haute distorsion.",
        "single": "La guitare a des micros SIMPLE BOBINAGE : sortie plus faible et "
                  "plus claire, plus d'aigus. On peut pousser le gain et la "
                  "presence un peu plus, et surveiller le souffle en haute gain.",
        "p90": "La guitare a des micros P90 : entre simple et humbucker, medium "
               "epais et mordant. Gain modere, garde du grain.",
        "active": "La guitare a des micros ACTIFS (type EMG) : sortie tres chaude, "
                  "compressee, plancher de bruit bas. Le gain de l'ampli attaque "
                  "fort : reduis-le legerement, l'attaque est deja tres serree.",
    }
    d = desc.get(pickup)
    return ("\n\nMICRO GUITARE : " + d) if d else ""


def lang_instruction(ui_lang):
    """Consigne de langue, COURTE, a placer en fin de demande.

    Lecon apprise : une consigne longue/impérative placee EN TETE poussait le
    modele a ecrire du texte explicatif hors du JSON -> champs texte vides a
    l'affichage. On la garde donc breve et en fin, sans casser le contrat
    'reponds uniquement en JSON'. La langue cible est nommee explicitement, avec
    l'avertissement sur les noms propres anglophones.

    Regle : langue de l'INTERFACE par defaut ; suivre la demande seulement si
    elle est ecrite en phrases completes dans une autre langue."""
    names = {"fr": "francais", "en": "English", "es": "espanol"}
    target = names.get(ui_lang, "francais")
    return ("\n\n(Langue : redige les VALEURS des champs texte du JSON "
            "\"recherche\", \"structure\", \"raison\", \"axe\", \"ecoute\", "
            "\"notes\" en %s. Un titre ou nom d'artiste anglophone ne change PAS "
            "cette langue. Les cles JSON et les noms de modeles/cabs/parametres "
            "restent inchanges. Reponds toujours UNIQUEMENT par l'objet JSON.)"
            % target)


def generate(cfg, tb, demande, log=print, roles=None):
    """Renvoie (payload, [(chemin, section, variant), ...]).

    roles : None/[] = le modele detecte la structure lui-meme.
            ["clean","lead"] = sections imposees.
    """
    current_model = model_of(cfg).lower()
    is_free_model = "free" in current_model
    if is_free_model:
        log("[Info] Modèle gratuit détecté : utilisation du catalogue allégé (light) pour éviter les erreurs de timeout.")
    system = SYSTEM + compact_catalog(tb, light=is_free_model)
    ui_lang = cfg.get("lang") or "fr"
    content = (demande + forced_prompt(roles)
               + pickup_instruction(cfg.get("pickup", "auto"))
               + lang_instruction(ui_lang))
    msgs = [{"role": "user", "content": content}]

    # Cout de CETTE generation : on note le cumul avant, la difference apres
    # donne ce que ce preset a coute (meme si la boucle fait plusieurs appels).
    cost_before = cfg.get("_session_cost", 0.0)

    payload = None
    for attempt in range(int(cfg.get("max_retries", 2)) + 1):
        log(T("log_api_attempt", attempt + 1))
        txt = call_api(cfg, system, msgs, log)
        try:
            payload = extract_json(txt)
        except ValueError as e:
            if cfg.get("_truncated"):
                # Inutile de renvoyer 8000 tokens de JSON coupe : on repart de
                # la demande en exigeant plus de concision.
                log(T("log_json_cut"))
                msgs = [{"role": "user", "content": demande + forced_prompt(roles) +
                         pickup_instruction(cfg.get("pickup", "auto")) +
                         lang_instruction(ui_lang) +
                         "\n\nIMPORTANT : ta reponse precedente a ete coupee car "
                         "trop longue. Sois BEAUCOUP plus concis : le champ "
                         "\"recherche\" fait 5 phrases maximum, \"axe\", "
                         "\"ecoute\" et \"raison\" une phrase chacun, "
                         "\"notes\" 3 phrases. Ne precise que les parametres "
                         "qui comptent, et ne cree pas de section inutile."}]
            else:
                log(T("log_unreadable", e))
                msgs += [{"role": "assistant", "content": txt},
                         {"role": "user", "content":
                          "Ta reponse n'etait pas un JSON valide. Renvoie "
                          "UNIQUEMENT l'objet JSON demande, sans texte ni "
                          "balises."}]
            continue

        payload = normalize_payload(payload)
        errs, warns = check_sections(tb, payload)
        if roles:
            got = [s.get("role") for s in payload.get("sections", [])]
            if got != list(roles):
                errs.append("sections imposees : attendu %s, recu %s"
                            % (list(roles), got))
        
        # Filtre "Turbo & Eco" : on ignore les warnings de style pour Claude
        is_premium = "claude" in current_model
        
        if is_premium:
            errs_to_fix = errs
            if warns:
                log("[Info] Avertissements de style ignores pour %s (economie de tokens)." % current_model)
                # On les affiche quand meme dans le log pour info, sans declencher de retry
                for w in warns:
                    log("  ! " + w)
        else:
            errs_to_fix = errs + warns

        if not errs_to_fix:
            break

        log(T("log_errors_fix", len(errs_to_fix)))
        for e in errs_to_fix:
            log(T("log_bullet", e))
        msgs += [{"role": "assistant", "content": txt},
                 {"role": "user", "content":
                  "Erreurs a corriger dans ta reponse :\n- " + "\n- ".join(errs_to_fix) +
                  "\n\nRenvoie l'objet JSON complet corrige, en n'utilisant que "
                  "des noms presents dans le catalogue."}]
    else:
        raise RuntimeError("Echec apres %d tentatives : le modele n'a pas produit "
                           "de specs valides." % (int(cfg.get("max_retries", 2)) + 1))

    # Un sous-dossier par run : le dossier de sortie accumulait les fichiers de
    # toutes les generations, avec des noms differents a chaque fois -- rendant
    # impossible de savoir lesquels viennent du dernier run.
    # Format demande : "Artiste - Titre - AAAAMMJJ - HHMMSS".
    import datetime
    now = datetime.datetime.now()
    date_part = now.strftime("%Y%m%d")
    heure_part = now.strftime("%H%M%S")
    artiste = safe_dirname((payload.get("artiste") or "").strip())
    titre = safe_dirname((payload.get("titre") or "").strip())[:40].strip()
    # Si le modele n'a pas rempli artiste/titre, on retombe sur la demande brute
    # pour ne jamais produire un dossier anonyme.
    if artiste and artiste != "preset":
        prefixe = "%s - %s" % (artiste, titre)
    elif titre and titre != "preset":
        prefixe = titre
    else:
        prefixe = safe_dirname(demande)[:40].strip()
    outdir = os.path.join(cfg["output_dir"],
                          "%s - %s - %s" % (prefixe, date_part, heure_part))
    os.makedirs(outdir, exist_ok=True)
    cfg["_last_outdir"] = outdir
    written = []
    secs = payload.get("sections", [])
    for si, sec in enumerate(secs, 1):
        # une section par sous-dossier des qu'il y en a plusieurs : sinon
        # 9 fichiers en vrac deviennent illisibles
        secdir = outdir
        if len(secs) > 1:
            secdir = os.path.join(outdir, "%d_%s" % (si, safe_filename(
                sec.get("nom") or sec.get("role") or "section")))
            os.makedirs(secdir, exist_ok=True)
        log(T("log_section")
            % (si, len(secs), sec.get("nom"), sec.get("role") or "?"))
        for i, v in enumerate(sec.get("variants", [])):
            try:
                spec = fill_default_cab(v["spec"], tb)
                raw, warn = encode_prst(spec, tb,
                                        template=resource_path("template.prst"))

                # Harmonisation du niveau de sortie : on force une valeur neutre (50).
                # L'outil de batch externe s'occupera d'affiner cela.
                raw, pv = apply_patch_vol(raw, spec, sec.get("role") or "",
                                          log=log)
                path = os.path.join(secdir, "%s_%s.prst"
                                    % (safe_filename(spec.get("name", "preset")),
                                       "ABC"[i] if i < 3 else str(i)))
                open(path, "wb").write(raw)
                chk = decode_prst(path, tb)
                if not chk["checksum"]["valid"]:
                    log(T("log_checksum_bad", os.path.basename(path)))
                for w in warn:
                    log(T("log_warn", w))
                log("      patch vol : %d" % pv)
                json.dump(spec, open(path[:-5] + ".json", "w", encoding="utf-8"),
                          indent=1, ensure_ascii=False)
                written.append((path, sec, v))
                log(T("log_written", os.path.basename(path)))
            except Exception as e:
                # une variante qui echoue ne doit pas priver l'utilisateur des
                # autres NI du compte-rendu : on loggue et on continue.
                log(T("log_variant_skip", v.get("label", i), e))
    # cout imputable a cette generation (0 hors Anthropic, seul provider suivi)
    if payload is not None:
        payload["_gen_cost"] = cfg.get("_session_cost", 0.0) - cost_before
    return payload, written


# ------------------------------------------------------------- affinage
SYSTEM_REFINE = """Tu es un ingenieur du son expert du multi-effets Valeton GP-200.

On te donne un preset EXISTANT (decode depuis l'appareil) et une demande de
modification en langage naturel. Tu renvoies le preset MODIFIE.

REGLES ABSOLUES
1. Renvoie le preset COMPLET, y compris les modules que tu ne changes pas.
2. NE CHANGE QUE CE QUI EST DEMANDE. Si on te dit "trop de reverb", tu touches
   a la reverb, pas a l'ampli. Toute modification non demandee est un bug.
3. N'utilise QUE des noms de modeles du catalogue, orthographe EXACTE.
   N'invente JAMAIS un nom.
4. Respecte les plages [min-max] de chaque parametre.
5. Slots : PRE cat 0,1,3,4 | WAH cat 5,1 | DST cat 3,0 | AMP cat 7,8 | NR cat 0,4
   CAB cabs | EQ cat 1 | MOD cat 4,1 | DLY cat 11 | RVB cat 12 | VOL cat 6
6. "il manque un flanger" -> mets un flanger dans le slot MOD (Jet, Flanger...).
   "pas assez de chorus" -> augmente Depth/Mix du chorus existant, ou ajoute un
   chorus dans MOD s'il n'y en a pas. Si le slot voulu est deja pris par autre
   chose, DIS-LE dans "avertissements" au lieu d'ecraser en silence.
7. Le nom : garde le meme sauf si on te demande de le changer (16 car. max).
8. Si une demande est impossible (ex. deux effets dans le meme slot), explique-le
   dans "avertissements" et fais au mieux.

SORTIE -- UNIQUEMENT un objet JSON, sans texte autour ni balises :
{
  "analyse": "ce que tu as compris de la demande, en une ou deux phrases",
  "changements": ["RVB Mix 20 -> 8", "MOD : ajout de Jet (flanger)"],
  "avertissements": "ce que tu n'as pas pu faire, ou les effets de bord. Vide si rien.",
  "spec": { ... le preset complet, meme format que ci-dessous ... }
}

Format du spec :
{
  "name": "16 car max", "author": "Claude", "description": "40 car max",
  "chain_order": [4,0,1,2,3,5,6,7,8,9,10],
  "modules": {
    "PRE": null,
    "AMP": {"model": "EV 51", "on": true, "params": {"Gain": 78}},
    "RVB": {"model": "Room", "on": true, "params": {"Mix": 8}}
  }
}

CATALOGUE COMPLET DES MODELES DISPONIBLES
"""


SYSTEM_LIVE_READY = """Tu es un ingenieur du son expert du multi-effets Valeton GP-200,
specialise dans l'adaptation de presets "maison" (regles a bas volume) pour le
live a fort volume.

On te donne un preset EXISTANT (decode depuis l'appareil). Tu le transformes en
version "Live Ready" en appliquant UNIQUEMENT les ajustements ci-dessous.

CONTRAINTES ABSOLUES
0. Tu ne changes AUCUN modele. Tu n'ajoutes AUCUN effet. Tu ne retires AUCUN effet.
   Tu ne changes PAS la chaine d'effets (chain_order). Tu ne changes PAS le nom.
   Tu ajustes UNIQUEMENT des valeurs numeriques de parametres.
   Tout changement de modele ou d'effet est un BUG GRAVE.
1. Gain / Drive : Reduis les parametres de Gain (ou Drive) des blocs AMP et DST
   de 15 a 20 % par rapport a la valeur d'origine. NE DESCENDS PAS sous 15 pour
   un preset deja clean. Si le Gain d'origine est deja bas (< 25), reduis de 10 %
   seulement.
2. Reverb : Reduis le parametre Mix (ou Level) du bloc RVB d'environ 30 %. Si le
   preset est un preset ambient ou la reverb EST l'intention artistique (Mix > 70),
   reduis de 15 % seulement.
3. Delay : Reduis le parametre Mix (ou Level) du bloc DLY d'environ 30 %. Active
   le parametre Trail si disponible.
4. CAB - coupe-haut (Low-Pass / Hi Cut) : Applique un Hi Cut entre 8 kHz et 10 kHz
   pour supprimer le fizz numerique. SAUF si le Hi Cut d'origine est DEJA inferieur
   a 8 kHz (reglage creatif intentionnel : son jazz sombre, etc.) : dans ce cas,
   NE LE REMONTE PAS.
5. CAB - coupe-bas : NE COUPE PAS les basses agressivement. Le signal unique alimente
   a la fois le FRFR sur scene et la facade. Laisser l'ingenieur du son gerer le
   coupe-bas sur sa console. Maximum : Low Cut a 80 Hz si absent.
6. Mediums : Ajoute un leger boost (+1.5 a +2 dB) autour de 1 kHz - 2 kHz dans le
   bloc EQ, SAUF si l'EQ a deja un boost dans cette zone. Si l'EQ n'est pas active
   et qu'il est vide, active-le et ajoute ce boost. Si l'EQ a des reglages creatifs
   complexes, NE LE TOUCHE PAS.
7. Renvoie le preset COMPLET, y compris les modules que tu ne changes pas.

SORTIE -- UNIQUEMENT un objet JSON, sans texte autour ni balises :
{
  "analyse": "resume en une ligne des ajustements appliques",
  "changements": ["AMP Gain 78 -> 64", "RVB Mix 45 -> 31", "CAB Hi Cut -> 9kHz"],
  "avertissements": "raisons si tu n'as pas applique certaines regles (ex: EQ creatif preserve). Vide si rien.",
  "spec": { ... le preset complet, meme format que ci-dessous ... }
}

Format du spec :
{
  "name": "16 car max", "author": "Claude", "description": "40 car max",
  "chain_order": [4,0,1,2,3,5,6,7,8,9,10],
  "modules": {
    "PRE": null,
    "AMP": {"model": "EV 51", "on": true, "params": {"Gain": 64}},
    "RVB": {"model": "Room", "on": true, "params": {"Mix": 5}}
  }
}

CATALOGUE COMPLET DES MODELES DISPONIBLES
"""

LIVE_READY_INSTRUCTION = (
    "Adapte ce preset pour une utilisation en concert a fort volume, "
    "en suivant STRICTEMENT les regles du systeme. "
    "NE CHANGE AUCUN modele, AUCUN effet. Ajuste uniquement les valeurs "
    "numeriques des parametres (gain, mix, EQ, filtre CAB)."
)


def decoded_to_spec(d):
    """Transforme un preset decode en spec reutilisable par l'encodeur."""
    mods = {}
    for slot in MODULES:
        e = d["modules"][slot]
        if not e.get("model"):
            mods[slot] = None
            continue
        mods[slot] = {"model": e["model"], "on": e["on"],
                      "params": {k: round(float(v), 4)
                                 for k, v in (e.get("params") or {}).items()}}
    return {"name": d["name"], "author": d.get("author") or "",
            "description": d.get("description") or "",
            "chain_order": d.get("chain_order") or list(range(11)),
            "modules": mods}


def diff_presets(before, after):
    """Compare deux presets DECODES. C'est le diff reel, pas ce que le modele
    pretend avoir change."""
    out = []
    if before.get("name") != after.get("name"):
        out.append("nom : %r -> %r" % (before.get("name"), after.get("name")))
    if before.get("chain_order") != after.get("chain_order"):
        out.append("chaine : %s -> %s" % (before.get("chain_readable"),
                                          after.get("chain_readable")))
    for slot in MODULES:
        b, a = before["modules"][slot], after["modules"][slot]
        if b.get("model") != a.get("model"):
            out.append("%s : %s -> %s" % (slot, b.get("model") or "(vide)",
                                          a.get("model") or "(vide)"))
            continue
        if b["on"] != a["on"]:
            out.append("%s : %s -> %s" % (slot, "ON" if b["on"] else "off",
                                          "ON" if a["on"] else "off"))
        pb, pa = b.get("params") or {}, a.get("params") or {}
        for k in pa:
            if k in pb and abs(float(pb[k]) - float(pa[k])) > 0.005:
                out.append("%s / %s : %g -> %g" % (slot, k, float(pb[k]),
                                                   float(pa[k])))
    return out


def refine(cfg, tb, prst_path, instruction, log=print):
    """Modifie un preset existant selon une consigne en langage naturel.

    Renvoie (payload, chemin_du_nouveau_prst, diff_reel).
    """
    before = decode_prst(prst_path, tb)
    if not before["checksum"]["valid"]:
        log(T("log_src_checksum"))
    spec_in = decoded_to_spec(before)

    system = SYSTEM_REFINE + compact_catalog(tb)
    demande = ("PRESET ACTUEL :\n%s\n\nDEMANDE DE MODIFICATION :\n%s"
               % (json.dumps(spec_in, indent=1, ensure_ascii=False), instruction)
               + lang_instruction(cfg.get("lang") or "fr"))
    msgs = [{"role": "user", "content": demande}]

    payload = None
    for attempt in range(int(cfg.get("max_retries", 2)) + 1):
        log(T("log_api_attempt", attempt + 1))
        txt = call_api(cfg, system, msgs, log)
        try:
            payload = extract_json(txt)
        except ValueError as e:
            log(T("log_unreadable", e))
            msgs = [{"role": "user", "content": demande +
                     "\n\nRenvoie UNIQUEMENT l'objet JSON demande, sans texte "
                     "ni balises."}]
            continue
        errs = check_names(tb, payload.get("spec") or {})
        if not errs:
            break
        log(T("log_errors_fix", len(errs)))
        for e in errs:
            log(T("log_bullet", e))
        msgs += [{"role": "assistant", "content": txt},
                 {"role": "user", "content":
                  "Erreurs a corriger :\n- " + "\n- ".join(errs) +
                  "\n\nRenvoie l'objet JSON complet corrige."}]
    else:
        raise RuntimeError("Echec apres %d tentatives : le modele n'a pas produit "
                           "de spec valide." % (int(cfg.get("max_retries", 2)) + 1))

    import datetime
    now = datetime.datetime.now()
    date_part = now.strftime("%Y%m%d")
    heure_part = now.strftime("%H%M%S")
    # En affinage il n'y a ni artiste ni titre : on nomme le dossier d'apres le
    # preset source, avec le meme format de date que la generation.
    src = safe_dirname(os.path.splitext(os.path.basename(prst_path))[0])[:40].strip()
    outdir = os.path.join(cfg["output_dir"],
                          "%s (affine) - %s - %s" % (src, date_part, heure_part))
    os.makedirs(outdir, exist_ok=True)
    cfg["_last_outdir"] = outdir

    spec = payload["spec"]
    raw, warn = encode_prst(spec, tb, template=resource_path("template.prst"))
    base = safe_filename(spec.get("name") or
                         os.path.splitext(os.path.basename(prst_path))[0])
    path = os.path.join(outdir, base + "_v2.prst")
    open(path, "wb").write(raw)
    for w in warn:
        log(T("log_warn", w))
    after = decode_prst(path, tb)
    if not after["checksum"]["valid"]:
        raise RuntimeError("checksum invalide : %s" % path)
    json.dump(spec, open(path[:-5] + ".json", "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)
    log(T("log_written2", os.path.basename(path)))
    return payload, path, diff_presets(before, after)


def refine_live(cfg, tb, prst_path, log=print):
    """Adapte un preset 'maison' pour le live (concert a fort volume).

    Utilise le prompt SYSTEM_LIVE_READY avec une instruction pre-cablee.
    Meme pipeline que refine() mais avec un systeme et une consigne
    specifiques, et un suffixe _live au lieu de _v2.
    """
    before = decode_prst(prst_path, tb)
    if not before["checksum"]["valid"]:
        log(T("log_src_checksum"))
    spec_in = decoded_to_spec(before)

    system = SYSTEM_LIVE_READY + compact_catalog(tb)
    demande = ("PRESET ACTUEL :\n%s\n\nDEMANDE DE MODIFICATION :\n%s"
               % (json.dumps(spec_in, indent=1, ensure_ascii=False),
                  LIVE_READY_INSTRUCTION)
               + lang_instruction(cfg.get("lang") or "fr"))
    msgs = [{"role": "user", "content": demande}]

    payload = None
    for attempt in range(int(cfg.get("max_retries", 2)) + 1):
        log(T("log_api_attempt", attempt + 1))
        txt = call_api(cfg, system, msgs, log)
        try:
            payload = extract_json(txt)
        except ValueError as e:
            log(T("log_unreadable", e))
            msgs = [{"role": "user", "content": demande +
                     "\n\nRenvoie UNIQUEMENT l'objet JSON demande, sans texte "
                     "ni balises."}]
            continue
        errs = check_names(tb, payload.get("spec") or {})
        if not errs:
            break
        log(T("log_errors_fix", len(errs)))
        for e in errs:
            log(T("log_bullet", e))
        msgs += [{"role": "assistant", "content": txt},
                 {"role": "user", "content":
                  "Erreurs a corriger :\n- " + "\n- ".join(errs) +
                  "\n\nRenvoie l'objet JSON complet corrige."}]
    else:
        raise RuntimeError("Echec apres %d tentatives : le modele n'a pas produit "
                           "de spec valide." % (int(cfg.get("max_retries", 2)) + 1))

    import datetime
    now = datetime.datetime.now()
    date_part = now.strftime("%Y%m%d")
    heure_part = now.strftime("%H%M%S")
    src = safe_dirname(os.path.splitext(os.path.basename(prst_path))[0])[:40].strip()
    outdir = os.path.join(cfg["output_dir"],
                          "%s (live) - %s - %s" % (src, date_part, heure_part))
    os.makedirs(outdir, exist_ok=True)
    cfg["_last_outdir"] = outdir

    spec = payload["spec"]
    raw, warn = encode_prst(spec, tb, template=resource_path("template.prst"))
    base = safe_filename(spec.get("name") or
                         os.path.splitext(os.path.basename(prst_path))[0])
    path = os.path.join(outdir, base + "_live.prst")
    open(path, "wb").write(raw)
    for w in warn:
        log(T("log_warn", w))
    after = decode_prst(path, tb)
    if not after["checksum"]["valid"]:
        raise RuntimeError("checksum invalide : %s" % path)
    json.dump(spec, open(path[:-5] + ".json", "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)
    log(T("log_written2", os.path.basename(path)))
    return payload, path, diff_presets(before, after)