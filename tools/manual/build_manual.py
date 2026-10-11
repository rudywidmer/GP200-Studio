#!/usr/bin/env python3
"""Usage : build_manual.py [fr|en]. Fabrique manual/manuel_fr.html (ou manual_en.html) puis le PDF (Chromium via Playwright).
Deux passes : la 1re mesure la page de chaque chapitre, la 2e les inscrit dans le sommaire."""
import json, os, re, subprocess, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
M = os.path.join(ROOT, 'manual')
LANG = 'en' if (len(sys.argv) > 1 and sys.argv[1] == 'en') else 'fr'
VERSION = '0.30.3'
TXT = {
    'fr': dict(date='11 octobre 2026', foot='Mode d\\2019 emploi', body='body_fr.html', img='img', html='manuel_fr.html', pdf='GP200-Studio-Web_Mode-d-emploi_FR.pdf',
               title='GP-200 Studio Web — Mode d’emploi', cover_h='GP-200 Studio <em>Web</em><br>Mode d’emploi', edition='Édition française', toc='Sommaire',
               sub='Générer, ouvrir, régler et ranger tes presets, les envoyer dans la pédale en USB, préparer un concert et harmoniser les volumes — le tout dans ton navigateur.',
               ver='Version', note='Ce manuel décrit la version %s de GP-200 Studio Web. Le numéro de version et la date de fabrication s’affichent en bas de l’appli : c’est le moyen de vérifier que tu utilises la bonne.'),
    'en': dict(date='October 11, 2026', foot='User manual', body='body_en.html', img='img_en', html='manual_en.html', pdf='GP200-Studio-Web_User-Manual_EN.pdf',
               title='GP-200 Studio Web — User manual', cover_h='GP-200 Studio <em>Web</em><br>User manual', edition='English edition', toc='Contents',
               sub='Generate, open, tweak and organize your presets, send them to the pedal over USB, prepare a gig and match volumes — all in your browser.',
               ver='Version', note='This manual describes version %s of GP-200 Studio Web. The version number and build date are shown at the bottom of the app: that is how to check you are using the right one.'),
}[LANG]
DATE = TXT['date']

