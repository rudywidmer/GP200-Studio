#!/usr/bin/env node
/* Captures d'ecran du manuel (FR). Chromium + fausse pedale AVEC memoire (noms realistes) + faux Gemini.
 * Sortie : manual/img/*.png (avec reperes numerotes orange ajoutes par-dessus la page, jamais dans l'appli). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..', '..');
const LANG = process.env.MLANG === 'en' ? 'en' : 'fr';
const OUT = path.join(ROOT, 'manual', LANG === 'en' ? 'img_en' : 'img'); fs.mkdirSync(OUT, { recursive: true });
const LOC = LANG === 'en' ? 'en-US' : 'fr-FR';
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/read_fixture.json'), 'utf8'));
const exp = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/expected_gen.json'), 'utf8'));
const SC = exp.find(x => x.name === 'clean_pass');

// ---- fausse pedale (reprise de tests/e2e_memmove.js, avec de vrais noms)
const src = fs.readFileSync(path.join(ROOT, 'tests/e2e_memmove.js'), 'utf8');
const mINIT = src.match(/const INIT = (`[\s\S]*?\}\)\(\);`);/);
let INIT = new Function('fx', 'return ' + mINIT[1])(fx);
INIT = INIT.replace("const nm = 'P' + String(pc).padStart(3, '0') + (tag || '');", "const nm = ((window.__NAMES && window.__NAMES[pc]) || ('" + (LANG === 'en' ? 'Free' : 'Libre') + " ' + String((pc >> 2) + 1).padStart(2, '0') + '-' + 'ABCD'[pc & 3])) + (tag || '');");
const NAMES = {};
const bank = (b, arr) => arr.forEach((n, i) => { NAMES[(b - 1) * 4 + i] = n; });
const BANKS = {
  fr: { 1: ['Clean Brillant', 'Crunch Rock', 'Lead Chaud', 'Ambiance'], 2: ['Blues Doux', 'Blues Drive', 'Solo Blues', 'Slide'], 3: ['Funk Clean', 'Funk Wah', 'Octave Fat', 'Rythme Pop'], 4: ['Nirvana Clean', 'Nirvana Disto', 'Grunge Lead', 'Grunge Fuzz'], 5: ['AC/DC Rythme', 'AC/DC Lead', 'Hard Rock', 'Boogie'], 6: ['Pop Clean', 'Pop Chorus', 'Pop Lead', 'Ballade'], 7: ['Reggae Skank', 'Reggae Dub', 'Ska Rythme', 'Ska Lead'], 8: ['Jazz Clean', 'Jazz Chorus', 'Jazz Solo', 'Bossa'], 9: ['Country Twang', 'Country Lead', 'Chicken Pick', 'Slide Country'], 10: ['Metal Rythme', 'Metal Lead', 'Djent', 'Thrash'], 50: ['Travail 1', 'Travail 2', 'Travail 3', 'Travail 4'] },
  en: { 1: ['Bright Clean', 'Rock Crunch', 'Warm Lead', 'Ambient'], 2: ['Soft Blues', 'Blues Drive', 'Blues Solo', 'Slide'], 3: ['Funk Clean', 'Funk Wah', 'Fat Octave', 'Pop Rhythm'], 4: ['Nirvana Clean', 'Nirvana Dirt', 'Grunge Lead', 'Grunge Fuzz'], 5: ['AC/DC Rhythm', 'AC/DC Lead', 'Hard Rock', 'Boogie'], 6: ['Pop Clean', 'Pop Chorus', 'Pop Lead', 'Ballad'], 7: ['Reggae Skank', 'Reggae Dub', 'Ska Rhythm', 'Ska Lead'], 8: ['Jazz Clean', 'Jazz Chorus', 'Jazz Solo', 'Bossa'], 9: ['Country Twang', 'Country Lead', 'Chicken Pick', 'Country Slide'], 10: ['Metal Rhythm', 'Metal Lead', 'Djent', 'Thrash'], 50: ['Work 1', 'Work 2', 'Work 3', 'Work 4'] }
}[LANG];
for (const b in BANKS) bank(+b, BANKS[b]);
bank(40, ['Sandman Intro', 'Sandman Riff', 'Sandman Solo', 'Sandman End']);
bank(41, ['Wish You Intro', 'Wish You Clean', 'Wish You Solo', 'Wish You End']);
bank(42, ['Comfortably N.', 'Comfortably L.', 'Money Riff', 'Money Solo']);
bank(43, ['Cocaine Riff', 'Cocaine Lead', 'Layla Intro', 'Layla Lead']);
bank(44, ['Hotel Cal Intro', 'Hotel Cal Arp', 'Hotel Cal Solo', 'Hotel Cal End']);
INIT = 'window.__NAMES = ' + JSON.stringify(NAMES) + ';\n' + INIT;

const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
const gemini = text => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }) });
// reponse IA : sections construites a partir du scenario de test, avec des textes realistes
const SONGS_FR = {
  sandman: { artiste: 'Metallica', titre: 'Enter Sandman', pre: 'Sandman', rig: 'Riff sur ampli high-gain (Mesa/Boogie), intro clean avec chorus', structure: 'Intro clean, riff crunch, solo lead',
    sections: [['Intro', 'clean', 'Arpège clair avec chorus et delay discret.'], ['Riff', 'crunch', 'Riff serré, gain moyen, noise gate actif.'], ['Solo', 'lead', 'Lead saturé, delay et reverb plus présents.']] },
  wish: { artiste: 'Pink Floyd', titre: 'Wish You Were Here', pre: 'Wish', rig: 'Guitare acoustique puis lead clean chaud', structure: 'Intro clean, solo lead',
    sections: [['Intro', 'clean', 'Son clair, reverb large.'], ['Solo', 'lead', 'Lead chaud, delay à la noire pointée.']] },
  numb: { artiste: 'Pink Floyd', titre: 'Comfortably Numb', pre: 'Numb', rig: 'Clean avec phaser, solos très lyriques', structure: 'Couplet clean, refrain crunch, solo lead',
    sections: [['Couplet', 'clean', 'Clean cristallin, phaser léger.'], ['Refrain', 'crunch', 'Crunch ouvert, médiums présents.'], ['Solo', 'lead', 'Lead long sustain, delay et reverb.']] },
};
const SONGS_EN = {
  sandman: { artiste: 'Metallica', titre: 'Enter Sandman', pre: 'Sandman', rig: 'Riff on a high-gain amp (Mesa/Boogie), clean intro with chorus', structure: 'Clean intro, crunch riff, lead solo',
    sections: [['Intro', 'clean', 'Clean arpeggio with chorus and a discreet delay.'], ['Riff', 'crunch', 'Tight riff, medium gain, noise gate on.'], ['Solo', 'lead', 'Saturated lead, delay and reverb more present.']] },
  wish: { artiste: 'Pink Floyd', titre: 'Wish You Were Here', pre: 'Wish', rig: 'Acoustic guitar, then a warm clean lead', structure: 'Clean intro, lead solo',
    sections: [['Intro', 'clean', 'Clean tone, wide reverb.'], ['Solo', 'lead', 'Warm lead, dotted-quarter delay.']] },
  numb: { artiste: 'Pink Floyd', titre: 'Comfortably Numb', pre: 'Numb', rig: 'Clean with phaser, very lyrical solos', structure: 'Clean verse, crunch chorus, lead solo',
    sections: [['Verse', 'clean', 'Crystal clean, light phaser.'], ['Chorus', 'crunch', 'Open crunch, present mids.'], ['Solo', 'lead', 'Long-sustain lead, delay and reverb.']] },
};
const SONGS = LANG === 'en' ? SONGS_EN : SONGS_FR;
const Q = LANG === 'en'
  ? { sand: "Enter Sandman - Metallica, from the clean intro to the solo", wish: 'Wish You Were Here - Pink Floyd, clean intro then solo', numb: 'Comfortably Numb - Pink Floyd, clean verse and lead solo', favs: ['Sandman Intro A', 'Sandman Solo A', 'Wish Solo A', 'Numb Verse A', 'Numb Chorus A', 'Numb Solo A'] }
  : { sand: "Enter Sandman - Metallica, du clean d'intro au solo", wish: 'Wish You Were Here - Pink Floyd, intro clean puis solo', numb: 'Comfortably Numb - Pink Floyd, couplet clean et solo lead', favs: ['Sandman Intro A', 'Sandman Solo A', 'Wish Solo A', 'Numb Couplet A', 'Numb Refrain A', 'Numb Solo A'] };
function aiText(key) {
  const S = SONGS[key] || SONGS.sandman, j = JSON.parse(SC.script[0].text), s0 = j.sections[0];
  j.artiste = S.artiste; j.titre = S.titre; j.recherche = S.rig; j.structure = S.structure;
  j.sections = S.sections.map(([nom, role, raison]) => {
    const t = JSON.parse(JSON.stringify(s0).split('Intro').join(nom).replace('"role":"clean"', '"role":"' + role + '"'));
    t.role = role; t.nom = nom; t.raison = raison; t.variants.forEach(v => { v.spec.name = S.pre + ' ' + nom + ' ' + v.label; v.spec.description = raison; });
    return t;
  });
  return JSON.stringify(j);
}

// ---- reperes : cadres + pastilles numerotees, poses sur <body>
async function mark(page, items, opt) {
  await page.evaluate(([items]) => {
    let d = document.getElementById('__ann'); if (d) d.remove();
    d = document.createElement('div'); d.id = '__ann'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
    document.body.appendChild(d);
    items.forEach(it => {
      let r = null;
      if (it.rect) r = { left: it.rect[0], top: it.rect[1], width: it.rect[2], height: it.rect[3] };
      else { const el = typeof it.sel === 'string' ? document.querySelector(it.sel) : null; if (!el) { console.warn('repere introuvable ' + it.sel); return; } r = el.getBoundingClientRect(); }
      const pad = it.pad === undefined ? 3 : it.pad;
      if (!it.nobox) { const b = document.createElement('div'); b.style.cssText = 'position:absolute;border:2.5px solid #ff7a1a;border-radius:8px;box-shadow:0 0 0 1px rgba(0,0,0,.35);left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + 2 * pad) + 'px;height:' + (r.height + 2 * pad) + 'px'; d.appendChild(b); }
      const c = document.createElement('div'), pos = it.at || 'tl';
      let x = r.left - pad, y = r.top - pad;
      if (pos.indexOf('r') >= 0) x = r.left + r.width + pad; if (pos.indexOf('b') >= 0) y = r.top + r.height + pad;
      if (pos === 'c') { x = r.left + r.width / 2; y = r.top + r.height / 2; }
      if (it.dx) x += it.dx; if (it.dy) y += it.dy;
      c.textContent = it.n; c.style.cssText = 'position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#ff7a1a;color:#111;font:700 15px/26px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #111,0 2px 6px rgba(0,0,0,.5);left:' + x + 'px;top:' + y + 'px';
      d.appendChild(c);
    });
  }, [items]);
}
const unmark = page => page.evaluate(() => { const d = document.getElementById('__ann'); if (d) d.remove(); });
async function shot(page, name, o) {
  o = o || {};
  const f = path.join(OUT, name + '.png');
  const opt = { path: f };
  if (o.clip) opt.clip = o.clip;
  await page.screenshot(opt);
  console.log('  shot', name);
}
async function shotModal(page, name, pad) {
  pad = pad === undefined ? 16 : pad;
  const b = await page.evaluate(() => { const v = Array.from(document.querySelectorAll('.modal-veil')).pop(), d = v && v.firstElementChild; if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  if (!b) return shot(page, name);
  const vp = page.viewportSize(), x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return shot(page, name, { clip: { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: Math.min(vp.height - y, b.height + 2 * pad) } });
}
const box = async (page, sel) => page.locator(sel).first().boundingBox();
async function clipOf(page, sels, pad) {
  pad = pad === undefined ? 10 : pad; let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
  for (const s of sels) { const b = await box(page, s); if (!b) continue; x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height); }
  const vp = page.viewportSize();
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(vp.width, x2 + pad); y2 = Math.min(vp.height, y2 + pad);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
const closeSlot = async page => { if (await page.locator('#slot-close').count()) await page.click('#slot-close'); };
const closePop = async page => { await closeSlot(page); if (await page.locator('#pop-close').count()) await page.click('#pop-close'); };
const openTab = async (page, t) => { await closePop(page); await page.click('#tabbtn-' + t); await page.waitForTimeout(250); };
const row = (page, pc) => page.locator('.mem-row[data-pc="' + pc + '"]');
async function dnd(page, from, to) {
  await page.evaluate(([a, b]) => { const lst = document.getElementById('mem-list'), top = document.querySelector('.mem-row[data-pc="' + Math.min(a, b) + '"]'); lst.scrollTop = top.offsetTop - 4; }, [from, to]);
  await page.waitForTimeout(60);
  const a = await row(page, from).boundingBox(), b = await row(page, to).boundingBox();
  await page.mouse.move(a.x + 40, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + 45, a.y + a.height / 2 + 5, { steps: 3 });
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.move(b.x + 41, b.y + b.height / 2, { steps: 2 });
  await page.mouse.up(); await page.waitForTimeout(250);
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5, locale: LOC, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(INIT);
  await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://localhost') || u.startsWith('data:')) return r.continue(); if (/generateContent/.test(u)) { const body = r.request().postData() || ''; return r.fulfill(gemini(aiText(/Wish You/.test(body) ? 'wish' : /Numb/.test(body) ? 'numb' : 'sandman'))); } return r.abort(); });
  await page.goto(base);

  // 01 premiere visite : fenetre de connexion
  await page.waitForSelector('#setup-modal');
  await page.waitForTimeout(400);
  await mark(page, [{ sel: '#provider', n: 1 }, { sel: '#apikey', n: 2 }, { sel: '#setup-ok', n: 3 }, { sel: '#setup-skip', n: 4 }]);
  await shotModal(page, '01-connexion-ia'); await unmark(page);

  await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef'); await page.click('#setup-ok');
  await page.waitForTimeout(500);
  // 02 accueil vide
  await mark(page, [{ sel: '#mode-new', n: 1 }, { sel: '#mode-refine', n: 1, nobox: true, at: 'tr', dx: 4 }, { sel: '.topbar .btn, header .btn', n: 2 }]);
  await unmark(page);
  await shot(page, '02-accueil');

  // generation
  await page.fill('#demande', Q.sand); await page.click('#go');
  await page.waitForSelector('.slot.fresh .mname', { timeout: 20000 });
  await page.waitForTimeout(1800);
  await shot(page, '03-resultat-ia');

  // 2 autres chansons (pour la set list par chanson)
  for (const q of [Q.wish, Q.numb]) {
    await page.fill('#demande', q); await page.click('#go');
    await page.waitForFunction(n => document.querySelectorAll('.lib-row').length >= n, q === Q.wish ? 11 : 17, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.locator('.lib-row', { hasText: 'Sandman Intro A' }).first().click();
  await page.waitForTimeout(400);

  // pedale : connexion + slot de travail
  await page.click('#pedal-chip');
  await page.waitForSelector('#slot-modal', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.selectOption('#inj-bank', '50'); await page.selectOption('#inj-letter', 'D');
  await mark(page, [{ sel: '#inj-bank', n: 1, at: 'tl', dx: -22, dy: 10 }, { sel: '#inj-letter', n: 1, at: 'tr', dx: 22, dy: 10 }, { sel: '#inj-auto', n: 2, at: 'tl', dx: -22, dy: 10 }, { sel: '#inj-ok', n: 3 }]);
  await shotModal(page, '10-slot-de-travail'); await unmark(page);
  await page.click('#inj-ok');
  await page.waitForSelector('#mem-list', { timeout: 15000 });
  await page.waitForSelector('#mem-dnd-hint', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await closeSlot(page);
  await page.waitForTimeout(600);

  // 04 ecran complet annote
  await page.fill('#demande', Q.sand);
  await mark(page, [
    { sel: '#mode-new', n: 1 }, { sel: '#open-prst', n: 2 }, { sel: '#ai-chip', n: 3 }, { sel: '#pedal-chip', n: 4 }, { sel: '#slot-chip', n: 5 }, { sel: '.switch', n: 6 },
    { sel: '.mem.zone', n: 7, at: 'tr', dx: -16, dy: 12 }, { sel: 'aside.side', n: 8, at: 'tr', dx: -16, dy: 12 }, { sel: '.ask-zone', n: 9, at: 'tr', dx: -16, dy: 12 },
    { sel: '#rack-panel', n: 10, at: 'tr', dx: -16, dy: 12 }, { sel: '.tabs-zone', n: 11, at: 'tr', dx: -16, dy: 12 }, { sel: '#help-manual', n: 12 }, { sel: '#diag-link', n: 13 }]);
  await shot(page, '04-ecran-complet'); await unmark(page);

  // 05 colonne des presets + options de generation
  await page.locator('aside.side').evaluate(e => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(300);
  await shot(page, '05-presets-options', { clip: await clipOf(page, ['aside.side'], 4) });
  await page.locator('aside.side').evaluate(e => { e.scrollTop = 0; });

  // 06 module : edition en direct
  await page.locator('.rack li').nth(3).click(); await page.waitForTimeout(300);
  await mark(page, [{ sel: '#pvol', n: 1 }, { sel: '.rack li:nth-child(4)', n: 2 }, { sel: '.rack li:nth-child(4) .ledbtn', n: 3, nobox: true, at: 'tr', dx: 22, dy: 6 }, { sel: '#ed-model', n: 4 }, { sel: '#ed-state', n: 5 },
    { sel: '#tab-module input[type=range]', n: 6, at: 'br', dy: 8 }, { sel: '#ed-send', n: 7 }, { sel: '#ed-save', n: 8 }]);
  await shot(page, '06-module', { clip: await clipOf(page, ['#rack-panel', '.tabs-zone'], 8) }); await unmark(page);

  // 07 resultat (analyse de l'IA)
  await openTab(page, 'result'); await shotModal(page, '07-resultat'); await closePop(page);

  // 08 pedale (envoi)
  await openTab(page, 'pedal'); await page.waitForTimeout(300);
  await mark(page, [{ sel: '#pedal-read', n: 1 }, { sel: '#pedal-bank', n: 2, at: 'tr', dx: -8, dy: 14 }, { sel: '#pedal-letter', n: 2, at: 'tr', dx: -8, dy: 14 }, { sel: '#pedal-one', n: 3 }, { sel: '#pedal-three', n: 4 }]);
  await shotModal(page, '08-pedale'); await unmark(page); await closePop(page);

  // 09 CTRL
  await openTab(page, 'ctrl');
  const cb = page.locator('#ctrl-grid input[type=checkbox]');
  if (await cb.count() >= 22) { await cb.nth(3).check(); await cb.nth(8).check(); await cb.nth(11).check(); await page.waitForTimeout(300); }
  await mark(page, [{ sel: '#ctrl-grid', n: 1 }, { sel: '#ctrl-sum', n: 2 }, { sel: '#ctrl-send', n: 3 }]);
  await shotModal(page, '09-ctrl'); await unmark(page); await closePop(page);

  // 11 memoire : glisser-deposer
  await row(page, 156).scrollIntoViewIfNeeded();
  await row(page, 156).click({ modifiers: ['Control'] }); await row(page, 157).click({ modifiers: ['Control'] });      // 2 presets : le deplacement reste un plan (un seul preset = confirmation immediate)
  await dnd(page, 156, 165); await page.waitForSelector('#mem-plan');
  await mark(page, [{ sel: '#mem-plan', n: 1 }, { sel: '#mem-apply', n: 2 }, { sel: '#mem-cancel', n: 3 }, { sel: '.mem-row[data-pc="164"]', n: 4, at: 'tr' }, { sel: '.mem-row[data-pc="156"]', n: 5, at: 'tr' }]);
  await shot(page, '11-memoire-plan', { clip: await clipOf(page, ['.mem.zone'], 4) }); await unmark(page);
  await page.click('#mem-apply'); await page.waitForSelector('#mm-confirm');
  await mark(page, [{ sel: '#mm-list', n: 1 }, { sel: '#mm-go', n: 2 }, { sel: '#mm-no', n: 3 }]);
  await shotModal(page, '12-memoire-confirmation'); await unmark(page);
  const [dl] = await Promise.all([page.waitForEvent('download').catch(() => null), page.click('#mm-go')]);
  await page.waitForSelector('#mm-result', { timeout: 90000 });
  await shotModal(page, '13-memoire-resultat'); 
  await page.click('#mm-close').catch(() => {}); await page.waitForTimeout(600);
  // selection multiple
  await page.waitForSelector('#mem-dnd-hint', { timeout: 60000 }); await page.waitForTimeout(800);
  await page.evaluate(() => { const l = document.getElementById('mem-list'), r = document.querySelector('.mem-row[data-pc="20"]'); l.scrollTop = r.offsetTop - 4; });
  await page.waitForTimeout(200);
  await row(page, 20).click(); await page.waitForTimeout(700);
  await row(page, 23).click({ modifiers: ['Shift'] }); await page.waitForTimeout(400);
  await shot(page, '14-memoire-selection', { clip: await clipOf(page, ['.mem.zone'], 4) });

  // 15 menu contextuel
  await page.locator('.lib-row', { hasText: 'Sandman Riff B' }).first().click({ button: 'right' });
  await page.waitForSelector('#ctx-menu'); await page.waitForTimeout(300);
  await shot(page, '15-menu-contextuel', { clip: { x: 0, y: 150, width: 780, height: 640 } });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 16 favoris
  for (const n of Q.favs) await page.locator('.lib-line', { hasText: n }).first().locator('.keep').click();
  await page.waitForTimeout(500);
  await page.locator('aside.side').evaluate(e => { e.scrollTop = 0; });
  await mark(page, [{ sel: '#fav-bar', n: 1 }, { sel: '.keep[aria-pressed=true]', n: 2 }]);
  await shot(page, '16-favoris', { clip: await clipOf(page, ['aside.side'], 4) }); await unmark(page);
  console.log(await page.evaluate(() => Array.from(document.querySelectorAll('#fav-bar [id], #fav-bar button')).map(e => e.id || e.textContent).join(' | ')));

  // 17 set list
  await openTab(page, 'setlist');
  await page.selectOption('#sl-fill-bank', '50').catch(() => {}); await page.selectOption('#sl-fill-letter', 'A').catch(() => {});
  await page.click('#sl-fill-song').catch(e => console.log('sl-fill-song', e.message.slice(0, 80))); await page.waitForTimeout(400);
  await mark(page, [{ sel: '#sl-fill-bank', n: 1, at: 'tr', dx: -8, dy: 14 }, { sel: '#sl-fill', n: 2 }, { sel: '#sl-fill-song', n: 3 }, { sel: '#sl-list', n: 4 }, { sel: '#sl-send', n: 5 }, { sel: '#sl-zip', n: 6 }]);
  await shotModal(page, '17-setlist'); await unmark(page);
  await page.click('#sl-send').catch(() => {}); await page.waitForTimeout(400);
  if (await page.locator('#sl-confirm').count()) { await page.locator('#sl-confirm').evaluate(e => e.scrollIntoView({ block: 'end' })); await page.waitForTimeout(300); await mark(page, [{ sel: '#sl-ow', n: 1 }, { sel: '#sl-yes', n: 2 }, { sel: '#sl-no', n: 3 }]); await shotModal(page, '18-setlist-confirmation'); await unmark(page); await page.click('#sl-no'); }
  await closePop(page);

  await closePop(page);
  await row(page, 156).click().catch(() => {}); await page.waitForTimeout(500);
  await page.locator('.lib-row', { hasText: 'Sandman Intro A' }).first().click(); await page.waitForTimeout(600);
  // 19 harmonisation : formulaire du lot
  await openTab(page, 'tune'); await page.waitForTimeout(300);
  if (await page.locator('#tune-open').count()) { await page.click('#tune-open'); await page.waitForTimeout(400); }
  await page.waitForTimeout(300);
  await shot(page, 'x-tune-top');
  await page.locator('#tune-batch').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await mark(page, [{ sel: '#tune-batch', n: 1, pad: 0 }, { sel: '#tune-open-files', n: 2 }, { sel: '#tune-add-fav', n: 3 }, { sel: '#tune-add-all', n: 4 }, { sel: '#tune-start', n: 5 }]);
  await shotModal(page, '19-harmonisation-lot'); await unmark(page);
  await page.click('#tune-add-fav').catch(() => {}); await page.waitForTimeout(400);
  await mark(page, [{ sel: '#tune-batch', n: 1, pad: 0 }, { sel: '#tune-start', n: 2 }]);
  await shotModal(page, '20-harmonisation-favoris'); await unmark(page);
  await closePop(page);

  // 21 journal + signalement
  await page.click('#diag-link'); await page.waitForSelector('#diag-panel'); await page.waitForTimeout(300);
  await shot(page, '21-signaler', { clip: { x: 640, y: 740, width: 800, height: 260 } }); 
  await page.click('#diag-close').catch(() => {});

  // 22 mode affiner
  await page.click('#mode-refine'); await page.waitForTimeout(500);
  await shot(page, '22-affiner');
  await ctx.close();

  // 23 mobile
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: LOC, isMobile: true, hasTouch: true });
  const m = await ctx2.newPage();
  await m.addInitScript(INIT);
  await m.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://localhost') || u.startsWith('data:')) return r.continue(); if (/generateContent/.test(u)) return r.fulfill(gemini(aiText('sandman'))); return r.abort(); });
  await m.goto(base); await m.waitForSelector('#setup-modal');
  await m.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef'); await m.click('#setup-ok'); await m.waitForTimeout(400);
  await m.fill('#demande', 'Enter Sandman - Metallica'); await m.click('#go');
  await m.waitForSelector('.slot.fresh .mname', { timeout: 20000 }); await m.waitForTimeout(1500);
  await m.screenshot({ path: path.join(OUT, '23-mobile.png') });
  await ctx2.close();
  await browser.close(); server.close();
})();
