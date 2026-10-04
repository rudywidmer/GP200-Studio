#!/usr/bin/env node
/* parseNotify / parsePanelParam (JS) contre parse_notify du Python (bypass, patch, volume du patch) et le decodage 12/10. */
'use strict';
const fs = require('fs'), path = require('path');
const U = require('../web/src/gp200usb.js');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_notify.json'), 'utf8'));
let pass = 0, fail = 0;
const unhex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
for (const c of cases) {
  const b = unhex(c.hex);
  const got = c.kind === 'panel' ? U.parsePanelParam(b) : U.parseNotify(b);
  const same = JSON.stringify(got) === JSON.stringify(c.exp);
  if (same) pass++; else { fail++; if (fail < 15) console.log('  FAIL ' + c.name + '\n    attendu ' + JSON.stringify(c.exp) + '\n    obtenu  ' + JSON.stringify(got)); }
}
// une notification n'est jamais prise pour une autre : un 12/10 n'est pas un parse_notify et inversement
for (const c of cases) {
  if (c.kind !== 'panel' || !c.exp) continue;
  if (U.parseNotify(unhex(c.hex)) === null) pass++; else { fail++; console.log('  FAIL 12/10 pris pour une notification : ' + c.name); }
}
console.log('=== notifications : ' + pass + ' OK, ' + fail + ' echecs (' + cases.length + ' cas Python) ===');
process.exit(fail ? 1 : 0);
