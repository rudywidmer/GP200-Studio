const fs = require('fs'), crypto = require('crypto');
const G = require('../web/src/gp200core.js');
const T = require('../web/src/gp200tune.js');
const bundle = JSON.parse(fs.readFileSync(__dirname + '/bundle.json', 'utf8'));
const exp = JSON.parse(fs.readFileSync(__dirname + '/expected_tune.json', 'utf8'));
const tables = new G.Tables(bundle.tables || bundle);
let ok = 0, fail = 0;
function chk(c, msg) { if (c) ok++; else { fail++; if (fail < 25) console.log('FAIL', msg); } }
const unhex = h => new Uint8Array(Buffer.from(h, 'hex'));
const sha = u => crypto.createHash('sha1').update(Buffer.from(u)).digest('hex');
const close = (a, b) => (a === b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
const eqv = (a, b) => Array.isArray(a) ? (Array.isArray(b) && a.length === b.length && a.every((x, i) => eqv(x, b[i]))) : close(a, b);

// 1. analyse
for (const c of exp.analysis) {
  const e = T.makeEntry('x', unhex(c.raw), 'NORMAL'); T.analyze(e, tables);
  const f = c.f;
  const got = { amp_idx: e.ampIdx, cab_idx: e.cabIdx, amp_name: e.ampName, amp_param_idx: e.ampParamIdx, amp_vol_orig: e.ampVolOrig,
    amp_gain_param_idx: e.ampGainParamIdx, amp_gain_orig: e.ampGainOrig, cab_vol_orig: e.cabVolOrig, patch_vol_orig: e.patchVolOrig };
  for (const k of Object.keys(got)) chk(eqv(got[k], f[k]), `analyse ${c.amp} ${k}: js=${got[k]} py=${f[k]}`);
  chk(e.cabVolParamIdx === 1, 'cab volume slot=1 (py=' + f.cab_vol_param_idx + ') ' + c.amp);
}

// 2. scenarios dynamiques
const STAT = { ticks: 0, calls: 0, applied: 0 };
exp.dyn.forEach((sc, si) => {
  const e = T.makeEntry('x', unhex(sc.raw), sc.ptype); T.analyze(e, tables);
  if (sc.strip.includes('amp')) { e.ampParamIdx = e.ampVolOrig = e.ampVolInitial = e.ampVolNew = null; }
  if (sc.strip.includes('gain')) { e.ampGainParamIdx = e.ampGainOrig = e.ampGainInitial = e.ampGainNew = null; }
  if (sc.strip.includes('cab')) { e.cabVolParamIdx = e.cabVolOrig = e.cabVolInitial = e.cabVolNew = null; }
  const t = new T.Tuner(e); t.load(sc.t0);
  const ctx = { usb: sc.usb, busy: false };
  sc.trace.forEach((st, i) => {
    const w = `scen ${si} tick ${i}`;
    if (st.ev === 'resend') { t.resend(st.t); return; }
    const out = t.update(st.t, st.itg, ctx);
    STAT.ticks++;
    const hint = out.hint === undefined ? '-' : [out.hint.key, out.hint.args];
    chk(eqv(hint, st.hint) || (hint === '-' && st.hint === '-'), `${w} hint js=${JSON.stringify(hint)} py=${JSON.stringify(st.hint)}`);
    if (st.delta === '-') chk(out.delta === null || out.delta === undefined || st.itg === null, w + ' delta absent');
    else if (st.delta.trim() === '---') chk(out.delta === null, w + ' delta ---');
    else chk(out.delta !== null && Math.abs(parseFloat(st.delta) - out.delta) <= 0.0501, `${w} delta js=${out.delta} py=${st.delta}`);
    const calls = out.action ? [out.action.type === 'patch' ? ['patch', out.action.value] : ['param', out.action.module, out.action.param, out.action.value]] : [];
    chk(eqv(calls, st.calls), `${w} actions js=${JSON.stringify(calls)} py=${JSON.stringify(st.calls)}`);
    STAT.calls += calls.length; STAT.applied += out.applied ? 1 : 0;
    chk(out.applied === st.applied, `${w} applied js=${out.applied} py=${st.applied}`);
    const p = st.entry;
    const mine = { patch_vol_new: e.patchVolNew, patch_vol_orig: e.patchVolOrig, amp_vol_new: e.ampVolNew, amp_vol_orig: e.ampVolOrig,
      amp_gain_new: e.ampGainNew, amp_gain_orig: e.ampGainOrig, cab_vol_new: e.cabVolNew, cab_vol_orig: e.cabVolOrig,
      status: e.status, tweak_count: e.tweakCount, lufs_ok: e.lufsOk };
    for (const k of Object.keys(mine)) chk(eqv(mine[k], p[k]), `${w} entry.${k} js=${mine[k]} py=${p[k]}`);
    chk(sha(e.data) === p.data, `${w} octets du preset`);
  });
});
console.log(`=== tune : ${ok} OK, ${fail} echecs  (${exp.analysis.length} amplis, ${exp.dyn.length} scenarios, ${STAT.ticks} pas, ${STAT.calls} reglages, ${STAT.applied} validations) ===`);
process.exit(fail ? 1 : 0);
