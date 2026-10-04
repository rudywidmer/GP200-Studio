#!/usr/bin/env node
/* fillDefaultCab (JS) contre fill_default_cab (Python) : baffle par defaut de l'ampli quand l'IA n'en donne pas. */
'use strict';
const fs = require('fs'), path = require('path');
const G = require('../web/src/gp200core.js');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
const tb = new G.Tables(bundle.tables);
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_cab.json'), 'utf8'));
let pass = 0, fail = 0;
for (const c of cases) {
  const spec = JSON.parse(JSON.stringify(c.in));
  const out = G.fillDefaultCab(spec, tb);
  const same = JSON.stringify(out) === JSON.stringify(c.out) && out === spec;
  if (same) pass++; else { fail++; console.log('  FAIL ' + c.name + '\n    attendu ' + JSON.stringify(c.out) + '\n    obtenu  ' + JSON.stringify(out)); }
}
// chaque ampli sans baffle recoit une baffle reelle qui existe dans les tables, active
let amps = 0;
for (const m of tb.models) {
  if (m.cat === 15) continue;
  if (m.cat !== 7 && m.cat !== 8) continue;
  const sp = G.fillDefaultCab({ modules: { AMP: { model: m.name, on: true } } }, tb);
  amps++;
  const cab = sp.modules.CAB;
  const good = cab && cab.on === true && tb.cabById.get(m.defcab) && cab.model === tb.cabById.get(m.defcab).name;
  if (good) pass++; else { fail++; console.log('  FAIL ampli ' + m.name + ' : ' + JSON.stringify(cab)); }
  try { G.encodePrst(sp, tb, new Uint8Array(Buffer.from(bundle.template, 'base64'))); pass++; } catch (e) { fail++; console.log('  FAIL encode ' + m.name + ' : ' + e.message); }
}
console.log('\n=== baffle par defaut : ' + pass + ' OK, ' + fail + ' echecs (' + cases.length + ' cas Python, ' + amps + ' amplis) ===');
process.exit(fail ? 1 : 0);
