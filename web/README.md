# GP-200 Studio Web

Version navigateur de GP-200 Studio : décrire un son, obtenir des presets `.prst` (3 variantes par section),
les télécharger, **les envoyer directement dans la pédale en USB** (Web MIDI) et **harmoniser leur volume** (mesure LUFS + réglage automatique). Aucun Python, aucune installation.

## Mettre en ligne (GitHub Pages)

1. Copie `web/dist/index.html` dans le dépôt, par exemple dans un dossier `docs/` (renomme-le en `index.html`).
2. Sur GitHub : **Settings → Pages → Build from a branch**, branche `main`, dossier `/docs`.
3. L'adresse devient `https://<utilisateur>.github.io/GP200-Studio/`. Cette adresse en `https` est
   nécessaire pour la connexion OpenRouter en 1 clic.

Le pied de page affiche la version et la date de fabrication du fichier (`Version 0.3 · 4 oct. 2026, 02:48`) : c'est le moyen de vérifier que la nouvelle version est bien en ligne. Le fichier est autonome (~380 Ko) : il n'appelle aucun serveur à part le fournisseur d'IA choisi.

## Envoi USB (Web MIDI)

- Fonctionne avec **Chrome, Edge, Opera** sur ordinateur (pas Safari, pas iPhone/iPad). La page doit être en `https`
  (GitHub Pages convient) ou ouverte depuis `localhost`.
- Le navigateur demande l'autorisation d'accéder aux appareils MIDI avec SysEx : c'est normal, il faut accepter.
- Un seul programme peut utiliser la pédale à la fois : fermer l'éditeur Valeton et GP-200 Studio avant d'envoyer.
  La page libère le port juste après chaque envoi.
- Protocole identique à `gp200_usb.py` (handshake avec ACK, 7 morceaux SysEx de 183 octets, Bank Select + Program Change).
  Les slots proposés vont de 01-A à 64-D (la sélection des slots 51 à 64 n'est pas vérifiée sur matériel côté Python ; l'écriture, elle, ne change pas).
- Un envoi écrase le slot choisi : la page demande une confirmation avant chaque envoi.

## Harmoniser le volume (LUFS)

Reprend le module « batch » de l'appli de bureau : on joue un accord en boucle, la page mesure le volume qui sort de la pédale
et règle seule l'ampli (puis le baffle, puis le patch volume, puis le gain en dernier recours) jusqu'à la cible
(−16 LUFS « Normal », −11 LUFS « Lead », tolérance 0,4 LU, validation après 3 s stables), puis renvoie le preset corrigé à la pédale.

**Harmonisation par lot (v0.10)** : le lot n'est plus limité aux presets du résultat affiché. Dans la fenêtre Volume, étape D, on compose librement la liste parmi **toute la bibliothèque** (presets générés, .prst ouverts, résultats d'affinage) : *Tout ajouter*, *Ajouter* un par un, *Ouvrir des .prst…* (plusieurs à la fois), ↑ ↓ pour l'ordre de mesure, ✕ pour retirer, type Normal/Lead par preset. Par défaut le lot reste celui d'avant (les presets du résultat affiché). Tous passent, un à la fois, par le même slot de travail (celui du panneau 📍 s'il est confirmé). À la fin, le bilan propose **Tout télécharger (zip)** (.prst + .json de chaque preset du lot, noms en double suffixés) ; les presets réglés sont aussi mis à jour dans la bibliothèque (✓).

**Lot sans preset chargé (v0.11)** : le bouton « 🎚️ Harmoniser par batch » du bandeau du haut (ou l'onglet Volume) ouvre directement le formulaire du lot, même avec une bibliothèque vide. « Ouvrir des .prst… » accepte plusieurs fichiers d'un coup : la fenêtre reste ouverte, tous les fichiers rejoignent le lot (dans l'ordre d'ouverture), et **rien n'est envoyé à la pédale** avant le lancement (pas d'injection automatique pendant la préparation du lot). Un fichier invalide est signalé sans bloquer les autres. Le rack ne rejoue plus son animation à chaque rafraîchissement.

**Info-bulles (v0.12)** : chaque bouton, champ, liste, case à cocher, lien et indicateur de l'interface a maintenant une info-bulle (attribut `title`, en français et en anglais), y compris les curseurs de paramètres (explication du paramètre, plage de valeurs et valeur par défaut) et les cases CTRL. Les textes sont dans `src/gp200tips.js` ; `applyTips()` (app.js) les pose après chaque rafraîchissement, **uniquement là où il n'y en a pas déjà une** : les info-bulles existantes ne sont jamais remplacées. `node tests/audit_tips.js` parcourt l'interface dans tous ses états (réglages, accueil, preset ouvert, chaque module, chaque fenêtre, pédale connectée, lot, mobile, FR et EN) et liste ce qui n'a pas d'info-bulle (`--strict` : code de sortie 1 s'il en reste) ; `node tests/run_tips_tests.js` vérifie que les deux langues ont les mêmes textes et que les 173 noms de paramètres de la table ont une explication.

**Attente de génération (v0.13)** : pendant que l'IA travaille, les LED du rack s'allument tour à tour (chenillard) et chaque module s'illumine légèrement, y compris quand le rack est encore vide (depuis l'interface à focus, les LED n'existaient que sur les modules remplis). Purement visuel ; désactivé si le système demande de réduire les animations.

