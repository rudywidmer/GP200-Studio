#!/usr/bin/env node
/* Test de bout en bout dans Chromium, API simulees. Usage : node tests/e2e.js */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), cp = require('child_process');
const { chromium } = require(process.env.PW_PATH || '/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'tests', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const SC = n => exp.find(x => x.name === n);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(DIST)); }
  else { res.writeHead(404); res.end('nope'); }
});

const gemini = (text, extra) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1234, candidatesTokenCount: 567 } }, extra || {})) });

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const problems = [], external = [], reqs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  let script = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('data:')) return route.continue();
    reqs.push({ url, method: route.request().method(), headers: route.request().headers(), body: route.request().postData() });
    if (/generativelanguage\.googleapis\.com\/v1beta\/models\/[^:?]+:generateContent/.test(url)) {
      const r = script.shift();
      if (!r) return route.fulfill({ status: 500, body: 'no script' });
      return route.fulfill(typeof r === 'function' ? r() : gemini(r));
    }
    if (/generativelanguage\.googleapis\.com\/v1beta\/models\?/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    }
    if (/api\.anthropic\.com\/v1\/messages/.test(url)) {
      const r = script.shift();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: r }], usage: { input_tokens: 5, output_tokens: 6 }, stop_reason: 'end_turn' }) });
    }
    if (/openrouter\.ai\/auth\?/.test(url)) {
      const q = new URL(url).searchParams;
      return route.fulfill({ status: 302, headers: { location: q.get('callback_url') + '?code=CODE123' } });
    }
    if (/openrouter\.ai\/api\/v1\/auth\/keys/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ key: 'sk-or-v1-TESTKEY' }) });
    }
    if (/openrouter\.ai\/api\/v1\/models/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: [] }) });
    }
    external.push(url); return route.abort();
  });

  console.log('1. chargement');
  await page.goto(base + '/');
  await page.waitForSelector('#setup-modal');
  ok(await page.locator('text=Connecte une IA').count() === 1, 'etape 1 visible, cle absente');
  ok(await page.locator('#apikey').isVisible(), 'champ cle visible (fenetre de connexion)');
  ok(await page.locator('#setup-ok').isDisabled(), 'OK desactive tant que la cle est absente');
  await page.screenshot({ path: path.join(SHOTS, '01-start-desktop.png'), fullPage: true });

  console.log('2. generation Gemini avec auto-correction (2 sections)');
  const sc = SC('retry_bad_param_and_prose');
  script = sc.script.map(x => x.text);
  await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef');
  await page.click('#setup-ok');
  ok(await page.locator('#setup-modal').count() === 0, 'fenetre fermee apres OK');
  ok((await page.locator('#ai-chip').innerText()).includes('Gemini'), 'pastille IA : Gemini');
  await page.locator('.chip', { hasText: 'Nothing Else Matters' }).click();
  ok((await page.inputValue('#demande')).includes('Nothing Else Matters'), 'exemple copie dans le champ');
  await page.click('#go');
  await page.waitForSelector('.slot.fresh .mname', { timeout: 15000 });
  await page.waitForTimeout(1500);
  ok(script.length === 0, '3 appels API consommes (prose, param inconnu, ok)');
  const g = reqs.filter(r => /generateContent/.test(r.url));
  ok(g.length === 3, 'trois requetes Gemini : ' + g.length);
  ok(g[0].headers['x-goog-api-key'] === 'AIzaSyFAKEKEY_0123456789abcdef' && !/key=/.test(g[0].url), 'cle en en-tete, pas dans l\'URL');
  const b0 = JSON.parse(g[0].body);
  ok(b0.generationConfig.responseMimeType === 'application/json' && !b0.tools, 'JSON force sans google_search');
  ok(b0.system_instruction.parts[0].text === sc.calls[0].system, 'prompt systeme identique a Python');
  ok(JSON.parse(g[2].body).contents.length === 5, 'historique de correction envoye (5 messages)');
  await page.screenshot({ path: path.join(SHOTS, '02-results-desktop.png'), fullPage: true });
  const tabs = await page.locator('.lib-row').allTextContents();
  ok(tabs.length >= 5, 'bibliotheque : sections + variantes : ' + JSON.stringify(tabs));
  ok(await page.locator('.slot').count() === 11, '11 slots dans le rack');
  ok(await page.locator('.slot.on').count() > 0, 'des LED allumees');
  await page.locator('.slot > .sbtn:not([disabled])').first().click();
  ok(await page.locator('.tabbody input[type=range]').count() > 0, 'onglet Module : reglages affiches');

  console.log('3. telechargements');
  const expFiles = sc.files;
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#dl-one')]);
  const p1 = path.join(SHOTS, d1.suggestedFilename()); await d1.saveAs(p1);
  const got1 = fs.readFileSync(p1).toString('hex');
  ok(expFiles[0].rel.endsWith(d1.suggestedFilename()) && got1 === expFiles[0].hex, 'premier .prst identique a Python : ' + d1.suggestedFilename());
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#dl-all')]);
  const zp = path.join(SHOTS, 'all.zip'); await d2.saveAs(zp);
  ok(/\.zip$/.test(d2.suggestedFilename()) && /Metallica - Enter Sandman - \d{8} - \d{6}\.zip/.test(d2.suggestedFilename()), 'nom du zip : ' + d2.suggestedFilename());
  let t = ''; try { t = cp.execSync('unzip -t "' + zp + '"').toString(); } catch (e) { t = String(e.stdout); }
  ok(/No errors detected/.test(t), 'unzip -t sans erreur');
  const py = cp.execSync(`python3 -c "
import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({i.filename:z.read(i.filename).hex() for i in z.infolist()}))" "${zp}"`, { maxBuffer: 1 << 26 }).toString();
  const zmap = JSON.parse(py);
  const names = Object.keys(zmap);
  const prstNames = names.filter(n => n.endsWith('.prst'));
  ok(prstNames.length === expFiles.length && names.length === 2 * expFiles.length, 'zip : ' + prstNames.length + ' .prst + ' + (names.length - prstNames.length) + ' .json');
  const rootDir = names[0].split('/')[0];
  ok(expFiles.every(f => zmap[rootDir + '/' + f.rel.split(path.sep).join('/')] === f.hex), 'chaque .prst du zip identique octet pour octet a Python');

  console.log('4. langue + mobile');
  await page.click('.seg button:has-text("EN")');
  ok(await page.locator('text=Describe the sound you want').count() === 1, 'bascule en anglais');
  await page.click('.seg button:has-text("FR")');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '03-results-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, 'pas de defilement horizontal sur mobile (' + overflow + ')');
  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('5. erreurs lisibles');
  script = [() => ({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) })];
  await page.click('#go');
  await page.waitForSelector('.ask-zone .note.err', { timeout: 10000 });
  ok(/clé API est refusée/.test(await page.locator('.ask-zone .note.err').first().innerText()), 'cle refusee : message en francais');
  script = [() => ({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Quota exceeded' } }) })];

  console.log('6. annulation');
  script = [() => new Promise(() => {})];            // ne repond jamais (non utilise : fulfill sync) -> on simule lent ci-dessous
  script = [];
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith('data:')) return route.continue();
    if (/generateContent/.test(url)) { await new Promise(r => setTimeout(r, 4000)); return route.fulfill(gemini('{}')).catch(() => {}); }
    return route.abort();
  });
  await page.reload();
  await page.waitForSelector('#go');
  await page.fill('#demande', 'Test annulation');
  await page.click('#go');
  await page.waitForSelector('.rack.scan');
  ok(true, 'rack en mode scan pendant l\'attente');
  await page.screenshot({ path: path.join(SHOTS, '04-busy.png') });
  await page.click('button.stop');
  await page.waitForSelector('#go', { timeout: 5000 });
  ok(true, 'annulation : retour a l\'etat initial');

  console.log('7. OpenRouter (PKCE) + Anthropic');
  await page.unroute('**/*');
  const orReq = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith('data:')) return route.continue();
    orReq.push({ url, body: route.request().postData(), headers: route.request().headers() });
    if (/openrouter\.ai\/auth\?/.test(url)) { const q = new URL(url).searchParams; return route.fulfill({ status: 302, headers: { location: q.get('callback_url') + '?code=CODE123' } }); }
    if (/auth\/keys/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ key: 'sk-or-v1-TESTKEY' }) });
    if (/openrouter\.ai\/api\/v1\/models/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: [] }) });
    if (/api\.anthropic\.com\/v1\/messages/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: SC('clean_pass').script[0].text }], usage: { input_tokens: 5, output_tokens: 6 }, stop_reason: 'end_turn' }) });
    return route.abort();
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.selectOption('#provider', 'openrouter');
  await page.click('button:has-text("Se connecter avec OpenRouter")');
  await page.waitForFunction(() => /OpenRouter ·/.test((document.getElementById('ai-chip') || {}).innerText || ''), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const authReq = orReq.find(r => /openrouter\.ai\/auth\?/.test(r.url)), exch = orReq.find(r => /auth\/keys/.test(r.url));
  ok(!!authReq && /code_challenge_method=S256/.test(authReq.url), 'redirection OpenRouter avec S256');
  const chal = new URL(authReq.url).searchParams.get('code_challenge');
  const ver = JSON.parse(exch.body).code_verifier;
  ok(JSON.parse(exch.body).code === 'CODE123' && crypto.createHash('sha256').update(ver).digest('base64url') === chal, 'echange : sha256(verifier) = challenge');
  ok(page.url() === base + '/', 'URL nettoyee (?code retire)');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gp200studio.web.v1')));
  ok(stored.keys.openrouter === 'sk-or-v1-TESTKEY' && stored.provider === 'openrouter', 'cle OpenRouter memorisee');
  ok(await page.locator('#setup-modal').count() === 0 && (await page.locator('#ai-chip').innerText()).includes('OpenRouter'), 'fenetre fermee, pastille IA : OpenRouter');
  await page.screenshot({ path: path.join(SHOTS, '05-openrouter-connected.png'), fullPage: false });

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.selectOption('#provider', 'anthropic');
  await page.fill('#apikey', 'sk-ant-api03-FAKE');
  await page.click('#setup-ok');
  await page.fill('#demande', 'Un clean chaud');
  await page.click('#go');
  await page.waitForSelector('.slot.fresh .mname', { timeout: 10000 });
  const an = orReq.find(r => /anthropic/.test(r.url));
  ok(an.headers['anthropic-dangerous-direct-browser-access'] === 'true' && an.headers['x-api-key'] === 'sk-ant-api03-FAKE' && an.headers['anthropic-version'], 'en-tetes Anthropic navigateur OK');

  console.log('8. isolation');
  ok(external.length === 0, 'aucune requete non prevue : ' + JSON.stringify(external));
  const bad = problems.filter(p => !/Failed to load resource/.test(p));
  ok(bad.length === 0, 'aucune erreur console / CSP : ' + JSON.stringify(bad));
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
  ok(/script-src 'sha256-/.test(csp) && !/unsafe-eval/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), 'CSP stricte (script par empreinte)');

  console.log('\n=== e2e : ' + pass + ' OK, ' + fail + ' echecs ===');
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
