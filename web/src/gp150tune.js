/* ============================================================================
 * gp150tune.js -- harmonisation du volume (auto-reglage) pour le GP-150 / GP-180 : logique pure
 *
 * La machine a etats (gel apres chargement, lissage du delta, garde-fou silence, 3 s de stabilite, cascade AMPLI -> BAFFLE -> VOLUME DU
 * PATCH -> GAIN) est CELLE du GP-200 (gp200tune.js, qui n'est pas modifie ni copie) : un Tuner GP-200 tourne sur un tampon « fantome »
 * au format GP-200, et ce qu'il decide (action = quel module / reglage / valeur, validation) est applique au vrai .prst GP-150 / GP-180.
 * Ainsi les seuils, les temps et les messages sont identiques, sans duplication de code.
 *
 * Differences propres a ces pedales :
 *   - le volume du patch est un entier 16 bits (offset 0x26), pas un octet ;
 *   - la baffle est un modele du module CAB (son reglage « Volume » est lu dans le catalogue de ce modele) ;
 *   - le module qui porte le niveau est l'AMP actif ; a defaut, le module NS (captures) actif, dont le volume s'appelle « VOL » ;
 *   - un module eteint n'est jamais regle (il ne changerait pas le niveau mesure).
 *
 *   const T = GP150TUNE.forModel('gp150', GP150.forModel('gp150'))
 * Aucun acces au DOM, au MIDI ni a l'horloge.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gp150core.js'), require('./gp200tune.js'));
  else root.GP150TUNE = factory(root.GP150, root.GP200TUNE);
})(typeof self !== 'undefined' ? self : this, function (C, T) {
  'use strict';

  const OFF_PATCH_VOL = 0x26;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function forModel(id, E) {
    const MODULES = E.MODULES, IDX = n => MODULES.indexOf(n);
    const dvOf = b => new DataView(b.buffer, b.byteOffset, b.byteLength);

    /** Tampon « fantome » au format GP-200 : le Tuner GP-200 y ecrit ses reglages, qui sont ensuite refaits sur le vrai preset. */
    function shadow() { const b = new Uint8Array(1224); b.set([0x14, 0x00, 0x44, 0x00], 72); return b; }

    function writePatchVol(real, v) { dvOf(real).setInt16(OFF_PATCH_VOL, Math.trunc(v), true); E.fixChecksum(real); }

    /** = makeEntry (gp200tune.js) : raw = .prst GP-150 / GP-180 de 1128 octets. */
    function makeEntry(name, raw, ptype) {
      const real = Uint8Array.from(raw);
      const e = T.makeEntry(name, shadow(), ptype);
      const pv = dvOf(real).getInt16(OFF_PATCH_VOL, true);
      e.data = real;
      e.patchVolInitial = e.patchVolOrig = e.patchVolNew = pv;
      return e;
    }

    /** = analyze : detecte volume / gain du module de niveau et volume de la baffle. */
    function analyze(e, tables) {
      const d = E.decodePrst(e.data, tables);
      const pick = slot => { const m = d.modules[slot]; return m && m.on && m.model ? m : null; };
      const amp = pick('AMP') || pick('NS'), cab = pick('CAB');
      e.ampIdx = amp ? amp.module_index : IDX('AMP');
      e.cabIdx = IDX('CAB');
      e.ampName = amp ? amp.model : '';
      const getp = (entry, name, dflt) => (entry.params && has(entry.params, name)) ? entry.params[name] : dflt;
      if (amp) {
        const pm = tables.paramsOf(amp.model_id, amp.module_index);
        const volNames = ['volume', 'level', 'master', 'out'].concat(amp.module_index === IDX('NS') ? ['vol'] : []);
        const gainNames = ['gain', 'drive', 'input', 'input gain'];
        for (const p of pm) {
          if (volNames.indexOf(p.name.toLowerCase()) >= 0) {
            e.ampParamIdx = p.slot;
            e.ampVolOrig = getp(amp, p.name, 50); e.ampVolInitial = e.ampVolOrig; e.ampVolNew = e.ampVolOrig;
            break;
          }
        }
        if (e.ampParamIdx === null) {
          for (const p of pm) {
            if (gainNames.indexOf(p.name.toLowerCase()) >= 0) {
              e.ampGainParamIdx = p.slot;
              e.ampGainOrig = getp(amp, p.name, 50); e.ampGainInitial = e.ampGainOrig; e.ampGainNew = e.ampGainOrig;
              break;
            }
          }
        }
      }
      if (cab) {
        for (const p of tables.paramsOf(cab.model_id, cab.module_index)) {
          if (['volume', 'level', 'out'].indexOf(p.name.toLowerCase()) >= 0) {
            e.cabVolParamIdx = p.slot;
            e.cabVolOrig = Number(getp(cab, p.name, 50)); e.cabVolInitial = e.cabVolOrig; e.cabVolNew = e.cabVolOrig;
            break;
          }
        }
      }
      return e;
    }

    /** Applique sur le vrai preset ce que le Tuner GP-200 vient de decider. */
    function realize(e, out) {
      if (out.action) {
        const a = out.action;
        if (a.type === 'patch') writePatchVol(e.data, a.value); else E.patchParam(e.data, a.module, a.param, a.value);
      }
      if (out.applied) writePatchVol(e.data, e.patchVolNew);
    }

    class Tuner {
      constructor(entry) { this.e = entry; this.inner = new T.Tuner(entry); }
      get target() { return this.inner.target; }
      get smoothed() { return this.inner.smoothed; }
      load(now) { return this.inner.load(now); }
      resend(now) { return this.inner.resend(now); }
      /** Fait tourner le Tuner GP-200 sur le tampon fantome, puis restitue le vrai preset. */
      _on(fn) {
        const e = this.e, real = e.data;
        e.data = shadow();
        try { return fn(); } finally { e.data = real; }
      }
      update(now, itg, ctx) {
        const out = this._on(() => this.inner.update(now, itg, ctx));
        realize(this.e, out);
        return out;
      }
      /** = _apply : fige les valeurs courantes comme nouvelle reference. */
      _apply(now, itg) {
        this._on(() => this.inner._apply(now, itg));
        writePatchVol(this.e.data, this.e.patchVolNew);
      }
    }

    return {
      id, OFF_PATCH_VOL, makeEntry, analyze, Tuner, writePatchVol,
      TARGETS: T.TARGETS, TOLERANCE_DB: T.TOLERANCE_DB, LUFS_PER_UNIT: T.LUFS_PER_UNIT, AMP_VOL_MIN: T.AMP_VOL_MIN, AMP_VOL_MAX: T.AMP_VOL_MAX,
      PATCH_VOL_MIN: T.PATCH_VOL_MIN, PATCH_VOL_MAX: T.PATCH_VOL_MAX, AMP_GAIN_MIN: T.AMP_GAIN_MIN, AMP_GAIN_MAX: T.AMP_GAIN_MAX,
      AMP_GAIN_BOOST_MAX: T.AMP_GAIN_BOOST_MAX, CAB_VOL_MIN: T.CAB_VOL_MIN, CAB_VOL_MAX: T.CAB_VOL_MAX, roundHalfEven: T.roundHalfEven,
    };
  }

  return { forModel, OFF_PATCH_VOL };
});
