#!/usr/bin/env node
/* E2E de l'envoi USB : Chromium + fausse API Web MIDI (aucune pedale necessaire). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'tests', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const SC = exp.find(x => x.name === 'clean_pass');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
const gemini = text => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }) });

// Fausse API Web MIDI, parametree par window.__MIDI_CFG
const INIT = `(() => {
  const cfg = window.__MIDI_CFG || {};
  window.__midi = { sent: [], opts: null, closes: 0, opens: 0, requests: 0 };
  if (cfg.unsupported) { try { delete Navigator.prototype.requestMIDIAccess; } catch (e) {} Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined, configurable: true }); return; }
  const input = { id: 'in1', name: 'GP-200', state: 'connected', type: 'input', onmidimessage: null, open: async () => input, close: async () => {} };
  let hs = 0, acked = false;
  const output = { id: 'out1', name: 'GP-200', state: 'connected', type: 'output',
    open: async () => { window.__midi.opens++; if (cfg.busy) throw new Error('InvalidStateError: port busy'); return output; },
    close: async () => { window.__midi.closes++; },
    send(d) {
      const b = Array.from(d); window.__midi.sent.push(b);
      if (cfg.unplugAfter && window.__midi.sent.length === cfg.unplugAfter) output.state = 'disconnected';
      if (b.length === 30 && b[8] === 0x12 && b[9] === 0x08) { hs++; if (!cfg.noAck && input.onmidimessage) { input.onmidimessage({ data: Uint8Array.from([0xF0].concat(Array.from({ length: 40 }, (_, i) => i), [0xF7])) }); } }
    } };
  const other = { id: 'out2', name: 'Midi Through', state: 'connected', type: 'output', open: async () => other, close: async () => {}, send() {} };
  const mk = (...p) => ({ forEach: f => p.forEach(f), get: id => p.find(x => x.id === id), get size() { return p.length; } });
  const access = { outputs: cfg.noPedal ? mk(other) : mk(output, other), inputs: cfg.noPedal ? mk() : mk(input), onstatechange: null, sysexEnabled: true };
  window.__access = access; window.__output = output;
  navigator.requestMIDIAccess = async (opts) => {
    window.__midi.requests++; window.__midi.opts = opts;
    if (cfg.deny) { const e = new Error('Permission denied'); e.name = 'SecurityError'; throw e; }
    return access;
  };
})();`;

function pyFrames(rawHex, slot, letter) {
  const out = cp.execSync(`python3 - <<'PY'
import sys; sys.path.insert(0, '${ROOT}/ref')
import gp200_usb as U, json
raw = bytes.fromhex('${rawHex}')
pc = U.slot_to_pc(${slot}, '${letter}')
print(json.dumps({'hs': list(U.build_handshake_sysex(pc)), 'chunks': [list(c) for c in U.build_sysex_chunks(raw, pc)]}))
PY`).toString();
  return JSON.parse(out);
}

async function closeSlot(page) { if (await page.locator('#slot-close').count()) await page.click('#slot-close'); }
async function openTab(page, t) { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); await page.click('#tabbtn-' + t); }
async function closePop(page) { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); }
async function newPage(browser, cfg) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.addInitScript('window.__MIDI_CFG = ' + JSON.stringify(cfg || {}) + ';');
  await page.addInitScript(INIT);
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('data:')) return route.continue();
    if (/generateContent/.test(url)) return route.fulfill(gemini(SC.script[0].text));
    return route.abort();
  });
  return { page, problems, ctx };
}
async function generate(page) {
  await page.goto(page.__base);
  await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef');
  await page.click('#setup-ok');
  await page.fill('#demande', 'Enter Sandman - Metallica');
  await page.click('#go');
  await page.waitForSelector('.slot.fresh .mname', { timeout: 15000 });
}
async function pedalOpen(page) { await page.click('#pedal-chip'); await page.waitForSelector('#slot-modal', { timeout: 3000 }).catch(() => {}); await openTab(page, 'pedal'); }
const sentOf = page => page.evaluate(() => window.__midi.sent);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const files = SC.files;               // 3 presets (A,B,C) produits par le Python

  console.log('1. navigateur sans Web MIDI');
  { const { page, problems } = await newPage(browser, { unsupported: true }); page.__base = base; await generate(page); await openTab(page, 'pedal');
    ok(await page.locator('text=Ce navigateur ne peut pas parler à la pédale').count() === 1, 'message "navigateur non supporté"');
    ok(await page.locator('#pedal-connect').count() === 0, 'pas de bouton de connexion'); ok(problems.length === 0, 'aucune erreur console'); await page.context().close(); }

  console.log('2. autorisation refusee');
  { const { page } = await newPage(browser, { deny: true }); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('.pedal .note.err');
    ok(/accès MIDI a été refusé/.test(await page.locator('.pedal .note.err').innerText()), 'message "accès refusé" avec la marche à suivre'); await page.context().close(); }

  console.log('3. pas de pedale branchee');
  { const { page } = await newPage(browser, { noPedal: true }); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('.pstate');
    ok(/Aucune pédale GP-200 détectée/.test(await page.locator('.pstate').innerText()), 'message "aucune pédale"');
    ok(await page.locator('#pedal-one').count() === 0, 'pas de bouton d\'envoi sans pédale');
    await page.screenshot({ path: path.join(SHOTS, '06-pedal-none.png'), fullPage: true }); await page.context().close(); }

  console.log('4. envoi d\'un preset');
  { const { page, problems } = await newPage(browser, {}); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('#pedal-one');
    ok(await page.evaluate(() => window.__midi.opts && window.__midi.opts.sysex === true), 'requestMIDIAccess({sysex:true})');
    ok(/GP-200 détectée : GP-200/.test(await page.locator('.pstate').innerText()), 'pédale détectée');
    await page.selectOption('#pedal-bank', '12'); await page.selectOption('#pedal-letter', 'B');
    await page.screenshot({ path: path.join(SHOTS, '07-pedal-ready.png'), fullPage: true });
    await page.click('#pedal-one');
    ok(/écraser ce qui se trouve actuellement sur 12-B/.test(await page.locator('[role=alertdialog]').innerText()), 'confirmation avant écrasement (12-B)');
    ok((await sentOf(page)).length === 0, 'rien envoyé avant la confirmation');
    await page.click('#pedal-yes');
    await page.waitForSelector('.pedal .note.ok', { timeout: 15000 });
    const sent = await sentOf(page);
    const py = pyFrames(files[0].hex, 12, 'B');
    ok(JSON.stringify(sent[0]) === JSON.stringify(py.hs), 'premier message = handshake Python');
    ok(JSON.stringify(sent.slice(1, 8)) === JSON.stringify(py.chunks), '7 morceaux SysEx identiques à Python');
    ok(JSON.stringify(sent.slice(8)) === JSON.stringify([[0xB0, 0, 0], [0xC0, 45]]), "Bank Select 0 + Program Change 45 (=12-B)");
    ok(sent.length === 10, '10 messages au total : ' + sent.length);
    ok(await page.evaluate(() => window.__midi.closes) >= 1, 'port MIDI libéré après envoi');
    ok(/Terminé : 12-B/.test(await page.locator('.pedal .note.ok').innerText()), 'message de fin');
    await page.screenshot({ path: path.join(SHOTS, '08-pedal-done.png'), fullPage: true });
    ok(problems.length === 0, 'aucune erreur console : ' + JSON.stringify(problems));
    await page.context().close(); }

  console.log('5. envoi des 3 variantes + annulation de la confirmation');
  { const { page } = await newPage(browser, {}); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('#pedal-three');
    await page.selectOption('#pedal-bank', '40');
    await page.click('#pedal-three');
    ok(/40-A, 40-B, 40-C/.test(await page.locator('[role=alertdialog]').innerText()), 'confirmation liste les 3 slots');
    await page.click('[role=alertdialog] button:has-text("Annuler")');
    ok((await sentOf(page)).length === 0 && await page.locator('[role=alertdialog]').count() === 0, 'annulation : rien envoyé');
    await page.click('#pedal-three'); await page.click('#pedal-yes');
    await page.waitForSelector('.pedal .note.ok', { timeout: 20000 });
    const sent = await sentOf(page);
    let i = 0, allOk = true;
    for (let k = 0; k < 3; k++) {
      const py = pyFrames(files[k].hex, 40, 'ABC'[k]);
      allOk = allOk && JSON.stringify(sent[i]) === JSON.stringify(py.hs) && JSON.stringify(sent.slice(i + 1, i + 8)) === JSON.stringify(py.chunks);
      i += 10;
    }
    ok(allOk, '3 presets : handshakes + morceaux identiques à Python');
    ok(JSON.stringify(sent.slice(-2)) === JSON.stringify([[0xB0, 0, 1], [0xC0, 28]]), "à la fin la pédale revient sur 40-A (PC 156 = Bank 1 + PC 28)");
    ok(sent.length === 32, '32 messages : ' + sent.length);
    await page.context().close(); }

  console.log('6. pedale occupee / debranchee / sans ACK');
  { const { page } = await newPage(browser, { busy: true }); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('#pedal-one'); await page.click('#pedal-one'); await page.click('#pedal-yes');
    await page.waitForSelector('.pedal .note.err', { timeout: 10000 });
    ok(/un autre programme/.test(await page.locator('.pedal .note.err').innerText()), 'port occupé : message clair'); await page.context().close(); }
  { const { page } = await newPage(browser, { unplugAfter: 4 }); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('#pedal-one'); await page.click('#pedal-one'); await page.click('#pedal-yes');
    await page.waitForSelector('.pedal .note.err', { timeout: 10000 });
    ok(/débranchée pendant l'envoi/.test(await page.locator('.pedal .note.err').innerText()), 'débranchement en cours d\'envoi : message clair');
    ok(await page.locator('#pedal-one:not([disabled])').count() <= 1, 'interface de nouveau utilisable'); await page.context().close(); }
  { const { page } = await newPage(browser, { noAck: true }); page.__base = base; await generate(page);
    await pedalOpen(page); await page.waitForSelector('#pedal-one'); await page.click('#pedal-one'); await page.click('#pedal-yes');
    await page.waitForSelector('.pedal .note.ok', { timeout: 20000 });
    const sent = await sentOf(page);
    ok(sent.filter(m => m.length === 30).length === 5, 'sans ACK : 5 handshakes puis envoi quand même');
    ok(/n'a pas confirmé la poignée de main/.test(await page.locator('.pedal').innerText()), 'avertissement "pas d\'ACK" affiché'); await page.context().close(); }

  console.log('7. mobile');
  { const { page } = await newPage(browser, {}); page.__base = base; await page.setViewportSize({ width: 390, height: 844 }); await generate(page);
    await pedalOpen(page); await page.waitForSelector('#pedal-one');
    ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'pas de défilement horizontal');
    await page.locator('.pedal').screenshot({ path: path.join(SHOTS, '09-pedal-mobile.png') }); await page.context().close(); }

  console.log('\n=== e2e usb : ' + pass + ' OK, ' + fail + ' echecs ===');
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
