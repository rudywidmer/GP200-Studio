S=/tmp/claude-0/-home-claude/4a2d6f6d-1085-5640-a193-980472ee5762/scratchpad/pg
rm -rf $S; mkdir -p $S
cd /home/claude/work/gp200-studio/manual
pdftoppm -r 50 -png ${1:-GP200-Studio-Web_Mode-d-emploi_FR.pdf} $S/p 2>/dev/null
python3 - <<PY
from PIL import Image
import glob
S="$S"
fs=sorted(glob.glob(S+'/p-*.png'))
for k in range(0,len(fs),10):
    ims=[Image.open(f) for f in fs[k:k+10]]
    w,h=ims[0].size
    sheet=Image.new('RGB',(w*5+6*6,h*2+3*6),(120,120,120))
    for i,im in enumerate(ims):
        sheet.paste(im,(6+(i%5)*(w+6),6+(i//5)*(h+6)))
    sheet.save(S+'/sheet%d.png'%(k//10))
print(len(fs))
PY
