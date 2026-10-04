# -*- coding: utf-8 -*-
"""
GP-200 Studio -- Moteur de mesure LUFS temps reel.
EBU R128 / ITU-R BS.1770 via pyloudnorm + sounddevice.

Ce module est volontairement independant de Tkinter et du reste de l'appli.
Il peut etre teste seul depuis un terminal :
    python gp200_lufs.py

Dependances optionnelles (pas dans le build de base) :
    pip install sounddevice pyloudnorm
"""

import queue
import threading
import numpy as np
from collections import deque

# ── imports optionnels ─────────────────────────────────────────────────────────

try:
    import sounddevice as sd
    _SD_OK = True
except ImportError:
    _SD_OK = False

try:
    import pyloudnorm as pyln
    _PLN_OK = True
except ImportError:
    _PLN_OK = False

DEPS_OK  = _SD_OK and _PLN_OK
DEPS_MSG = " | ".join(filter(None, [
    "sounddevice manquant" if not _SD_OK  else "",
    "pyloudnorm manquant"  if not _PLN_OK else "",
]))


# ── utilitaire ────────────────────────────────────────────────────────────────

def list_input_devices():
    """Retourne [(index, nom)] des entrees audio disponibles."""
    if not _SD_OK:
        return []
    out = []
    try:
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0:
                out.append((i, d["name"]))
    except Exception:
        pass
    return out


# ── moteur LUFS ───────────────────────────────────────────────────────────────