CSS = r'''
@page { size: A4; margin: 17mm 17mm 20mm 17mm;
  @bottom-left { content: "GP-200 Studio Web \00B7  @@FOOT@@"; font: 500 8pt Inter, sans-serif; color: #8a98a5; }
  @bottom-right { content: counter(page); font: 600 8.5pt Inter, sans-serif; color: #5d6c79; } }
@page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
@page toc { @bottom-right { content: none; } }
:root { --ink:#16232e; --dim:#52626f; --acc:#128ab0; --acc-d:#0c6a8a; --acc-l:#e4f4fa; --or:#ff7a1a; --line:#d9e1e7; --bg2:#f4f7f9; }
* { box-sizing: border-box; }
html { font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: var(--ink); font-size: 9.35pt; line-height: 1.47; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; }
p { margin: 0 0 2.6mm; orphans: 3; widows: 3; }
b { font-weight: 650; }
code { font: 500 8.4pt "DejaVu Sans Mono", monospace; background: #eaf0f4; border-radius: 3px; padding: 0.3mm 1.2mm; color: #0f3d52; }
kbd { font: 600 7.8pt "DejaVu Sans Mono", monospace; background: #fff; border: 1px solid #b8c4cd; border-bottom-width: 2px; border-radius: 3px; padding: 0.2mm 1.4mm; color: #22313c; }
ul, ol { margin: 0 0 3mm; padding-left: 5.2mm; }
li { margin: 0 0 1.4mm; }

/* couverture */
.cover { page: cover; height: 297mm; width: 210mm; position: relative; overflow: hidden; color: #fff; page-break-after: always;
  background: radial-gradient(120% 80% at 80% 0%, #17566f 0%, #0d2330 45%, #08141c 100%); }
.cover .logo { position: absolute; left: 22mm; top: 24mm; display: flex; align-items: center; gap: 4mm; }
.cover .tag { font: 600 9pt Inter; letter-spacing: .18em; text-transform: uppercase; color: #7fd3ee; }
.cover h1 { position: absolute; left: 22mm; top: 62mm; margin: 0; font: 800 44pt/1.04 "Inter Display", Inter; letter-spacing: -.02em; width: 150mm; }
.cover h1 em { font-style: normal; color: #4cc3e6; }
.cover .sub { position: absolute; left: 22mm; top: 112mm; width: 140mm; font: 400 13pt/1.5 Inter; color: #c5d7e0; }
.cover .hero { position: absolute; left: 22mm; right: -40mm; top: 158mm; height: 108mm; border-radius: 10px 0 0 10px; box-shadow: 0 18px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.12); overflow: hidden; }
.cover .hero img { display: block; width: 100%; }
.cover::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 32mm; background: linear-gradient(180deg, rgba(8,20,28,0), #08141c 62%); }
.cover .meta { z-index: 2; }
.cover .meta { position: absolute; left: 22mm; bottom: 14mm; font: 500 9pt Inter; color: #9fb6c2; }
.cover .meta b { color: #fff; }

/* sommaire */
.toc { page: toc; page-break-after: always; }
.toc h1 { font: 800 26pt "Inter Display", Inter; margin: 0 0 8mm; letter-spacing: -.01em; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { display: flex; align-items: baseline; gap: 3mm; padding: 2.1mm 0; border-bottom: 1px solid var(--line); margin: 0; font-size: 10.6pt; }
.toc li .n { flex: none; width: 8mm; font: 800 12pt "Inter Display", Inter; color: var(--acc); }
.toc li .t { flex: none; font-weight: 600; }
.toc li .d { flex: 1; border-bottom: 1.5px dotted #b9c6cf; transform: translateY(-1.2mm); }
.toc li .p { flex: none; font-weight: 700; color: var(--dim); }
.toc .note { margin-top: 9mm; color: var(--dim); font-size: 9pt; }

/* chapitres */
.chap { page-break-before: always; }
.chap > h1 { break-after: avoid; break-inside: avoid; }
#c16 { font-size: 8.7pt; line-height: 1.38; }
#c16 h2, #c16 h3 { margin-top: 3.5mm; }
#c16 table, #c16 .kv { font-size: 8pt; margin-bottom: 2.5mm; }
#c16 td, #c16 th { padding-top: 1mm; padding-bottom: 1mm; }
.chap.cont { page-break-before: auto; margin-top: 7mm; }
.chap > h1 { display: flex; align-items: center; gap: 4mm; margin: 0 0 4mm; font: 800 24pt/1.1 "Inter Display", Inter; letter-spacing: -.015em; color: #0d2330; }
.chap > h1 .num { flex: none; width: 13mm; height: 13mm; border-radius: 3.4mm; background: var(--acc); color: #fff; display: grid; place-items: center; font: 800 17pt "Inter Display", Inter; letter-spacing: 0; }
.chap .lead { font-size: 10.8pt; line-height: 1.47; color: #27414f; margin-bottom: 4mm; padding-bottom: 3mm; border-bottom: 1px solid var(--line); }
h2 { font: 750 12.8pt "Inter Display", Inter; margin: 5.4mm 0 2.2mm; color: #0d2330; break-after: avoid; padding-bottom: 1.2mm; border-bottom: 2px solid var(--acc-l); }
h3 { font: 700 10.8pt Inter; margin: 4.5mm 0 2mm; color: var(--acc-d); break-after: avoid; }

/* figures */
figure { margin: 3mm 0 4.5mm; break-inside: avoid; }
figure img { display: block; width: 100%; border-radius: 6px; border: 1px solid #c9d3da; box-shadow: 0 2px 8px rgba(20,40,60,.12); }
figcaption { font-size: 8.2pt; color: var(--dim); margin-top: 1.6mm; }
figcaption b { color: var(--acc-d); }
.side-by { display: flex; gap: 6mm; align-items: flex-start; margin: 2mm 0 4mm; break-inside: avoid; }
.side-by > div { flex: 1; min-width: 0; }
.side-by figure { margin: 0; flex: none; }
figure.narrow { width: 50mm; }
figure.narrow.s44 { width: 44mm; }
figure.narrow.s56 { width: 58mm; }
figure.narrow2 { width: 78mm; }
figure.wide { margin-left: auto; margin-right: auto; }
figure.w48 { width: 48%; }
figure.w50 { width: 50%; }
figure.w52 { width: 52%; }
figure.w66 { width: 66%; }
figure.w56 { width: 56%; }
figure.w60 { width: 60%; }
figure.w62 { width: 62%; }
figure.w76 { width: 76%; }
figure.w78 { width: 78%; }
figure.w80 { width: 80%; }
figure.w84 { width: 84%; }
figure.w86 { width: 86%; }
figure.w80x { width: 80%; }
figure.w88 { width: 88%; }
figure.w92 { width: 92%; }
figure.w94 { width: 94%; }
figure.w100 { width: 100%; }

.chips { display: flex; flex-wrap: wrap; gap: 2mm; margin: 1mm 0 3mm; }
.chip { padding: 1.2mm 3mm; border-radius: 0 4px 4px 0; border-left: 1.2mm solid; font-size: 8.6pt; }
.chip.tip { background: #e8f6fb; border-color: #1a9fc7; } .chip.warn { background: #fff1e4; border-color: #ff7a1a; } .chip.safe { background: #e8f7ee; border-color: #2fa866; } .chip.hw { background: #f0f1f4; border-color: #7b8794; }
table.nobreak { break-inside: avoid; }

/* listes speciales */
ol.legend { list-style: none; padding: 0; margin: 2mm 0 4mm; counter-reset: lg; }
ol.legend li { position: relative; padding-left: 8mm; counter-increment: lg; margin-bottom: 1.6mm; }
ol.legend li::before, .n { content: counter(lg); }
ol.legend li::before { position: absolute; left: 0; top: .2mm; width: 5.2mm; height: 5.2mm; border-radius: 50%; background: var(--or); color: #1b1206; font: 800 7.6pt/5.2mm Inter; text-align: center; box-shadow: 0 0 0 .5mm #fff, 0 0 0 .7mm #1b1206; }
.n { display: inline-block; width: 4.6mm; height: 4.6mm; border-radius: 50%; background: var(--or); color: #1b1206; font: 800 7pt/4.6mm Inter; text-align: center; content: none; vertical-align: middle; }
ol.steps { list-style: none; padding: 0; counter-reset: st; }
ol.steps > li { position: relative; padding: 0 0 0 10mm; margin-bottom: 3mm; counter-increment: st; min-height: 7mm; }
ol.steps > li::before { content: counter(st); position: absolute; left: 0; top: -.4mm; width: 7mm; height: 7mm; border-radius: 50%; background: var(--acc); color: #fff; font: 800 10pt/7mm "Inter Display", Inter; text-align: center; }
ol.steps.small > li { padding-left: 8mm; margin-bottom: 1.8mm; min-height: 0; }
ol.steps.small > li::before { width: 5.4mm; height: 5.4mm; font-size: 8pt; line-height: 5.4mm; top: .2mm; }
ul.check { list-style: none; padding-left: 0; }
ul.check li { padding-left: 6.5mm; position: relative; }
ul.check li::before { content: "✓"; position: absolute; left: 0; top: 0; color: var(--acc); font-weight: 800; }

/* encadres */
.box { margin: 3mm 0; padding: 2.6mm 4mm 2.6mm 4.4mm; border-radius: 0 6px 6px 0; border-left: 1.4mm solid; font-size: 9.2pt; break-inside: avoid; }
.box.tip { background: #e8f6fb; border-color: #1a9fc7; }
.box.warn { background: #fff1e4; border-color: #ff7a1a; }
.box.safe { background: #e8f7ee; border-color: #2fa866; }
.box.hw { background: #f0f1f4; border-color: #7b8794; }
.box b:first-child { text-transform: none; }

/* tableaux */
table { border-collapse: collapse; width: 100%; margin: 2mm 0 4.5mm; font-size: 8.9pt; break-inside: auto; }
tr { break-inside: avoid; }
th, td { border: 1px solid var(--line); padding: 1.6mm 2.4mm; vertical-align: top; text-align: left; }
th { background: var(--bg2); font-weight: 650; }
table.kv th { width: 24mm; background: var(--acc-l); }
table.grid tr:nth-child(even) td { background: #fafcfd; }
table.keys td:first-child { width: 62mm; white-space: nowrap; }
table.trouble td:first-child { width: 42mm; font-weight: 600; }
table.mods td:nth-child(odd) { width: 14mm; background: var(--bg2); }
dl.gloss { margin: 0; }
dl.gloss dt { font-weight: 700; color: var(--acc-d); margin-top: 2.2mm; break-after: avoid; }
dl.gloss dd { margin: 0 0 1mm 0; }
'''

