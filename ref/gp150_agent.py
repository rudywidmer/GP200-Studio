"""GP-150 / GP-180 : consignes IA (prompts), catalogue compact et validations -- reference Python (l'oracle de web/src/gp150agent.js).

Meme role que gp200_agent.py pour le GP-200 (qui n'est pas modifie : on en reprend les fonctions qui ne dependent pas du format, comme
pickup_instruction et lang_instruction). Les appels reseau (Gemini, Anthropic, OpenRouter) restent ceux de l'application.

Differences avec le GP-200 :
  - 12 modules : PRE WAH DST NS AMP NR CAB EQ MOD DLY RVB VOL, chain_order = permutation de 0..11 ;
  - le slot NS (« captures » SnapTone / A2 Lite, 120 modeles opaques) n'est pas propose a l'IA (comme SnapTone sur le GP-200) :
    un preset existant qui en contient un le garde tel quel ;
  - le nom d'un preset fait 13 caracteres au maximum ;
  - une baffle est choisie explicitement (le catalogue ne dit pas quelle baffle une tete charge d'office) ;
  - certains reglages sont discrets (liste d'options) : la valeur est l'indice de l'option.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import gp150lib as L          # noqa: E402
import gp200_agent as A       # noqa: E402

MODULES = L.MODULES
ROLES = A.ROLES
ROLE_HINT = A.ROLE_HINT
NAME_MAX = L.LEN_NAME
pickup_instruction = A.pickup_instruction
lang_instruction = A.lang_instruction
forced_prompt = A.forced_prompt


# ------------------------------------------------- catalogue compact (prompt)
def _ascii(s):
    return bool(s) and all(32 <= ord(c) < 127 for c in s)


def _param_txt(p):
    lo, hi = min(p["min"], p["max"]), max(p["min"], p["max"])
    if p.get("options"):
        return "%s{%s}" % (p["name"], ",".join("%d=%s" % (i, o) for i, o in enumerate(p["options"])))
    return "%s[%g-%g]" % (p["name"], lo, hi)


def compact_catalog(tb, light=False):
    """Catalogue condense pour le prompt. L'origine (le materiel reel imite, quand les donnees la connaissent) suit le nom entre parentheses.
    Les baffles « User IR » (emplacements vides de l'utilisateur) et les captures du slot NS ne sont pas proposees."""
    fam = [(4, "AMPLIS"), (2, "DISTOS / OVERDRIVES / BOOSTS"), (0, "PRE : COMPRESSEURS / PITCH / FILTRES"), (1, "WAH"),
           (5, "NR : NOISE GATE"), (7, "EQ"), (8, "MODULATIONS"), (9, "DELAYS"), (10, "REVERBS"), (11, "VOLUME")]
    out = []
    for cat, label in fam:
        rows = []
        keep_desc = (not light) or cat in (4, 2)
        for m in sorted((x for x in tb.models if x["cat"] == cat), key=lambda x: x["name"]):
            ps = ",".join(_param_txt(p) for p in m["params"])
            org = m.get("origin") if keep_desc and _ascii(m.get("origin") or "") else ""
            rows.append("%s (cat%d, %s)%s : %s" % (m["name"], cat, m["category_label"] or "-", (" [= " + org + "]") if org else "", ps))
        out.append("### %s (slot %s) — %d\n%s" % (label, MODULES[cat], len(rows), "\n".join(rows)))
    cabs = [m for m in tb.models if m["cat"] == 6 and m["category_label"] != "User IR"]
    common = {tuple(_param_txt(p) for p in m["params"]) for m in cabs}
    assert len(common) == 1, "les baffles n'ont pas tous les memes reglages"
    out.append("### BAFFLES (slot CAB) — %d\nReglages communs : %s\n%s"
               % (len(cabs), ", ".join(next(iter(common))),
                  "\n".join("%s (%s)" % (m["name"], m["category_label"] or "-") for m in cabs)))
    return "\n\n".join(out)


SYSTEM = """Tu es un ingenieur du son expert, specialiste des multi-effets Valeton GP-150 et GP-180 (meme moteur, meme catalogue).

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
le meme son, c'est UNE section, pas deux. Une section = un son reellement different,
pas une partie du morceau. Un solo ne merite sa section que si le son change vraiment
(boost, plus de gain, delay ajoute...), pas juste parce qu'il y a un solo.

ETAPE 2 -- POUR CHAQUE SECTION, 3 presets qui sont trois INTERPRETATIONS du MEME
son, pas trois sons differents. Elles doivent toutes rester reconnaissables comme
le morceau demande, tout en divergeant de facon audible :

  A "Fidele"   : Le rig d'origine reproduit au plus pres, en utilisant les marques et modeles historiques identifies lors de ta recherche
                 (cherche leurs equivalents exacts dans le catalogue : l'origine du modele figure entre crochets "[= ...]").
                 Pas de compromis generique : si l'artiste utilisait tel ampli ou telle pedale, selectionne le modele correspondant.
                 Pense-le pour sonner vivant en direct / FRFR.

  B "Variante" : Le meme son explore sous un autre angle -- a TOI de choisir l'axe le plus pertinent pour CE morceau :
                 un ampli/baffle alternatif credible de la meme famille, OU un dosage different des effets et du gain
                 (plus/moins de modulation, de disto, de delai/reverb), sans exageration.
                 Meme intention sonore, une autre couleur, sans denaturer la chanson.

  C "Poussee"  : La meme base poussee d'un cran, strictement dans le meme univers -- plus mordante, saturee ou presente
                 (ou plus ouverte / dynamique / aerienne), sans changer l'ADN du son ni trahir le morceau.

REGLES ABSOLUES
1. N'utilise QUE des noms de modeles presents dans le catalogue ci-dessous, a l'orthographe
   EXACTE. N'invente JAMAIS un nom. Si le materiel reel n'a pas d'equivalent, prends le plus
   proche disponible et dis-le dans "notes".
2. Respecte les plages [min-max] indiquees pour chaque parametre. Un reglage ecrit
   Nom{0=a,1=b,...} est un choix : la valeur est le NUMERO de l'option (0, 1, 2...), jamais son texte.
3. Le nom d'un preset fait 13 CARACTERES MAXIMUM (ASCII).
4. Chaque slot n'accepte que les modeles de sa famille du catalogue (le slot est indique a cote de chaque famille).
5. La pedale a 12 modules, dans cet ordre de numerotation :
   0=PRE 1=WAH 2=DST 3=NS 4=AMP 5=NR 6=CAB 7=EQ 8=MOD 9=DLY 10=RVB 11=VOL
   chain_order = permutation de 0..11 ou chain_order[i] = module en position i. Defaut : [0,1,2,3,4,5,6,7,8,9,10,11].
   Usuel : gate en tete [5,0,1,2,3,4,6,7,8,9,10,11].
6. Le slot NS (captures de la pedale) n'est PAS dans le catalogue : mets-le TOUJOURS a null.
7. Un slot inutilise vaut null. N'active pas d'effet sans raison musicale.
8. Tu n'as pas besoin de preciser tous les parametres : les non precises prennent le
   defaut du firmware. Ne precise que ce qui compte.
9. LES 3 VARIANTES DOIVENT DIVERGER DE FACON AUDIBLE, MAIS RESTER LE MEME MORCEAU.
   Pas trois presets quasi identiques (un gain qui passe de 72 a 68 ne compte pas), pas non plus trois sons
   sans rapport qui trahissent le morceau. La divergence peut venir du couple ampli/baffle, du niveau de gain,
   du choix et du dosage des effets, ou de l'equilibre EQ. Tu n'es PAS oblige de changer l'ampli.
   Deux SECTIONS differentes peuvent partager le meme ampli.
10. HONNETETE SUR LE RIG. Si tu n'es pas sur du materiel reel, ECRIS-LE dans "recherche"
   avec les mots "je ne suis pas certain". N'ecris jamais "probablement X" en le
   traitant ensuite comme un fait. Un rig faux produit un preset faux.
11. Le son d'un ampli sature vient de L'AMPLI, pas d'une pedale de distorsion. Une pedale
   en DST sert a BOOSTER (Gain bas 10-25, Volume haut 75-85), pas a fabriquer le gain.
12. Le nom d'un preset fait 13 caracteres MAX et doit rendre sa section reconnaissable
   sur l'ecran de l'appareil. Pas deux presets de sections differentes avec le meme nom.
13. Un son LEAD (solo) se distingue typiquement par : un boost devant l'ampli, un peu
   plus de gain, des mediums remontes (pour percer), et souvent un delay. Un son CLEAN
   n'a ni DST ni gain d'ampli eleve.
14. Le slot AMP ET le slot CAB sont toujours renseignes et actifs : le signal part en direct
   dans une sono / interface FRFR, sans baffle le son est inutilisable. Choisis une baffle
   coherente avec l'ampli (meme famille que la tete).

MATERIEL MODELISE
Valeton obfusque les marques dans les NOMS (UK 800, Mess2C+, EV 51...). Quand les donnees du projet
connaissent le materiel reel, le catalogue l'ecrit entre crochets apres le nom : "UK 800 (cat4, Drive) [= Marshall JCM800] : ...".
FIE-TOI A CES INDICATIONS, pas a ce que le nom evoque. Un modele sans crochets : equivalent reel non documente,
ne lui invente pas de filiation et ne le mets pas au coeur du son sans raison explicite.

METHODE DE CONSTRUCTION DU SON (ordre de conception, pas ordre de la chaine)
1. AMP + CAB D'ABORD. Cale le couple ampli/baffle pour obtenir le son de base
   (clair, ou juste au bord de la saturation) AVANT d'ajouter le moindre effet.
2. Regle le Gain de l'ampli jusqu'au caractere voulu, puis ajuste le Volume de
   l'ampli et le Volume de la baffle pour un niveau propre, sans saturation parasite.
3. EFFETS ENSUITE, seulement s'ils servent le morceau. Pour chacun, n'ecris QUE
   des parametres qui existent sur le modele choisi (voir catalogue). Principes utiles
   quand le parametre EXISTE sur le modele :
   - REVERB / DELAY : "Trail" a 1 pour que la traine ne soit pas coupee net ; reduire "Pre Delay" resserre l'espace.
   - COMPRESSEUR : compression discrete.
   - EQ : pour faire ressortir la guitare dans un mix, pousse legerement les mediums plutot que de tout monter.
   - NR (gate) : "Threshold" 20-30 suffit pour des micros simples ; 45-55 seulement pour des palm-mutes metal serres.
   - BAFFLE : Low Cut 80-100 Hz et High Cut 8-10 kHz assainissent en FRFR.
   - MODULATION : dosage leger par defaut.
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
        "name": "13 car max",
        "author": "Claude",
        "description": "40 car max",
        "chain_order": [5,0,1,2,3,4,6,7,8,9,10,11],
        "modules": {
          "PRE": null,
          "WAH": null,
          "DST": {"model": "Green OD", "on": true, "params": {"Gain": 15}},
          "NS": null,
          "AMP": {"model": "EV 51", "on": true, "params": {"Gain": 78}},
          "NR":  {"model": "Gate 2", "on": true, "params": {"Threshold": 45}},
          "CAB": {"model": "Mess 4x12", "on": true, "params": {"Low Cut": 85, "High Cut": 9000}},
          "EQ": null, "MOD": null,
          "DLY": {"model": "Digital Delay S", "on": true, "params": {"Mix": 15}},
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


SYSTEM_REFINE = """Tu es un ingenieur du son expert des multi-effets Valeton GP-150 et GP-180.

On te donne un preset EXISTANT (decode depuis l'appareil) et une demande de
modification en langage naturel. Tu renvoies le preset MODIFIE.

REGLES ABSOLUES
1. Renvoie le preset COMPLET, y compris les modules que tu ne changes pas.
   Un module note {"keep": true, "on": ...} est un modele que le catalogue ne connait pas : recopie-le TEL QUEL.
2. NE CHANGE QUE CE QUI EST DEMANDE. Si on te dit "trop de reverb", tu touches
   a la reverb, pas a l'ampli. Toute modification non demandee est un bug.
3. N'utilise QUE des noms de modeles du catalogue, orthographe EXACTE.
   N'invente JAMAIS un nom. Le slot NS (captures) n'est pas dans le catalogue : laisse-le exactement comme il est.
4. Respecte les plages [min-max] de chaque parametre. Un reglage ecrit Nom{0=a,1=b,...} est un choix :
   la valeur est le NUMERO de l'option.
5. Slots : un modele ne va que dans le slot de sa famille (indique a cote de chaque famille du catalogue).
6. "il manque un flanger" -> mets un flanger dans le slot MOD. "pas assez de chorus" -> augmente
   Depth/Mix du chorus existant, ou ajoute un chorus dans MOD s'il n'y en a pas. Si le slot voulu est deja
   pris par autre chose, DIS-LE dans "avertissements" au lieu d'ecraser en silence.
7. Le nom : garde le meme sauf si on te demande de le changer (13 car. max).
8. chain_order = permutation de 0..11 (0=PRE 1=WAH 2=DST 3=NS 4=AMP 5=NR 6=CAB 7=EQ 8=MOD 9=DLY 10=RVB 11=VOL).
9. Si une demande est impossible (ex. deux effets dans le meme slot), explique-le
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
  "name": "13 car max", "author": "Claude", "description": "40 car max",
  "chain_order": [5,0,1,2,3,4,6,7,8,9,10,11],
  "modules": {
    "PRE": null,
    "AMP": {"model": "EV 51", "on": true, "params": {"Gain": 78}},
    "RVB": {"model": "Room", "on": true, "params": {"Mix": 8}}
  }
}

CATALOGUE COMPLET DES MODELES DISPONIBLES
"""


SYSTEM_LIVE_READY = """Tu es un ingenieur du son expert des multi-effets Valeton GP-150 et GP-180,
specialise dans l'adaptation de presets "maison" (regles a bas volume) pour le
live a fort volume.

On te donne un preset EXISTANT (decode depuis l'appareil). Tu le transformes en
version "Live Ready" en appliquant UNIQUEMENT les ajustements ci-dessous.

CONTRAINTES ABSOLUES
0. Tu ne changes AUCUN modele. Tu n'ajoutes AUCUN effet. Tu ne retires AUCUN effet.
   Tu ne changes PAS la chaine d'effets (chain_order). Tu ne changes PAS le nom.
   Tu ajustes UNIQUEMENT des valeurs numeriques de parametres.
   Tout changement de modele ou d'effet est un BUG GRAVE.
   Un module {"keep": true, ...} ou le slot NS : recopie-les tels quels.
   Un reglage ecrit Nom{0=a,1=b,...} dans le catalogue est un choix : ne le touche pas.
1. Gain / Drive : Reduis les parametres de Gain (ou Drive) des blocs AMP et DST
   de 15 a 20 % par rapport a la valeur d'origine. NE DESCENDS PAS sous 15 pour
   un preset deja clean. Si le Gain d'origine est deja bas (< 25), reduis de 10 %
   seulement.
2. Reverb : Reduis le parametre Mix du bloc RVB d'environ 30 %. Si le
   preset est un preset ambient ou la reverb EST l'intention artistique (Mix > 70),
   reduis de 15 % seulement.
3. Delay : Reduis le parametre Mix du bloc DLY d'environ 30 %. Active
   le parametre Trail si disponible.
4. CAB - coupe-haut (High Cut) : Applique un High Cut entre 8000 et 10000 Hz pour
   supprimer le fizz numerique. SAUF si le High Cut d'origine est DEJA inferieur
   a 8000 : dans ce cas, NE LE REMONTE PAS.
5. CAB - coupe-bas (Low Cut) : NE COUPE PAS les basses agressivement. Le signal unique alimente
   a la fois le FRFR sur scene et la facade. Laisser l'ingenieur du son gerer le
   coupe-bas sur sa console. Maximum : Low Cut a 80 Hz si absent.
6. Mediums : Ajoute un leger boost (+1.5 a +2 dB) autour de 1 kHz - 2 kHz dans le
   bloc EQ (les reglages d'EQ vont de -50 a +50), SAUF si l'EQ a deja un boost dans cette zone. Si l'EQ n'est pas active
   et qu'il est vide, active-le et ajoute ce boost. Si l'EQ a des reglages creatifs
   complexes, NE LE TOUCHE PAS.
7. Renvoie le preset COMPLET, y compris les modules que tu ne changes pas.

SORTIE -- UNIQUEMENT un objet JSON, sans texte autour ni balises :
{
  "analyse": "resume en une ligne des ajustements appliques",
  "changements": ["AMP Gain 78 -> 64", "RVB Mix 45 -> 31", "CAB High Cut -> 9000"],
  "avertissements": "raisons si tu n'as pas applique certaines regles (ex: EQ creatif preserve). Vide si rien.",
  "spec": { ... le preset complet, meme format que ci-dessous ... }
}

Format du spec :
{
  "name": "13 car max", "author": "Claude", "description": "40 car max",
  "chain_order": [5,0,1,2,3,4,6,7,8,9,10,11],
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


# ------------------------------------------------------------- validation
def check_names(tb, spec, keep=None):
    """Pre-valide noms de modeles ET de parametres, avec suggestions (voir gp200_agent.check_names).

    `keep` (affinage) = modules du preset d'origine {slot: {"model": ...}} : un modele deja present dans ce slot est conserve tel quel.
    Le slot NS n'est accepte que s'il est conserve tel quel."""
    import difflib
    errs = []
    mods = spec.get("modules") or {}
    for slot, ms in mods.items():
        if not ms:
            continue
        if not isinstance(ms, dict):
            errs.append("slot %s : doit etre un objet {\"model\": ..., \"on\": ..., \"params\": {...}} ou null" % slot)
            continue
        if not ms.get("model"):
            continue
        if slot not in MODULES:
            errs.append("slot %r inconnu (attendus: %r)" % (slot, MODULES))
            continue
        if slot == "NS":
            kept = keep and keep.get("NS") and keep["NS"].get("model")
            if not (kept and L.norm(kept) == L.norm(ms["model"])):
                errs.append("slot NS : n'est pas propose dans le catalogue. Mets-le a null.")
            continue
        try:
            m = tb.find(slot, ms["model"])
        except ValueError:
            pool = [x["name"] for x in tb.models_for_slot(slot) if x["category_label"] != "User IR"]
            near = difflib.get_close_matches(str(ms["model"]), pool, 4, 0.4)
            errs.append("slot %s : le modele %r N'EXISTE PAS. Proches : %r" % (slot, ms["model"], near or pool[:8]))
            continue
        plist = tb.params_of(m["id"], m["cat"])
        known = {L.norm(p["name"]): p for p in plist}
        params = ms.get("params")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            errs.append("slot %s / %s : \"params\" doit etre un objet {\"Nom\": valeur}" % (slot, m["name"]))
            continue
        for g, val in params.items():
            p = known.get(L.norm(g))
            if p is None:
                near = difflib.get_close_matches(g, [q["name"] for q in plist], 3, 0.4)
                errs.append("slot %s / %s : le parametre %r N'EXISTE PAS. Parametres reels : %r%s"
                            % (slot, m["name"], g, [q["name"] for q in plist], (" (proche : %r)" % near) if near else ""))
                continue
            try:
                v = float(val)
            except (TypeError, ValueError):
                errs.append("slot %s / %s / %s : %r n'est pas un nombre" % (slot, m["name"], p["name"], val))
                continue
            lo, hi = min(p["min"], p["max"]), max(p["min"], p["max"])
            if not (lo <= v <= hi):
                errs.append("slot %s / %s / %s : %g est hors plage [%g..%g]" % (slot, m["name"], p["name"], v, lo, hi))
            elif p.get("options") and v != int(v):
                errs.append("slot %s / %s / %s : %g n'est pas un numero d'option valide (0 a %d)" % (slot, m["name"], p["name"], v, len(p["options"]) - 1))
    n = spec.get("name", "")
    if isinstance(n, str) and len(n) > NAME_MAX:
        errs.append("name %r fait %d caracteres (max %d)" % (n, len(n), NAME_MAX))
    ch = spec.get("chain_order")
    if ch is not None:
        if not (isinstance(ch, list) and sorted(ch) == list(range(len(MODULES)))):
            errs.append("chain_order %r n'est pas une permutation de 0..%d" % (ch, len(MODULES) - 1))
    return errs


def check_amp_cab(spec):
    """Generation : un ampli actif sans baffle est un preset inutilisable en FRFR."""
    mods = spec.get("modules") or {}
    amp, cab = mods.get("AMP"), mods.get("CAB")
    if amp and isinstance(amp, dict) and amp.get("model") and amp.get("on", True):
        if not (cab and isinstance(cab, dict) and cab.get("model") and cab.get("on", True)):
            return ["slot CAB : un ampli actif doit etre suivi d'une baffle active (choisis-en une coherente avec l'ampli)"]
    return []


def normalize_payload(payload):
    return A.normalize_payload(payload)


def _variant_signature(v):
    mods = (v.get("spec") or {}).get("modules") or {}
    amp = (mods.get("AMP") or {}).get("model")
    cab = (mods.get("CAB") or {}).get("model")
    active = tuple(sorted(k for k in ("PRE", "WAH", "DST", "MOD", "DLY", "RVB", "EQ")
                          if (mods.get(k) or {}).get("on") and (mods.get(k) or {}).get("model")))
    fx_models = tuple((mods.get(k) or {}).get("model") for k in active)
    gain = None
    for gk in ("Gain", "Gain 1", "Drive"):
        gv = ((mods.get("AMP") or {}).get("params") or {}).get(gk)
        if isinstance(gv, (int, float)):
            gain = round(gv / 15)
            break
    return (amp, cab, active, fx_models, gain)


def check_divergence(section):
    seen, errs = {}, []
    for v in section.get("variants", []):
        sig = _variant_signature(v)
        if sig == (None, None, (), (), None):
            continue
        if sig in seen:
            errs.append("les variantes %r et %r sont quasi identiques (meme ampli, meme baffle, memes effets et meme gain). "
                        "Fais-les diverger d'un cran de facon audible -- change le dosage ou le choix des effets, le niveau de "
                        "gain/saturation, ou l'ampli/baffle -- tout en gardant le son du morceau." % (seen[sig], v.get("label", "?")))
        else:
            seen[sig] = v.get("label", "?")
    return errs


def check_sections(tb, payload):
    """Renvoie (erreurs_fatales, avertissements_style)."""
    errs, warns = [], []
    secs = payload.get("sections") or []
    if not secs:
        return ["aucune section : il en faut au moins une"], []
    if len(secs) > 4:
        errs.append("%d sections, c'est trop (4 maximum). Regroupe les parties qui partagent le meme son." % len(secs))
    noms = []
    for sec in secs:
        lbl = sec.get("nom") or "?"
        noms.append(lbl)
        if sec.get("role") and sec["role"] not in ROLES:
            errs.append("section %r : role %r invalide (attendus : %s)" % (lbl, sec["role"], ", ".join(ROLES)))
        vs = sec.get("variants") or []
        if len(vs) != 3:
            errs.append("section %r : %d variante(s), il en faut EXACTEMENT 3" % (lbl, len(vs)))
        for v in vs:
            sp = v.get("spec", {})
            for e in check_names(tb, sp) + check_amp_cab(sp):
                errs.append("[%s / %s] %s" % (lbl, v.get("label", "?"), e))
        for w in check_divergence(sec):
            warns.append("section %r : %s" % (lbl, w))
    if len(set(noms)) != len(noms):
        errs.append("deux sections portent le meme nom : %s" % noms)
    allnames = [(v.get("spec") or {}).get("name") for sec in secs for v in (sec.get("variants") or [])]
    dupes = {n for n in allnames if n and allnames.count(n) > 1}
    if dupes:
        errs.append("noms de presets dupliques entre sections : %s. Rends-les distincts (ex. 'MOP Rythm Fid' et 'MOP Solo Fid')." % sorted(dupes))
    return errs, warns


def diff_presets(before, after):
    """Diff reel entre deux presets decodes (comme gp200_agent.diff_presets, avec les 12 modules)."""
    out = []
    if before.get("name") != after.get("name"):
        out.append("nom : %r -> %r" % (before.get("name"), after.get("name")))
    if before.get("chain_order") != after.get("chain_order"):
        out.append("chaine : %s -> %s" % (before.get("chain_readable"), after.get("chain_readable")))
    for slot in MODULES:
        b, a = before["modules"][slot], after["modules"][slot]
        if b.get("model") != a.get("model"):
            out.append("%s : %s -> %s" % (slot, b.get("model") or "(vide)", a.get("model") or "(vide)"))
            continue
        if b["on"] != a["on"]:
            out.append("%s : %s -> %s" % (slot, "ON" if b["on"] else "off", "ON" if a["on"] else "off"))
        pb, pa = b.get("params") or {}, a.get("params") or {}
        for k in pa:
            if k in pb and abs(float(pb[k]) - float(pa[k])) > 0.005:
                out.append("%s / %s : %g -> %g" % (slot, k, float(pb[k]), float(pa[k])))
    return out
