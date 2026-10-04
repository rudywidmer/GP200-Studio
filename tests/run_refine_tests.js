#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const G = require('../web/src/gp200core.js');
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_refine.json'), 'utf8'));
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
const tb = new G.Tables(bundle.tables);
const template = new Uint8Array(Buffer.from(bundle.template, 'base64'));
const hex2u8 = h => new Uint8Array(Buffer.from(h, 'hex'));
let pass = 0, fail = 0;
const bad = m => { fail++; console.log('  FAIL ' + m); };
const good = () => { pass++; };
const eq = (a, b, m) => { (a === b) ? good() : bad(m + '\n    JS: ' + String(a).slice(0, 200) + '\n    PY: ' + String(b).slice(0, 200)); };

(async () => {
  // 1. decoded_to_spec : texte exact envoye a l'IA
  console.log('decoded_to_spec');
  for (const [i, s] of exp.specs.entries()) {
    const d = G.decodePrst(hex2u8(s.raw), tb);
    const dump = G.pyJsonDumps(G.decodedToSpec(d), 1);
    if (dump === s.dump) good();
    else {
      bad('spec #' + i);
      let k = 0; while (dump[k] === s.dump[k]) k++;
      console.log('    JS: …' + dump.slice(Math.max(0, k - 60), k + 80) + '\n    PY: …' + s.dump.slice(Math.max(0, k - 60), k + 80));
    }
  }
  // 2. diff_presets
  console.log('diff_presets');
  let nonEmpty = 0;
  for (const [i, c] of exp.diffs.entries()) {
    const a = G.decodePrst(hex2u8(c.a), tb), b = G.decodePrst(hex2u8(c.b), tb);
    const got = G.diffPresets(a, b);
    if (c.diff.length) nonEmpty++;
    eq(JSON.stringify(got), JSON.stringify(c.diff), 'diff #' + i);
  }
  console.log('  (' + nonEmpty + ' diffs non vides)');
  // 3. refine()
  console.log('refine');
  for (const [i, sc] of exp.refine.entries()) {
    const script = sc.script.slice();
    const calls = [];
    const hooks = {
      template, now: new Date(2026, 9, 4, 14, 5, 9),
      log: () => {}, t: (k, ...a) => k + ':' + a.join('|'),
      callApi: async (cfg, system, msgs) => {
        calls.push({ system, msgs: JSON.parse(JSON.stringify(msgs)) });
        if (!script.length) throw new Error('IndexError');
        return { text: script.shift(), truncated: false };
      },
    };
    const cfg = { provider: 'gemini', maxRetries: sc.cfg.max_retries, lang: sc.lang };
    let res, err;
    const lbl = 'scenario #' + i + ' (' + sc.mode + ')';
    try { res = await G.refine(cfg, tb, { name: sc.name, raw: hex2u8(sc.raw) }, sc.instr, bundle.prompts, hooks, sc.mode); } catch (e) { err = e; }
    if (sc.error) { err ? good() : bad(lbl + ' devait lever ' + sc.error); }
    else if (err) { bad(lbl + ' exception ' + err.stack); continue; }
    eq(calls.length, sc.calls.length, lbl + ' nb appels');
    sc.calls.forEach((c, k) => {
      if (!calls[k]) return;
      eq(calls[k].system === c.system, true, lbl + ' system #' + k);
      eq(JSON.stringify(calls[k].msgs), JSON.stringify(c.msgs), lbl + ' messages #' + k);
    });
    if (sc.error) continue;
    eq(res.folder.replace(/ - \d{8} - \d{6}$/, ''), sc.folder.replace(/ - \d{8} - \d{6}$/, ''), lbl + ' dossier');
    eq(res.filename, sc.filename, lbl + ' fichier');
    eq(Buffer.from(res.raw).toString('hex'), sc.hex, lbl + ' octets');
    eq(JSON.stringify(res.diff), JSON.stringify(sc.diff), lbl + ' diff');
    eq(JSON.stringify(res.payload), JSON.stringify(sc.payload), lbl + ' payload');
  }
  // 4. carryOver : CTRL + volume patch recopies, checksum valide
  console.log('carryOver');
  for (const raw of exp.refine.filter(r => r.hex).slice(0, 10).map(r => hex2u8(r.raw))) {
    const src = Uint8Array.from(raw);
    G.writeCtrl(src, { 1: ['AMP', 'DLY'], 4: ['RVB'], 8: ['WAH', 'MOD', 'DST'] });
    src[0x38] = 77;
    const r = exp.refine.find(x => x.hex && x.raw === Buffer.from(raw).toString('hex'));
    const out = G.carryOver(src, hex2u8(r.hex));
    const rc = G.readCtrl(out), sc2 = G.readCtrl(src);
    eq(JSON.stringify(rc), JSON.stringify(sc2), 'ctrl recopie');
    eq(out[0x38], 77, 'patch vol');
    eq(G.decodePrst(out, tb).checksum.valid, true, 'checksum');
    // le reste (hors zone CTRL, vol, checksum) est inchange
    const ref = hex2u8(r.hex); let diffs = 0;
    for (let k = 0; k < 1224; k++) if (out[k] !== ref[k] && !(k >= 0x3b8) && k !== 0x38) diffs++;
    eq(diffs, 0, 'octets hors CTRL inchanges');
  }
  console.log('patchParam / patchOn');
  for (const c of exp.patches) {
    const raw = hex2u8(c.raw);
    for (const op of c.ops) { if (op[0] === 'p') G.patchParam(raw, op[1], op[2], op[3]); else G.patchOn(raw, op[1], op[2]); }
    eq(Buffer.from(raw).toString('hex'), c.hex, 'patch octets');
  }
  console.log('replaceRecord');
  for (let i = 0; i < 20; i++) {
    const a = hex2u8(exp.patches[i].raw), b = hex2u8(exp.patches[(i + 7) % exp.patches.length].hex), k = i % 11;
    const out = G.replaceRecord(Uint8Array.from(a), b, k);
    const da = G.decodePrst(a, tb), db = G.decodePrst(b, tb), dout = G.decodePrst(out, tb);
    const slot = G.MODULES[k];
    eq(JSON.stringify(dout.modules[slot]), JSON.stringify(db.modules[slot]), 'record remplace');
    eq(G.MODULES.filter(m => m !== slot).every(m => JSON.stringify(dout.modules[m]) === JSON.stringify(da.modules[m])), true, 'autres modules intacts');
    eq(dout.checksum.valid, true, 'checksum');
  }
  console.log('modelsForSlot');
  for (const sl of G.MODULES) {
    const got = tb.modelsForSlot(sl).map(([m, cat]) => [m.name, cat, cat === 10 ? m.model_id : m.id]);
    eq(JSON.stringify(got), JSON.stringify(exp.mfs[sl]), 'modelsForSlot ' + sl);
  }
  console.log('setCtrl');
  for (const c of exp.ctrls) {
    const out = G.setCtrl(hex2u8(c.raw), c.spec);
    eq(Buffer.from(out).toString('hex'), c.hex, 'setCtrl octets');
    eq(JSON.stringify(G.readCtrl(out)), JSON.stringify(c.read), 'readCtrl');
    eq(G.decodePrst(out, tb).checksum.valid, true, 'setCtrl checksum');
  }
  console.log('\n=== refine : ' + pass + ' OK, ' + fail + ' echecs ===');
  process.exit(fail ? 1 : 0);
})();
