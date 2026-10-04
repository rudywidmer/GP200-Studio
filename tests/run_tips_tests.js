#!/usr/bin/env node
/* Info-bulles : les deux langues ont les memes cles, aucun texte vide, et CHAQUE parametre de la table des modeles a une explication. */
'use strict';
const fs = require('fs'), path = require('path');
const T = require('../web/src/gp200tips.js');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

const kf = Object.keys(T.ui.fr), ke = Object.keys(T.ui.en);
ok(kf.length === ke.length && kf.every(k => k in T.ui.en), 'memes cles en francais et en anglais : ' + kf.filter(k => !(k in T.ui.en)).concat(ke.filter(k => !(k in T.ui.fr))).join(','));
for (const lang of ['fr', 'en']) for (const k of Object.keys(T.ui[lang])) ok(typeof T.ui[lang][k] === 'string' && T.ui[lang][k].trim().length >= 8, lang + '.' + k + ' : texte present');
ok(kf.length > 90, 'nombre de textes : ' + kf.length);

const names = new Set();
for (const m of bundle.tables.models) for (const p of m.params) names.add(p.name);
let n = 0;
for (const name of names) for (const lang of ['fr', 'en']) {
  const t = T.param(name, lang);
  ok(t && t.length > 10, 'parametre « ' + name + ' » (' + lang + ') : explication manquante'); n++;
}
ok(n === names.size * 2, 'tous les parametres verifies : ' + names.size + ' noms x 2 langues');
// accents / langue : pas de francais dans la version anglaise (heuristique simple)
for (const name of names) { const e = T.param(name, 'en'); ok(!/[éèêàùçô]/.test(e), 'anglais sans accent : ' + name + ' -> ' + e); }
const tip = T.paramTip({ name: 'Gain', min: 0, max: 100, default: 20 }, 'fr');
ok(/^Gain : .*\nPlage : 0 – 100 · par défaut : 20$/.test(tip), 'format de l\'info-bulle d\'un parametre : ' + JSON.stringify(tip));
const tipE = T.paramTip({ name: 'Time', min: 20, max: 4000, default: 400 }, 'en');
ok(/Range: 20 – 4000 · default: 400$/.test(tipE), 'format anglais : ' + JSON.stringify(tipE));
console.log('\n=== tips : ' + pass + ' OK, ' + fail + ' echecs ===');
process.exit(fail ? 1 : 0);
