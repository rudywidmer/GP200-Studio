# Correction de `slots` (appartenance aux blocs) — 4 octobre 2026

26 modèles de `gp200_models_all.json` : **seul le champ `slots` change** (aucun paramètre, aucune valeur).
Reproductible : `python3 tools/apply_slots_correction.py` (idempotent, `--check` pour vérifier).

| Modèles | Avant | Après |
|---|---|---|
| OD 9, Yellow OD, Penesas, Super OD, Blues OD | DST | DST + **PRE** |
| Auto Swell | MOD, NR | MOD, NR + **PRE** |
| Hold, Freeze | MOD | MOD + **PRE** |
| Guitar EQ 1/2, Bass EQ 1/2, Mess EQ, Hyper EQ | EQ + PRE | EQ |
| Detune, Bit Smash | MOD + PRE | MOD |
| SnapTone 1–5 (cat 15, ids 0–4) | DST | **AMP** |
| SnapTone 6–10 (cat 15, ids 5–9) | AMP | **DST** |

Le PRE reste à 31 modèles (8 entrées, 8 sorties) : un contrôle par comptage ne voyait rien.

## Preuves
- **Origine du diagnostic** : Alan Sheers (branche `alan-gp200-fixes`, commit 1eeac2b), d'après les `<Catalog Name="BLOCK">` de
  `algorithm.xml` (éditeur Valeton 1.8.1, SHA-256 `D95D6E019D602E4DAFD5B2B0AEC7C1494DD52546B0E67F0EE6663D8FA6CB8E0E`).
- **PRE** : le menu de la pédale d'Alan (firmware 1.8.0) = les 31 modèles de l'XML. Vérifié aussi sur la pédale de Rudy le 4/10/2026 :
  OD 9, Yellow OD et Hold sont dans le menu PRE ; Guitar EQ 1 et Detune n'y sont pas.
- **SnapTone** : capture 12/0C sur la pédale de Rudy le 4/10/2026 (`panel_20261004_155430.jsonl`), SnapTone 1 à 5 choisis dans le menu DST :
  module 2, catégorie 15, ids **5, 6, 7, 8, 9**. Les ids 0–4 côté AMP se déduisent (5 + 5), non lus directement.
- Cause : le champ `catalogs` des SnapTone (issu de l'XML) contredisait déjà leur `slots`, et la lecture de `algorithm.xml` du projet source
  (phash/gp200editor) ne retient que les paramètres par code d'effet, pas le module.

## Ce que ça change
- Listes de modèles proposées par bloc (page et prompt) : conformes au menu de la pédale.
- Validation de la génération/de l'affinage : un modèle n'est accepté que dans un bloc où le menu le propose (voir `gp200lib.Tables.in_menu`).
- Décodage et réécriture d'un `.prst` existant : inchangés (tolérants).
