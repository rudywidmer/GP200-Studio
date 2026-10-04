const fs = require('fs');
const L = require('../web/src/gp200lufs.js');
const exp = JSON.parse(fs.readFileSync(__dirname + '/expected_lufs.json', 'utf8'));
const buf = fs.readFileSync(__dirname + '/lufs_signals.f32');
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
let ok = 0, fail = 0, worst = 0;
function chk(c, msg) { if (c) ok++; else { fail++; console.log('FAIL', msg); } }
const sigs = {};
for (const s of exp.signals) {
  const x = f32.subarray(s.offset, s.offset + s.n); sigs[s.name] = x;
  let v, err = null;
  try { v = L.integratedLoudness(Float64Array.from(x), s.rate); } catch (e) { err = e.message; }
  if (s.err) { chk(err !== null, s.name + ' devait lever'); continue; }
  chk(err === null, s.name + ' leve ' + err);
  if (s.lufs === '-inf') chk(v === -Infinity, s.name + ' -inf obtenu ' + v);
  else if (s.lufs === 'nan') chk(Number.isNaN(v), s.name + ' nan');
  else { const d = Math.abs(v - s.lufs); worst = Math.max(worst, d); chk(d < 1e-9, `${s.name} js=${v} py=${s.lufs}`); }
}
for (const c of exp.engine) {
  const x = sigs[c.name], e = new L.LufsEngine(null, 44100);
  let i = 0;
  for (let k = 0; k + c.blk <= x.length; k += c.blk, i++) {
    const r = e.feed(x.subarray(k, k + c.blk));
    for (let q = 0; q < 3; q++) {
      const a = r[q], b = c.steps[i][q];
      if (a === null || b === null) chk(a === b, `${c.name} step ${i} q${q}: ${a} vs ${b}`);
      else { const d = Math.abs(a - b); worst = Math.max(worst, d); chk(d < 1e-9, `${c.name} step ${i} q${q}: ${a} vs ${b}`); }
    }
  }
}
// reset
{ const e = new L.LufsEngine(null, 44100); const x = sigs['sine1k_0dB_44100'];
  for (let k = 0; k + 4410 <= x.length; k += 4410) e.feed(x.subarray(k, k + 4410));
  e.reset(); const r = e.feed(x.subarray(0, 4410)); chk(r[0] === null && r[2] === null, 'reset -> null'); }
console.log(`${ok} OK / ${fail} echecs  (ecart max ${worst.toExponential(2)} LU)`);
process.exit(fail ? 1 : 0);