- Il faut la pédale connectée (USB/MIDI) **et** son entrée audio USB (elle apparaît comme une carte son « GP-200 ») : le navigateur demande l'autorisation du micro.
- Chaque preset est envoyé dans un **emplacement de travail** (écrasé, avec confirmation). Les `.prst` de la page (et le zip) sont mis à jour avec les valeurs réglées.
- Garder l'onglet visible pendant la mesure. Chrome/Edge sur ordinateur.
- `gp200lufs.js` = port de pyloudnorm 0.2.0 + `LUFSEngine` ; `gp200tune.js` = port de la logique de `gp200_batch.py` ; `gp200usb.js` gagne les messages de réglage en direct.
- Écart volontaire avec le Python : le volume du CAB est écrit au slot 1 du bloc CAB IR (son vrai slot) ; `gp200_batch.py` utilise l'index 0.

## Poste de travail (v0.5) et audit de la pédale (v0.6)

Sur ordinateur (≥ 1100 px) tout tient sur **un seul écran, sans défilement de la page** ; sur téléphone la page s'empile.

- **Barre du haut** : mode (*Nouveau morceau* / *Affiner un preset existant*), **Ouvrir un .prst**, pastille IA (ouvre la fenêtre de connexion), pastille pédale (un clic = connexion USB ; reconnexion automatique si le navigateur a déjà l'autorisation), interrupteur **Direct**, langue.
- **Mes presets** (colonne de gauche) : tout ce qui est généré, ouvert ou affiné s'y accumule ; on clique un preset pour l'afficher, ✕ pour le retirer. On peut y glisser-déposer un ou plusieurs `.prst` n'importe où dans la page.
- **Affiner agit sur le preset sélectionné** (généré, ouvert ou déjà affiné) ; chaque résultat s'ajoute à la liste, l'original est conservé. Le texte envoyé à l'IA, la boucle de correction, le nom des fichiers et le diff « changements réels » sont ceux de `gp200_agent.refine` / `refine_live` (vérifiés octet par octet). Écart volontaire : le Python perd la table CTRL et le volume du patch en réécrivant le fichier, la page les recopie depuis le fichier d'origine.
- **Rack** : cliquer un module le sélectionne ; la LED d'un module = bypass (en direct sur la pédale si elle est connectée). Flèches ← → pour naviguer.
- **Onglets** : *Module* (modèle, ON, curseurs avec plages réelles du firmware + saisie numérique), *Résultat* (diff, analyse de l'IA, ou métadonnées du preset ouvert), *Pédale* (envoi 1 ou 3 presets), *CTRL* (grille 8 × 11, **appliquée à chaque case cochée**, comme `CtrlDialog._save`), *Volume* (harmonisation LUFS), *Journal*.
- **Interface (v0.8, purement cosmétique)** : le rack fonctionne au focus — un 1ᵉʳ clic sur un module le sélectionne, un clic de plus sur le module déjà au focus l'active ou le coupe (la pastille d'état à droite du modèle remplace la case « Module actif » ; changer de module ou de preset remet le focus à zéro ; la LED du rack bascule toujours en un clic). Résultat, Pédale, CTRL, Volume et Journal s'ouvrent dans une fenêtre flottante (✕, Échap ou clic à côté pour fermer) ; l'éditeur du module reste affiché sous le rack. Seul le résultat d'un affinage s'ouvre tout seul ; le journal ne s'ouvre plus de force pendant un calcul.
- **Écoute de la pédale (v0.9, sens pédale → page)** : la page garde le port MIDI ouvert (case « Écouter la pédale » du panneau 📍, cochée par défaut ; à décocher pour utiliser l'éditeur Valeton, qui ne partage pas le port) et décode les annonces du GP-200 (`parse_notify` du Python, même corpus de test) : *module basculé au pied ou en façade* → le rack, la pastille d'état et le fichier suivent, sans rien renvoyer ; *volume du patch* → mis à jour (octet 0x38 et checksum) ; *changement de patch* → bandeau « GP-200 sur xx-X ». Le contenu d'un patch n'est jamais envoyé par la pédale : si elle est sur un autre patch que celui du preset affiché, les réglages en direct sont **suspendus** (rien n'est envoyé sur un autre patch) et un bouton « Renvoyer le preset » réécrit le slot ; si elle recharge le slot d'injection alors que l'écran a des réglages non injectés, un bandeau le dit (et le prochain réglage renvoie d'abord le module entier). Un réglage tourné en façade (12/10) est décodé depuis la v0.14 (module, slot, valeur : voir plus bas) et appliqué au preset affiché. Le journal « Ce que dit la pédale » (fenêtre Pédale) garde les derniers messages en hexadécimal pour décoder la suite. Un écho de notre propre bascule est ignoré pendant 500 ms.
- **Réglage en direct par défaut** : dès que la pédale est connectée, chaque mouvement de curseur, changement de modèle (`effect change`, 400 ms, paramètres, 1ᵉʳ renvoyé en dernier) ou bypass part tout de suite (trames de `gp200_usb.py`, 1 trame / 40 ms max). **Injection = écriture dans un slot puis sélection (comme la version Windows, `_inject_bg`)** : le preset est écrit dans le slot choisi de la pédale (poignée de main + 7 morceaux, puis Bank Select / Program Change 350 ms plus tard) ; la pédale le charge depuis sa mémoire, tous ses modules ont donc le bon modèle et les réglages en direct visent les bons paramètres. **Dès la connexion de la pédale, avant tout preset, une fenêtre demande le slot de travail** (rouvrable à tout moment par la pastille 📍 de l'en-tête). Le slot (📍 `12-C`, 1 à 50, lettre A–D, 01-A par défaut comme l'appli Windows) est affiché sur le bouton **⚡ Injecter** et dans le message de fin ; **rien n'est écrit tant qu'on ne l'a pas confirmé** (OK dans le panneau 📍), car le contenu du slot est écrasé à chaque injection. L'option **auto** (mémorisée) réinjecte dès qu'un preset est choisi (clic dans la liste, génération, ouverture, résultat d'affinage ; 0,5 s de calme, un choix pendant une écriture est rejoué ensuite). Après l'injection, un réglage = 1 trame (+ renvoi final), sans renvoyer de modèle. **Au premier réglage d'un module (et après chaque pause de plus de 15 s), la page envoie d'abord ce module en entier — `effect change`, 400 ms, toutes ses valeurs, la première renvoyée — pour que la pédale soit sur le même modèle que l'écran : un numéro de paramètre n'a de sens que pour le modèle chargé, sinon c'est un autre réglage qui bouge.** La liaison s'ouvre au premier réglage et se referme après 15 s d'inactivité pour laisser la pédale à l'éditeur Valeton. Les réglages sont provisoires sur la pédale tant qu'on n'a pas envoyé le preset (« Enregistrer sur la pédale… »). L'interrupteur **Direct** les coupe (le fichier seul change).
- **Audit du 04/10 intégré (v0.6)** (`ref/audit/`, 216 modèles, 1 084 réglages, extraits par `tools/webdata.py` dans le bundle) :
  - **Confirmation 12/0C** : la pédale confirme chaque changement d'effet par un SysEx 12/0C (`[22]` = module, `[29]<<4|[30]` = modèle, `[-2]` = catégorie ; `gp200usb.js › MidiLink.changeEffect`). La page attend cette confirmation au lieu de 400 ms à l'aveugle (+ 150 ms de marge), renvoie le changement une fois si elle manque, et se rabat sur l'attente fixe si le format n'est jamais reconnu (2 absences d'affilée sans aucune confirmation vue) ou pour les modèles qui ne confirment pas (Gate 1, Volume, SnapTone). Un effet jamais confirmé est signalé à la fin de l'injection. Des paramètres envoyés pendant le chargement d'un modèle sont perdus : c'est la cause probable d'un Time de delay parfois faux.
  - **Time** : renvoyé en dernier à chaque envoi de module, et chaque curseur renvoie sa dernière valeur 180 ms après le dernier mouvement.
  - **Baffle** : changer d'ampli fait recharger sa baffle par défaut à la pédale (71 amplis confirmés, tous d'accord avec `defcab`). La page renvoie donc la baffle du preset après l'ampli (injection et changement d'ampli en direct). Dans les presets générés, si l'IA n'en donne pas, la baffle par défaut de l'ampli est posée explicitement (`fill_default_cab` côté Python, `fillDefaultCab` côté web, mêmes cas de test).
  - **↻** à côté d'un réglage = muet en direct (91 réglages, surtout Sync / Trail / Spread / modes) : la pédale ne le prend en compte qu'au chargement du preset.
  - **Niveau mesuré** de l'ampli / de la distorsion affiché dans l'onglet Module (réglages par défaut, bruit rose à −26 dBFS ; les amplis vont de −26 à −4,7 dBFS). Ces niveaux ne sont **pas** encore utilisés pour compenser les volumes à la génération : il manque la courbe niveau = f(Volume ampli / volume du patch) pour convertir des dB en unités de réglage.

