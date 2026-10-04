#!/usr/bin/env node
/* Fuzz de l'interface : tous les modeles de tous les slots, clics et double-clics sur le rack, onglets. Detecte toute exception (= page noire). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const G = require('../web/src/gp200core.js');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle.json'), 'utf8'));
const tb = new G.Tables(bundle.tables);
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const base0 = Uint8Array.from(Buffer.from(exp.find(x => x.name === 'clean_pass').files[0].hex, 'hex'));
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.V) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
process.on('unhandledRejection', () => {});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const errs = []; global.__errs = errs; global.__page = page;
  page.on('pageerror', e => errs.push('pageerror: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(0, 3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.route('**/*', r => (/^(http:\/\/localhost|data:)/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(base);
  await page.waitForSelector('#setup-modal'); await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef'); await page.click('#setup-ok');
  await page.setInputFiles('#prst-file', { name: 'base.prst', mimeType: 'application/octet-stream', buffer: Buffer.from(base0) });
  await page.waitForSelector('.lib-entry');
  const alive = async tag => { const n = await page.locator('.shell').count(); const b = await page.locator('.sbtn').count(); if (n !== 1 || b < 11) { ok(false, 'page cassee apres ' + tag + ' (shell=' + n + ', sbtn=' + b + ')'); return false; } return true; };
  const TABS = ['result', 'pedal', 'ctrl', 'tune'];
  let n = 0;
  for (const slot of G.MODULES) {
    const list = tb.modelsForSlot(slot);
    await page.locator(`.slot[data-slot="${slot}"] .sbtn`).click();
    for (let i = 0; i < list.length; i++) {
      await page.selectOption('#ed-model', String(i));
      n++;
      if (errs.length) { ok(false, slot + ' modele #' + i + ' ' + list[i][0].name + ' : ' + errs.join(' ; ')); errs.length = 0; }
      if (i % 7 === 0) {
        // clics / doubles-clics sur chaque effet, dans chaque onglet
        const t = TABS[(i / 7 | 0) % TABS.length];
        await page.click('#tabbtn-' + t); await page.waitForSelector('#pop'); await page.keyboard.press('Escape');
        for (const s2 of G.MODULES) { const b = page.locator(`.slot[data-slot="${s2}"] .sbtn`); if (i % 14 === 0) await b.dblclick({ timeout: 3000 }); else await b.click({ timeout: 3000 }); if (errs.length) { console.log('ERREUR : modele', slot, '#' + i, list[i][0].name, '(cat ' + list[i][1] + ') puis clic sur', s2, 'onglet', t, '=>', errs[0].slice(0, 200)); process.exit(1); } }
        await page.locator(`.slot[data-slot="${slot}"] .sbtn`).click();
        await page.waitForTimeout(0);
        if (errs.length) { ok(false, slot + ' #' + i + ' clics onglet ' + t + ' : ' + errs.join(' ; ')); errs.length = 0; }
        if (!(await alive(slot + '#' + i))) { console.log(errs); await browser.close(); server.close(); process.exit(1); }
      }
    }
    ok(await alive(slot), slot + ' : ' + list.length + ' modeles OK');
  }
  console.log('rendus de modele :', n);
  // LED + sliders aux extremes
  for (const slot of G.MODULES) {
    await page.locator(`.slot[data-slot="${slot}"] .sbtn`).click();
    const cnt = await page.locator('#module-box input[type=range]').count();
    for (let i = 0; i < cnt; i++) for (const side of ['min', 'max']) await page.evaluate(([i, side]) => { const el = document.querySelectorAll('#module-box input[type=range]')[i]; el.value = el.getAttribute(side); el.dispatchEvent(new Event('input', { bubbles: true })); }, [i, side]);
    await page.locator(`.slot[data-slot="${slot}"] .ledbtn`).click({ timeout: 2000 }).catch(() => {});
  }
  ok(errs.length === 0, 'aucune erreur : ' + JSON.stringify(errs.slice(0, 3)));
  await alive('fin');
  console.log(`\n=== fuzz ui : ${pass} OK, ${fail} echecs ===`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error(String(e).slice(0, 300)); try { console.error('ERRS', JSON.stringify(global.__errs)); console.error(await global.__page.evaluate(() => document.getElementById('app').innerHTML.length + ' | ' + document.body.innerText.slice(0, 200))); } catch (x) {} process.exit(2); });
