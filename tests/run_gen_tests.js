#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const G = require('../web/src/gp200core.js');
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
const tb = new G.Tables(bundle.tables);                       // tables ALLEGEES : teste aussi le trimming
const template = new Uint8Array(Buffer.from(bundle.template, 'base64'));
let pass = 0, fail = 0;
const bad = m => { fail++; console.log('  FAIL ' + m); };
const good = () => { pass++; };

(async () => {
  for (const sc of exp) {
    console.log(sc.name);
    const script = sc.script.slice();
    const calls = [];
    const hooks = {
      template, now: new Date(2026, 9, 4, 14, 5, 9),
      log: () => {}, t: (k, ...a) => k + ':' + a.join('|'),
      callApi: async (cfg, system, msgs) => { calls.push({ system, msgs: JSON.parse(JSON.stringify(msgs)) }); const r = script.shift(); return { text: r.text, truncated: !!r.truncated }; },
    };
    const cfg = Object.assign({ provider: 'gemini', maxRetries: 2, lang: 'fr', pickup: 'auto' },
      sc.cfg, sc.cfg.max_retries !== undefined ? { maxRetries: sc.cfg.max_retries } : {});
    let res, err;
    try { res = await G.generate(cfg, tb, sc.demande, bundle.prompts, hooks, sc.roles); } catch (e) { err = e; }
    if (sc.error) { err ? good() : bad('devait lever ' + sc.error); }
    else if (err) { bad('exception ' + err.stack); continue; }
    // appels envoyes a l'IA : system + historique de messages identiques
    if (calls.length === sc.calls.length) good(); else bad('nb appels ' + calls.length + ' vs ' + sc.calls.length);
    sc.calls.forEach((c, i) => {
      if (!calls[i]) return;
      if (calls[i].system === c.system) good(); else bad('system #' + i + ' differe (' + calls[i].system.length + ' vs ' + c.system.length + ')');
      if (JSON.stringify(calls[i].msgs) === JSON.stringify(c.msgs)) good();
      else {
        bad('messages #' + i + ' differents');
        const a = JSON.stringify(calls[i].msgs), b = JSON.stringify(c.msgs);
        let k = 0; while (a[k] === b[k]) k++;
        console.log('    JS: …' + a.slice(Math.max(0, k - 80), k + 120) + '\n    PY: …' + b.slice(Math.max(0, k - 80), k + 120));
      }
    });
    if (sc.error) continue;
    const jsFolder = res.folder.replace(/ - \d{8} - \d{6}$/, '');
    const pyFolder = sc.folder.replace(/ - \d{8} - \d{6}$/, '');
    jsFolder === pyFolder ? good() : bad('dossier ' + JSON.stringify(jsFolder) + ' vs ' + JSON.stringify(pyFolder));
    if (!/ - 20261004 - 140509$/.test(res.folder)) bad('suffixe date ' + res.folder); else good();
    const got = res.files.map(f => ({ rel: (f.folder ? f.folder + '/' : '') + f.filename, hex: Buffer.from(f.raw).toString('hex') }));
    if (got.length !== sc.files.length) bad('nb fichiers ' + got.length + ' vs ' + sc.files.length);
    sc.files.forEach((f, i) => {
      if (!got[i]) return;
      got[i].rel === f.rel.split(path.sep).join('/') ? good() : bad('chemin ' + got[i].rel + ' vs ' + f.rel);
      got[i].hex === f.hex ? good() : bad('octets ' + f.rel);
    });
  }
  console.log('\n=== generate : ' + pass + ' OK, ' + fail + ' echecs ===');
  process.exit(fail ? 1 : 0);
})();