## Reconstruire après une modification

```
python3 tools/build_web.py          # produit web/dist/index.html
```
`tools/build_web.py` lit le code Python du projet (prompts, catalogue, tables du firmware) pour
que la page reste alignée sur l'appli de bureau. Si tes `.py` ne sont pas dans `ref/`, indique le dossier :
`GP200_REF=/chemin/vers/le/projet python3 tools/build_web.py`
(ce dossier doit contenir `gp200lib.py`, `gp200_agent.py`, `gp200_i18n.py`, `template.prst` et `data/` ; les tests LUFS/réglage utilisent aussi `gp200_batch.py`, `gp200_lufs.py`, `gp200_usb.py`, et `pip install pyloudnorm numpy scipy`).

## Tests

```
python3 tests/make_expected.py && node tests/run_core_tests.js     # encodeur JS = gp200lib.py, octet par octet
python3 tests/make_expected_gen.py && node tests/run_gen_tests.js  # boucle IA complète = gp200_agent.generate
python3 tests/make_expected_usb.py && node tests/run_usb_tests.js  # trames et séquence USB = gp200_usb.py
python3 tests/make_expected_lufs.py && node tests/run_lufs_tests.js  # mesure LUFS = pyloudnorm + LUFSEngine
python3 tests/make_expected_tune.py && node tests/run_tune_tests.js  # auto-réglage = vrai code de gp200_batch.py (faux self + horloge simulée)
python3 tests/make_expected_refine.py && node tests/run_refine_tests.js  # affiner, CTRL, réglages = gp200_agent / gp200lib / gp200_usb
python3 tests/make_expected_cab.py && node tests/run_cab_tests.js  # baffle par défaut de l'ampli = fill_default_cab
node tests/run_confirm_tests.js                                    # attente de la confirmation 12/0C, renvoi, sonde, modèles sans confirmation
python3 tests/make_expected_notify.py && node tests/run_notify_tests.js   # décodage des notifications de la pédale (12/08, 12/10) contre parse_notify du Python
node tests/run_read_tests.js                                          # lecture du patch en cours : requêtes = celles de l'éditeur Valeton (capture USB), réponses → .prst, fausse pédale
node tests/run_tips_tests.js                                          # info-bulles : FR/EN identiques, tous les paramètres expliqués
node tests/audit_tips.js --strict                                    # aucune info-bulle manquante dans l'interface (Chromium)
node tests/e2e.js                                                  # Chromium, API simulées : génération, téléchargements, fournisseurs
node tests/e2e_usb.js                                              # Chromium, fausse API Web MIDI
node tests/e2e_read.js                                             # Chromium, fausse pédale qui rejoue la capture : lecture au branchement, changement de patch, débranchement / rebranchement, preset ouvert intact, pédale muette
node tests/e2e_tune.js                                             # Chromium, faux pédalier + faux micro + horloge simulée
node tests/fuzz_ui.js                                              # Chromium : tous les modèles de tous les slots + clics / doubles-clics sur le rack (aucune exception tolérée)
node tests/e2e_refine.js                                           # Chromium, faux Gemini + fausse pédale : bibliothèque, ouvrir/glisser-déposer, affiner, CTRL, réglage en direct, mise en page
```

