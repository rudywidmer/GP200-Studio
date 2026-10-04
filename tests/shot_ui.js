const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_gen.json'), 'utf8'));
const SC = exp.find(x => x.name === 'clean_pass');
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.join(ROOT, 'web/dist/index.html'))); });
const gemini = text => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }) });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [name, vp] of [['desk', { width: 1440, height: 860 }], ['laptop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'fr-FR' });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
    await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://localhost') || u.startsWith('data:')) return r.continue(); if (/generateContent/.test(u)) return r.fulfill(gemini(SC.script[0].text)); return r.abort(); });
    await page.goto(base);
    await page.screenshot({ path: `tests/shots/20-${name}-first.png` });
    await page.fill('#apikey', 'AIzaSyFAKEKEY_0123456789abcdef'); await page.click('#setup-ok');
    await page.fill('#demande', 'Enter Sandman - Metallica'); await page.click('#go');
    await page.waitForSelector('.slot.fresh .mname', { timeout: 15000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `tests/shots/21-${name}-gen.png`, fullPage: name === 'mobile' });
    console.log(name, 'scroll', await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]));
    await ctx.close();
  }
  await browser.close(); server.close();
})();
