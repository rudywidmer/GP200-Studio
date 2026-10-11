#!/usr/bin/env node
/* Capture du manuel : profil GP-150 (fausse pedale de tests/fake_gp150.js). MLANG=en pour l'interface anglaise. Derive de tests/e2e_gp150.js. Sortie : manual/img[_en]/26-gp150.png */
/* (E2E GP-150 / GP-180 : Chromium + fausse pedale (tests/fake_gp150.js) injectee dans la page. Aucune pedale necessaire.
 * Couvre : detection du modele, bascule de profil, lecture, memoire, reglage en direct, ecoute, injection, ecriture, set list, generation IA,
 * securite (modele inconnu, ecriture confirmee, pas de reset), retour au GP-200 sans perte, mise en page. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..', '..');
const makeFake = require('../../tests/fake_gp150.js');
const C = require('../../web/src/gp150core.js');
const X = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'expected_gp150.json'), 'utf8'));
const tb = new C.Tables(X.tables), sk = Uint8Array.from(Buffer.from(X.skeleton, 'hex'));
const E150 = C.forModel('gp150'), E180 = C.forModel('gp180');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
const gemini = text => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }) });

const specOf = (name, amp, gain) => ({ name, patch_vol: 61, modules: {
  DST: { model: 'Micro Boost', on: true, params: { Gain: 20 } },
  AMP: { model: amp || 'UK 800', on: true, params: { Gain: gain || 60, Presence: 55, Volume: 70 } },
  NR: { model: 'Gate 1', on: true, params: { Threshold: 25 } },
  CAB: { model: 'UK 2x12', on: true, params: { 'Low Cut': 80, 'High Cut': 9000 } },
  RVB: { model: 'Room', on: true, params: { Mix: 10 } }, VOL: { model: 'Volume', on: true, params: {} } } });
const rawOf = (E, spec) => E.encodePrst(spec, tb, sk).raw;
fs.mkdirSync('/tmp/gp150e2e', { recursive: true });
const FILE_A = '/tmp/gp150e2e/Alpha.prst', FILE_B = '/tmp/gp150e2e/Beta.prst', FILE_180 = '/tmp/gp150e2e/Gamma180.prst';
fs.writeFileSync(FILE_A, Buffer.from(rawOf(E150, specOf('Alpha', 'UK 800', 60))));
fs.writeFileSync(FILE_B, Buffer.from(rawOf(E150, specOf('Beta', 'EV 51', 80))));
fs.writeFileSync(FILE_180, Buffer.from(rawOf(E180, specOf('Gamma 180', 'UK 900', 70))));

const AI_PAYLOAD = JSON.stringify({ artiste: 'AC/DC', titre: 'Back in Black', recherche: 'r', structure: 's', notes: 'n', sections: [{ nom: 'Rythmique', role: 'disto', raison: 'r',
  variants: ['A - Fidele', 'B - Variante', 'C - Poussee'].map((l, i) => ({ label: l, axe: 'x', ecoute: 'y', spec: specOf('Back ' + 'ABC'[i], 'UK 800', 40 + 20 * i) })) }] });

async function newPage(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: opts.w || 1440, height: opts.h || 900 }, locale: process.env.MLANG === 'en' ? 'en-US' : 'fr-FR' });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  if (opts.fake !== null) {
    const fo = JSON.stringify(opts.fake || { portName: 'GP-150' });
    await page.addInitScript(`window.__fake = (${makeFake.toString()})(${fo}); navigator.requestMIDIAccess = async () => window.__fake.access;`);
  }
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('data:')) return route.continue();
    if (/generateContent/.test(url)) return route.fulfill(gemini(AI_PAYLOAD));
    return route.abort();
  });
  await page.goto('http://localhost:' + server.address().port + '/');
  await page.click('#setup-skip');
  return { page, problems, ctx };
}
const st = (page, expr) => page.evaluate(`(${expr})(window.__fake)`);
const codes = page => st(page, 'f => f.state.host.map(h => h.code)');
async function closePops(page) { for (let i = 0; i < 3; i++) { if (await page.locator('#slot-close').count()) await page.click('#slot-close'); else if (await page.locator('#pop-close').count()) await page.click('#pop-close'); } }
async function tab(page, t) { await closePops(page); await page.click('#tabbtn-' + t); await sleep(250); }
async function connect(page) { await page.click('#pedal-chip'); await page.waitForSelector('#mem-list', { timeout: 8000 }).catch(() => {}); await sleep(900); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const { page, ctx } = await newPage(browser, { w: 1440, h: 900 });
  await connect(page); await closePops(page); await sleep(600);
  const out = path.join(ROOT, 'manual', process.env.MLANG === 'en' ? 'img_en' : 'img'); fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, '26-gp150.png') });
  console.log('shot 26-gp150'); await ctx.close(); await browser.close(); server.close();
})();
