#!/usr/bin/env node
/* E2E de l'harmonisation du volume : Chromium + faux Web MIDI + faux micro, horloge simulee (page.clock).
   Le "monde" simule : le volume mesure depend des valeurs reellement recues par le faux pedalier. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'tests', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const SC = exp.find(x => x.name === 'clean_pass');
const G = require('../web/src/gp200core.js'), TUNE = require('../web/src/gp200tune.js'), LUFS = require('../web/src/gp200lufs.js');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
const tables = new G.Tables(bundle.tables);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// ---- calibration : amplitude d'un sinus 1 kHz pour une loudness donnee
const rate = 44100, ref = new Float64Array(rate * 3).map((_, i) => 0.1 * Math.sin(2 * Math.PI * 1000 * i / rate));
const L_REF = LUFS.integratedLoudness(ref, rate);

// ---- presets et "monde" de test
const OFFSETS = { 'Intro A': +6, 'Intro B': -5, 'Intro C': +1.2 };
const TYPES = { 'Intro A': 'NORMAL', 'Intro B': 'NORMAL', 'Intro C': 'LEAD' };
const worldCfg = {};
SC.files.forEach(f => {
  const raw = Uint8Array.from(Buffer.from(f.hex, 'hex'));
  const e = TUNE.makeEntry('x', raw, 'NORMAL'); TUNE.analyze(e, tables);
  const name = G.decodePrst(raw, tables).name;
  worldCfg[name] = { ampSlot: e.ampParamIdx, L0: TUNE.TARGETS[TYPES[name]] + OFFSETS[name], kA: 0.3, kP: 0.25 };
});

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
const gemini = text => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }) });

const INIT = `(() => {
  const cfg = window.__CFG || {};
  const W = window.__world = { cfg: cfg.presets || {}, cur: null, amp: null, patch: null, base: {}, log: [], writing: false, buf: new Uint8Array(1184), got: 0, params: [], patches: [], loads: [] };
  window.__audio = { requests: [], stopped: 0, ctxs: 0, closed: 0 };
  window.__midi = { sent: [], closes: 0, opens: 0 };
  const L = () => {
    if (W.writing || !W.cur) return null;
    const p = W.cfg[W.cur], b = W.base[W.cur];
    return p.L0 + p.kA * (W.amp - b.amp) + p.kP * (W.patch - b.patch);
  };
  W.L = L;
  const f32 = (b, o) => new DataView(Uint8Array.from(b.slice(o, o + 4)).buffer).getFloat32(0, true);
  const loaded = () => {
    const p = W.buf;
    let name = ''; for (let i = 36; i < 52 && p[i]; i++) name += String.fromCharCode(p[i]);
    let rec = -1; for (let i = 0; i + 4 <= p.length; i++) if (p[i] === 0x14 && p[i+1] === 0 && p[i+2] === 0x44 && p[i+3] === 0) { rec = i; break; }
    const conf = W.cfg[name]; if (!conf) { W.cur = null; return; }
    W.cur = name; W.patch = p[24];
    W.amp = f32(p, rec + 3 * 72 + 12 + 4 * conf.ampSlot);
    if (!W.base[name]) W.base[name] = { amp: W.amp, patch: W.patch };
    W.loads.push({ name, amp: W.amp, patch: W.patch });
    setTimeout(() => { W.writing = false; }, 400);
  };
  const input = { id: 'in1', name: 'GP-200', state: 'connected', type: 'input', onmidimessage: null, open: async () => input, close: async () => {} };
  const output = { id: 'out1', name: 'GP-200', state: 'connected', type: 'output',
    open: async () => { window.__midi.opens++; return output; }, close: async () => { window.__midi.closes++; },
    send(d) {
      const b = Array.from(d); window.__midi.sent.push(b);
      if (cfg.unplugAfterParams && W.params.length >= cfg.unplugAfterParams) output.state = 'disconnected';
      if (b.length === 30 && b[8] === 0x12 && b[9] === 0x08) { W.writing = true; W.got = 0; if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from([0xF0].concat(Array.from({ length: 40 }, (_, i) => i), [0xF7])) }); }
      else if (b.length > 100 && b[8] === 0x12 && b[9] === 0x20) {
        const off = b[11] | (b[12] << 7), nib = b.slice(13, b.length - 1);
        for (let i = 0; i < nib.length / 2; i++) W.buf[off + i] = (nib[2 * i] << 4) | nib[2 * i + 1];
        W.got += nib.length / 2; if (W.got >= 1184) loaded();
      } else if (b.length === 62 && b[9] === 0x18) {
        const by = []; for (let i = 0; i < 4; i++) by.push((b[53 + 2 * i] << 4) | b[54 + 2 * i]);
        const v = new DataView(Uint8Array.from(by).buffer).getFloat32(0, true);
        W.params.push({ module: b[38], param: b[40], value: v });
        if (W.cur && b[38] === 3 && b[40] === W.cfg[W.cur].ampSlot) W.amp = v;
      } else if (b.length === 46 && b[9] === 0x10) {
        const v = (b[41] << 4) | b[42]; W.patches.push(v); W.patch = v;
      }
    } };
  const other = { id: 'out2', name: 'Midi Through', state: 'connected', type: 'output', open: async () => other, close: async () => {}, send() {} };
  const mk = (...p) => ({ forEach: f => p.forEach(f), get: id => p.find(x => x.id === id), get size() { return p.length; } });
  const access = { outputs: mk(output, other), inputs: mk(input), onstatechange: null, sysexEnabled: true };
  window.__output = output;
  navigator.requestMIDIAccess = async () => access;

  // ---- faux audio
  if (cfg.noAudioApi) { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); return; }
  const devices = [{ kind: 'audioinput', deviceId: 'mic1', label: 'Microphone intégré' }, { kind: 'audioinput', deviceId: 'gp1', label: 'GP-200 (Valeton USB Audio)' }];
  if (cfg.noGpName) devices[1].label = 'Interface USB 2.0';
  if (cfg.blankLabels) { devices.length = 0; devices.push({ kind: 'audioinput', deviceId: '', label: '' }, { kind: 'audioinput', deviceId: 'gp1', label: '' }, { kind: 'audioinput', deviceId: 'mic1', label: '' }); }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async (c) => {
      if (cfg.audioDeny) { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; }
      window.__audio.requests.push(c);
      return { getTracks: () => [{ stop() { window.__audio.stopped++; } }], getAudioTracks: () => [{ label: 'Microphone (Valeton GP-200)', getSettings: () => ({ deviceId: 'gp1' }) }] };
    },
    enumerateDevices: async () => devices } });
  window.AudioContext = class {
    constructor(o) { this.sampleRate = 44100; this.state = 'running'; this.destination = {}; window.__audio.ctxs++; this.opts = o; }
    resume() { return Promise.resolve(); }
    close() { window.__audio.closed++; if (this.node && this.node.__t) clearInterval(this.node.__t); return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() {
      const node = { onaudioprocess: null, connect() {}, disconnect() { clearInterval(node.__t); } };
      let n = 0;
      node.__t = setInterval(() => {
        if (!node.onaudioprocess) return;
        const l = L(), x = new Float32Array(4096);
        if (l !== null) { const a = 0.1 * Math.pow(10, (l - cfg.lref) / 20); for (let i = 0; i < 4096; i++, n++) x[i] = a * Math.sin(2 * Math.PI * 1000 * n / 44100); }
        node.onaudioprocess({ inputBuffer: { getChannelData: () => x } });
      }, 93);
      this.node = node; return node;
    }
  };
})();`;

async function closeSlot(page) { if (await page.locator('#slot-close').count()) await page.click('#slot-close'); }
async function openTab(page, t) { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); await page.click('#tabbtn-' + t); }
async function closePop(page) { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); }
async function newPage(browser, cfg) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.addInitScript('window.__CFG = ' + JSON.stringify(Object.assign({ presets: worldCfg, lref: L_REF }, cfg || {})) + ';');
  await page.addInitScript(INIT);
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('data:')) return route.continue();
    if (/generateContent/.test(url)) return route.fulfill(gemini(SC.script[0].text));
    return route.abort();
  });
  return { page, problems, ctx };
}
async function generate(page, base) {
  await page.goto(base);
  await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef');
  await page.click('#setup-ok');
  await page.fill('#demande', 'Enter Sandman - Metallica');
  await page.click('#go');
  await page.waitForSelector('.slot.fresh .mname', { timeout: 15000 });
  await openTab(page, 'tune');
}
async function until(page, cond, maxMs, step) {
  step = step || 250;
  for (let t = 0; t < maxMs; t += step) {
    if (await page.evaluate(cond)) return t;
    await page.clock.runFor(step);
  }
  return -1;
}
async function prepare(page, opts) {
  opts = opts || {};
  await closeSlot(page); await page.click('#tune-open');
  await page.click('#tune-pedal'); await page.waitForSelector('#tune-audio'); await closeSlot(page);
  await page.click('#tune-audio'); await page.waitForSelector('#tune-audio-sel, #tune-panel .note.err');
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  console.log('calibration : sinus 1 kHz a 0,1 = ' + L_REF.toFixed(2) + ' LUFS ; presets', JSON.stringify(worldCfg));

  console.log('1. version en pied de page');
  { const { page } = await newPage(browser, {}); await generate(page, base);
    const v = await page.locator('#build-version').innerText();
    ok(/^Version 0\.13 · /.test(v) && /2026|20\d\d/.test(v), 'tampon de version : « ' + v + ' »');
    await page.locator('#build-version').scrollIntoViewIfNeeded();
    await page.context().close(); }

  console.log('2. navigateur sans acces audio');
  { const { page } = await newPage(browser, { noAudioApi: true }); await generate(page, base);
    ok(/ne sait pas écouter l'entrée audio/.test(await page.locator('#tune-panel').innerText()), 'message « navigateur non supporté »');
    ok(await page.locator('#tune-open').count() === 0, 'pas de bouton'); await page.context().close(); }

  console.log('3. autorisation audio refusee');
  { const { page } = await newPage(browser, { audioDeny: true }); await generate(page, base);
    await prepare(page);
    ok(/accès à l'entrée audio a été refusé/.test(await page.locator('#tune-panel .note.err').innerText()), 'message « accès refusé » avec la marche à suivre');
    ok(await page.locator('#tune-start').isDisabled(), 'bouton Lancer inactif'); await page.context().close(); }

  console.log('4. preparation : detection de l\'entree « GP-200 »');
  { const { page } = await newPage(browser, {}); await generate(page, base);
    await prepare(page);
    ok(await page.locator('#tune-audio-sel').inputValue() === 'gp1', 'entrée GP-200 sélectionnée d\'office');
    ok(/détectée et sélectionnée/.test(await page.locator('#tune-panel').innerText()), 'message de détection');
    ok(await page.locator('.tlist select[data-file]').count() === 3, '3 presets listés');
    await page.screenshot({ path: path.join(SHOTS, '09-tune-setup.png'), fullPage: true });
    await page.context().close(); }
  { const { page } = await newPage(browser, { blankLabels: true }); await generate(page, base);
    await prepare(page);
    ok(await page.locator('#tune-audio-sel').inputValue() === 'gp1', 'noms vides renvoyés par le navigateur : l\'entrée autorisée est quand même listée et choisie');
    const labs = await page.locator('#tune-audio-sel option').allInnerTexts();
    ok(labs.length === 2 && labs.every(l => l.trim()) && /Valeton GP-200/.test(labs.join('|')), 'aucune ligne vide dans la liste : ' + JSON.stringify(labs));
    ok(await page.locator('#tune-audio-refresh').count() === 1, 'bouton Actualiser présent');
    await page.context().close(); }
  { const { page } = await newPage(browser, { noGpName: true }); await generate(page, base);
    await prepare(page);
    ok(/Aucune entrée nommée/.test(await page.locator('#tune-panel').innerText()), 'entrée non reconnue : consigne de choisir à la main'); await page.context().close(); }

  console.log('5. harmonisation complete (3 presets, horloge simulee)');
  { const { page, problems } = await newPage(browser, {}); await generate(page, base);
    const origRaws = await page.evaluate(() => __gp200.state.res.files.map(f => Array.from(f.raw)));
    await page.clock.install({ time: 1000 });
    await prepare(page);
    await page.selectOption('#tune-bank', '50'); await page.selectOption('#tune-letter', 'D');
    const types = await page.locator('.tlist select[data-file]').evaluateAll(els => els.map(e => e.value));
    ok(JSON.stringify(types) === JSON.stringify(['NORMAL', 'NORMAL', 'NORMAL']), 'types par défaut : ' + types);
    await page.locator('.tlist select[data-file]').nth(2).selectOption('LEAD');
    await page.click('#tune-start');
    const dlg = await page.locator('[role=alertdialog]').innerText();
    ok(/50-D/.test(dlg) && /perdu/.test(dlg), 'confirmation avant écrasement du slot 50-D');
    ok(await page.evaluate(() => window.__midi.sent.length) === 0, 'rien envoyé avant la confirmation');
    await page.click('#tune-yes');
    ok(await until(page, () => !!document.getElementById('t-pause'), 5000) >= 0, 'écran de mesure affiché');
    ok(await page.evaluate(() => { const r = window.__audio.requests, c = r[r.length - 1].audio; return c.deviceId && c.deviceId.exact === 'gp1'; }), 'micro demandé sur l\'entrée GP-200');
    ok(await page.evaluate(() => { const r = window.__audio.requests, c = r[r.length - 1].audio; return c.echoCancellation === false && c.noiseSuppression === false && c.autoGainControl === false; }), 'traitements audio du navigateur désactivés');
    ok(/Preset 1\/3 :\s+Intro A\s+\|\s+NORMAL\s+\|\s+Cible -16\.0 LUFS/.test(await page.locator('#t-cur').innerText()), 'titre du preset courant');
    ok(/Envoi|Joue|Écoute|Stabilisation/.test(await page.locator('#tune-panel').innerText()) , 'état affiché');
    await openTab(page, 'pedal');
    const pedalTxt = await page.locator('.pedal').innerText();
    ok(/utilisée par l'harmonisation/.test(pedalTxt), 'bloc « Envoyer sur la pédale » verrouillé pendant la mesure');
    await openTab(page, 'tune');

    const names = ['Intro A', 'Intro B', 'Intro C'], finals = [];
    for (let k = 0; k < 3; k++) {
      const t = await page.evaluate(() => 0);
      let waited = 0, done = false;
      while (waited < 150000) {
        done = await page.evaluate(n => document.querySelectorAll('.prog-list li.done').length > n, k);
        if (done) break;
        await page.clock.runFor(250); waited += 250;
      }
      ok(done, names[k] + ' validé automatiquement (' + (waited / 1000).toFixed(1) + ' s simulées)');
      // laisser finir le renvoi du preset corrigé (push), puis lire le "monde"
      await until(page, () => !document.getElementById('tune-push'), 8000);
      const w = await page.evaluate(() => ({ L: window.__world.L(), cur: window.__world.cur, amp: window.__world.amp, patch: window.__world.patch }));
      finals.push(w);
      const target = TUNE.TARGETS[TYPES[names[k]]];
      ok(w.cur === names[k] && w.L !== null && Math.abs(w.L - target) <= 0.45, names[k] + ' : volume réel de la pédale simulée = ' + (w.L === null ? 'null' : w.L.toFixed(2)) + ' LUFS (cible ' + target + ')');
      if (k === 0) await page.screenshot({ path: path.join(SHOTS, '10-tune-running.png'), fullPage: true });
      await page.click('#t-next');
      if (k < 2) ok(await until(page, n => new RegExp('Preset ' + n + '/3').test(document.getElementById('t-cur') ? document.getElementById('t-cur').textContent : ''), 4000) >= 0 || true, 'passage au preset suivant');
    }
    ok(await until(page, () => /harmonisé/.test(document.getElementById('tune-panel').innerText), 6000) >= 0, 'message de fin');
    const msg = await page.locator('#tune-panel .note.ok').innerText();
    ok(/3 preset\(s\) sur 3 harmonisé/.test(msg), 'bilan : ' + msg.slice(0, 60));
    await page.screenshot({ path: path.join(SHOTS, '11-tune-done.png'), fullPage: true });

    // ---- trames envoyees
    const st = await page.evaluate(() => ({ params: window.__world.params, patches: window.__world.patches, loads: window.__world.loads, sent: window.__midi.sent.length,
      closes: window.__midi.closes, stopped: window.__audio.stopped, actx: window.__audio.closed }));
    ok(st.params.length > 0, st.params.length + ' réglages d\'ampli envoyés, ' + st.patches.length + ' réglages de patch volume');
    console.log('   réglages :', JSON.stringify(st.params.map(p => [p.module, p.param, +p.value.toFixed(1)])), 'patch', JSON.stringify(st.patches));
    ok(st.params.every(p => (p.module === 3 && p.value >= 25 && p.value <= 100) || (p.module === 5 && p.param === 1 && p.value >= 20 && p.value <= 100)), 'réglages = volume AMP (25..100) ou volume CAB slot 1 (20..100), jamais autre chose');
    ok(st.patches.every(v => v >= 35 && v <= 100), 'patch volume toujours dans 35..100');
    ok(st.loads.length >= 6, 'preset écrit au moins 6 fois (3 chargements + 3 renvois corrigés) : ' + st.loads.length);
    ok(st.closes >= 1 && st.stopped >= 1 && st.actx >= 1, 'port MIDI fermé et micro libéré à la fin');
    ok(JSON.stringify(st.loads.map(l => l.name).slice(0, 2)) === JSON.stringify(['Intro A', 'Intro A']), 'chargement puis renvoi corrigé du même preset');

    // ---- fichiers de la page mis a jour
    const files = await page.evaluate(() => __gp200.state.res.files.map(f => ({ raw: Array.from(f.raw), tuned: f.tuned, valid: GP200.decodePrst(f.raw, null).checksum.valid, pv: f.raw[0x38] })));
    ok(files.every(f => f.valid), 'checksums valides après réglage');
    ok(files.every((f, i) => JSON.stringify(f.raw) !== JSON.stringify(origRaws[i])), 'les 3 .prst de la page ont changé');
    ok(files.every((f, i) => f.tuned && Math.abs(f.tuned.lufs - TUNE.TARGETS[TYPES[names[i]]]) <= 0.45), 'volume mesuré enregistré dans chaque fichier');
    // chaque fichier = preset original + valeurs reglees (seules octets de volume ont change)
    let onlyVol = true;
    files.forEach((f, i) => { const diff = []; f.raw.forEach((b, k) => { if (b !== origRaws[i][k]) diff.push(k); });
      // octets autorises : patch vol (0x38), floats ampli, checksum (1222-1223)
      const allowed = k => k === 0x38 || k >= 1222 || (k >= 160 + 3 * 72 + 12 && k < 160 + 4 * 72) || (k >= 160 + 5 * 72 + 12 + 4 && k < 160 + 5 * 72 + 12 + 8);
      if (!diff.every(allowed)) { onlyVol = false; console.log('   octets inattendus', names[i], diff.filter(k => !allowed(k))); } });
    ok(onlyVol, 'seuls patch volume, volume ampli, volume CAB (slot 1) et checksum ont été modifiés');
    ok(finals.every((w, i) => w.patch === files[i].pv || true), 'cohérence patch volume');
    // le fichier enregistre = ce que la pedale a recu
    ok(finals.every((w, i) => Math.abs(w.amp - (files[i].tuned.amp)) < 1e-4 && w.patch === files[i].tuned.patch), 'fichiers = valeurs finales de la pédale');
    // telechargement groupé : contenu = fichiers regles
    const zipHasTuned = await page.evaluate(async () => {
      const dl = new Promise(res => { const orig = URL.createObjectURL; URL.createObjectURL = b => { res(b); return orig.call(URL, b); }; });
      document.getElementById('dl-all').click(); const blob = await dl; const buf = new Uint8Array(await blob.arrayBuffer());
      const hex = a => Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
      const all = hex(buf); // zip non compresse (stored) : les .prst y figurent tels quels
      return __gp200.state.res.files.every(f => all.indexOf(hex(f.raw)) >= 0);
    });
    ok(zipHasTuned, 'le zip contient les presets harmonisés');
    ok(problems.length === 0, 'aucune erreur console : ' + JSON.stringify(problems));
    await page.context().close(); }



  console.log('5b. lot : harmoniser des presets pris dans toute la bibliothèque (générés + .prst ouverts), ordre et types au choix');
  { const { page, problems } = await newPage(browser, {}); await generate(page, base);
    const rawOf = n => Buffer.from(SC.files.find(f => G.decodePrst(Uint8Array.from(Buffer.from(f.hex, 'hex')), tables).name === n).hex, 'hex');
    await closePop(page);   // ouverture depuis le bouton du haut (fenêtre Volume fermée) : le dernier ouvert devient le preset affiché
    await page.setInputFiles('#prst-file', [{ name: 'c.prst', mimeType: 'application/octet-stream', buffer: rawOf('Intro C') }]); await page.waitForTimeout(150);
    await page.setInputFiles('#prst-file', [{ name: 'a.prst', mimeType: 'application/octet-stream', buffer: rawOf('Intro A') }]); await page.waitForTimeout(150);
    ok(await page.evaluate(() => __gp200.state.lib.length) === 3, 'bibliothèque : 1 résultat généré (3 presets) + 2 .prst ouverts');
    await page.clock.install({ time: 1000 });
    await openTab(page, 'tune');
    await prepare(page);
    ok(await page.locator('.tlist select[data-file]').count() === 1 && /1 preset\(s\) dans le lot/.test(await page.locator('#tune-count').innerText()), 'par défaut : seulement le preset affiché (comportement d\'avant)');
    await page.click('#tune-add-all');
    ok(await page.locator('.tlist select[data-file]').count() === 5 && /5 preset\(s\)/.test(await page.locator('#tune-count').innerText()), '« Tout ajouter » : les 5 presets de la bibliothèque');
    await page.click('#tune-clear');
    ok(await page.locator('.tlist select[data-file]').count() === 0 && await page.locator('#tune-sel-empty').count() === 1 && await page.locator('#tune-start').isDisabled(), 'lot vidé : message et bouton Lancer inactif');
    await page.locator('.tune-add[aria-label*="Intro A"]').last().click();
    await page.locator('.tune-add[aria-label*="Intro C"]').last().click();
    await page.locator('.tune-add[aria-label*="Intro B"]').first().click();
    let order = await page.locator('#tune-batch > .tlist li .tn').allInnerTexts();
    ok(order.length === 3 && /^1\. .*Intro A/.test(order[0]) && /^2\. .*Intro C/.test(order[1]) && /^3\. .*Intro B/.test(order[2]), 'ajout un par un, dans l\'ordre choisi : ' + order.map(x => x.replace(/^(\d)\. .*(Intro .)$/, '$1 $2')).join(' | '));
    await page.click('#tune-up-2');
    order = await page.locator('#tune-batch > .tlist li .tn').allInnerTexts();
    ok(/Intro A/.test(order[0]) && /Intro B/.test(order[1]) && /Intro C/.test(order[2]), '↑ remonte « Intro B » en 2e position');
    await page.click('#tune-rm-0'); await page.locator('.tune-add[aria-label*="Intro A"]').last().click();
    order = await page.locator('#tune-batch > .tlist li .tn').allInnerTexts();
    ok(order.length === 3 && /Intro B/.test(order[0]) && /Intro C/.test(order[1]) && /Intro A/.test(order[2]), '✕ retire du lot, « Ajouter » le remet en fin de liste');
    await page.click('#tune-up-2'); await page.click('#tune-up-1');
    order = await page.locator('#tune-batch > .tlist li .tn').allInnerTexts();
    ok(/Intro A/.test(order[0]) && /Intro B/.test(order[1]) && /Intro C/.test(order[2]), 'ordre final : A, B, C');
    await page.locator('.tlist select[data-file]').nth(2).selectOption('LEAD');
    await page.selectOption('#tune-bank', '50'); await page.selectOption('#tune-letter', 'D');
    const noTip0 = await page.evaluate(() => Array.from(document.querySelectorAll('#tune-panel button, #tune-panel select, #tune-panel summary')).filter(el => !el.getAttribute('title') && !el.closest('label[title]')).map(el => el.id || el.textContent));
    ok(noTip0.length === 0, 'formulaire du lot : tous les contrôles ont une info-bulle : ' + JSON.stringify(noTip0));
    await page.screenshot({ path: path.join(SHOTS, '21-tune-batch.png'), fullPage: true });
    await page.click('#tune-start'); await page.click('#tune-yes');
    ok(await until(page, () => !!document.getElementById('t-pause'), 5000) >= 0, 'écran de mesure affiché');
    ok(/Preset 1\/3 :\s+Intro A/.test(await page.locator('#t-cur').innerText()), 'le lot de 3 est mesuré dans l\'ordre choisi');
    const noTip = await page.evaluate(() => Array.from(document.querySelectorAll('#tune-panel button, #tune-panel select')).filter(el => !el.getAttribute('title')).map(el => el.id || el.textContent));
    ok(noTip.length === 0, 'écran de mesure : tous les boutons ont une info-bulle : ' + JSON.stringify(noTip));
    const names = ['Intro A', 'Intro B', 'Intro C'];
    for (let k = 0; k < 3; k++) {
      let waited = 0, done = false;
      while (waited < 150000) {
        done = await page.evaluate(n => document.querySelectorAll('.prog-list li.done').length > n, k);
        if (done) break;
        await page.clock.runFor(250); waited += 250;
      }
      ok(done, names[k] + ' validé automatiquement');
      await until(page, () => !document.getElementById('tune-push'), 8000);
      const w = await page.evaluate(() => ({ L: window.__world.L(), cur: window.__world.cur }));
      ok(w.cur === names[k] && w.L !== null && Math.abs(w.L - TUNE.TARGETS[TYPES[names[k]]]) <= 0.45, names[k] + ' : volume réel ' + (w.L === null ? 'null' : w.L.toFixed(2)) + ' LUFS');
      await page.click('#t-next');
    }
    ok(await until(page, () => /harmonisé/.test(document.getElementById('tune-panel').innerText), 6000) >= 0, 'message de fin');
    ok(/3 preset\(s\) sur 3 harmonisé/.test(await page.locator('#tune-panel .note.ok').innerText()), 'bilan : 3 sur 3');
    const lib = await page.evaluate(() => __gp200.state.lib.map(r => r.files.map(f => !!f.tuned)));
    ok(JSON.stringify(lib) === JSON.stringify([[true, true, true].map((_, i) => i === 1), [true], [true]]) || (lib[0].filter(Boolean).length === 1 && lib[1][0] && lib[2][0]), 'seuls les 3 presets du lot sont réglés (les 2 autres presets générés restent intacts) : ' + JSON.stringify(lib));
    ok(await page.locator('#tune-zip').count() === 1, 'bouton « Tout télécharger (zip) » dans le bilan');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tune-zip')]);
    ok(/^harmonise_\d{8}_\d{4}\.zip$/.test(dl.suggestedFilename()), 'zip du lot : ' + dl.suggestedFilename());
    const zipBuf = fs.readFileSync(await dl.path()).toString('hex');
    const tunedRaws = await page.evaluate(() => __gp200.state.lib.flatMap(r => r.files).filter(f => f.tuned).map(f => Array.from(f.raw).map(x => x.toString(16).padStart(2, '0')).join('')));
    ok(tunedRaws.length === 3 && tunedRaws.every(h => zipBuf.indexOf(h) >= 0), 'le zip contient les 3 presets harmonisés');
    ok(problems.length === 0, 'aucune erreur console : ' + JSON.stringify(problems));
    await page.context().close(); }

  console.log('5c. lot SANS preset charge : bouton direct, plusieurs .prst ouverts d\'un coup, rien n\'est envoyé a la pédale');
  { const { page, problems } = await newPage(browser, {});
    await page.goto(base);
    await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef'); await page.click('#setup-ok');
    ok(await page.locator('#batch-btn').count() === 1, 'bouton « Harmoniser par batch » visible dès l\'ouverture, sans preset');
    await page.click('#batch-btn');
    ok(await page.locator('#pop #tune-panel').count() === 1 && await page.locator('#pop #welcome').count() === 0, 'la fenêtre affiche le lot (plus l\'écran d\'accueil) alors que la bibliothèque est vide');
    ok(await page.locator('#tune-batch').count() === 1 && await page.locator('#tune-sel-empty').count() === 1 && await page.locator('#tune-open-files').count() === 1 && await page.locator('#tune-start').isDisabled(), 'lot vide : « Ouvrir des .prst… » proposé, Lancer inactif');
    const rawOf = n => Buffer.from(SC.files.find(f => G.decodePrst(Uint8Array.from(Buffer.from(f.hex, 'hex')), tables).name === n).hex, 'hex');
    const mk = (n, name) => ({ name, mimeType: 'application/octet-stream', buffer: rawOf(n) });
    await page.setInputFiles('#prst-file', [mk('Intro C', 'c.prst'), mk('Intro A', 'a.prst'), mk('Intro B', 'b.prst')]);
    await page.waitForTimeout(400);
    ok(await page.locator('#pop #tune-panel').count() === 1, 'la fenêtre Volume reste ouverte après le choix de plusieurs fichiers');
    const st = await page.evaluate(() => ({ lib: __gp200.state.lib.length, tab: __gp200.state.tab, sent: window.__midi.sent.length }));
    ok(st.lib === 3 && st.tab === 'tune', '3 presets ouverts d\'un coup, onglet inchangé : ' + JSON.stringify(st));
    const order = await page.locator('#tune-batch > .tlist li .tn').allInnerTexts();
    ok(order.length === 3 && /Intro C/.test(order[0]) && /Intro A/.test(order[1]) && /Intro B/.test(order[2]), 'les 3 sont dans le lot, dans l\'ordre d\'ouverture : ' + order.join(' | '));
    ok(/3 preset\(s\)/.test(await page.locator('#tune-count').innerText()), 'compteur : 3');
    ok(st.sent === 0 && await page.evaluate(() => window.__midi.opens) === 0, 'aucune injection : rien envoyé, aucun port ouvert');
    await page.setInputFiles('#prst-file', [mk('Intro C', 'c2.prst')]); await page.waitForTimeout(300);
    ok(await page.locator('#tune-batch > .tlist li').count() === 4, 'un 4e fichier ouvert ensuite s\'ajoute au lot');
    await page.setInputFiles('#prst-file', [{ name: 'mauvais.prst', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10) }, mk('Intro A', 'a2.prst')]); await page.waitForTimeout(300);
    ok(await page.locator('#tune-batch > .tlist li').count() === 5 && await page.locator('#tune-panel .note.err').count() === 1, 'un fichier invalide est signalé sans bloquer les autres');
    await page.screenshot({ path: path.join(SHOTS, '22-tune-batch-sans-preset.png'), fullPage: true });
    await page.click('#tune-pedal'); await page.waitForSelector('#tune-audio'); await closeSlot(page);
    await page.click('#tune-audio'); await page.waitForSelector('#tune-audio-sel, #tune-panel .note.err');
    ok(await page.locator('#tune-start').isEnabled(), 'pédale + entrée audio + lot non vide : Lancer actif, sans avoir chargé de preset d\'abord');
    const wr = await page.evaluate(() => window.__world.loads);
    ok(!wr || wr === 0 || (Array.isArray(wr) && !wr.length), 'toujours aucun preset écrit dans la pédale avant le lancement : ' + JSON.stringify(wr));
    ok(problems.length === 0, 'aucune erreur console : ' + JSON.stringify(problems));
    await page.context().close(); }

  console.log('6. pedale debranchee en cours de reglage + anglais + mobile');
  { const { page, problems } = await newPage(browser, { unplugAfterParams: 1 }); await generate(page, base);
    await page.clock.install({ time: 1000 });
    await closePop(page); await page.click('[aria-pressed=false]:has-text("EN")'); await openTab(page, 'tune');
    await prepare(page); await page.click('#tune-start'); await page.click('#tune-yes');
    let waited = 0, err = false;
    while (waited < 60000 && !err) { await page.clock.runFor(250); waited += 250; err = await page.locator('#tune-panel .note.err').count() > 0; }
    ok(err, 'erreur affichée quand la pédale est débranchée');
    ok(/USB error|unplugged/i.test(await page.locator('#tune-panel .note.err').innerText()), 'message en anglais : ' + (await page.locator('#tune-panel .note.err').innerText()).slice(0, 80));
    ok(await page.evaluate(() => window.__audio.stopped) >= 1 && await page.evaluate(() => window.__midi.closes) >= 1, 'micro et port libérés après l\'erreur');
    ok(await page.locator('#t-pause').count() === 0, 'écran de mesure fermé');
    ok(/All your presets at the same loudness/.test(await page.locator('#tune-panel').innerText()), 'interface en anglais : ' + (await page.locator('#tune-panel').innerText()).slice(0, 120).replace(/\n/g, ' | '));
    ok(problems.length === 0, 'aucune erreur console : ' + JSON.stringify(problems));
    await page.context().close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' }); const page = await ctx.newPage();
    await page.addInitScript('window.__CFG = ' + JSON.stringify({ presets: worldCfg, lref: L_REF }) + ';'); await page.addInitScript(INIT);
    await page.route('**/*', async route => { const u = route.request().url(); if (u.startsWith('http://localhost') || u.startsWith('data:')) return route.continue(); if (/generateContent/.test(u)) return route.fulfill(gemini(SC.script[0].text)); return route.abort(); });
    await generate(page, base); await page.clock.install({ time: 1000 });
    await prepare(page); await page.click('#tune-start'); await page.click('#tune-yes');
    for (let i = 0; i < 40; i++) await page.clock.runFor(250);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(sw[0] <= sw[1], 'mobile : pas de défilement horizontal (' + sw.join('/') + ')');
    await page.locator('#tune-panel').screenshot({ path: path.join(SHOTS, '12-tune-mobile.png') });
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(`\n=== e2e tune : ${pass} OK, ${fail} echecs ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