LOGO = '''<svg width="46" height="46" viewBox="0 0 46 46"><rect x="1.5" y="1.5" width="43" height="43" rx="10" fill="#0b1d28" stroke="#3ab6dc" stroke-width="2.4"/>
<rect x="9" y="17" width="28" height="12" rx="6" fill="none" stroke="#3ab6dc" stroke-width="2.4"/><circle cx="17" cy="23" r="3.2" fill="#3ab6dc"/><circle cx="29" cy="23" r="3.2" fill="#ff5a4d"/></svg>'''


def toc_entries(body):
    return [(m.group(1), re.sub(r'<[^>]+>', '', m.group(3)).strip(), m.group(0)) for m in
            re.finditer(r'<section class="chap[^"]*" id="(c\d+)">\s*<h1><span class="num">(\d+)</span>(.*?)</h1>', body, re.S)] and \
           [(re.search(r'id="(c\d+)"', x).group(1), re.search(r'<span class="num">(\d+)</span>', x).group(1),
             re.sub(r'<[^>]+>', '', re.search(r'</span>(.*?)</h1>', x, re.S).group(1)).strip())
            for x in re.findall(r'<section class="chap[^"]*" id="c\d+">\s*<h1>.*?</h1>', body, re.S)]


def build(pages):
    body = open(os.path.join(M, TXT['body']), encoding='utf-8').read()
    ent = toc_entries(body)
    toc = ''.join('<li><span class="n">%s</span><span class="t">%s</span><span class="d"></span><span class="p">%s</span></li>' % (n, t, pages.get(cid, '')) for cid, n, t in ent)
    cover = '''<section class="cover">
<div class="logo">%s<div class="tag">Valeton GP-200 · GP-150 · GP-180</div></div>
<h1>%s</h1>
<div class="sub">%s</div>
<div class="hero"><img src="%s/04-ecran-complet.jpg"></div>
<div class="meta"><b>%s %s</b> · %s · %s</div></section>''' % (LOGO, TXT['cover_h'], TXT['sub'], TXT['img'], TXT['ver'], VERSION, DATE, TXT['edition'])
    tocsec = '<section class="toc"><h1>%s</h1><ol>%s</ol><p class="note">%s</p></section>' % (TXT['toc'], toc, TXT['note'] % VERSION)
    html = '<!doctype html><html lang="%s"><head><meta charset="utf-8"><title>%s</title><style>%s</style></head><body>%s%s%s</body></html>' % (LANG, TXT['title'], CSS.replace('@@FOOT@@', TXT['foot']), cover, tocsec, body)
    out = os.path.join(M, TXT['html'])
    open(out, 'w', encoding='utf-8').write(html)
    return out, ent


def render(html, pdf):
    js = os.path.join(M, '_render.js')
    open(js, 'w').write('''const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.goto('file://' + process.argv[2]); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, preferCSSPageSize: true }); await b.close(); })();''')
    subprocess.check_call(['node', js, html, pdf])


def pages_of(pdf, ent):
    from pypdf import PdfReader
    r = PdfReader(pdf)
    norm = lambda x: re.sub(r'[\s\u2019\u02bc\']+', '', x)
    texts = [norm(p.extract_text() or '') for p in r.pages]
    res = {}
    for cid, n, t in ent:
        key = norm(str(n) + t)
        for i in range(2, len(texts)):                      # apres couverture et sommaire
            if key in texts[i]:
                res[cid] = str(i + 1); break
    return res, len(texts)


if __name__ == '__main__':
    pdf = os.path.join(M, TXT['pdf'])
    html, ent = build({})
    render(html, pdf)
    pages, n = pages_of(pdf, ent)
    html, ent = build(pages)
    render(html, pdf)
    pages2, n2 = pages_of(pdf, ent)
    print('pages', n2, 'sommaire stable:', pages == pages2)
    print(json.dumps(pages2))
