/* ============================================================================
 * gp200tune.js -- harmonisation du volume (auto-reglage) : logique pure
 *
 * Port FIDELE de la logique de gp200_batch.py (BatchWindow) :
 *   - analyse du preset (_analyze_params) : volume ampli, sinon gain ampli, volume cab
 *   - machine a etats de _update_meters : gel de 2,5 s, lissage exponentiel du delta,
 *     garde-fou silence, 3 s de stabilite dans la tolerance, cascade
 *     AMPLI -> CAB -> PATCH VOLUME (-> GAIN en dernier recours)
 *   - _apply (validation) et les _send_*_tweak_bg (mise a jour du binaire + checksum)
 *
 * Aucun acces au DOM, au MIDI ni a l'horloge : l'heure (now, en secondes) et la mesure
 * (LUFS integre) sont fournies par l'appelant ; les envois a la pedale sont renvoyes
 * sous forme d'"actions" que l'appelant execute.
 *
 * Difference volontaire avec le Python : le volume du CAB est ecrit au slot 1 du
 * bloc CAB IR (le vrai slot du parametre "Volume" dans le catalogue, cf. _PARAM_META
 * de gp200_usb.py) ; gp200_batch.py utilise l'index 0 (enumerate) qui n'est pas le
 * bon slot pour ce seul bloc.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gp200core.js'));
  else root.GP200TUNE = factory(root.GP200);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  const OFF_PATCH_VOL = 0x38, CS_OFFSET = 1222, CS_DATA_LEN = 1222, RECORD_SIZE = 72;
  const REC_MAGIC = [0x14, 0x00, 0x44, 0x00];
  const TARGETS = { NORMAL: -16.0, LEAD: -11.0 };
  const TOLERANCE_DB = 0.4, LUFS_PER_UNIT = 0.25;
  const AMP_VOL_MIN = 25, AMP_VOL_MAX = 100;
  const PATCH_VOL_MIN = 35, PATCH_VOL_MAX = 100;
  const AMP_GAIN_MIN = 20, AMP_GAIN_MAX = 90, AMP_GAIN_BOOST_MAX = 10;
  const CAB_VOL_MIN = 20, CAB_VOL_MAX = 100;
  const SETTLE_LOAD_S = 2.5, SETTLE_APPLY_S = 3.0, STABLE_S = 3.0, TWEAK_GAP_S = 2.0, EMA_ALPHA = 0.2, SILENCE_DB = 30.0;

  const roundHalfEven = x => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); };
  const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

  function findMagic(d) {
    outer: for (let i = 0; i + 4 <= d.length; i++) {
      for (let k = 0; k < 4; k++) if (d[i + k] !== REC_MAGIC[k]) continue outer;
      return i;
    }
    return -1;
  }
  /** Somme des 1222 premiers octets modulo 65536 (= _checksum du batch). */
  function checksum(d) { let s = 0; for (let i = 0; i < CS_DATA_LEN; i++) s += d[i]; return s & 0xFFFF; }
  function setChecksum(d) { const c = checksum(d); d[CS_OFFSET] = (c >> 8) & 0xFF; d[CS_OFFSET + 1] = c & 0xFF; }

  /** Equivalent de PresetEntry : un preset a harmoniser. raw = Uint8Array de 1224 octets. */
  function makeEntry(name, raw, ptype) {
    const data = Uint8Array.from(raw);
    const pv = data[OFF_PATCH_VOL];
    return {
      name, data, ptype: ptype === 'LEAD' ? 'LEAD' : 'NORMAL',
      patchVolInitial: pv, patchVolOrig: pv, patchVolNew: pv,
      ampIdx: null, ampParamIdx: null, ampVolInitial: null, ampVolOrig: null, ampVolNew: null, ampName: '',
      ampGainParamIdx: null, ampGainInitial: null, ampGainOrig: null, ampGainNew: null,
      cabIdx: null, cabVolParamIdx: null, cabVolInitial: null, cabVolOrig: null, cabVolNew: null,
      lufsOk: null, status: 'wait', tweakCount: 0,
      lastAmpTweak: 0, settleUntil: 0, toleranceStart: null,
    };
  }

  /** = _analyze_params : detecte volume / gain ampli et volume cab. */
  function analyze(e, tables) {
    const MODULES = G.MODULES;
    e.ampIdx = MODULES.indexOf('AMP');
    e.cabIdx = MODULES.indexOf('CAB');
    const d = G.decodePrst(e.data, tables);
    const ampDict = d.modules.AMP || {}, cabDict = d.modules.CAB || {};
    e.ampName = ampDict.model || '';
    const getp = (dict, name, dflt) => (dict.params && Object.prototype.hasOwnProperty.call(dict.params, name)) ? dict.params[name] : dflt;
    if (e.ampName) {
      let mid = null, mcat = null;
      for (const m of tables.byKey.values()) {
        if (m.name === e.ampName) { mid = m.id; mcat = m.cat; break; }
      }
      if (mid !== null) {
        const pm = tables.paramsOf(mid, mcat);
        const volNames = ['volume', 'level', 'master', 'out'];
        const gainNames = ['gain', 'drive', 'input', 'input gain'];
        for (let i = 0; i < pm.length; i++) {
          const p = pm[i];
          if (volNames.indexOf(p.name.toLowerCase()) >= 0) {
            e.ampParamIdx = p.slot;
            e.ampVolOrig = getp(ampDict, p.name, 50); e.ampVolInitial = e.ampVolOrig; e.ampVolNew = e.ampVolOrig;
            break;
          }
        }
        if (e.ampParamIdx === null) {
          for (let i = 0; i < pm.length; i++) {
            const p = pm[i];
            if (gainNames.indexOf(p.name.toLowerCase()) >= 0) {
              e.ampGainParamIdx = p.slot;
              e.ampGainOrig = getp(ampDict, p.name, 50); e.ampGainInitial = e.ampGainOrig; e.ampGainNew = e.ampGainOrig;
              break;
            }
          }
        }
      }
    }
    if (tables.cabs && tables.cabs.length) {
      const cpm = tables.paramsOf(0, 10);
      for (const p of cpm) {
        if (['volume', 'level', 'out'].indexOf(p.name.toLowerCase()) >= 0) {
          e.cabVolParamIdx = p.slot;
          e.cabVolOrig = Number(getp(cabDict, p.name, 75.0)); e.cabVolInitial = e.cabVolOrig; e.cabVolNew = e.cabVolOrig;
          break;
        }
      }
    }
    return e;
  }

  /** Ecrit un float32 dans un parametre d'un module + recalcule le checksum. */
  function writeParam(e, moduleIdx, paramIdx, value) {
    let rec0 = findMagic(e.data); if (rec0 < 0) rec0 = 72;
    const blk = rec0 + moduleIdx * RECORD_SIZE;
    new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength).setFloat32(blk + 12 + paramIdx * 4, value, true);
    setChecksum(e.data);
  }
  function writePatchVol(e, v) { e.data[OFF_PATCH_VOL] = Math.trunc(v) & 0xFF; setChecksum(e.data); }

  const H = (key, ...args) => ({ key, args });

  /**
   * Un preset en cours d'harmonisation (= l'etat de BatchWindow pour le preset courant).
   * Utilisation : t.load(now) ; puis a intervalles reguliers (150 ms) t.update(now, itg, ctx).
   */
  class Tuner {
    constructor(entry) { this.e = entry; this.smoothed = null; }

    /** = debut de _play_current_preset (hors E/S). */
    load(now) {
      const e = this.e;
      e.settleUntil = now + SETTLE_LOAD_S;
      if (e.status !== 'done') e.status = 'run';
      this.smoothed = null;
    }
    /** = debut de _resend_current : redonne une chance a un preset deja valide. */
    resend(now) {
      const e = this.e;
      if (e.status === 'done') { e.status = 'run'; e.toleranceStart = null; e.settleUntil = now + SETTLE_LOAD_S; }
      this.smoothed = null;
    }

    get target() { return TARGETS[this.e.ptype]; }

    /**
     * = _update_meters (hors affichage). itg = LUFS integre (null si indisponible).
     * ctx = {usb: true si la pedale est connectee, busy: true pendant un transfert}.
     * Retourne {delta, hint, tone, applyEnabled, action, applied}.
     *   action  : null ou {type:'amp'|'gain'|'cab'|'patch', module, param, value} a envoyer
     *             (le binaire du preset est deja mis a jour) ; l'appelant doit ensuite
     *             remettre le compteur LUFS a zero.
     *   applied : true si le preset vient d'etre valide (= _apply) ; l'appelant renvoie
     *             alors e.data a la pedale et remet le compteur LUFS a zero.
     */
    update(now, itg, ctx) {
      const e = this.e, out = { delta: null, hint: undefined, tone: undefined, applyEnabled: undefined, action: null, applied: false, ignored: false };
      if (ctx && ctx.busy) { out.ignored = true; return out; }
      if (itg === null || itg === undefined) { out.delta = null; out.applyEnabled = false; return out; }
      const target = TARGETS[e.ptype];
      const rawDelta = itg - target;
      this.smoothed = this.smoothed === null ? rawDelta : EMA_ALPHA * rawDelta + (1 - EMA_ALPHA) * this.smoothed;
      const delta = this.smoothed;
      out.delta = delta;

      if (e.status === 'done') {
        out.tone = 'ok';
        out.hint = H('batch_hint_validated', e.patchVolNew, e.ampVolNew !== null ? String(roundHalfEven(e.ampVolNew)) : 'N/A');
        out.applyEnabled = false;
        return out;
      }
      if (e.settleUntil > now) {
        out.tone = 'idle';
        out.hint = H('batch_hint_settling', Math.trunc(e.settleUntil - now) + 1);
        out.applyEnabled = false;
        return out;
      }
      if (Math.abs(delta) > SILENCE_DB) {
        out.tone = 'idle'; out.hint = H('batch_hint_silence'); out.applyEnabled = false;
        return out;
      }
      if (Math.abs(delta) <= TOLERANCE_DB) {
        out.tone = 'ok';
        if (e.toleranceStart === null || e.toleranceStart === undefined) e.toleranceStart = now;
        const stable = now - e.toleranceStart;
        if (stable >= STABLE_S) {
          out.hint = H('batch_hint_stable_ok');
          this._apply(now, itg);
          out.applied = true;
          return out;
        }
        out.hint = H('batch_hint_stable_wait', Math.trunc(STABLE_S - stable) + 1);
        out.applyEnabled = false;
        return out;
      }
      // hors tolerance
      e.toleranceStart = null;
      if (ctx && ctx.usb && !ctx.busy) {
        if (now - e.lastAmpTweak < TWEAK_GAP_S) return out;
        this._cascade(now, delta, out);
      } else {
        out.applyEnabled = true;
        out.hint = H('batch_hint_no_usb', delta);
      }
      return out;
    }

    _cascade(now, delta, out) {
      const e = this.e;
      let diff = -roundHalfEven(delta / LUFS_PER_UNIT);
      if (diff === 0) diff = delta > 0 ? -1 : 1;

      const tweakPatch = fallback => {
        const isMin = e.patchVolNew <= PATCH_VOL_MIN && diff < 0;
        const isMax = e.patchVolNew >= PATCH_VOL_MAX && diff > 0;
        e.patchVolNew = clamp(PATCH_VOL_MIN, PATCH_VOL_MAX, e.patchVolNew + diff);
        e.tweakCount += 1;
        if ((isMin || isMax) && fallback) {
          out.hint = H('batch_hint_patch_ceil');
          fallback();
          return;
        }
        out.hint = H('batch_hint_patch_adj', e.tweakCount, e.patchVolNew, (isMin || isMax) ? 'LIMIT' : '');
        e.lastAmpTweak = now;
        writePatchVol(e, e.patchVolNew);
        out.action = { type: 'patch', value: Math.trunc(e.patchVolNew) };
      };
      const tweakCab = fallback => {
        if (e.cabVolParamIdx !== null && e.cabVolNew !== null) {
          const isMin = e.cabVolNew <= CAB_VOL_MIN && diff < 0;
          const isMax = e.cabVolNew >= CAB_VOL_MAX && diff > 0;
          if (!isMin && !isMax) {
            e.cabVolNew = clamp(CAB_VOL_MIN, CAB_VOL_MAX, e.cabVolNew + diff);
            e.tweakCount += 1;
            out.hint = H('batch_hint_cab_adj', e.tweakCount, e.cabVolNew);
            e.lastAmpTweak = now;
            writeParam(e, e.cabIdx, e.cabVolParamIdx, e.cabVolNew);
            out.action = { type: 'cab', module: e.cabIdx, param: e.cabVolParamIdx, value: e.cabVolNew };
          } else {
            out.hint = H('batch_hint_cab_limit', isMin ? 'FLOOR' : 'CEILING');
            tweakPatch(fallback);
          }
        } else {
          tweakPatch(fallback);
        }
      };

      if (e.ampParamIdx !== null && e.ampVolNew !== null) {
        const isMin = e.ampVolNew <= AMP_VOL_MIN && diff < 0;
        const isMax = e.ampVolNew >= AMP_VOL_MAX && diff > 0;
        if (!isMin && !isMax) {
          e.ampVolNew = clamp(AMP_VOL_MIN, AMP_VOL_MAX, e.ampVolNew + diff);
          e.patchVolNew = e.patchVolOrig;
          e.tweakCount += 1;
          out.hint = H('batch_hint_amp_adj', e.tweakCount, e.ampVolNew);
          e.lastAmpTweak = now;
          writeParam(e, e.ampIdx, e.ampParamIdx, e.ampVolNew);
          out.action = { type: 'amp', module: e.ampIdx, param: e.ampParamIdx, value: e.ampVolNew };
        } else {
          out.hint = H('batch_hint_amp_limit', isMin ? 'FLOOR' : 'CEILING');
          tweakCab();
        }
      } else if (e.ampGainParamIdx !== null && e.ampGainNew !== null) {
        const gainLast = () => {
          const gainCeil = Math.min(AMP_GAIN_MAX, e.ampGainInitial + AMP_GAIN_BOOST_MAX);
          const isMaxG = e.ampGainNew >= gainCeil && diff > 0;
          const isMinG = e.ampGainNew <= AMP_GAIN_MIN && diff < 0;
          if (!isMaxG && !isMinG) {
            e.ampGainNew = clamp(AMP_GAIN_MIN, gainCeil, e.ampGainNew + diff);
            e.tweakCount += 1;
            out.hint = H('batch_hint_gain_adj', e.ampGainNew, gainCeil);
            e.lastAmpTweak = now;
            writeParam(e, e.ampIdx, e.ampGainParamIdx, e.ampGainNew);
            out.action = { type: 'gain', module: e.ampIdx, param: e.ampGainParamIdx, value: e.ampGainNew };
          } else {
            out.hint = H('batch_hint_gain_limit', gainCeil, TARGETS[e.ptype]);
          }
        };
        tweakCab(gainLast);
      } else {
        tweakCab();
      }
    }

    /** = _apply : fige les valeurs courantes comme nouvelle reference. */
    _apply(now, itg) {
      const e = this.e;
      writePatchVol(e, e.patchVolNew);
      e.lufsOk = itg;
      e.status = Math.abs(itg - TARGETS[e.ptype]) <= TOLERANCE_DB ? 'done' : 'run';
      e.patchVolOrig = e.patchVolNew;
      if (e.ampVolNew !== null) e.ampVolOrig = e.ampVolNew;
      if (e.ampGainNew !== null) e.ampGainOrig = e.ampGainNew;
      if (e.cabVolNew !== null) e.cabVolOrig = e.cabVolNew;
      e.settleUntil = now + SETTLE_APPLY_S;
    }
  }

  return {
    TARGETS, TOLERANCE_DB, LUFS_PER_UNIT, AMP_VOL_MIN, AMP_VOL_MAX, PATCH_VOL_MIN, PATCH_VOL_MAX, AMP_GAIN_MIN, AMP_GAIN_MAX,
    AMP_GAIN_BOOST_MAX, CAB_VOL_MIN, CAB_VOL_MAX, OFF_PATCH_VOL, makeEntry, analyze, Tuner, checksum, setChecksum, roundHalfEven,
  };
});