## Limites connues

- Gemini, OpenRouter et Anthropic uniquement (OpenAI et Perplexity n'autorisent pas les appels directs depuis un navigateur).
- La clé API est mémorisée dans le navigateur (case à décocher sur un ordinateur partagé).
- L'envoi USB et l'harmonisation sont testés avec une fausse pédale et un faux micro (octets et décisions identiques au Python), pas encore sur du vrai matériel depuis un navigateur. La capture audio utilise `ScriptProcessor` (déprécié mais pris en charge partout).
- Le réglage en direct agit sur le patch **actif** de la pédale : sélectionne-le d'abord sur la pédale. Affiner, CTRL et réglage en direct sont testés comme le reste (octets identiques au Python, fausse pédale), pas encore sur du vrai matériel. Le « live batch/panel » du bureau (`gp200_batch_live.py`, `gp200_live.py`) n'est pas porté.
- Le test `tests/lufs_signals.f32` (13 Mo) est régénéré par `make_expected_lufs.py` ; il n'est pas dans l'archive.
- Une clé de config `ctrl` écrite deux fois sous deux graphies (`"2"` et `"CTRL2"`) peut s'appliquer dans un autre ordre qu'en Python : cas jamais produit par l'IA.

## v0.14 — réglages tournés en façade suivis par la page (12/10 décodé)

Le message 12/10 envoyé par le GP-200 quand on tourne un réglage est un 12/18 amputé de 16 octets (confirmé sur la pédale réelle le 4/10/2026 : 112 trames, 16 séries étiquetées, 0 discordance). Format (46 octets, pédale → PC) :

| Octets | Rôle |
|---|---|
| [0..7] `F0 21 25 7E 47 50 2D 32`, [8..9] `12 10` | en-tête, commande |
| [14] = `05`, [18] = `0C` | fixes (vérifiés) |
| [22] | module : 0 PRE, 1 WAH, 2 DST, 3 AMP, 4 NR, 5 CAB, 6 EQ, 7 MOD, 8 DLY, 9 RVB, 10 VOL |
| [24] | slot du paramètre (même numérotation que le [40] du 12/18) |
| [25..28], [29..36] | résidus de tampon, variables : **jamais vérifiés** |
| [37..44] | valeur : float32 petit-boutiste, un octet = 2 nibbles (haut d'abord), valeur de l'écran sans conversion |

- **Décodeurs** : `parsePanelParam` (JS, `web/src/gp200usb.js`) → `{kind:'panel', module, param, value}` et `parse_panel_param` (Python, `ref/gp200_usb.py`, appelé par `parse_notify` pour les trames de 46 octets) → `("param", module, slot, valeur)`. Mêmes règles : module ≤ 10, slot ≤ 14, nibbles ≤ 0x0F, valeur finie. Corpus commun `tests/expected_notify.json` (2693 cas : séries réelles, résidus, refus, fuzz).
- **Page** : la valeur reçue est écrite dans le preset affiché (`patchParam` + checksum, `params` du module et `spec`) sans rien renvoyer à la pédale ; la fiche du module suit (au plus tous les 250 ms, jamais pendant qu'un curseur est tenu). On applique toujours la **dernière valeur reçue** (la pédale envoie ~10 trames/s et saute des valeurs intermédiaires).
- **Conditions** : le fichier et le module ont un modèle, le slot existe dans ce modèle, la valeur est dans [min, max], la pédale est sur le patch affiché (sinon le bandeau « autre patch » / « rechargé » parle déjà), et aucune écriture USB n'est en cours. Sinon la valeur n'est pas écrite, elle est notée au journal « Ce que dit la pédale » et le bandeau indique que l'écran peut différer.
- **Garde anti-écho** : tout 12/18 envoyé par la page (curseur, envoi de module, harmonisation) mémorise module × 16 + slot ; un 12/10 reçu moins de 500 ms plus tard pour le même couple est ignoré. La pédale n'a jamais renvoyé d'écho (0 sur 16) : c'est une sécurité.
- **Journal** : un 12/10 que le décodage refuse (variante de trame) reste dans le journal brut, en hexadécimal.
- **Inchangé** : toutes les écritures vers la pédale (12/18, 12/14, 12/08, 12/10 envoyés par le PC).
- **Pas encore observé** : slots 3 à 14, modules WAH / NR / PRE / VOL en façade, paramètres non numériques, pédale d'expression et CTRL. Pour tout nouveau cas : `tools/gp200_panel_capture.py --libre` (script de capture, hors de cette archive).
- Tests : `node tests/run_notify_tests.js`, `node tests/e2e_refine.js` (groupe 8f : application, rafale, hors plage, écho, autre patch).

## v0.15 — menus de blocs conformes à la pédale (PRE, SnapTone) et validation par menu

**Le constat** (Alan Sheers, confirmé sur ta pédale le 4/10/2026) : le champ `slots` de 26 modèles ne correspondait pas au menu de la pédale. PRE : OD 9, Yellow OD, Penesas, Super OD, Blues OD, Auto Swell, Hold, Freeze **manquaient** ; Guitar EQ 1/2, Bass EQ 1/2, Mess EQ, Hyper EQ, Detune, Bit Smash y figuraient **à tort** (8 entrées, 8 sorties : le total restait 31). SnapTone : ids 0–4 sont dans AMP et ids 5–9 dans DST (capture 12/0C : « SnapTone 1 à 5 » du menu DST = ids 5 à 9), la base les avait inversés.

- **Données** : `tools/apply_slots_correction.py` (idempotent, `--check`) corrige uniquement `slots` ; détail et preuves dans `ref/data/CORRECTIONS_slots_2026-10-04.md`. Le menu PRE vaut maintenant exactement les 31 modèles relevés sur la pédale.
- **Validation de ce que l'IA propose** (`checkNames` / `check_names`) : un modèle n'est accepté dans un bloc que si le menu de la pédale l'y propose (`Tables.inMenu` / `in_menu`), pas seulement parce que sa catégorie y est admise. 165 couples « catégorie compatible mais hors menu » sont désormais refusés (ex. Green OD ou Guitar EQ 1 en PRE, Hammy en MOD) : l'erreur renvoyée à l'IA dit où va le modèle et propose des voisins du bon bloc.
- **Prompt** : l'ancienne règle « PRE : cat 0,1,3,4… » (qui laissait l'IA choisir hors menu) est remplacée. Les modèles des catégories partagées (0, 1, 3, 4) portent `slots=…` dans le catalogue ; les autres catégories n'ont qu'un slot. SnapTone n'est toujours pas proposé à l'IA.
- **Tolérance** : décoder, afficher et réécrire un `.prst` existant ne vérifie rien (un ancien preset avec Detune en PRE s'ouvre, s'affiche et se réécrit à l'identique). À l'affinage, un modèle déjà présent dans un slot du preset d'origine est conservé tel quel (`keep`) ; seul un NOUVEAU modèle hors menu est renvoyé à l'IA. Les listes déroulantes de la page suivent le menu, en gardant le modèle courant visible.
- **Aussi** : `fmtG` (JS) arrondit désormais comme `%g` de Python sur les valeurs exactement à mi-chemin (999996.5 → 999996), cas limite révélé par le nouveau corpus.
- Tests : `python3 tests/make_expected_menu.py && node tests/run_menu_tests.js` (matrice 2160 couples modèle × bloc, faits relevés sur la pédale, cohérence du prompt, tolérance, affinage scripté) ; e2e_refine groupe 8j (listes de blocs dans la page).

## v0.16 — continuer sans clé IA

Demande remontée par un utilisateur : certains veulent seulement ouvrir des presets, les envoyer à la pédale et harmoniser les volumes, ce qui n'a jamais eu besoin d'IA.

- La fenêtre de connexion (première visite) propose **« Continuer sans IA »** (info-bulle et aide FR/EN) à côté d'« OK ». Le choix est mémorisé (`noAi` dans le stockage local de la page, avec les autres préférences) : la fenêtre ne s'ouvre plus d'elle-même aux visites suivantes.
- Sans clé : ouverture de presets (fichiers, glisser-déposer), envoi USB, écoute de la pédale, réglage en direct et **harmonisation des volumes** fonctionnent comme avant. Seules la génération et l'affinage par IA demandent une clé : un clic sur « Générer » ou « Affiner » sans clé affiche le message habituel et rouvre la fenêtre, qui se ferme alors avec ✕, Échap ou un clic à côté.
- La pastille « Connecter une IA » en haut reste le moyen d'ajouter une clé plus tard ; saisir une clé remet le fonctionnement normal (`noAi` repasse à faux).
- Tests : `node tests/e2e_refine.js`, groupe 8k.


## v0.17 — plus de faux « clé invalide »

Signalé par un utilisateur et reproduit avec une clé Gemini valide : la fenêtre de connexion affichait « cette clé ne ressemble pas à une clé Gemini (elle devrait commencer par AIza) ». Ce test de préfixe était trop strict : Google émet aussi des clés d'un autre format (par ex. `AQ.…`), et seul le fournisseur sait si une clé est valide.

- **Cause** : un simple indice de saisie (`checkKeyHint`) exigeait le préfixe `AIza` pour Gemini (`sk-ant-` pour Anthropic, `sk-or-` pour OpenRouter). Il ne bloquait rien, mais la page affirmait à tort que la clé n'était pas bonne. Le chemin d'appel n'était pas en cause : la clé est transmise telle quelle (`x-goog-api-key`), sans contrôle de format.
- **Correctif** : l'indice ne s'affiche plus que si la clé collée porte le préfixe **d'un autre fournisseur** (ex. `sk-ant-…` sous Gemini : « Cette clé ressemble à une clé Anthropic, mais le fournisseur choisi est Gemini »). Une clé de format inconnu ne déclenche plus rien ; l'indice ne bloque jamais le bouton OK. Si le fournisseur refuse vraiment la clé, le message « La clé API est refusée par le fournisseur » (401/403) s'affiche à la première génération, comme avant.
- Tests : `node tests/e2e_refine.js`, groupe 8l (formats Gemini AIza / AQ. / hexadécimal / autres, mélanges de fournisseurs dans les trois sens, rechargement, anglais, absence de tout test « doit commencer par »).

## v0.18 — volume du patch dans le réglage en direct

Oubli de la fiche du module : le volume du patch (0 à 100, octet 0x38 du `.prst`, le bouton « patch volume » de la façade) n'était réglable que par l'harmonisation, jamais à la main.

- **Curseur + champ « Volume du patch »** sous les réglages du module choisi (et aussi quand le module est vide) : le volume est un réglage du preset, pas d'un module. Écrit dans le fichier affiché (octet 0x38 + checksum, sur place) puis envoyé en direct (12/10, trame de 46 octets, la même que `send_patch_vol_update` de la version Python) avec la même file que les autres réglages : 1 trame / 40 ms, dernière valeur gagnante, renvoi de la dernière valeur 180 ms après le dernier mouvement. Il n'envoie aucune trame de module (pas de resynchronisation).
- **Suivi du bouton en façade** : déjà décodé depuis la v0.9 (12/08) ; le curseur et le champ affichent maintenant la valeur reçue. Anti-écho : la pédale renvoie un 12/08 après notre envoi, il est ignoré pendant 500 ms (comme pour les bypass et les réglages).
- **Hors ligne** : le curseur modifie le preset affiché ; le `.prst` téléchargé ou envoyé ensuite porte le nouveau volume.
- Tests : `node tests/e2e_refine.js`, groupe 8m (trames comparées au Python, rafale, champ borné 0 à 100, écho, bouton en façade, module vide, hors ligne, anglais).

## v0.19 — le volume du patch au-dessus de la chaîne du signal

Retour de Rudy sur la v0.18 : le volume du patch concerne tout le preset, pas le module sélectionné ; sa place est dans la zone du rack, juste au-dessus de la chaîne, et non dans la fiche du module.

- Une seule ligne « Volume du patch » (curseur + champ 0 à 100) entre l'en-tête du preset et les modules ; elle reste en place quand on change de module. Le long texte d'aide visible est remplacé par l'info-bulle.
- Comportement inchangé (v0.18) : écriture dans le fichier + checksum, envoi en direct 12/10, dernière valeur renvoyée, anti-écho 500 ms, suivi du bouton en façade, hors ligne.
- Tests : `node tests/e2e_refine.js` groupe 8m (position dans le DOM, changement de module sans envoi).

## v0.20 — messages d'état discrets dans la barre du bas

Retour de Rudy : les deux encadrés « GP-200 sur 64-D » et « Injecté et sélectionné sur la pédale en 64-D » prenaient beaucoup de place au-dessus de la chaîne du signal.

- **En bas de l'application** (barre d'état, texte discret avec un petit point vert) : « GP-200 sur 64-D · volume du patch 57 » (`#pd-on`) et « Injecté et sélectionné… » (`#inj-state`). Rien à faire, donc rien dans la zone de travail.
- **Reste près du rack**, parce que ça demande un geste ou signale un écart : choisir le slot d'injection (`#inj-need`), pédale sur un autre patch ou patch rechargé / réglage tourné en façade avec le bouton « Renvoyer le preset » (`#pd-other`, `#pd-reloaded`, `#pd-knob`), erreur ou avertissement d'injection. Quand tout va bien, l'encadré disparaît complètement.
- Même condition d'affichage qu'avant (preset affiché + pédale branchée) ; masqué pendant une génération.
- Tests : `node tests/e2e_refine.js`, groupe 8n.

## v0.21 — réglages du module : 6 par ligne

Demande de Rudy (écran un peu petit) : la fiche d'un module prenait trop de hauteur à 4 réglages par ligne.

- La grille des curseurs passe à **6 colonnes au plus** (`repeat(auto-fill, minmax(max(140px, (100% − 90px) / 6), 1fr))`) : 6 dès ~1000 px de large pour la fiche (soit un écran de 1280 px), 5 ou moins en dessous, 1 colonne sur mobile (≤ 640 px) comme avant. Un ampli à 6 réglages tient sur une seule rangée.
- Compactage : champ numérique 62 px (au lieu de 78), curseurs un peu moins hauts, interlignes réduits.
- Affichage des valeurs lues dans le fichier arrondi à 2 décimales au moins (37.6244 → 37.62 ; plus si le pas du réglage l'exige) pour tenir dans le champ ; le fichier garde sa précision, et ce qui est tapé ou déplacé n'est pas arrondi.
- Tests : `node tests/e2e_refine.js`, groupe 8o (1920 / 1600 / 1366 / 1280 px = 6 colonnes, 900 px, mobile, rien ne dépasse, une rangée pour 6 réglages).

## v0.22 — boutons et champs compacts

Retour de Rudy : la barre du haut est bien, mais la zone « Que veux-tu changer… » et le haut du rack prenaient trop de place ; revoir la taille de tous les boutons.

- **Référence** : les boutons de la barre du haut (`.btn.small`, 32 px). Avec une souris ou un pavé tactile (`@media (pointer: fine)`) : boutons 32 px, bouton principal (Générer / Affiner) 34 px (au lieu de 48), listes déroulantes et champs 32 px (au lieu de 40), onglets Résultat / Pédale / CTRL / Volume 34 px (au lieu de 38), exemples 26 px (au lieu de 31), zone de saisie 58 px (au lieu de 64).
- **Zone de demande** : 213 px de haut à 1600 px de large (250 avant) ; le rack commence 37 px plus haut. Le bouton « Optimiser pour concert » et son explication tiennent sur une ligne.
- **Écran tactile** (`pointer: coarse`) : les grandes cibles sont conservées (bouton principal 48 px, etc.).
- Aucun changement de comportement ni de texte.
- Tests : `node tests/e2e_refine.js`, groupe 8p (hauteurs des boutons, onglets, listes, exemples, hauteur de la zone de demande, tactile).

## v0.23 — fiche du module : aide pleine largeur, message d'état en bas

- Le paragraphe « Pour que la pédale ait exactement le preset affiché… » n'est plus limité à 70 caractères de large (`.module > .help { max-width: none }`) : 4 lignes → 2 lignes à 1600 px. Même chose pour l'encadré « Choisis d'abord le slot d'injection… » (`.injbox .note`).
- Le message « X appliqué sur la pédale (pas encore enregistré) » (`#ed-msg`) passe dans la barre d'état du bas, comme « GP-200 sur 64-D » (v0.20), en ligne comme hors ligne. Les **erreurs** de la liaison directe (`#ed-err`) restent dans la fiche du module : elles demandent d'être vues.
- Tests : `node tests/e2e_refine.js`, groupe 8q.

## v0.24 — Set list : garder, nommer, envoyer en masse

Un module à part (`web/src/gp200setlist.js` pour la logique, section « set list » d'`app.js`, onglet **Set list**). Rien de l'existant n'est modifié, hors un coeur ajouté à chaque ligne de la bibliothèque (la ligne `.lib-row` est inchangée, elle est simplement enveloppée dans un `div.lib-line`).

- **Garder** : un ♥ à droite de chaque preset de la liste de gauche ; l'onglet « Set list (n) » compte les presets gardés. Écouter un preset reste comme avant (sélection = injection dans le slot de travail).
- **Fenêtre Set list** : un nom par preset (16 caractères, accents remplacés par la lettre de base — « Café » → « Cafe » —, le reste hors ASCII est retiré ; le nom réellement envoyé est annoncé), une banque (1–64) et une lettre (A–D), ↑ ↓ ✕, et « Attribuer » = emplacements consécutifs à partir d'un slot.
- **Contrôles avant l'envoi** (bloquants) : nom vide, emplacement manquant / invalide, deux presets sur le même emplacement. **Avertissements** : nom modifié, deux noms identiques, emplacement = slot de travail de la page (il est réécrit à chaque sélection).
- **Envoi** : confirmation listant chaque emplacement écrasé (« 10-B ← Cafe Rock »), puis écriture une à une (poignée de main + SysEx + sélection, comme l'envoi de la fenêtre Pédale), barre de progression, la pédale se positionne sur le premier preset. En cas d'interruption (câble débranché…), le message dit combien ont été écrits et lesquels.
- **Les fichiers de la bibliothèque ne sont jamais modifiés** : le nom n'existe que dans la copie envoyée (`renameRaw` : 16 octets du nom + checksum recalculé, rien d'autre).
- **ZIP** : « Télécharger la set list » (la liste n'est conservée que dans l'onglet du navigateur).
- Non fait volontairement : mémoire des slots écrits (la pédale ne permet pas de relire ses slots), harmonisation de la sélection, conservation de la liste après rechargement.
- Tests : `node tests/run_setlist_tests.js` (logique, comparée au Python : noms, checksums, 256 emplacements), `node tests/e2e_setlist.js` (♥, validation, envoi octet par octet comparé au Python, coupure, ZIP, EN, mobile).

## v0.25 — « Signaler un problème » (diagnostic)

- Un lien **Signaler un problème** en bas de page, et un panneau qui s'ouvre tout seul à la première erreur inattendue (erreur JS, promesse rejetée, erreur d'API hors clé invalide / quota). Rien n'est envoyé automatiquement : le rapport se copie à la main dans un message ou une « issue » GitHub.
- Le rapport contient la version, le navigateur, le fournisseur d'IA et le modèle, l'état MIDI (ports vus, port choisi, patch de la pédale) et les 80 derniers événements. **Aucune clé API** : les clés (Google, Anthropic/OpenRouter `sk-…`, `Bearer`, `api_key=…`) sont masquées en `[key hidden]`.
- Code : section « diagnostic » d'`app.js` (`dg()` note un événement, `diagErr()` une erreur, `diagReport()` fabrique le texte), styles `.diag` / `.linkbtn` dans `style.css`.

## v0.26 — mode filaire Android (USB OTG)

- Chrome pour Android + câble USB OTG (adaptateur OTG + câble USB-B de la pédale, ou câble USB-C → USB-B) : mêmes envois et même réglage en direct qu'avec un ordinateur.
- Détecté par le `userAgent` (`IS_ANDROID` dans `app.js`). Hors Android, **rien ne change** (comparaison du DOM avant / après identique).
- `MidiLink({ loose: true })` : reconnaissance plus tolérante du port (nom `GP200` / `Valeton…`, ou unique sortie présente), entrée appariée par nom ou unique, **réassemblage des SysEx livrés en plusieurs morceaux**. Rythme plus prudent (60 ms entre morceaux, 45 ms entre paramètres, 700 ms à l'ouverture du port). Textes d'aide propres (`pedal_steps_android`…).
- La page doit être ouverte **depuis son adresse https** (GitHub Pages). Ouverte depuis une pièce jointe ou un fichier téléchargé (`content://`, `file://`), Chrome refuse le MIDI : v0.26.1 le dit clairement et masque l'adresse de la page locale dans le rapport.

## v0.27 — lecture du patch chargé sur la pédale

- **Au branchement**, si rien n'est affiché, la page lit le patch en cours et l'affiche (rack, réglages, volume). Il est rangé dans la liste avec le badge « pédale ».
- **Quand la pédale change de patch** (au pied) alors que le rack montre un patch lu sur la pédale, il est relu et remplacé sur place (0,25 s de calme). L'annonce qui suit immédiatement une lecture du même patch est ignorée (écho).
- **Bouton « Lire le patch en cours »** (onglet Pédale) : relit à la demande, même si un autre preset est affiché (il reste dans la liste) ou si le réglage en direct est coupé. En cas d'échec, il dit pourquoi.
- **Lecture seule** : seules les requêtes `11/04` (bloc système : patch courant en octets 8–9) et `11/10` (patch) de l'éditeur Valeton sont envoyées, jamais une trame d'écriture. Un patch lu n'est jamais injecté automatiquement, même si un slot d'injection est choisi (`fromPedal()` neutralise `scheduleInject` et l'alerte « la pédale est sur un autre patch »).
- Protocole (relevé sur une capture USBPcap du démarrage de l'éditeur Valeton) : réponse `12/4e/06` (bloc système, 846 octets) ou `12/18/09` (patch, 7 morceaux de 185 octets décodés, 1 176 octets en tout), quartets haut d'abord, décalage sur 14 bits (`b[11] | b[12] << 7`). Le `.prst` = en-tête et fin du modèle + ces 1 176 octets en 40…1215 + somme de contrôle recalculée (`prstFromDeviceRead`).
- On demande d'abord le **tampon d'édition** (état actuel, réglages non enregistrés compris), puis, s'il manque ou désigne un autre patch, le patch enregistré. Si la pédale ne répond pas à la lecture simple, on refait l'ouverture de session de l'éditeur (`11/04 … 01 02`, `11/12`) puis on la referme (`02 02`) ; sinon, silence : rack vide et une ligne `read …` dans le rapport de diagnostic.
- Vérifié sur la vraie pédale (patchs 64-A / 64-B, lecture ≈ 0,3 s après l'annonce).
- Tests : `node tests/run_read_tests.js` (`tests/read_fixture.json` = extraits de la capture).

## v0.27.1 — pédale débranchée puis rebranchée (ou éteinte puis rallumée)

- Bug trouvé sur la vraie pédale : après un débranchement sauvage, la pédale remise sur un autre patch (63-C) puis rebranchée, le rack restait sur l'ancien (63-A). La lecture au branchement n'avait lieu que si le rack était **vide** ; avec un patch lu sur la pédale déjà affiché, elle était sautée.
- Maintenant (`fetchWanted()` dans `app.js`) : au (re)branchement, la page relit le patch si le rack est vide **ou** s'il montre déjà un patch lu sur la pédale ; celui-ci est alors remplacé sur place (une seule entrée dans la liste). Un preset **ouvert, généré ou affiné** n'est jamais remplacé. Si la pédale n'est pas encore prête (elle redémarre), une seconde tentative a lieu 2,5 s plus tard.
- Test : `node tests/e2e_read.js` (scénario 3 : débranchement, pédale remise sur un autre patch, rebranchement ; scénario 5 : un preset ouvert reste affiché). Le scénario 3 échoue sur la v0.27.


## v0.28 — Mémoire de la pédale (colonne de gauche)

Quand la pédale est reconnue, une colonne **« Mémoire de la pédale »** s'ajoute à gauche de « Mes presets » : les 256 emplacements (01-A … 64-D) avec le nom du patch enregistré dedans.

- **Lecture seule.** Chaque nom vient de la requête `11/10` (patch enregistré), la même que celle de l'éditeur Valeton au démarrage (≈ 6 s pour les 256). Aucune écriture (`11/1c`, `11/0a`) n'est jamais envoyée.
- **Clic sur un emplacement** : la pédale le charge (Bank Select + Program Change, comme au pied), puis la page le lit et l'affiche dans le rack. C'est le seul message envoyé en dehors des lectures.
- **Chargement automatique** : démarre quelques secondes après le branchement, en commençant par le patch courant, mais seulement une fois la pédale connue (patch courant lu) ou le slot de travail confirmé : rien n'ouvre le port avant. Si la toute première lecture reste sans réponse, la lecture automatique est abandonnée (le bouton ↻ reste disponible).
- **Noms périmés** : au rebranchement les noms déjà lus sont gardés mais grisés (« à relire ») puis relus ; un emplacement écrasé par la page (injection, set list) est relu aussitôt.
- **Bouton ↻** : relit toute la mémoire. Une lecture est toujours mise en attente tant qu'un envoi, un réglage de volume ou la lecture du patch courant est en cours.
- **Disposition** : 3 colonnes à partir de 1100 px (la page s'élargit à 1810 px au lieu de rétrécir la zone centrale) ; en dessous, la colonne passe sous le rack.
- **Diagnostic** : « Signaler un problème » contient les lignes `memoire : N emplacements lus` ou `memoire : interrompue …`.
- Tests : `tests/e2e_read.js` (pédale simulée : noms, clic, lecture, défilement, 1200/800 px), `run_read_tests.js` (`readStoredPatch`, `deviceReadName`).

## v0.28.1 — Gemini : repli sur « flash-lite » en cas de surcharge, liste de modèles nettoyée

Signalé avec une clé Gemini **gratuite** : `gemini-3.5-flash` renvoie souvent 503 (« high demand », les clés gratuites passent après les payantes) et la liste proposait des modèles inutilisables par l'appli.

- **Repli sur 503 (Gemini uniquement).** Si le modèle répond encore 503 après les 2 relances habituelles (4 s puis 16 s), la génération en cours bascule **une seule fois** sur un modèle « flash-lite » pris dans la liste courante (stable avant preview, le plus récent d'abord ; avec la liste intégrée : `gemini-3.1-flash-lite`). Le journal indique « modèle remplacé par … ». Le modèle choisi dans les réglages n'est pas modifié ; la correction automatique qui suit reste sur le modèle de repli. Aucun repli si le modèle choisi est déjà un flash-lite, si le repli est aussi surchargé (l'erreur 503 habituelle s'affiche) ou pour une autre erreur (429, clé refusée…). **OpenRouter et Anthropic ne changent jamais de modèle.**
- **Liste de modèles Gemini filtrée** (`geminiUsable`) : seuls les `gemini-…` qui génèrent du texte sont proposés. Sont retirés Gemma, Antigravity (modèle d'agent : « Developer instruction / JSON mode is not enabled »), embedding, voix (TTS), image, temps réel (live), audio, robotique, usage d'ordinateur, deep research. Si le filtre ne laisse rien, la liste intégrée est utilisée. Le modèle déjà choisi reste affiché même s'il n'est plus dans la liste.
- Tests : `node tests/run_fallback_tests.js` (repli : Gemini seul, une seule bascule, autres fournisseurs inchangés) et `node tests/run_modelfilter_tests.js` (filtre de la liste, liste vide, autres fournisseurs inchangés).