class LUFSEngine:
    """
    Capture audio en continu et calcule 3 mesures LUFS (EBU R128) :

        Momentary  -- fenetre 400 ms (perception immediate)
        Short-term -- fenetre 3 s   (perception a court terme)
        Integrated -- depuis le dernier reset() (valeur de reference)

    Architecture :
        sounddevice callback  -->  queue  -->  thread de calcul  -->  callback utilisateur

    Le thread de calcul est separe du callback audio pour eviter les xruns.

    Usage minimal :
        engine = LUFSEngine(callback=fn)
        engine.start(device=0)
        # fn(momentary, short_term, integrated) est appelee toutes les ~150 ms
        # Les valeurs None signifient "pas assez de donnees"
        engine.stop()
        engine.reset()   # remet le buffer integre a zero
    """

    SAMPLE_RATE  = 44100
    CHANNELS     = 1
    BLOCK_MS     = 100      # taille des blocs audio en ms
    MOMENT_S     = 0.4      # fenetre Momentary
    SHORT_S      = 3.0      # fenetre Short-term
    MIN_S        = 0.3      # minimum de donnees pour calculer

    def __init__(self, callback=None):
        """
        callback : fn(momentary, short_term, integrated)
            Chaque argument est un float LUFS ou None si pas assez de donnees.
            Appelee depuis le thread de calcul -- utiliser .after() pour l'UI Tk.
        """
        self.callback = callback

        self._queue   = queue.Queue(maxsize=50)
        self._meter   = None
        self._stream  = None
        self._thread  = None
        self._running = threading.Event()
        self._lock    = threading.Lock()

        # Buffers numpy (float64 mono)
        self._short_buf = deque()   # fenetre glissante SHORT_S
        self._int_buf   = []        # tout depuis reset()

    # ── interface publique ──────────────────────────────────────────────────

    def start(self, device=None):
        """Demarre la capture et le thread de calcul."""
        if not DEPS_OK:
            raise RuntimeError(
                "Dependances manquantes : " + DEPS_MSG +
                "\nInstalle avec : pip install sounddevice pyloudnorm"
            )
        self._meter = pyln.Meter(self.SAMPLE_RATE)
        self.reset()
        self._running.set()

        block = int(self.SAMPLE_RATE * self.BLOCK_MS / 1000)
        self._stream = sd.InputStream(
            device=device,
            channels=self.CHANNELS,
            samplerate=self.SAMPLE_RATE,
            dtype="float32",
            blocksize=block,
            callback=self._audio_cb,
        )

        self._thread = threading.Thread(target=self._process_loop, daemon=True)
        self._thread.start()
        self._stream.start()

    def stop(self):
        """Arrete proprement la capture et le thread de calcul."""
        self._running.clear()
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        # debloquer le thread de calcul s'il attend
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._thread = None

    def reset(self):
        """Remet le buffer integre a zero (Momentary et Short-term non affectes)."""
        with self._lock:
            self._int_buf.clear()
            self._short_buf.clear()

    # ── callbacks internes ──────────────────────────────────────────────────

    def _audio_cb(self, indata, frames, time_info, status):
        """Appelee par sounddevice dans son propre thread -- rapide, juste une copie."""
        chunk = indata[:, 0].astype(np.float64)   # mono float64
        try:
            self._queue.put_nowait(chunk)
        except queue.Full:
            pass   # on perd un bloc plutot que de bloquer

    def _process_loop(self):
        """Thread de calcul LUFS -- separe du callback audio."""
        while self._running.is_set():
            try:
                chunk = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if chunk is None:
                break

            with self._lock:
                self._short_buf.append(chunk)
                self._int_buf.append(chunk.copy())
                self._trim_short_buf()

            m  = self._lufs_window(self.MOMENT_S)
            st = self._lufs_window(self.SHORT_S)
            it = self._lufs_integrated()

            if self.callback and self._running.is_set():
                try:
                    self.callback(m, st, it)
                except Exception:
                    pass

    def _trim_short_buf(self):
        """Garde seulement SHORT_S secondes dans _short_buf (lock tenu)."""
        max_samples = int(self.SAMPLE_RATE * self.SHORT_S)
        total = sum(len(c) for c in self._short_buf)
        while total > max_samples and len(self._short_buf) > 1:
            total -= len(self._short_buf.popleft())

    # ── calcul LUFS ────────────────────────────────────────────────────────

    def _get_window(self, seconds):
        """Retourne les dernieres `seconds` secondes du short_buf (thread-safe)."""
        n = int(self.SAMPLE_RATE * seconds)
        with self._lock:
            if not self._short_buf:
                return None
            data = np.concatenate(list(self._short_buf))
        if len(data) < int(self.SAMPLE_RATE * self.MIN_S):
            return None
        return data[-n:] if len(data) > n else data

    def _lufs_window(self, seconds):
        """LUFS sur une fenetre glissante."""
        data = self._get_window(seconds)
        if data is None:
            return None
        return self._compute_lufs(data)

    def _lufs_integrated(self):
        """LUFS integre depuis le dernier reset()."""
        with self._lock:
            if not self._int_buf:
                return None
            data = np.concatenate(self._int_buf)
        if len(data) < int(self.SAMPLE_RATE * self.MIN_S):
            return None
        return self._compute_lufs(data)

    def _compute_lufs(self, data):
        """Applique le filtre BS.1770 et retourne le LUFS ou None."""
        try:
            # pyloudnorm attend (samples, channels)
            v = self._meter.integrated_loudness(data.reshape(-1, 1))
            return float(v) if v > -70.0 else None
        except Exception:
            return None


# ── test standalone ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import time

    print("=== Test gp200_lufs.py ===")
    print("DEPS_OK :", DEPS_OK)
    if not DEPS_OK:
        print("Manquant :", DEPS_MSG)
        sys.exit(1)

    devs = list_input_devices()
    print("\nEntrees audio disponibles :")
    for i, n in devs:
        print(f"  [{i}] {n}")

    if not devs:
        print("Aucun device trouve.")
        sys.exit(1)

    dev_idx = devs[0][0]
    print(f"\nCapture sur device [{dev_idx}]  (Ctrl+C pour arreter)\n")

    def on_lufs(m, st, itg):
        def f(v): return f"{v:+6.1f}" if v is not None else "  ---  "
        print(f"\r  Momentary {f(m)} | Short-term {f(st)} | Integrated {f(itg)}  ",
              end="", flush=True)

    engine = LUFSEngine(callback=on_lufs)
    engine.start(device=dev_idx)
    try:
        time.sleep(30)
    except KeyboardInterrupt:
        pass
    finally:
        engine.stop()
    print("\nArrete.")
