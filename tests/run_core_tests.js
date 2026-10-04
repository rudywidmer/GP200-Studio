#!/usr/bin/env node
/* Rejoue le corpus genere par make_expected.py (code PYTHON = verite) sur gp200core.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../web/src/gp200core.js');

const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));
const REF = path.join(__dirname, '..', 'ref', 'data');
const tb = new G.Tables({
  models: JSON.parse(fs.readFileSync(path.join(REF, 'gp200_models_all.json'), 'utf8')),
  cabs: JSON.parse(fs.readFileSync(path.join(REF, 'gp200_cabs.json'), 'utf8')),
  desc: JSON.parse(fs.readFileSync(path.join(REF, 'gp200_descriptions.json'), 'utf8')),
});
const template = new Uint8Array(Buffer.from(exp.template_b64, 'base64'));
const hex = u8 => Buffer.from(u8).toString('hex');

let pass = 0, fail = 0;
const fails = {};
function ok(group, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  (fails[group] = fails[group] || []).push(typeof detail === 'function' ? detail() : detail);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. encode / check_names / decode / patch_vol -------------------------------
exp.cases.forEach((c, i) => {
  const o = { keepAssignments: c.opts.keep_assignments, strict: c.opts.strict, fillEmptySlots: c.opts.fill_empty_slots };
  let got;
  try {
    const r = G.encodePrst(JSON.parse(JSON.stringify(c.spec)), tb, template, o);
    got = { raw: hex(r.raw), warnings: r.warnings, bytes: r.raw };
  } catch (e) { got = { error: e.message }; }
  const e = c.expected;
  if (e.raw !== undefined) {
    ok('encode.raw', got.raw === e.raw, () => 'case ' + i + ' ' + (got.error || firstDiff(got.raw, e.raw)));
    ok('encode.warnings', same(got.warnings, e.warnings), () => 'case ' + i + ' ' + JSON.stringify([got.warnings, e.warnings]).slice(0, 300));
    if (got.bytes) {
      const d = G.decodePrst(got.bytes, tb);
      const dd = JSON.parse(JSON.stringify(d)); delete dd.patch_vol; delete dd.file;
      const pd = JSON.parse(JSON.stringify(c.decoded)); delete pd.file;
      ok('decode', same(dd, pd), () => 'case ' + i + ' ' + diffObj(dd, pd));
      const [pv, n] = G.applyPatchVol(got.bytes);
      ok('patchvol', hex(pv) === c.patchvol.raw && n === c.patchvol.pv, () => 'case ' + i);
    }
  } else {
    ok('encode.error', got.error !== undefined && (c.expected.etype !== 'ValueError' || got.error === e.error),
      () => 'case ' + i + ' JS=' + JSON.stringify(got.error || 'NO ERROR') + ' PY=' + JSON.stringify(e.error));
  }
  let cn;
  try { cn = G.checkNames(tb, JSON.parse(JSON.stringify(c.spec))); } catch (e2) { cn = 'EXC ' + e2.message; }
  ok('check_names', same(cn, c.check_names), () => 'case ' + i + ' ' + JSON.stringify([cn, c.check_names]).slice(0, 600));
});

// 2. check_sections ----------------------------------------------------------
exp.payloads.forEach((p, i) => {
  if (p.error) return;
  let np, r;
  try {
    np = G.normalizePayload(JSON.parse(JSON.stringify(p.payload)));
    ok('normalize', same(np, p.norm), () => 'payload ' + i);
    r = G.checkSections(tb, np);
  } catch (e) { r = ['EXC ' + e.message, []]; }
  ok('check_sections.errs', same(r[0], p.errs), () => 'payload ' + i + ' ' + JSON.stringify([r[0], p.errs]).slice(0, 500));
  ok('check_sections.warns', same(r[1], p.warns), () => 'payload ' + i + ' ' + JSON.stringify([r[1], p.warns]).slice(0, 500));
});

// 3. extract_json ------------------------------------------------------------
const KNOWN_DIVERGENCE = new Set(['{"a": NaN}']);   // json.loads accepte NaN, JSON.parse non (jamais emis par un LLM)
exp.extract_json.forEach(c => {
  if (KNOWN_DIVERGENCE.has(c.in)) return;
  let r;
  try { r = { out: G.extractJson(c.in) }; } catch (e) { r = { error: e.name }; }
  if (c.error) ok('extract_json', r.error !== undefined, () => JSON.stringify(c.in) + ' devait echouer');
  else ok('extract_json', same(r.out, c.out), () => JSON.stringify(c.in) + ' ' + JSON.stringify([r, c.out]));
});

// 4. noms de fichiers / forced prompt ---------------------------------------
exp.misc.safe_filename.forEach(([a, b]) => ok('safe_filename', G.safeFilename(a) === b, () => JSON.stringify([a, G.safeFilename(a), b])));
exp.misc.safe_dirname.forEach(([a, b]) => ok('safe_dirname', G.safeDirname(a) === b, () => JSON.stringify([a, G.safeDirname(a), b])));
const HINT = { clean: "son clair : pas de DST, gain d'ampli bas", crunch: 'crunch : ampli en limite de saturation, gain moyen',
  disto: 'sature : le gain vient de l\'ampli', lead: 'solo : boost devant, mediums remontes pour percer, souvent un delay' };
exp.misc.forced.forEach(([r, s]) => ok('forced_prompt', G.forcedPrompt(r, HINT) === s, () => JSON.stringify([r, G.forcedPrompt(r, HINT), s])));

// 5. difflib -----------------------------------------------------------------
exp.difflib.forEach((c, i) => {
  const r = G.closeMatches(c.w, exp.pools[c.pool], c.n, c.c);
  ok('difflib', same(r, c.out), () => JSON.stringify([c.w, c.pool, c.n, c.c, r, c.out]));
});

// 6. %g / round / repr -------------------------------------------------------
exp.fmtg.forEach(([v, s]) => ok('fmtG', G.fmtG(v) === s, () => JSON.stringify([v, G.fmtG(v), s])));
exp.round.forEach(([v, s]) => ok('pyRound', G.pyRound(v) === s, () => JSON.stringify([v, G.pyRound(v), s])));
exp.repr.forEach(([v, s]) => ok('pyRepr', G.pyRepr(v) === s, () => JSON.stringify([v, G.pyRepr(v), s])));

// 7. PKCE --------------------------------------------------------------------
(async () => {
  try {
    const nodeCrypto = require('crypto');
    const h = nodeCrypto.createHash('sha256').update(exp.pkce.verifier).digest();
    ok('pkce.b64url', G.b64url(new Uint8Array(h)) === exp.pkce.challenge, () => G.b64url(new Uint8Array(h)));
    const p = await G.makePkce();
    const chk = nodeCrypto.createHash('sha256').update(p.verifier).digest();
    ok('pkce.makePkce', G.b64url(new Uint8Array(chk)) === p.challenge && /^[A-Za-z0-9_-]{43,128}$/.test(p.verifier), () => JSON.stringify(p));
  } catch (e) { ok('pkce', false, () => 'EXC ' + e.stack); }

  // 8. zip ------------------------------------------------------------------
  const entries = [
    { name: 'Artiste - Titre/1_Intro/test_A.prst', data: template },
    { name: 'Artiste - Titre/1_Intro/été.txt', data: new Uint8Array(Buffer.from('héllo wörld\n'.repeat(500))) },
    { name: 'Artiste - Titre/vide.txt', data: new Uint8Array(0) },
  ];
  const z = G.buildZip(entries, new Date(Date.UTC(2026, 9, 4, 12, 34, 56)));
  fs.writeFileSync(path.join(__dirname, 'out_test.zip'), Buffer.from(z));
  fs.writeFileSync(path.join(__dirname, 'out_test.zip.json'), JSON.stringify(entries.map(e => ({ name: e.name, hex: hex(e.data) }))));

  console.log('\n=== Resultat : ' + pass + ' OK, ' + fail + ' echecs ===');
  for (const g of Object.keys(fails)) {
    console.log('\n[' + g + '] ' + fails[g].length + ' echec(s)');
    fails[g].slice(0, 4).forEach(d => console.log('  - ' + String(d).slice(0, 700)));
  }
  process.exit(fail ? 1 : 0);
})();

function firstDiff(a, b) {
  if (!a || !b) return 'absent';
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) if (a.slice(i, i + 2) !== b.slice(i, i + 2)) return 'octet ' + (i / 2) + ': JS ' + a.slice(i, i + 2) + ' PY ' + b.slice(i, i + 2);
  return 'longueur';
}
function diffObj(a, b, p) {
  p = p || '';
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b ? '' : p + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diffObj(a[k], b[k], p + '.' + k); if (d) return d; }
  return '';
}
