#!/usr/bin/env python3
"""Apres shots.js : recadre les captures etroites / copiees des tests et convertit tout en JPEG (manual/img/*.jpg)."""
import glob, os, sys
LANG = 'en' if len(sys.argv) > 1 and sys.argv[1] == 'en' else 'fr'
IMG = 'img_en' if LANG == 'en' else 'img'
TS = 'shots_en' if LANG == 'en' else 'shots'
from PIL import Image
M = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'manual'))
T = os.path.abspath(os.path.join(M, '..', 'tests', TS))
os.chdir(M)
for src, dst, box in [(T + '/10-tune-running.png', IMG + '/24-harmonisation-en-cours.png', (138, 28, 1142, 604)),
                      (T + '/11-tune-done.png', IMG + '/25-harmonisation-fin.png', (138, 28, 1142, 966))]:
    Image.open(src).crop(box).save(dst)
im = Image.open(IMG + '/18-setlist-confirmation.png')
if im.size[1] > 600: im.crop((0, im.size[1] - 358, im.size[0], im.size[1])).save(IMG + '/18-setlist-confirmation.png')
CROPS = {'05-presets-options': (0, 690, 447, 1277), '11-memoire-plan': (0, 0, 357, 940), '14-memoire-selection': (0, 330, 357, 1020), '16-favoris': (0, 0, 447, 760)}
for n, b in CROPS.items():
    im = Image.open(IMG + '/%s.png' % n)
    if im.size[1] > b[3] - b[1] + 5: im.crop(b).save(IMG + '/%s.png' % n)
for f in sorted(glob.glob(IMG + '/*.png')):
    if os.path.basename(f).startswith('x-'): continue
    Image.open(f).convert('RGB').save(f[:-4] + '.jpg', 'JPEG', quality=90, subsampling=0, optimize=True)
print('ok')
