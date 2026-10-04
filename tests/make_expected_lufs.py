"""Corpus de reference LUFS : pyloudnorm 0.2.0 + gp200_lufs.LUFSEngine (vrai code Python)."""
import sys, json, struct, math, types
import numpy as np
sys.path.insert(0, '../ref')
# gp200_lufs importe sounddevice en option -> absent = OK
sys.path.insert(0, '/mnt/user-data/uploads')
sys.modules['sounddevice'] = None
import importlib.util
spec = importlib.util.spec_from_file_location('gp200_lufs', [p for p in __import__('glob').glob('/mnt/user-data/uploads/*gp200_lufs.py')][0])
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
import pyloudnorm as pyln

rng = np.random.RandomState(12345)
def sine(f, a, n, rate): return a*np.sin(2*np.pi*f*np.arange(n)/rate)
sigs = []
def add(name, rate, x): sigs.append((name, rate, x.astype(np.float32)))
for rate in (44100, 48000):
    n = int(rate*3.0)
    add(f'sine1k_0dB_{rate}', rate, sine(1000, 0.5, n, rate))
    add(f'sine100_-20dB_{rate}', rate, sine(100, 0.1, n, rate))
    add(f'sine50_loud_{rate}', rate, sine(50, 0.9, int(rate*1.7), rate))
    add(f'noise_{rate}', rate, 0.1*rng.randn(int(rate*5.3)))
    chord = sine(110,0.15,int(rate*8.1),rate)+sine(165,0.1,int(rate*8.1),rate)+sine(220,0.08,int(rate*8.1),rate)
    chord *= np.exp(-np.arange(len(chord))/rate/2.5)            # decroissance (accord)
    add(f'chord_decay_{rate}', rate, chord)
    add(f'short_0.4s_{rate}', rate, sine(440,0.3,int(rate*0.4),rate))
    add(f'short_0.41s_{rate}', rate, sine(440,0.3,int(rate*0.41),rate))
    add(f'gated_{rate}', rate, np.concatenate([np.zeros(rate), sine(300,0.4,rate*2,rate), 1e-5*rng.randn(rate*2), sine(300,0.02,rate,rate)]))
    add(f'silence_{rate}', rate, np.zeros(rate*2))
    add(f'tiny_{rate}', rate, 1e-6*rng.randn(rate*2))
    add(f'odd_len_{rate}', rate, 0.2*rng.randn(rate*2+137))
    add(f'clip_{rate}', rate, np.clip(3*sine(220,1,int(rate*2.6),rate),-1,1))

out = {'signals': []}
blob = bytearray()
for name, rate, x in sigs:
    m = pyln.Meter(rate)
    try:
        v = float(m.integrated_loudness(x.astype(np.float64).reshape(-1,1)))
        err = None
    except Exception as e:
        v, err = None, str(e)
    if v is not None and not math.isfinite(v): v = '-inf' if v < 0 else 'nan'
    out['signals'].append({'name': name, 'rate': rate, 'n': len(x), 'offset': len(blob)//4, 'lufs': v, 'err': err})
    blob += x.tobytes()
open('lufs_signals.f32', 'wb').write(blob)

# --- moteur : memes blocs de 100 ms que gp200_lufs.py -------------------------
eng_cases = []
for name, rate, x in sigs:
    if rate != 44100 or len(x) < 44100: continue
    e = L.LUFSEngine(); e._meter = pyln.Meter(44100)
    blk = 4410
    steps = []
    for i in range(0, len(x)-blk+1, blk):
        c = x[i:i+blk].astype(np.float64)
        e._short_buf.append(c); e._int_buf.append(c.copy()); e._trim_short_buf()
        steps.append([e._lufs_window(0.4), e._lufs_window(3.0), e._lufs_integrated()])
    eng_cases.append({'name': name, 'blk': blk, 'steps': steps})
out['engine'] = eng_cases
json.dump(out, open('expected_lufs.json', 'w'))
print(len(sigs), 'signaux;', len(eng_cases), 'cas moteur')
