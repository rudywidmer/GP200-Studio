#!/usr/bin/env node
/* E2E de l'interface « poste de travail » : bibliotheque, ouverture/glisser-deposer d'un .prst, affiner, CTRL, reglage d'un module
   (hors ligne puis en direct, sans etape d'envoi). Chromium + faux Gemini + fausse API Web MIDI. */
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

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const { page, problems, requests } = await newPage(browser);
  await page.goto(base);
  await withKey(page);

  console.log('1. ouvrir un .prst d\'emblee (sans passer par un mode), erreurs, plusieurs fichiers');
  ok(await page.locator('#welcome').count() === 1 && await page.locator('#lib-empty').count() === 1, 'accueil : bibliotheque vide + mode d\'emploi');
  ok(await page.locator('#mode-new').getAttribute('aria-pressed') === 'true', 'mode « Nouveau morceau » au depart');
  await upload(page, new Uint8Array(100), 'trop-court.prst');
  ok(/1224/.test(await note(page)) && /trop-court\.prst/.test(await note(page)), 'fichier de mauvaise taille refusé avec explication');
  await upload(page, new Uint8Array(1224), 'zeros.prst');
  ok(/zeros\.prst/.test(await note(page)), 'fichier de 1224 octets sans structure refusé');
  ok(await libCount(page) === 0, 'rien ajouté à la bibliothèque');
  await upload(page, srcRaw);
  ok(await page.locator('#mode-refine').getAttribute('aria-pressed') === 'true', 'ouvrir un .prst bascule seul en mode « Affiner »');
  ok(/mon preset\.prst/.test(await page.locator('#ref-loaded').innerText()), 'le preset ouvert est la cible de l\'affinage');
  ok(await libCount(page) === 1 && /ouvert/.test(await page.locator('.lib-entry .badge').innerText()), 'bibliothèque : 1 preset, badge « ouvert »');
  ok(await page.locator('.slot .mname').filter({ hasText: /\S/ }).count() >= 8, 'le rack affiche les modules du preset');
  ok(await page.locator('#dl-all').count() === 0, 'un seul preset : pas de « tout télécharger »');
  ok(await page.locator('#pop').count() === 0 && await page.locator('#ed-on').count() === 0 && await page.locator('#module-box input[type=range]').count() > 0, 'module affiché sous le rack (sans case « Module actif »), curseurs prêts à l\'emploi');
  const dl0 = await downloadOne(page);
  ok(eqBytes(dl0.bytes, srcRaw), 'le preset ouvert se télécharge à l\'identique');
  const badRaw = Uint8Array.from(srcRaw); badRaw[1223] ^= 0x55;
  await upload(page, badRaw, 'abime.prst');
  ok(/checksum/.test(await note(page)), 'checksum faux : avertissement lisible');
  ok(await libCount(page) === 2, 'le fichier abîmé est quand même ouvert (2 entrées)');
  await page.setInputFiles('#prst-file', [
    { name: 'a.prst', mimeType: 'application/octet-stream', buffer: Buffer.from(srcRaw) },
    { name: 'b.prst', mimeType: 'application/octet-stream', buffer: Buffer.from(srcRaw) },
    { name: 'c.prst', mimeType: 'application/octet-stream', buffer: Buffer.from(new Uint8Array(10)) }]);
  await page.waitForFunction(() => document.querySelectorAll('.lib-entry').length === 4 && /c\.prst/.test((document.getElementById('status-note') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  ok(await libCount(page) === 4 && /c\.prst/.test(await note(page)), 'plusieurs fichiers d\'un coup : 2 ouverts, 1 refusé signalé');
  await page.locator('.lib-entry .x').first().click();
  ok(await libCount(page) === 3, 'suppression d\'un preset de la liste');
  await page.screenshot({ path: path.join(SHOTS, '13-refine-open.png') });

  console.log('2. glisser-déposer');
  await page.reload(); await page.waitForSelector('#open-prst');
  await page.evaluate(buf => {
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(buf)], 'depose.prst'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__veil = document.body.classList.contains('dragging');
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, Array.from(srcRaw));
  ok(await page.evaluate(() => window.__veil), 'voile « Dépose ton .prst » affiché pendant le survol');
  await page.waitForSelector('.lib-entry');
  ok(/depose\.prst/.test(await page.locator('#ref-loaded').innerText()) && !(await page.evaluate(() => document.body.classList.contains('dragging'))), 'fichier déposé ouvert, voile retiré');

  console.log('3. affiner le preset ouvert');
  await page.click('#go-refine');
  ok(/changer sur ce preset/.test(await note(page)), 'sans consigne : message');
  await page.click('.ask-zone .chips .chip >> nth=0');
  ok((await page.inputValue('#instr')).length > 10, 'un exemple remplit la consigne');
  await page.fill('#instr', 'Trop de reverb, il manque du gain');
  await page.click('#go-refine');
  await page.waitForSelector('#refine-result', { timeout: 15000 });
  ok(requests.length === 1 && /PRESET ACTUEL/.test(requests[0]) && /Trop de reverb, il manque du gain/.test(requests[0]), 'requête IA : preset actuel + consigne');
  ok(await page.locator('#pop #tab-result').count() === 1 && await page.locator('#tabbtn-result[aria-expanded=true]').count() === 1, 'la fenêtre Résultat s\'ouvre toute seule');
  const diffTxt = await page.locator('#diff-list li').allInnerTexts();
  ok(JSON.stringify(diffTxt) === JSON.stringify(expectedDiff), 'changements réels = diff calculé par le cœur (' + diffTxt.length + ')');
  const resTxt = await page.locator('#refine-result').innerText();
  ok(/Le son est trop sourd/.test(resTxt) && /Gain \+5/.test(resTxt) && /Attention au volume/.test(resTxt), 'analyse, changements déclarés et avertissements affichés');
  ok(/assignations CTRL et le volume/.test(resTxt), 'mention de la recopie CTRL / volume');
  ok(await libCount(page) === 2 && /Refined/.test(await page.locator('.rack-head h2').innerText()), 'le résultat s\'ajoute à la liste (l\'original est gardé) et devient le preset affiché');
  await closePop(page);
  const dl1 = await downloadOne(page);
  ok(dl1.name === 'Refined_v2.prst', 'nom de fichier Refined_v2.prst : ' + dl1.name);
  ok(eqBytes(dl1.bytes, expectedRefined), 'octets = encodage du cœur + CTRL/volume recopiés');
  ok(dl1.bytes[G.OFF_PATCH_VOL] === 77 && JSON.stringify(G.readCtrl(dl1.bytes)[0]) === JSON.stringify(['AMP', 'DLY']), 'patch volume 77 et CTRL1 conservés');
  ok(G.decodePrst(dl1.bytes, tb).checksum.valid, 'checksum valide');
  await page.screenshot({ path: path.join(SHOTS, '14-refine-result.png') });

  console.log('4. enchaîner : concert sur le résultat, puis affiner l\'original');
  await page.click('#go-live');
  await page.waitForSelector('#refine-result h3:has-text("concert")', { timeout: 15000 });
  ok(await libCount(page) === 3, 'le résultat suivant s\'ajoute aussi (3 entrées)');
  const dl2 = await downloadOne(page);
  ok(dl2.name === 'Refined_live.prst', 'nom de fichier _live : ' + dl2.name);
  ok(/utilisation en concert/.test(requests[1]) && !/Trop de reverb/.test(requests[1]), 'consigne concert (pré-câblée) envoyée à l\'IA');
  ok(/Refined/.test(requests[1]), 'le concert est bâti sur le preset sélectionné (le résultat précédent)');
  await page.locator('.lib-entry').first().locator('.lib-row').click();
  ok(/depose\.prst/.test(await page.locator('#ref-loaded').innerText()), 'cliquer un preset de la liste le choisit comme cible');
  await page.fill('#instr', 'Plus de clarté'); await page.click('#go-refine');
  await page.waitForSelector('.lib-entry >> nth=3', { timeout: 15000 });
  ok(requests.length === 3 && /PRESET ACTUEL/.test(requests[2]) && !/Refined/.test(requests[2].split('PRESET ACTUEL')[1] || ''), 'affinage relancé depuis l\'original');
  await page.reload();

  console.log('5. CTRL : cases appliquées tout de suite');
  await page.waitForSelector('#open-prst');
  await upload(page, srcRaw);
  await openTab(page, 'ctrl');
  ok(await page.locator('#ctrl-grid input[type=checkbox]').count() === 88, 'grille 8 × 11');
  ok(await page.locator('#ctrl-grid input[data-ctrl="1"][data-mod="AMP"]').isChecked() && await page.locator('#ctrl-grid input[data-ctrl="1"][data-mod="DLY"]').isChecked()
     && !(await page.locator('#ctrl-grid input[data-ctrl="1"][data-mod="PRE"]').isChecked()), 'cases pré-cochées d\'après le fichier');
  await page.screenshot({ path: path.join(SHOTS, '15-ctrl.png') });
  await page.click('#ctrl-grid input[data-ctrl="3"][data-mod="PRE"]');
  await page.click('#ctrl-grid input[data-ctrl="3"][data-mod="RVB"]');
  await page.click('#ctrl-grid input[data-ctrl="1"][data-mod="DLY"]');
  ok(/CTRL1=AMP/.test(await page.locator('#ctrl-sum').innerText()) && /CTRL3=PRE\+RVB/.test(await page.locator('#ctrl-sum').innerText()), 'résumé des CTRL mis à jour sans bouton « enregistrer »');
  const dl3 = await downloadOne(page);
  const wantCtrl = G.setCtrl(srcRaw, { 1: ['AMP'], 2: ['PRE'], 3: ['PRE', 'RVB'] });
  ok(eqBytes(dl3.bytes, wantCtrl), 'octets du téléchargement = setCtrl (vérifié contre Python)');
  ok(G.decodePrst(dl3.bytes, tb).checksum.valid, 'checksum valide après CTRL');
  await openTab(page, 'ctrl');
  ok(await page.locator('#pop').count() === 1 && await page.locator('.rack').isVisible(), 'CTRL : fenêtre flottante (le rack reste derrière)');
  await page.keyboard.press('Escape');
  ok(await page.locator('#pop').count() === 0, 'Échap ferme la fenêtre');
  await openTab(page, 'result'); await page.mouse.click(5, 5);
  ok(await page.locator('#pop').count() === 0, 'un clic à côté ferme la fenêtre');
  await openTab(page, 'pedal'); await page.click('#pop-close');
  ok(await page.locator('#pop').count() === 0, 'bouton ✕ ferme la fenêtre');

  console.log('6. régler un module hors ligne (sans rien envoyer)');
  await page.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
  const nSl = await page.locator('#module-box input[type=range]').count();
  ok(nSl >= 1, 'curseurs affichés (' + nSl + ')');
  ok(/Hors ligne/.test(await page.locator('#live-note').innerText()), 'mention « hors ligne » tant que la pédale n\'est pas là');
  const pname = await page.locator('#module-box input[type=range]').first().getAttribute('data-param');
  const prm = tb.paramsOf(srcDec.modules[changedSlot].model_id, srcDec.modules[changedSlot].category).find(x => x.name === pname);
  const target = Math.min(prm.min, prm.max) + (Math.abs(prm.max - prm.min) * 0.5);
  await setRange(page, 0, target);
  const sliderVal = Number(await page.locator('#module-box input[type=range]').first().inputValue());
  ok(Number(await page.locator('#module-box input.num').first().inputValue()) === sliderVal, 'la case numérique suit le curseur');
  const want1 = G.patchParam(Uint8Array.from(wantCtrl), G.MODULES.indexOf(changedSlot), prm.slot, sliderVal);
  const dl4 = await downloadOne(page);
  ok(eqBytes(dl4.bytes, want1), 'le curseur modifie le bon float (octets = patchParam)');
  ok(G.decodePrst(dl4.bytes, tb).checksum.valid, 'checksum valide');
  const list = tb.modelsForSlot(changedSlot);
  const curId = srcDec.modules[changedSlot].model_id;
  const idx = list.findIndex(x => (x[1] === 10 ? x[0].model_id : x[0].id) !== curId);
  await page.selectOption('#ed-model', String(idx));
  await page.waitForSelector('#ed-msg');
  const dl5 = await downloadOne(page);
  const d5 = G.decodePrst(dl5.bytes, tb), d4 = G.decodePrst(dl4.bytes, tb);
  ok(d5.modules[changedSlot].model === list[idx][0].name && d5.checksum.valid, 'nouveau modèle écrit : ' + d5.modules[changedSlot].model);
  ok(G.MODULES.filter(m => m !== changedSlot).every(m => JSON.stringify(d5.modules[m]) === JSON.stringify(d4.modules[m])), 'les autres modules sont inchangés');
  await page.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
  const dl6 = await downloadOne(page);
  ok(G.decodePrst(dl6.bytes, tb).modules[changedSlot].on === !d5.modules[changedSlot].on, 'clic sur le module déjà au focus : il s\'active / se coupe (écrit dans le fichier)');
  await page.locator(`.slot[data-slot="${changedSlot}"] .ledbtn`).click();
  const dl7 = await downloadOne(page);
  ok(G.decodePrst(dl7.bytes, tb).modules[changedSlot].on === d5.modules[changedSlot].on, 'LED du rack : même bascule ON/OFF en un clic');
  { const other = G.MODULES.find(m => m !== changedSlot && srcDec.modules[m] && srcDec.modules[m].model);
    const btn = page.locator(`.slot[data-slot="${other}"] .sbtn`);
    const onOf = async () => G.decodePrst((await downloadOne(page)).bytes, tb).modules[other].on;
    const base = await onOf();
    await btn.click();
    ok(await onOf() === base && await btn.getAttribute('aria-pressed') === 'true', 'focus : 1er clic sur un module = on y va, rien ne change');
    await btn.click();
    ok(await onOf() === !base && (await page.locator('#ed-state').getAttribute('class')).includes(' on') === !base, '2e clic (module au focus) = activé / coupé, badge d\'état à jour');
    await btn.click();
    ok(await onOf() === base, '3e clic = bascule inverse');
    await page.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
    await btn.click();
    ok(await onOf() === base, 'changer de module remet le focus à zéro : le 1er clic ne bascule pas'); }
  ok((await sentOf(page)).length === 0 && await page.evaluate(() => window.__midi.opens) === 0, 'hors ligne : aucune trame MIDI, aucun port ouvert');
  await page.screenshot({ path: path.join(SHOTS, '16-edit.png') });

  console.log('7. ergonomie : une seule page, sans défilement');
  for (const [w, hh] of [[1440, 860], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: hh }); await page.waitForTimeout(150);
    const m = await page.evaluate(() => { const r = document.querySelector('.rack').getBoundingClientRect(), t = document.querySelector('.tabbody').getBoundingClientRect(), st = document.querySelector('.statusbar').getBoundingClientRect();
      return { sh: document.documentElement.scrollHeight - window.innerHeight, rackBottom: r.bottom, tabBottom: t.bottom, statTop: st.top, ih: window.innerHeight, over: getComputedStyle(document.documentElement).overflowY }; });
    ok(m.rackBottom <= m.ih && m.tabBottom <= m.statTop + 1 && m.statTop < m.ih, w + '×' + hh + ' : rack, onglets et barre d\'état tiennent dans l\'écran');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press('Escape');
  await page.click('#ai-chip');
  ok(await page.locator('#setup-modal').count() === 1, 'la pastille IA rouvre la fenêtre de connexion');
  await page.keyboard.press('Escape');
  ok(await page.locator('#setup-modal').count() === 0, 'Échap la referme');
  ok(problems.length === 0, 'aucune erreur console : ' + JSON.stringify(problems));
  await page.context().close();

  console.log('8. réglage en direct : aucune étape d\'envoi');
  { const c = await newPage(browser); const pg = c.page;
    await pg.goto(base); await withKey(pg);
    await upload(pg, srcRaw);
    ok(await pg.locator('#live-switch').count() === 0, 'interrupteur Direct absent tant que la pédale n\'est pas connectée');
    await pg.click('#pedal-chip'); await pg.waitForSelector('#live-switch');
    ok(await pg.locator('#live-switch').isChecked() && /En direct/.test(await pg.locator('#live-note').innerText()), 'pédale connectée : Direct activé d\'office');
    await pg.clock.install();
    await pg.clock.runFor(1500);
    await closeSlot(pg);
    ok(await pg.locator('#inj-need').count() === 1 && (await sentOf(pg)).length === 0, 'slot d\'injection pas encore choisi : rien n\'est écrit sur la pédale, un message le dit');
    await pg.clock.runFor(16000);              // pause : la liaison se referme, la pédale peut avoir changé de preset
    const B = (await sentOf(pg)).length;
    const sentS = async () => (await sentOf(pg)).slice(B);
    await pg.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
    const k = G.MODULES.indexOf(changedSlot);
    const pn = await pg.locator('#module-box input[type=range]').first().getAttribute('data-param');
    const pm = tb.paramsOf(srcDec.modules[changedSlot].model_id, srcDec.modules[changedSlot].category).find(x => x.name === pn);
    const lo = Math.min(pm.min, pm.max), hi = Math.max(pm.min, pm.max);
    await setRange(pg, 0, lo + (hi - lo) * 0.25);
    await setRange(pg, 0, lo + (hi - lo) * 0.25 + (hi - lo) * 0.1);
    await setRange(pg, 0, lo + (hi - lo) * 0.75);
    await pg.clock.runFor(1500);
    let sent = await sentS();
    ok(await pg.evaluate(() => window.__midi.opens) === 1, 'premier réglage : la liaison s\'ouvre toute seule');
    const mod0 = G.decodePrst(Uint8Array.from(await pg.evaluate(() => Array.from(__gp200.state.res.files[0].raw))), tb).modules[changedSlot];
    const nP = tb.paramsOf(mod0.model_id, mod0.category).filter(p => p.slot < 15).length;
    const cur = Uint8Array.from(await pg.evaluate(() => Array.from(__gp200.state.res.files[0].raw)));
    const fv = Number(await pg.locator('#module-box input[type=range]').first().inputValue());
    ok(sent.length >= 1 + nP + 1 && sent.length <= 1 + nP + 2, 'premier réglage du module : modèle + ' + nP + ' valeurs + 1er renvoyé (+ au plus 1 trame pour un mouvement fait pendant l\'envoi) : ' + sent.length + ' trames, pas un par mouvement');
    ok(JSON.stringify(sent[0]) === JSON.stringify(pyMsg(`U.build_effect_change_msg(${k}, ${mod0.model_id}, ${mod0.category})`)), 'd\'abord la trame « effect change » du modèle affiché (Python)');
    const synced = sent.slice(1, 1 + nP);
    ok(synced.every(m => m.length === 62) && JSON.stringify(sent[1 + nP]) === JSON.stringify(sent[1]), 'puis les paramètres (le premier renvoyé en dernier, bug #80)');
    ok(JSON.stringify(sent.filter(m => m.length === 62 && m[40] === pm.slot).pop()) === JSON.stringify(Array.from(U.buildParamUpdateMsg(k, pm.slot, fv, cur))), 'la dernière valeur du réglage bougé est bien celle de l\'écran, avec le bon numéro de paramètre (' + pm.slot + ')');
    // réglages suivants : une seule trame chacun, sans renvoyer le modèle
    await pg.clock.runFor(500);
    sent = await sentS();
    const nBefore = sent.length;
    await setRange(pg, 0, lo + (hi - lo) * 0.6); await pg.clock.runFor(200);
    sent = await sentS();
    const fv2 = Number(await pg.locator('#module-box input[type=range]').first().inputValue());
    const cur2 = Uint8Array.from(await pg.evaluate(() => Array.from(__gp200.state.res.files[0].raw)));
    const expF = JSON.stringify(Array.from(U.buildParamUpdateMsg(k, pm.slot, fv2, cur2)));
    ok(sent.length === nBefore + 2 && JSON.stringify(sent[sent.length - 1]) === expF && JSON.stringify(sent[sent.length - 2]) === expF, 'réglages suivants : une trame (format vérifié contre Python) + son renvoi 180 ms après, sans renvoyer le modèle');
    await setRange(pg, 0, lo + (hi - lo) * 0.62); await setRange(pg, 0, lo + (hi - lo) * 0.64); await pg.clock.runFor(300);
    const n2 = (await sentS()).length - nBefore - 2;
    ok(n2 >= 2 && n2 <= 3, 'deux mouvements très rapprochés : cadence limitée, un seul renvoi final (' + n2 + ' trame(s))');
    // autre module : sa propre synchronisation
    const other = G.MODULES.find(m2 => m2 !== changedSlot && srcDec.modules[m2] && srcDec.modules[m2].model && tb.paramsOf(srcDec.modules[m2].model_id, srcDec.modules[m2].category).some(p => p.slot < 15) && m2 !== 'CAB' && m2 !== 'VOL');
    const k2 = G.MODULES.indexOf(other), n3 = (await sentS()).length;
    await pg.locator(`.slot[data-slot="${other}"] .sbtn`).click();
    await setRange(pg, 0, Number(await pg.locator('#module-box input[type=range]').first().getAttribute('min')) + 1); await pg.clock.runFor(1500);
    const sent3 = (await sentS()).slice(n3);
    ok(sent3.length > 2 && sent3[0].length === 54 && sent3[0][38] === k2, 'autre module (' + other + ') : il est lui aussi synchronisé avant son premier réglage');
    await pg.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
    ok(!(await pg.evaluate(() => window.__midi.sent.some(m => m.length === 54 && false))), 'contrôle');
    // bypass : LED du rack, pas de bouton intermédiaire
    const nOn = G.decodePrst(cur, tb).modules[changedSlot].on;
    await pg.locator(`.slot[data-slot="${changedSlot}"] .ledbtn`).click(); await pg.clock.runFor(100);
    sent = await sentS();
    ok(JSON.stringify(sent[sent.length - 1]) === JSON.stringify(pyMsg(`U.build_bypass_msg(${k}, ${nOn ? 'False' : 'True'})`)), 'LED du rack = trame bypass Python (' + (nOn ? 'coupé' : 'activé') + ')');
    // changement de modèle en direct
    const list8 = tb.modelsForSlot(changedSlot);
    const idx8 = list8.findIndex(x => (x[1] === 10 ? x[0].model_id : x[0].id) !== srcDec.modules[changedSlot].model_id);
    const n0 = (await sentS()).length;
    await pg.selectOption('#ed-model', String(idx8));
    for (let i = 0; i < 100 && !/pédale \(pas encore enregistré\)/.test(await pg.evaluate(() => (document.getElementById('ed-msg') || {}).textContent || '')); i++) await pg.clock.runFor(50);
    sent = (await sentS()).slice(n0);
    const pick = list8[idx8], mid = pick[1] === 10 ? pick[0].model_id : pick[0].id;
    ok(JSON.stringify(sent[0]) === JSON.stringify(pyMsg(`U.build_effect_change_msg(${k}, ${mid}, ${pick[1]})`)), 'changement de modèle = trame Python effect_change');
    const nParams = tb.paramsOf(mid, pick[1]).filter(p => p.slot < 15).length;
    ok(sent.length === 1 + nParams + 1 && sent.slice(1).every(m => m.length === 62), 'puis ' + nParams + ' paramètres + le 1er renvoyé (' + (sent.length - 1) + ' trames)');
    ok(JSON.stringify(sent[sent.length - 1]) === JSON.stringify(sent[1]), 'le premier paramètre est renvoyé en dernier');
    await pg.screenshot({ path: path.join(SHOTS, '17-edit-live.png') });
    // inactivité : la liaison se referme au bout de 15 s et se rouvre au besoin
    const c0 = await pg.evaluate(() => window.__midi.closes);
    await pg.clock.runFor(14000);
    ok(await pg.evaluate(() => window.__midi.closes) === c0, 'à 14 s d\'inactivité la liaison est encore ouverte');
    await pg.clock.runFor(2500);
    ok(await pg.evaluate(() => window.__midi.closes) === c0 + 1, 'après 15 s sans réglage elle se referme (port libéré pour l\'éditeur Valeton)');
    const nEff = (await sentS()).filter(m => m.length === 54).length;
    await setRange(pg, 0, lo + (hi - lo) * 0.5); await pg.clock.runFor(1500);
    ok(await pg.evaluate(() => window.__midi.opens) === 2, 'un nouveau réglage la rouvre sans rien demander');
    ok((await sentS()).filter(m => m.length === 54).length === nEff + 1, 'et le module est renvoyé (la pédale a pu changer de preset pendant la pause)');
    // interrupteur Direct coupé : plus rien ne part
    await pg.click('#live-switch', { force: true }).catch(() => pg.locator('.switch').click());
    ok(!(await pg.locator('#live-switch').isChecked()) && /pas envoy|hors|Direct|désactiv/i.test(await pg.locator('#live-note').innerText()), 'interrupteur Direct coupé');
    const n1 = (await sentS()).length;
    await setRange(pg, 0, lo + (hi - lo) * 0.2); await pg.clock.runFor(300);
    ok((await sentS()).length === n1, 'Direct coupé : le réglage ne modifie que le preset affiché');
    ok(await pg.evaluate(() => window.__midi.closes) === c0 + 2, 'et la liaison est fermée');
    // Direct rallumé + envoi du preset : la liaison directe est coupée d\'abord
    await pg.locator('.switch').click();
    await setRange(pg, 0, lo + (hi - lo) * 0.3); await pg.clock.runFor(200);
    await openTab(pg, 'pedal'); await pg.click('#pedal-one'); await pg.click('#pedal-yes');
    for (let i = 0; i < 200 && !(await pg.locator('.pedal .note.ok').count()); i++) await pg.clock.runFor(100);
    ok(await pg.locator('.pedal .note.ok').count() === 1, 'envoi complet du preset sur la pédale réussi');
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await c.ctx.close(); }

  console.log('8c. injection : écrire dans le slot choisi puis le sélectionner (comme la version Windows)');
  { const c = await newPage(browser); const pg = c.page;
    await pg.clock.install(); await pg.goto(base); await withKey(pg); await upload(pg, srcRaw);
    ok(await pg.locator('#inject-btn').count() === 0 && await pg.locator('#inj-slot').count() === 0, 'pas de bouton « Injecter » sans pédale');
    await pg.click('#pedal-chip'); await pg.waitForSelector('#inj-slot'); await closeSlot(pg);
    ok(/Choisir/.test(await pg.locator('#inj-slot').innerText()) && await pg.locator('#inject-btn').isDisabled(), 'tant que le slot n\'est pas choisi : bouton « Injecter » inactif');
    await pg.clock.runFor(2000);
    ok((await sentOf(pg)).length === 0, 'et aucune injection automatique (rien n\'est écrasé sans accord)');
    await chooseSlot(pg, 12, 'C');
    ok(await waitInjected(pg), 'slot 12-C choisi : injection automatique du preset affiché');
    let sent = await sentOf(pg);
    ok(JSON.stringify(sent) === JSON.stringify(injFrames(srcRaw, 12, 'C')), 'trames = handshake + 7 morceaux + Bank/PC du slot 12-C, identiques au Python (' + sent.length + ')');
    ok(/12-C/.test(await pg.locator('#inj-state').innerText()) && /12-C/.test(await pg.locator('#inj-slot').innerText()), 'le slot est affiché sur le bouton et dans le message de fin');
    const saved = await pg.evaluate(() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.inj) return v.inj; } catch (e) { /* rien */ } } return null; });
    ok(saved && saved.bank === 12 && saved.letter === 'C' && saved.set === true && saved.auto === true, 'slot, lettre, auto et « confirmé » sont mémorisés : ' + JSON.stringify(saved));
    ok(await pg.evaluate(() => window.__midi.closes) >= 1 && !(await pg.evaluate(() => __gp200.state.ed.live)), 'les ports sont libérés après l\'injection');
    // plage complete : jusqu'a 64-D (PC 255 = Bank 1 + PC 127, comme le Python)
    await pg.click('#inj-slot');
    ok(await pg.locator('#inj-bank option').count() === 64, 'numéros proposés : 1 à 64');
    await pg.selectOption('#inj-bank', '64'); await pg.selectOption('#inj-letter', 'D'); await pg.click('#inj-ok');
    ok(await waitInjected(pg), 'slot 64-D : injection automatique');
    { const f64 = (await sentOf(pg)).slice(sent.length);
      ok(JSON.stringify(f64) === JSON.stringify(injFrames(srcRaw, 64, 'D')) && f64[f64.length - 1][1] === 127 && f64[f64.length - 2][2] === 1, 'trames 64-D = écriture + Bank 1 / PC 127'); }
    await chooseSlot(pg, 12, 'C');
    ok(await waitInjected(pg), 'retour sur 12-C');
    sent = (await sentOf(pg));
    // la pedale est maintenant sur ce fichier : un réglage = 1 trame (+ renvoi), aucun modèle renvoyé
    await pg.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
    const n0 = sent.length;
    await setRange(pg, 0, Number(await pg.locator('#module-box input[type=range]').first().getAttribute('max')) / 2); await pg.clock.runFor(1000);
    const live = (await sentOf(pg)).slice(n0);
    ok(live.length === 2 && live.every(m => m.length === 62), 'après l\'injection un réglage = 1 trame + son renvoi final, sans renvoyer de modèle (' + live.length + ')');
    // deuxieme preset ouvert : reinjection automatique, meme slot
    const raw2 = Uint8Array.from(srcRaw); G.patchParam(raw2, 8, 0, 33);
    const n1 = (await sentOf(pg)).length;
    await upload(pg, raw2, 'variante.prst');
    ok(await waitInjected(pg), 'deuxième preset ouvert : réinjection automatique dans le même slot');
    ok(JSON.stringify((await sentOf(pg)).slice(n1)) === JSON.stringify(injFrames(raw2, 12, 'C')), 'c\'est bien le deuxième fichier qui est écrit');
    // clic sur le premier preset de la liste
    const n2 = (await sentOf(pg)).length;
    await pg.locator('.lib-entry').first().locator('.lib-row').click();
    ok(await waitInjected(pg), 'clic sur un preset de la liste : réinjection automatique');
    ok((await sentOf(pg)).length - n2 === 10, 'une écriture complète (10 trames)');
    // auto coupé : plus rien ne part tout seul, le bouton écrit quand même
    await chooseSlot(pg, 12, 'C', false);
    const n3 = (await sentOf(pg)).length;
    await pg.locator('.lib-entry').nth(1).locator('.lib-row').click(); await pg.clock.runFor(3000);
    ok((await sentOf(pg)).length === n3, 'auto-inject décoché : le choix d\'un preset n\'écrit rien');
    await pg.click('#inject-btn');
    ok(await waitInjected(pg), 'bouton « Injecter » : écriture à la demande');
    ok((await sentOf(pg)).length - n3 === 10, 'une écriture complète au clic');
    // un choix pendant une ecriture est mis en file et rejoue ensuite
    await chooseSlot(pg, 12, 'C', true);
    await waitInjected(pg);
    const n5 = (await sentOf(pg)).length;
    await pg.click('#inject-btn');
    await pg.locator('.lib-entry').first().locator('.lib-row').click();
    await waitInjected(pg, 600); await pg.clock.runFor(4000);
    const nq = (await sentOf(pg)).slice(n5);
    const rawNow = Uint8Array.from(await pg.evaluate(() => Array.from(__gp200.state.res.files[0].raw)));
    ok(nq.length === 20 && JSON.stringify(nq.slice(10)) === JSON.stringify(injFrames(rawNow, 12, 'C')), 'un choix pendant une écriture : elle se termine, puis le preset choisi est écrit (' + nq.length + ' trames)');
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await c.ctx.close(); }

  console.log('8d. activer un module OFF après une injection');
  { const c = await newPage(browser); const pg = c.page;
    await pg.clock.install(); await pg.goto(base); await withKey(pg); await upload(pg, srcRaw);
    await pg.click('#pedal-chip'); await pg.waitForSelector('#inj-slot'); await closeSlot(pg);
    await chooseSlot(pg, 1, 'A');
    ok(await waitInjected(pg), 'injection en 01-A');
    const offSl = G.MODULES.find(sl => srcDec.modules[sl] && srcDec.modules[sl].model && !srcDec.modules[sl].on), kO = G.MODULES.indexOf(offSl), eO = srcDec.modules[offSl];
    ok(!!offSl, 'module OFF du preset de test : ' + offSl);
    const nA = (await sentOf(pg)).length;
    await pg.locator(`.slot[data-slot="${offSl}"] .ledbtn`).click();
    await pg.clock.runFor(3000);
    const tail = (await sentOf(pg)).slice(nA);
    ok(tail.length === 1 && JSON.stringify(tail[0]) === JSON.stringify(Array.from(U.buildBypassMsg(kO, true))), 'la pédale a déjà ce modèle (injecté) : on l\'active, rien d\'autre');
    await pg.locator(`.slot[data-slot="${offSl}"] .ledbtn`).click(); await pg.clock.runFor(500);
    await pg.clock.runFor(16000);                 // pause : la pedale a pu changer de patch -> on ne suppose plus rien
    const nB = (await sentOf(pg)).length;
    await pg.locator(`.slot[data-slot="${offSl}"] .ledbtn`).click(); await pg.clock.runFor(3000);
    const tail2 = (await sentOf(pg)).slice(nB);
    ok(JSON.stringify(tail2[0]) === JSON.stringify(Array.from(U.buildEffectChangeMsg(kO, eO.model_id, eO.category))), 'après une pause : son modèle est renvoyé d\'abord (effect change)');
    ok(JSON.stringify(tail2[tail2.length - 1]) === JSON.stringify(Array.from(U.buildBypassMsg(kO, true))) && tail2.slice(1, -1).every(m => m.length === 62), 'puis ses valeurs, puis seulement l\'activation');
    await c.ctx.close(); }


  console.log('8f. écoute de la pédale : ce qui change sur le GP-200 remonte dans l\'interface');
  { const c = await newPage(browser, null, { listen: true }); const pg = c.page;
    const NUXB = [0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32];
    const f30 = o => { const b = new Array(30).fill(0); b[0] = 0xF0; NUXB.forEach((v, i) => { b[1 + i] = v; }); b[8] = 0x12; b[9] = 0x08; b[18] = 4; b[29] = 0xF7; return Object.assign(b, o(b)); };
    const fBypass = (m, on) => f30(b => { b[13] = 1; b[14] = 5; b[22] = m; b[24] = on ? 1 : 0; b[25] = 3; b[26] = 0x0D; b[27] = 8; b[28] = 0; return b; });
    const fPatch = pc => f30(b => { b[13] = 0; b[14] = 8; b[15] = 1; b[25] = pc >> 4; b[26] = pc & 15; return b; });
    const fVol = v => f30(b => { b[13] = 0; b[14] = 6; b[15] = 0; b[25] = v >> 4; b[26] = v & 15; return b; });
    const fPanel = (val, ctrl) => { const b = new Array(46).fill(0); b[0] = 0xF0; NUXB.forEach((v, i) => { b[1 + i] = v; }); b[8] = 0x12; b[9] = 0x10; b[22] = ctrl; const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, val, true);
      for (let i = 0; i < 4; i++) { b[37 + 2 * i] = dv.getUint8(i) >> 4; b[38 + 2 * i] = dv.getUint8(i) & 15; } b[45] = 0xF7; return b; };
    const notify = (d) => pg.evaluate(d => window.__midi.notify(d), d);
    const slotOn = sl => pg.evaluate(sl => __gp200.state.res.files[0].decoded.modules[sl].on, sl);
    await pg.clock.install(); await pg.goto(base); await withKey(pg); await upload(pg, srcRaw);
    await pg.click('#pedal-chip'); await pg.waitForSelector('#inj-slot'); await closeSlot(pg);
    await chooseSlot(pg, 12, 'C');
    ok(await waitInjected(pg), 'injection en 12-C');
    await pg.clock.runFor(2500);
    ok(await pg.evaluate(() => __gp200.state.ed.live), 'à l\'écoute : la liaison est rouverte toute seule après l\'injection');
    await pg.clock.runFor(30000);
    ok(await pg.evaluate(() => __gp200.state.ed.live), 'et elle reste ouverte (pas de fermeture après 15 s)');
    ok(/12-C/.test(await pg.locator('#pd-on').innerText()), 'bandeau « GP-200 sur 12-C » après l\'injection');
    const n0 = (await sentOf(pg)).length;
    // 1. module bascule au pied -> l'interface suit, sans rien renvoyer
    const sl = G.MODULES.find(m => srcDec.modules[m] && srcDec.modules[m].model), k = G.MODULES.indexOf(sl), was = await slotOn(sl);
    ok(await notify(fBypass(k, !was)), 'notification bypass envoyée');
    await pg.clock.runFor(600);
    ok(await slotOn(sl) === !was && await pg.locator(`.slot[data-slot="${sl}"]`).evaluate((el, w) => el.classList.contains('on') === !w, was), 'module basculé au pied : le rack et le fichier suivent (' + sl + ' ' + (!was ? 'ON' : 'OFF') + ')');
    ok(G.decodePrst(await pg.evaluate(() => Array.from(__gp200.state.res.files[0].raw)).then(a => Uint8Array.from(a)), tb).modules[sl].on === !was, 'octets du preset à jour');
    ok((await sentOf(pg)).length === n0, 'rien n\'est renvoyé à la pédale');
    await notify(fBypass(k, !was)); await pg.clock.runFor(600);
    ok(await slotOn(sl) === !was, 'même état reçu deux fois : rien ne change');
    // 2. echo de notre propre bascule : ignore pendant 500 ms
    await pg.locator(`.slot[data-slot="${sl}"] .ledbtn`).click(); await pg.clock.runFor(100);
    ok(await slotOn(sl) === was, 'clic sur la LED : bascule locale');
    await notify(fBypass(k, !was)); await pg.clock.runFor(300);
    ok(await slotOn(sl) === was, 'écho de l\'ancien état juste après notre envoi : ignoré');
    await pg.clock.runFor(2000);
    // 3. volume du patch tourne sur la pedale
    ok(await notify(fVol(55)), 'notification volume du patch');
    await pg.clock.runFor(600);
    ok(await pg.evaluate(() => __gp200.state.res.files[0].raw[0x38] === 55 && __gp200.state.res.files[0].decoded.patch_vol === 55), 'volume du patch mis à jour (octet 0x38 = 55)');
    ok(G.decodePrst(Uint8Array.from(await pg.evaluate(() => Array.from(__gp200.state.res.files[0].raw))), tb).checksum.valid, 'checksum valide après la mise à jour');
    // 4. bouton tourne en facade : valeur lisible, parametre inconnu -> avertissement
    await notify(fPanel(100, 0x0A)); await pg.clock.runFor(600);
    ok(await pg.locator('#pd-knob').count() === 0, 'message de chargement de patch (ctrl 0x0A) : pas d\'alerte');
    await notify(fPanel(52, 1)); await pg.clock.runFor(600);
    ok(await pg.locator('#pd-knob').count() === 1 && /ne dit pas lequel/.test(await pg.locator('#pd-knob').innerText()), 'réglage tourné en facade : l\'écran prévient qu\'il peut différer');
    // 5. la pedale change de patch (autre que celui du preset affiche) : reglages suspendus
    await notify(fPatch(26)); await pg.clock.runFor(600);       // 07-C
    ok(/07-C/.test(await pg.locator('#pd-other').innerText()) && /12-C/.test(await pg.locator('#pd-other').innerText()), 'autre patch sur la pédale : avertissement (07-C ≠ 12-C)');
    await pg.screenshot({ path: path.join(SHOTS, '19-listen.png') });
    await pg.locator(`.slot[data-slot="${changedSlot}"] .sbtn`).click();
    const nOther = (await sentOf(pg)).length;
    await setRange(pg, 0, Number(await pg.locator('#module-box input[type=range]').first().getAttribute('max')) / 2); await pg.clock.runFor(1500);
    ok((await sentOf(pg)).length === nOther, 'les réglages en direct sont suspendus (rien n\'est envoyé sur un autre patch)');
    await pg.locator(`.slot[data-slot="${sl}"] .ledbtn`).click(); await pg.clock.runFor(500);
    ok((await sentOf(pg)).length === nOther, 'la LED du rack ne touche pas non plus un autre patch');
    await notify(fBypass(k, was)); await pg.clock.runFor(400);
    ok(await slotOn(sl) === !was, 'un bypass reçu depuis un autre patch ne modifie pas le preset affiché');
    // 6. Renvoyer le preset : ecriture + selection, tout rentre dans l'ordre
    await pg.click('#pd-resend');
    ok(await waitInjected(pg), 'renvoi du preset');
    await pg.clock.runFor(2500);
    ok(await pg.locator('#pd-other').count() === 0 && /12-C/.test(await pg.locator('#pd-on').innerText()), 'retour sur 12-C : plus d\'avertissement');
    // 7. retour au patch par la pedale alors que l'ecran a des reglages non injectes
    await setRange(pg, 0, Number(await pg.locator('#module-box input[type=range]').first().getAttribute('max'))); await pg.clock.runFor(800);   // un réglage en direct, jamais écrit en mémoire
    await notify(fPatch(26)); await pg.clock.runFor(400);
    await notify(fPatch(47)); await pg.clock.runFor(600);        // 12-D
    ok(await pg.locator('#pd-other').count() === 1, 'toujours un autre patch (12-D)');
    await notify(fPatch(46)); await pg.clock.runFor(600);        // 12-C
    ok(await pg.locator('#pd-other').count() === 0 && await pg.locator('#pd-reloaded').count() === 1 && /rechargé 12-C/.test(await pg.locator('#pd-reloaded').innerText()), 'retour sur 12-C avec des réglages non injectés : « la pédale a rechargé 12-C »');
    const nR = (await sentOf(pg)).length;
    await setRange(pg, 0, Number(await pg.locator('#module-box input[type=range]').first().getAttribute('min'))); await pg.clock.runFor(800);
    const post = (await sentOf(pg)).slice(nR);
    ok(post.length >= 5 && post[0].length === 54, 'le prochain réglage renvoie d\'abord le module entier (modèle puis valeurs)');
    await pg.click('#pd-resend'); ok(await waitInjected(pg), 'renvoi du preset'); await pg.clock.runFor(2500);
    ok(await pg.locator('#pd-reloaded').count() === 0 && await pg.locator('#pd-knob').count() === 0, 'après le renvoi : plus aucun avertissement');
    await notify(fPatch(46)); await pg.clock.runFor(600);
    ok(await pg.locator('#pd-reloaded').count() === 0 && await pg.locator('#pd-on').count() === 1, 'patch rechargé à l\'identique de ce qui est affiché : aucun avertissement');
    // 8. journal
    await notify([0xF0, ...NUXB, 0x12, 0x20, 0, 0, 0, 1, 2, 3, 0xF7]); await pg.clock.runFor(300);
    await openTab(pg, 'pedal');
    const lg = await pg.evaluate(() => { const d = document.getElementById('pd-log'); d.open = true; return d.innerText + document.getElementById('pd-log-text').textContent; });
    ok(/patch 12-C/.test(lg) && /ON|OFF/.test(lg) && /12\/20/.test(lg) && /f0 21 25 7e/.test(lg), 'le journal montre patchs, bypass et messages inconnus (hex)');
    await closePop(pg);
    // 9. ecoute coupee : le port est rendu, plus rien ne remonte
    await pg.click('#inj-slot'); await pg.locator('#listen-chk').uncheck();
    await pg.click('#inj-ok'); await pg.clock.runFor(3000);
    ok(!(await pg.evaluate(() => __gp200.state.ed.live)), 'écoute décochée : le port est libéré');
    const was2 = await slotOn(sl);
    await notify(fBypass(k, !was2)).catch(() => {}); await pg.clock.runFor(600);
    ok(await slotOn(sl) === was2, 'plus rien ne remonte');
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await c.ctx.close(); }


  console.log('8g. slot de travail confirmé dès la connexion de la pédale, avant tout preset');
  { const c = await newPage(browser); const pg = c.page;
    await pg.clock.install(); await pg.goto(base); await withKey(pg);
    ok(await pg.locator('#slot-chip').count() === 0, 'pédale non connectée : pas de pastille de slot');
    await pg.click('#pedal-chip'); await pg.waitForSelector('#slot-modal');
    ok(await pg.locator('#inj-panel').isVisible() && /Choisir/.test(await pg.locator('#slot-chip').innerText()), 'à la connexion, sans aucun preset : la fenêtre « slot d\'injection » s\'ouvre toute seule');
    await pg.screenshot({ path: path.join(SHOTS, '20-slot.png') });
    await upload(pg, srcRaw); await pg.clock.runFor(3000);
    ok((await sentOf(pg)).length === 0 && await pg.evaluate(() => window.__midi.opens) === 0, 'preset ouvert pendant que le slot n\'est pas confirmé : rien n\'est écrit, aucun port ouvert');
    await pg.click('#slot-close');
    ok(await pg.locator('#slot-modal').count() === 0 && /Choisir/.test(await pg.locator('#slot-chip').innerText()) && await pg.locator('#inj-need').count() === 1, 'fermée sans valider : rien n\'est choisi, le message le rappelle');
    await pg.clock.runFor(3000);
    ok((await sentOf(pg)).length === 0, 'toujours rien d\'écrit');
    await pg.click('#slot-chip'); await pg.waitForSelector('#slot-modal');
    await pg.keyboard.press('Escape');
    ok(await pg.locator('#slot-modal').count() === 0, 'Échap ferme la fenêtre');
    await pg.click('#slot-chip');
    await pg.selectOption('#inj-bank', '5'); await pg.selectOption('#inj-letter', 'B');
    await pg.click('#inj-ok');
    ok(await waitInjected(pg), 'slot 05-B confirmé : le preset ouvert est injecté');
    ok(JSON.stringify(await sentOf(pg)) === JSON.stringify(injFrames(srcRaw, 5, 'B')), 'écrit dans 05-B (trames identiques au Python)');
    ok(/5-B|05-B/.test(await pg.locator('#slot-chip').innerText()), 'la pastille de l\'en-tête affiche le slot');
    await pg.click('#slot-chip'); ok(await pg.locator('#slot-modal').count() === 1, 'la pastille permet de le changer à tout moment'); await pg.click('#slot-close');
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await c.ctx.close(); }

  console.log('8e. confirmation 12/0C de la pédale, Time renvoyé, baffle rechargée après un changement d\'ampli');
  { const auditPs = JSON.parse(fs.readFileSync(path.join(ROOT, 'ref/audit/gp200_param_support.json'), 'utf8'));
    const lvCsv = fs.readFileSync(path.join(ROOT, 'ref/audit/gp200_model_levels.csv'), 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
    const mkRaw = (mut) => { const sp = G.plainSpec(G.decodedToSpec(srcDec)); mut(sp); const r = G.encodePrst(sp, tb, template).raw; return [r, G.decodePrst(r, tb)]; };
    const delay = (model, params) => sp => { sp.modules.DLY = { model, on: true, params }; };
    const [rawP, decP] = mkRaw(delay('Ping Pong', { Mix: 20, Time: 500, Feedback: 50, Sync: 0, Trail: 1 }));
    const c = await newPage(browser); const pg = c.page;
    await pg.clock.install(); await pg.goto(base); await withKey(pg); await upload(pg, rawP);
    await pg.click('#pedal-chip'); await pg.waitForSelector('#inj-slot'); await closeSlot(pg);
    const kD = G.MODULES.indexOf('DLY');
    await pg.locator('.slot[data-slot="DLY"] .sbtn').click();
    await pg.click('#ed-send'); await pg.clock.runFor(4000);
    const sent = await sentOf(pg);
    const ppList = tb.paramsOf(decP.modules.DLY.model_id, decP.modules.DLY.category).filter(p => p.slot < 15);
    const timeSlot = ppList.find(p => p.name === 'Time').slot;
    const expSend = [Array.from(U.buildEffectChangeMsg(kD, decP.modules.DLY.model_id, decP.modules.DLY.category))]
      .concat(ppList.map(p => Array.from(U.buildParamUpdateMsg(kD, p.slot, Number(decP.modules.DLY.params[p.name]), rawP))),
        [Array.from(U.buildParamUpdateMsg(kD, ppList[0].slot, Number(decP.modules.DLY.params[ppList[0].name]), rawP)),
         Array.from(U.buildParamUpdateMsg(kD, timeSlot, Number(decP.modules.DLY.params.Time), rawP))]);
    ok(JSON.stringify(sent) === JSON.stringify(expSend), 'Ping Pong : effect change, valeurs, 1re renvoyée, puis le Time (idx ' + timeSlot + ') en dernier = Python (' + sent.length + ' trames)');
    ok(JSON.stringify(sent.filter(m => m.length === 62).map(m => m[40])) === JSON.stringify(ppList.map(p => p.slot).concat([ppList[0].slot, timeSlot])), 'ordre des index : ' + sent.filter(m => m.length === 62).map(m => m[40]).join(','));
    const cf = await pg.evaluate(() => Object.assign({}, __gp200.state.usb.link.confirm));
    ok(cf.seen === 1 && !cf.off, 'la pédale a confirmé le chargement du delay');
    ok(await pg.evaluate(() => __gp200.state.ed.noConf.length) === 0, 'aucun « sans confirmation » signalé');

    // changer d'ampli en direct : effect change ampli, ses valeurs, puis la baffle du preset (la pedale a recharge la baffle par defaut)
    await pg.locator('.slot[data-slot="AMP"] .sbtn').click();
    const ampList = tb.modelsForSlot('AMP'), curA = ampList.findIndex(x => x[0].name === decP.modules.AMP.model), pick = ampList.findIndex((x, i) => i !== curA && x[0].cat === 7);
    const kA = G.MODULES.indexOf('AMP'), kC = G.MODULES.indexOf('CAB');
    const n1b = (await sentOf(pg)).length;
    await pg.selectOption('#ed-model', String(pick));
    await pg.clock.runFor(4000);
    const lv = (await sentOf(pg)).slice(n1b), effL = lv.filter(m => m.length === 54).map(m => m[38]);
    ok(effL.length === 2 && effL[0] === kA && effL[1] === kC && lv.findIndex(m => m.length === 54 && m[38] === kC) > lv.findIndex(m => m.length === 54 && m[38] === kA), 'choisir un ampli en direct : l\'ampli, ses valeurs, puis la baffle du preset (' + effL.join(',') + ')');

    // pastilles de l'audit + niveau mesuré
    await pg.locator('.slot[data-slot="DLY"] .sbtn').click();
    const nAfter = auditPs.find(e => e.model === 'Ping Pong').params.filter(p => p.status === 'ok_after_preset_load' && p.slot < 15).length;
    ok(nAfter === 2 && await pg.locator('#module-box .pflag').count() === nAfter, 'réglages muets en direct signalés par ↻ (' + nAfter + ' pour Ping Pong)');
    await pg.locator('.slot[data-slot="AMP"] .sbtn').click();
    const ampEl = await pg.evaluate(() => { const m = __gp200.state.res.files[0].decoded.modules.AMP; return { model_id: m.model_id, category: m.category }; });
    const lvRow = lvCsv.find(r => r[0] === 'AMP' && Number(r[2]) === ampEl.model_id && Number(r[3]) === ampEl.category);
    const lvTxt = await pg.locator('#mod-level').innerText();
    ok(!!lvRow && lvTxt.indexOf(Number(lvRow[4]).toFixed(1).replace('.', ',')) >= 0 && /dBFS/.test(lvTxt), 'niveau mesuré affiché pour l\'ampli : ' + lvTxt);

    // confirmation perdue (changement de delay) : un seul renvoi
    await pg.evaluate(() => { window.__midi.confirm = 'dropFirst'; window.__midi.dropped = false; });
    await pg.locator('.slot[data-slot="DLY"] .sbtn').click();
    const dl = tb.modelsForSlot('DLY'), curD = dl.findIndex(x => x[0].name === 'Ping Pong'), pickD = dl.findIndex((x, i) => i !== curD && x[0].name === 'Sweep Echo');
    const n2 = (await sentOf(pg)).length;
    await pg.selectOption('#ed-model', String(pickD));
    await pg.clock.runFor(5000);
    const eff2 = (await sentOf(pg)).slice(n2).filter(m => m.length === 54).map(m => m[38] + ':' + m[45] + m[46]);
    ok(eff2.length === 2 && eff2[0] === eff2[1], 'le chargement non confirmé est renvoyé une seule fois, tout de suite (' + eff2.join(' ') + ')');
    ok(await pg.evaluate(() => __gp200.state.ed.noConf.length) === 0, 'après le renvoi la pédale a confirmé : rien à signaler');
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await c.ctx.close(); }

  { // la pedale ne confirme jamais (format inconnu) : on ne ralentit pas, on le signale
    const c = await newPage(browser); const pg = c.page;
    await pg.clock.install(); await pg.goto(base); await withKey(pg); await upload(pg, srcRaw);
    await pg.evaluate(() => { window.__midi.confirm = 'never'; });
    await pg.click('#pedal-chip'); await pg.waitForSelector('#inj-slot'); await closeSlot(pg);
    await pg.locator('.slot[data-slot="DLY"] .sbtn').click();
    await pg.click('#ed-send'); await pg.clock.runFor(5000);
    const sent = await sentOf(pg);
    ok(sent.filter(m => m.length === 54).length === 1 && sent.length > 5, 'pédale sans confirmation : le module est envoyé quand même, sans renvoi du premier essai');
    const st = await pg.evaluate(() => ({ nc: __gp200.state.ed.noConf.length, msg: (document.getElementById('ed-msg') || {}).textContent || '' }));
    ok(st.nc === 1 && /confirmé/.test(st.msg), 'avertissement affiché : ' + st.msg.slice(0, 90));
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await c.ctx.close(); }

  console.log('8b. une erreur d\'affichage ne vide pas la page');
  { const c = await newPage(browser); const pg = c.page;
    await pg.goto(base); await withKey(pg); await upload(pg, srcRaw);
    await pg.evaluate(() => { __gp200.state.res.files[0].decoded.modules = null; __gp200.render(); });
    ok(await pg.locator('.shell').count() === 1 && await pg.locator('#render-error').count() === 1, 'erreur simulée : l\'écran reste affiché + bandeau « Erreur d\'affichage »');
    await c.ctx.close(); }

  console.log('9. pédale déjà autorisée : reconnexion automatique');
  { const c = await newPage(browser, null, { granted: true }); const pg = c.page;
    await pg.goto(base); await withKey(pg);
    await pg.waitForSelector('#live-switch', { timeout: 5000 });
    ok(/GP-200/.test(await pg.locator('#pedal-chip').innerText()), 'pastille « GP-200 » allumée sans clic');
    await c.ctx.close(); }

  console.log('10. anglais + mobile');
  { const c = await newPage(browser, { width: 390, height: 800 });
    await c.page.goto(base); await withKey(c.page); await c.page.click('button:has-text("EN")');
    await upload(c.page, srcRaw);
    await openTab(c.page, 'ctrl');
    ok(/CTRL 1 to 8 are the preset/.test(await c.page.locator('#ctrl-panel').innerText()), 'interface en anglais');
    ok(await c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal de la page à 390 px');
    await c.page.screenshot({ path: path.join(SHOTS, '18-refine-mobile.png'), fullPage: true });
    ok(c.problems.length === 0, 'aucune erreur console'); await c.ctx.close(); }

  console.log('8h. info-bulles : chaque contrôle en a une, les existantes ne sont pas écrasées, FR/EN');
  { const c = await newPage(browser); const pg = c.page;
    await pg.goto(base); await withKey(pg);
    const missing = () => pg.evaluate(() => Array.from(document.querySelectorAll('button, select, textarea, summary, a[href], input:not([type=file])')).filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.getAttribute('title') && !el.closest('label[title]'); }).map(el => (el.id || el.className || el.tagName) + ' « ' + (el.innerText || '').slice(0, 25) + ' »'));
    ok((await missing()).length === 0, 'accueil : aucun contrôle sans info-bulle : ' + JSON.stringify(await missing()));
    ok(/3 variantes/.test(await pg.locator('#mode-new').getAttribute('title')) && /Ctrl \+ Entrée/.test(await pg.locator('#demande').getAttribute('title')), 'textes en français sur le mode et la demande');
    ok(/Utiliser cet exemple/.test(await pg.locator('.ask-zone .chip').first().getAttribute('title')), 'les exemples expliquent leur effet');
    await upload(pg, srcRaw);
    ok((await missing()).length === 0, 'preset ouvert (rack + module) : aucun contrôle sans info-bulle : ' + JSON.stringify(await missing()));
    const tt = await pg.evaluate(() => Array.from(document.querySelectorAll('#module-box input[type=range]')).map(e => e.getAttribute('title')));
    ok(tt.length > 0 && tt.every(t => /Plage : -?\d/.test(t) && /par défaut/.test(t)), 'chaque curseur de paramètre : explication + plage + valeur par défaut : ' + JSON.stringify(tt[0]));
    ok(await pg.locator('#module-box input[type=number]').first().getAttribute('title') !== null && /curseur/.test(await pg.locator('#module-box input[type=number]').first().getAttribute('title')), 'le champ numérique explique aussi sa saisie');
    for (const t of ['result', 'pedal', 'ctrl', 'tune']) { await openTab(pg, t); const m = await missing(); ok(m.length === 0, 'fenêtre ' + t + ' : aucun contrôle sans info-bulle : ' + JSON.stringify(m)); await closePop(pg); }
    await openTab(pg, 'ctrl');
    ok(/CTRL 1/.test(await pg.locator('input[data-ctrl="1"]').first().getAttribute('title')), 'cases CTRL : « CTRL n » dans l\'info-bulle');
    await closePop(pg);
    // info-bulle existante : conservée telle quelle
    ok((await pg.locator('#build-version').getAttribute('title')).length > 10 && /^20\d\d-/.test(await pg.locator('#build-version').getAttribute('title')), 'l\'info-bulle de la version (existante) est intacte');
    await pg.click('[aria-pressed=false]:has-text("EN")');
    ok(/variants per section/.test(await pg.locator('#mode-new').getAttribute('title')) && /Range: /.test((await pg.evaluate(() => document.querySelector('#module-box input[type=range]').getAttribute('title')))), 'passage en anglais : les info-bulles suivent');
    ok((await missing()).length === 0, 'anglais : aucun contrôle sans info-bulle : ' + JSON.stringify(await missing()));
    await pg.click('#pedal-chip'); await pg.waitForSelector('#slot-modal');
    ok((await missing()).length === 0, 'dialogue du slot de travail : aucun contrôle sans info-bulle : ' + JSON.stringify(await missing()));
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await pg.context().close(); }

  console.log('8i. génération en attente : la chaîne du rack « clignote » même rack vide');
  { const c = await newPage(browser); const pg = c.page;
    await pg.goto(base); await withKey(pg);
    let release; const gate = new Promise(r => { release = r; });
    await pg.route(/generateContent/, async route => { await gate; await route.fulfill(gemini(SC.script[0].text)); });
    await pg.fill('#demande', 'Enter Sandman - Metallica'); await pg.click('#go');
    await pg.waitForSelector('.rack.scan');
    ok(await pg.locator('.rack.scan .slot .led').count() === 11, 'rack vide pendant la génération : une LED par module (11)');
    const seen = new Set();
    for (let i = 0; i < 12; i++) { seen.add(await pg.evaluate(() => Array.from(document.querySelectorAll('.rack .slot .led')).map(l => getComputedStyle(l).backgroundColor).join('|'))); await pg.waitForTimeout(140); }
    ok(seen.size >= 4, 'les LED s\'allument tour à tour (chenillard) : ' + seen.size + ' états différents');
    ok(await pg.locator('.rack.scan .slot > .sbtn').first().evaluate(el => getComputedStyle(el).animationName) === 'chasebtn', 'chaque module s\'illumine aussi légèrement');
    release();
    await pg.waitForSelector('.slot.fresh .mname', { timeout: 15000 });
    ok(await pg.locator('.rack.scan').count() === 0 && await pg.locator('.rack .slot > .sbtn .ledgap .led').count() === 0, 'génération finie : chenillard arrêté, LED de remplissage retirées');
    ok(c.problems.length === 0, 'aucune erreur console : ' + JSON.stringify(c.problems));
    await pg.context().close(); }

  console.log('\n=== e2e refine/ui : ' + pass + ' OK, ' + fail + ' echecs ===');
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
