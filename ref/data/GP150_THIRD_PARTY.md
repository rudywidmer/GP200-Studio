# Données GP-150 / GP-180 : origine et licence

`gp150_fxid_ring.json` (catalogue des modèles et de leurs réglages) et `gp150_skeleton.prst` (preset vide valide servant de base)
proviennent du projet **valeton-gp150-editor** (https://github.com/lucanenni/valeton-gp150-editor), licence MIT.
Le protocole de communication (trames SysEx, sommes de contrôle, lecture / écriture) et le format `.prst` du GP-150 y sont décrits et
ont servi de référence ; les fonctions correspondantes de GP-200 Studio sont réécrites et vérifiées contre ce code (voir `tests/`).

    MIT License

    Copyright (c) 2026 Andrew Mercurio
    Copyright (c) 2026 lucanenni (GP-150 support)

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
    modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
    WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
    COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
    ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## GP-180

Le GP-180 partage le même format de fichier (seule la valeur initiale du CRC-16 du fichier diffère) et le même protocole. Aucune
donnée du dépôt Valeton-GP180-Rev-Eng (GPL-3.0) n'est copiée dans ce projet : ses captures ont seulement servi à vérifier, hors
dépôt, que les trames et sommes de contrôle sont reconstruites à l'identique.
