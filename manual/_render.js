const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.goto('file://' + process.argv[2]); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, preferCSSPageSize: true }); await b.close(); })();