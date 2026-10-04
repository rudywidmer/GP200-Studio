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
- **Écoute de la pédale (v0.9, sens pédale → page)** : la page garde le port MIDI ouvert (case « Écouter la pédale » du panneau 📍, cochée par défaut ; à décocher pour utiliser l'éditeur Valeton, qui ne partage pas le port) et décode les annonces du GP-200 (`parse_notify` du Python, même corpus de test) : *module basculé au pied ou en façade* → le rack, la pastille d'état et le fichier suivent, sans rien renvoyer ; *volume du patch* → mis à jour (octet 0x38 et checksum) ; *changement de patch* → bandeau « GP-200 sur xx-X ». Le contenu d'un patch n'est jamais envoyé par la pédale : si elle est sur un autre patch que celui du preset affiché, les réglages en direct sont **suspendus** (rien n'est envoyé sur un autre patch) et un bouton « Renvoyer le preset » réécrit le slot ; si elle recharge le slot d'injection alors que l'écran a des réglages non injectés, un bandeau le dit (et le prochain réglage renvoie d'abord le module entier). Un réglage tourné en façade (12/10) ne donne que sa valeur, pas le module ni le paramètre (protocole non décodé) : la page prévient que l'écran peut différer. Le journal « Ce que dit la pédale » (fenêtre Pédale) garde les derniers messages en hexadécimal pour décoder la suite. Un écho de notre propre bascule est ignoré pendant 500 ms.
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
node tests/run_tips_tests.js                                          # info-bulles : FR/EN identiques, tous les paramètres expliqués
node tests/audit_tips.js --strict                                    # aucune info-bulle manquante dans l'interface (Chromium)
node tests/e2e.js                                                  # Chromium, API simulées : génération, téléchargements, fournisseurs
node tests/e2e_usb.js                                              # Chromium, fausse API Web MIDI
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
