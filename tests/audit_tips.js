#!/usr/bin/env node
/* Audit des info-bulles : parcourt l'interface dans tous ses etats (Chromium + fausse pedale + faux Gemini) et liste
   les controles / indicateurs SANS attribut title. Sortie : un recapitulatif ; code de sortie 1 s'il en reste (--strict). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'tests', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const G = require('../web/src/gp200core.js'), U = require('../web/src/gp200usb.js');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
const tb = new G.Tables(bundle.tables);
const template = new Uint8Array(Buffer.from(bundle.template, 'base64'));
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const SC = exp.find(x => x.name === 'clean_pass');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const hex = b => Buffer.from(b).toString('hex');
const eqBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// ---- le preset de depart : un des presets Python, avec une table CTRL et un patch volume non triviaux
const src = Uint8Array.from(Buffer.from(SC.files[0].hex, 'hex'));
G.setCtrl(src, { 1: ['AMP'] });
const srcRaw = G.setCtrl(src, { 1: ['AMP', 'DLY'], 2: ['PRE'] }); srcRaw[G.OFF_PATCH_VOL] = 77;
G.patchOn(srcRaw, 0, true);                                  // recalcule le checksum
const srcDec = G.decodePrst(srcRaw, tb);

// ---- la reponse de l'IA : on modifie un parametre + on coupe un module
const spec = G.plainSpec(G.decodedToSpec(srcDec));
let changedSlot = null, changedParam = null;
for (const sl of G.MODULES) {
  const m = spec.modules[sl];
  if (m && m.params && Object.keys(m.params).length && !changedSlot && sl !== 'CAB') {
    const k = Object.keys(m.params)[0], p = tb.paramsOf(srcDec.modules[sl].model_id, srcDec.modules[sl].category).find(x => x.name === k);
    m.params[k] = m.params[k] + (m.params[k] + 5 <= Math.max(p.min, p.max) ? 5 : -5); changedSlot = sl; changedParam = k;
  }
}
spec.name = 'Refined';
if (G.checkNames(tb, spec).length) throw new Error('spec de test invalide : ' + G.checkNames(tb, spec));
const payload = { analyse: 'Le son est trop sourd.', changements: ['Gain +5', 'nom change'], avertissements: 'Attention au volume', spec };
const encd = G.encodePrst(spec, tb, template);
const expectedRefined = G.carryOver(srcRaw, encd.raw);
const expectedDiff = G.diffPresets(srcDec, G.decodePrst(encd.raw, tb));

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
const gemini = text => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }) });

const INIT = `(() => {
  window.__midi = { sent: [], closes: 0, opens: 0 };
  const input = { id: 'in1', name: 'GP-200', state: 'connected', type: 'input', onmidimessage: null, open: async () => input, close: async () => {} };
  const output = { id: 'out1', name: 'GP-200', state: 'connected', type: 'output',
    open: async () => { window.__midi.opens++; return output; }, close: async () => { window.__midi.closes++; },
    send(d) { const b = Array.from(d); window.__midi.sent.push(b);
      if (b.length === 30 && b[8] === 0x12 && b[9] === 0x08 && input.onmidimessage) input.onmidimessage({ data: Uint8Array.from([0xF0].concat(Array.from({ length: 40 }, (_, i) => i), [0xF7])) });
      // comme la vraie pedale (audit du 04/10) : un changement d'effet est confirme par un SysEx 12/0C ([22] = module, [29]<<4|[30] = modele, [-2] = categorie) ;
      // un changement d'ampli fait d'abord charger sa baffle par defaut (module 5, categorie 10). confirm : 'on' | 'never' | 'dropFirst'
      if (b.length === 54 && b[8] === 0x12 && b[9] === 0x14 && input.onmidimessage) {
        const mm = window.__midi, mode = mm.confirm || 'on';
        mm.effects = (mm.effects || 0) + 1;
        const drop = mode === 'never' || (mode === 'dropFirst' && !mm.dropped && (mm.dropped = true));
        const fr = (mod, mid, cat) => { const f = new Array(54).fill(0); f[0] = 0xF0; [0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32].forEach((v, i) => { f[1 + i] = v; }); f[8] = 0x12; f[9] = 0x0C; f[22] = mod; f[29] = mid >> 4; f[30] = mid & 15; f[52] = cat; f[53] = 0xF7; return Uint8Array.from(f); };
        if (!drop) setTimeout(() => { if (b[38] === 3) input.onmidimessage({ data: fr(5, 0, 10) }); input.onmidimessage({ data: fr(b[38], (b[45] << 4) | b[46], b[52]) }); }, mm.delay || 120);
      } } };
  window.__midi.notify = d => { if (!input.onmidimessage) return false; input.onmidimessage({ data: Uint8Array.from(d) }); return true; };
  const mk = (...p) => ({ forEach: f => p.forEach(f), get: id => p.find(x => x.id === id), get size() { return p.length; } });
  navigator.requestMIDIAccess = async () => ({ outputs: mk(output), inputs: mk(input), onstatechange: null, sysexEnabled: true });
})();`;

async function closeSlot(page) { if (await page.locator('#slot-close').count()) await page.click('#slot-close'); }
async function openTab(page, t) { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); await page.click('#tabbtn-' + t); }
async function closePop(page) { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); }
async function newPage(browser, viewport, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [], requests = [];
  page.on('console', m => { if (/^INJ/.test(m.text())) console.log('    ' + m.text().slice(0,200)); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.addInitScript(INIT);
  // l'ecoute de la pedale garde le port ouvert : les anciens scenarios (liaison ouverte a la demande) la coupent, le groupe 8f l'active
  await page.addInitScript(`try { if (!localStorage.getItem('gp200studio.web.v1')) localStorage.setItem('gp200studio.web.v1', JSON.stringify({ listen: ${opts.listen ? 'true' : 'false'} })); } catch (e) {}`);
  if (opts.granted) await page.addInitScript("navigator.permissions.query = async () => ({ state: 'granted' });");
  let reply = JSON.stringify(payload);
  page.__setReply = t => { reply = t; };
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('data:')) return route.continue();
    if (/generateContent/.test(url)) { requests.push(route.request().postData()); return route.fulfill(gemini(reply)); }
    return route.abort();
  });
  return { page, problems, requests, ctx };
}
const upload = async (page, buf, name) => { await page.setInputFiles('#prst-file', { name: name || 'mon preset.prst', mimeType: 'application/octet-stream', buffer: Buffer.from(buf) }); await page.waitForTimeout(120); };
async function downloadOne(page) {
  await closePop(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-one')]);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
}
const setRange = (page, i, v) => page.evaluate(([i, v]) => { const el = document.querySelectorAll('#module-box input[type=range]')[i]; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [i, v]);
const sentOf = page => page.evaluate(() => window.__midi.sent);
const note = page => page.locator('#status-note').innerText();
const pyMsg = code => JSON.parse(cp.execSync(`python3 - <<'PY'
import sys, json; sys.path.insert(0, '${ROOT}/ref')
import gp200_usb as U
print(json.dumps(list(${code})))
PY`).toString());
async function withKey(page) {            // premiere visite : la fenetre de connexion s'ouvre d'elle-meme
  await page.waitForSelector('#setup-modal');
  await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef'); await page.click('#setup-ok');
}
async function waitInjected(pg, max) {      // fait avancer l'horloge simulee jusqu'a la fin de l'injection (auto ou manuelle)
  for (let i = 0; i < (max || 300); i++) {
    await pg.clock.runFor(100);
    const st = await pg.evaluate(() => ({ b: __gp200.state.inj.busy, m: __gp200.state.inj.msg, t: __gp200.state.inj.t, e: __gp200.state.inj.err }));
    if (!st.b && !st.t && (/Injecté|Injected/.test(st.m) || st.e)) return true;
  }
  return false;
}
/** Trames d'une injection : handshake (la fausse pedale l'acquitte), 7 morceaux, puis Bank Select + Program Change. */
function injFrames(raw, bank, letter) {
  const pc = U.slotToPc(bank, letter);
  return [Array.from(U.buildHandshakeSysex(pc))].concat(U.buildSysexChunks(raw, pc).map(m => Array.from(m)), U.selectMessages(bank, letter).map(m => Array.from(m)));
}
async function chooseSlot(pg, bank, letter, auto) {
  if (!(await pg.locator('#inj-panel').count())) await pg.click('#slot-chip');
  await pg.selectOption('#inj-bank', String(bank)); await pg.selectOption('#inj-letter', letter);
  if (auto !== undefined && (await pg.locator('#inj-auto').isChecked()) !== auto) await pg.locator('#inj-auto').click();
  await pg.click('#inj-ok');
}
const libCount = page => page.locator('.lib-entry').count();


