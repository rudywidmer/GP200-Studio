/* ============================================================================
 * gp200lufs.js -- mesure de volume LUFS (EBU R128 / ITU-R BS.1770) dans le navigateur
 *
 * Port FIDELE de :
 *   - pyloudnorm 0.2.0 (Meter.integrated_loudness : filtre K-weighting RBJ,
 *     blocs de 400 ms a 75 % de recouvrement, double gating -70 / -10 LU)
 *   - gp200_lufs.py (LUFSEngine : fenetres Momentary 0,4 s / Short-term 3 s /
 *     Integrated depuis le dernier reset, mini 0,3 s, None si <= -70 LUFS)
 *
 * La capture audio (getUserMedia) est isolee dans MicSource ; le moteur recoit
 * simplement des blocs de Float32 (donc testable sans micro).
 * Aucun acces au DOM en dehors de MicSource.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GP200LUFS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLOCK_S = 0.400, OVERLAP = 0.75, GAMMA_A = -70.0;
  const MOMENT_S = 0.4, SHORT_S = 3.0, MIN_S = 0.3;
  const INT_CAP_S = 120;       // garde-fou memoire/CPU (le Python n'en a pas ; jamais atteint en usage normal)

  /** np.round : arrondi au pair le plus proche. */
  function roundHalfEven(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }

  /** Coefficients biquad RBJ, identiques a pyloudnorm IIRfilter.generate_coefficients. */
  function iirCoeffs(G, Q, fc, rate, type) {
    const A = Math.pow(10, G / 40.0);
    const w0 = 2.0 * Math.PI * (fc / rate);
    const alpha = Math.sin(w0) / (2.0 * Q);
    const cs = Math.cos(w0), sA = Math.sqrt(A);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'high_shelf') {
      b0 = A * ((A + 1) + (A - 1) * cs + 2 * sA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cs);
      b2 = A * ((A + 1) + (A - 1) * cs - 2 * sA * alpha);
      a0 = (A + 1) - (A - 1) * cs + 2 * sA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cs);
      a2 = (A + 1) - (A - 1) * cs - 2 * sA * alpha;
    } else if (type === 'high_pass') {
      b0 = (1 + cs) / 2;
      b1 = -(1 + cs);
      b2 = (1 + cs) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else {
      throw new Error('Invalid filter type ' + type);
    }
    return { b: [b0 / a0, b1 / a0, b2 / a0], a: [a0 / a0, a1 / a0, a2 / a0] };
  }

  /** Filtre K-weighting : high shelf (+4 dB, 1500 Hz) puis high pass (38 Hz). */
  function kWeightStages(rate) {
    return [
      iirCoeffs(4.0, 1 / Math.sqrt(2), 1500.0, rate, 'high_shelf'),
      iirCoeffs(0.0, 0.5, 38.0, rate, 'high_pass'),
    ];
  }

  /** scipy.signal.lfilter (forme transposee II, etat initial nul). */
  function lfilter(c, x) {
    const b0 = c.b[0], b1 = c.b[1], b2 = c.b[2], a1 = c.a[1], a2 = c.a[2];
    const y = new Float64Array(x.length);
    let z1 = 0, z2 = 0;
    for (let n = 0; n < x.length; n++) {
      const xn = x[n];
      const yn = b0 * xn + z1;
      z1 = b1 * xn - a1 * yn + z2;
      z2 = b2 * xn - a2 * yn;
      y[n] = yn;
    }
    return y;
  }

  /** Loudness integree gatee d'un signal MONO. Leve si trop court (comme valid_audio).
   *  Retourne un nombre (peut valoir -Infinity, comme le Python). */
  function integratedLoudness(data, rate) {
    if (data.length < BLOCK_S * rate) throw new Error('Audio must have length greater than the block size.');
    let x = data;
    for (const st of kWeightStages(rate)) x = lfilter(st, x);

    const n = x.length, Tg = BLOCK_S, step = 1.0 - OVERLAP;
    const T = n / rate;
    const numBlocks = Math.trunc(roundHalfEven((T - Tg) / (Tg * step))) + 1;
    const z = new Float64Array(Math.max(numBlocks, 0));
    // somme cumulee des carres pour calculer chaque bloc en O(1)... en gardant la meme
    // arithmetique que le Python (somme directe) : on somme directement, c'est assez rapide.
    for (let j = 0; j < numBlocks; j++) {
      const l = Math.trunc(Tg * (j * step) * rate);
      const u = Math.trunc(Tg * (j * step + 1) * rate);
      let s = 0;
      const end = Math.min(u, n);
      for (let i = l; i < end; i++) s += x[i] * x[i];
      z[j] = (1.0 / (Tg * rate)) * s;
    }
    const lj = new Float64Array(numBlocks);
    for (let j = 0; j < numBlocks; j++) lj[j] = -0.691 + 10.0 * Math.log10(z[j]);

    let sum = 0, cnt = 0;
    for (let j = 0; j < numBlocks; j++) if (lj[j] >= GAMMA_A) { sum += z[j]; cnt++; }
    const zAvg1 = cnt ? sum / cnt : NaN;
    const gammaR = -0.691 + 10.0 * Math.log10(zAvg1) - 10.0;
    sum = 0; cnt = 0;
    for (let j = 0; j < numBlocks; j++) if (lj[j] > gammaR && lj[j] > GAMMA_A) { sum += z[j]; cnt++; }
    let zAvg2 = cnt ? sum / cnt : NaN;
    if (Number.isNaN(zAvg2)) zAvg2 = 0;                       // np.nan_to_num
    return -0.691 + 10.0 * Math.log10(zAvg2);
  }

  // ------------------------------------------------------------------- moteur
  /** Concatene une liste de blocs Float32 en un Float64Array. */
  function concat(chunks, total) {
    const out = new Float64Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /**
   * Moteur LUFS (= LUFSEngine). callback(momentary, shortTerm, integrated) a chaque bloc ;
   * les valeurs sont des nombres LUFS ou null ("pas assez de donnees" ou <= -70).
   */
  class LufsEngine {
    constructor(callback, rate) {
      this.callback = callback || null;
      this.rate = rate || 44100;
      this.short = [];       // blocs de la fenetre courte
      this.shortLen = 0;
      this.int = [];         // tout depuis reset()
      this.intLen = 0;
      this.last = [null, null, null];
      this.chunks = 0;
      this.dirty = false;
    }
    reset() { this.short = []; this.shortLen = 0; this.int = []; this.intLen = 0; }

    /** Ajoute un bloc audio (Float32Array mono), sans calcul (appel rapide, depuis le callback audio). */
    push(chunk) {
      const c = Float64Array.from(chunk);
      this.short.push(c); this.shortLen += c.length;
      this.int.push(c); this.intLen += c.length;
      // fenetre courte : on garde au moins SHORT_S secondes
      const maxShort = Math.trunc(this.rate * SHORT_S);
      while (this.shortLen > maxShort && this.short.length > 1 &&
             this.shortLen - this.short[0].length >= maxShort) {
        this.shortLen -= this.short.shift().length;
      }
      // garde-fou integre
      const maxInt = Math.trunc(this.rate * INT_CAP_S);
      while (this.intLen > maxInt && this.int.length > 1) this.intLen -= this.int.shift().length;
      this.chunks++;
      this.dirty = true;
    }

    /** Calcule les 3 mesures sur ce qui est en memoire ([momentary, short, integrated], null = pas de mesure). */
    measure() {
      const m = this._window(MOMENT_S), st = this._window(SHORT_S), it = this._integrated();
      this.last = [m, st, it];
      this.dirty = false;
      if (this.callback) { try { this.callback(m, st, it); } catch (e) { /* comme le Python */ } }
      return this.last;
    }

    /** push + measure (= un tour de la boucle de calcul du Python). */
    feed(chunk) { this.push(chunk); return this.measure(); }

    _window(seconds) {
      if (!this.shortLen) return null;
      if (this.shortLen < Math.trunc(this.rate * MIN_S)) return null;
      const n = Math.trunc(this.rate * seconds);
      let data = concat(this.short, this.shortLen);
      if (data.length > n) data = data.subarray(data.length - n);
      return this._compute(data);
    }
    _integrated() {
      if (!this.intLen) return null;
      if (this.intLen < Math.trunc(this.rate * MIN_S)) return null;
      return this._compute(concat(this.int, this.intLen));
    }
    _compute(data) {
      try {
        const v = integratedLoudness(data, this.rate);
        return v > -70.0 ? v : null;
      } catch (e) { return null; }
    }
  }

  // ------------------------------------------------------ capture (navigateur)
  /**
   * Capture micro / interface audio via getUserMedia + ScriptProcessor.
   * Prend le canal 0 (= channels=1 de sounddevice). Traitement echo/bruit/AGC
   * desactive : on veut le signal brut de la pedale.
   */
  const MicSource = {
    supported(nav) {
      nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
      return !!(nav && nav.mediaDevices && nav.mediaDevices.getUserMedia);
    },
    /** Demande l'autorisation (indispensable pour voir les noms) puis liste les entrees. */
    async listInputs(nav) {
      nav = nav || navigator;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let tmp = await nav.mediaDevices.getUserMedia({ audio: true });
      try {
        // le flux ouvert sert aussi a connaitre l'entree que le navigateur vient d'autoriser (selecteur d'appareil de Chrome/Edge)
        let tid = '', tlabel = '';
        try { const tr = tmp.getAudioTracks && tmp.getAudioTracks()[0]; if (tr) { tlabel = tr.label || ''; tid = (tr.getSettings && tr.getSettings().deviceId) || ''; } } catch (e) { /* rien */ }
        const read = async () => (await nav.mediaDevices.enumerateDevices())
          .filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId);
        let devs = await read();
        // certains navigateurs ne remplissent les noms qu'un instant apres l'autorisation
        if (!devs.length || devs.every(d => !d.label)) { await wait(300); devs = await read(); }
        const out = devs.map((d, i) => ({
          id: d.deviceId,
          label: d.label || (d.deviceId === tid && tlabel) || ('Entrée audio ' + (i + 1)),
          active: !!tid && d.deviceId === tid,
        }));
        if (tid && !out.some(d => d.id === tid)) out.unshift({ id: tid, label: tlabel || 'Entrée audio autorisée', active: true });
        if (!out.length) out.push({ id: '', label: 'Entrée par défaut du navigateur', active: true });
        return out;
      } finally {
        if (tmp) tmp.getTracks().forEach(t => t.stop());
      }
    },
    /** Demarre la capture. onChunk(Float32Array) ; renvoie {rate, stop()}. */
    async start(deviceId, onChunk, env) {
      env = env || {};
      const nav = env.navigator || navigator;
      const AC = env.AudioContext || (typeof AudioContext !== 'undefined' ? AudioContext : self.webkitAudioContext);
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          channelCount: { ideal: 2 },
        },
      };
      const stream = await nav.mediaDevices.getUserMedia(constraints);
      let ctx;
      try { ctx = new AC({ sampleRate: 44100 }); } catch (e) { ctx = new AC(); }
      if (ctx.state === 'suspended' && ctx.resume) { try { await ctx.resume(); } catch (e) { /* ignore */ } }
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 2, 1);
      const mute = ctx.createGain(); mute.gain.value = 0;          // evite tout retour sonore
      node.onaudioprocess = ev => { onChunk(new Float32Array(ev.inputBuffer.getChannelData(0))); };
      src.connect(node); node.connect(mute); mute.connect(ctx.destination);
      return {
        rate: ctx.sampleRate,
        stop() {
          try { node.onaudioprocess = null; src.disconnect(); node.disconnect(); mute.disconnect(); } catch (e) { /* ignore */ }
          try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
          try { ctx.close(); } catch (e) { /* ignore */ }
        },
      };
    },
  };

  return { iirCoeffs, kWeightStages, lfilter, integratedLoudness, roundHalfEven, LufsEngine, MicSource,
    BLOCK_S, MOMENT_S, SHORT_S, MIN_S, INT_CAP_S };
});