const found = new Map();
const COLLECT = () => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const out = [];
  const sel = 'button, input, select, textarea, summary, a[href], [role=button], [role=tab], [role=switch]';
  document.querySelectorAll(sel).forEach(el => {
    if (el.id === 'prst-file' || !vis(el)) {
      if (!(el.type === 'checkbox' && el.closest('label.switch'))) return;
    }
    const tip = el.getAttribute('title') || (el.closest('label[title], summary[title], .switch[title]') || {}).title;
    if (tip) return;
    const lab = el.closest('label');
    out.push({ kind: 'ctl', tag: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? '[' + el.type + ']' : ''), id: el.id || '', cls: (el.className && el.className.baseVal === undefined ? el.className : '').slice(0, 40),
      txt: ((el.innerText || el.value || '') + '').replace(/\s+/g, ' ').trim().slice(0, 40), aria: el.getAttribute('aria-label') || '', lab: lab ? lab.innerText.replace(/\s+/g, ' ').trim().slice(0, 40) : '' });
  });
  const info = '.badge, .mstate, .chip-st, .count, .meter, .gauge, .pled, .vfile, .sdot, .tcur, .pstate, .tmv, .pn';
  document.querySelectorAll(info).forEach(el => {
    if (!vis(el) || el.getAttribute('title') || el.closest('[title]')) return;
    out.push({ kind: 'info', tag: el.tagName.toLowerCase(), id: el.id || '', cls: (el.className + '').slice(0, 40), txt: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), aria: el.getAttribute('aria-label') || '', lab: '' });
  });
  return out;
};
async function snap(page, label) {
  const list = await page.evaluate(COLLECT);
  for (const x of list) {
    const key = [x.kind, x.tag, x.id || (x.cls + '|' + (x.txt.length > 25 && /\d/.test(x.txt) ? '' : x.txt)), x.aria].join('~');
    if (!found.has(key)) found.set(key, Object.assign({ where: label }, x));
  }
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const strict = process.argv.includes('--strict');
  for (const lang of ['fr', 'en']) {
    const { page, problems } = await newPage(browser, { width: 1280, height: 1000 }, { listen: true });
    await page.addInitScript(`try { const k='gp200studio.web.v1'; const o = JSON.parse(localStorage.getItem(k) || '{}'); o.lang='${lang}'; localStorage.setItem(k, JSON.stringify(o)); } catch (e) {}`);
    await page.goto(base);
    await page.waitForSelector('#setup-modal');
    await snap(page, 'reglages (1re visite)');
    // autres fournisseurs
    for (const prov of await page.locator('#provider option').evaluateAll(o => o.map(x => x.value))) { await page.selectOption('#provider', prov); await snap(page, 'reglages / ' + prov); }
    await page.selectOption('#provider', 'gemini');
    await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef');
    await page.click('#setup-ok'); await page.waitForTimeout(150);
    await snap(page, 'accueil (nouveau morceau)');
    // options de generation
    for (const d of await page.locator('details > summary').all()) { try { await d.click({ timeout: 800 }); } catch (e) { /* */ } }
    await snap(page, 'accueil + options deployees');
    await page.click('#batch-btn'); await snap(page, 'batch sans preset (formulaire)');
    await page.click('#pop-close');
    await page.click('#mode-refine'); await snap(page, 'mode affiner sans fichier');
    await page.click('#mode-new');
    // generation (faux Gemini) -> resultat a 3 variantes
    await page.fill('#demande', 'Enter Sandman - Metallica'); page.__setReply(JSON.stringify(payload));
    // ouvrir un .prst
    await upload(page, srcRaw, 'mon preset.prst'); await snap(page, 'preset ouvert (rack + module)');
    await page.click('#mode-refine'); await snap(page, 'mode affiner avec fichier');
    // chaque module du rack : 1er clic = selection
    const nslots = await page.locator('.sbtn:not(:disabled)').count();
    for (let i = 0; i < nslots; i++) { await page.locator('.sbtn:not(:disabled)').nth(i).click(); await snap(page, 'module #' + i); }
    for (const t of ['result', 'pedal', 'ctrl', 'tune']) { await openTab(page, t); await snap(page, 'fenetre ' + t + ' (hors ligne)'); await closePop(page); }
    // affiner (resultat)
    await page.fill('#instr', 'plus de gain'); await page.click('#go-refine').catch(() => {}); await page.waitForTimeout(600);
    await snap(page, 'apres affinage'); await openTab(page, 'result'); await snap(page, 'fenetre resultat apres affinage'); await closePop(page);
    if (await page.locator('#tabbtn-log').count()) { await openTab(page, 'log'); await snap(page, 'fenetre journal'); await closePop(page); }
    // pedale
    await page.click('#pedal-chip'); await page.waitForTimeout(400);
    await snap(page, 'pedale : demande de connexion / dialogue slot');
    await closeSlot(page); await page.waitForTimeout(200);
    await snap(page, 'pedale connectee (sans slot confirme)');
    await page.click('#slot-chip').catch(() => {}); await snap(page, 'dialogue slot de travail');
    await page.selectOption('#inj-bank', '5').catch(() => {}); await page.selectOption('#inj-letter', 'B').catch(() => {}); await page.click('#inj-ok').catch(() => {});
    await page.waitForTimeout(800); await snap(page, 'pedale connectee + slot choisi');
    await page.click('#slot-chip').catch(() => {}); await snap(page, 'panneau slot (reglage)'); await closeSlot(page);
    for (const t of ['result', 'pedal', 'ctrl', 'tune', 'log']) { if (!(await page.locator('#tabbtn-' + t).count())) continue; await openTab(page, t); await page.waitForTimeout(150); await snap(page, 'fenetre ' + t + ' (pedale connectee)'); await closePop(page); }
    // module en direct : parcourir les modules avec la pedale
    const ns = await page.locator('.sbtn:not(:disabled)').count();
    for (let i = 0; i < ns; i++) { await page.locator('.sbtn:not(:disabled)').nth(i).click(); await snap(page, 'module #' + i + ' (pedale connectee)'); }
    // batch avec pedale
    await openTab(page, 'tune'); await page.click('#tune-open').catch(() => {}); await page.waitForTimeout(200); await snap(page, 'batch : formulaire (pedale connectee)');
    await page.click('#tune-audio').catch(() => {}); await page.waitForTimeout(300); await snap(page, 'batch : entree audio'); await closePop(page);
    // plusieurs presets dans la bibliotheque
    await upload(page, srcRaw, 'deuxieme.prst'); await snap(page, 'bibliotheque (2 presets)');
    // generation : resultat a 3 variantes par section
    page.__setReply(SC.script[0].text);
    await page.click('#mode-new'); await page.fill('#demande', 'Enter Sandman - Metallica'); await page.click('#go'); await page.waitForSelector('.slot.fresh .mname', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500); await snap(page, 'resultat genere (variantes)');
    for (const t of ['result', 'pedal', 'ctrl']) { await openTab(page, t); await snap(page, 'fenetre ' + t + ' (resultat genere)'); }
    await openTab(page, 'pedal');
    for (const id of ['#pedal-three', '#pedal-one']) { if (await page.locator(id).count()) { await page.click(id).catch(() => {}); await page.waitForTimeout(250); await snap(page, 'pedale : apres ' + id); } }
    if (await page.locator('#pd-log').count()) { await page.locator('#pd-log').click().catch(() => {}); await snap(page, 'pedale : journal ouvert'); }
    await closePop(page);
    // petit ecran
    await page.setViewportSize({ width: 390, height: 844 }); await snap(page, 'mobile');
    if (problems.length) console.log('  erreurs console :', problems.slice(0, 3));
    await page.context().close();
  }
  await browser.close(); server.close();
  const rows = Array.from(found.values());
  const groups = {};
  rows.forEach(r => { (groups[r.kind] = groups[r.kind] || []).push(r); });
  for (const k of Object.keys(groups)) {
    console.log('\n== ' + (k === 'ctl' ? 'CONTROLES sans info-bulle' : 'INDICATEURS sans info-bulle') + ' : ' + groups[k].length);
    groups[k].forEach(r => console.log('  - [' + r.where + '] ' + r.tag + (r.id ? '#' + r.id : '') + (r.cls ? ' .' + r.cls.replace(/\s+/g, '.') : '') + (r.txt ? ' « ' + r.txt + ' »' : '') + (r.aria ? ' aria=' + r.aria : '') + (r.lab ? ' label=' + r.lab : '')));
  }
  console.log('\n=== audit info-bulles : ' + rows.length + ' element(s) sans title ===');
  process.exit(strict && rows.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
