/* ============================================================================
 * gp150setlist.js -- « Set list » du GP-150 / GP-180 : logique pure
 *
 * Meme role que gp200setlist.js (qui n'est pas modifie) avec la numerotation de ces pedales :
 *   - emplacements : 200 patchs numerotes 001 a 200 (pas de banque ni de lettre). Pour garder la meme interface que le GP-200,
 *     le « numero de banque » de l'interface EST le numero du patch (1..200) et la lettre est toujours « A » (et n'est pas affichee).
 *   - nom d'un preset : champ de 13 octets ASCII du .prst (offset 0x2C), meme nettoyage que le GP-200.
 *   - renameRaw : copie du .prst avec un autre nom (somme de controle recalculee, propre a chaque modele).
 *
 *   const SL = GP150SETLIST.forModel('gp150')
 * Aucun acces au DOM, au MIDI, a l'horloge ni au stockage.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gp150core.js'));
  else root.GP150SETLIST = factory(root.GP150);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const SLOT_MAX = 200, LETTERS = ['A'], N_SLOTS = SLOT_MAX;
  const OFF_NAME = 0x2C, MAX_NAME = 13;
  const SPECIAL = { 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L' };

  // ----------------------------------------------------------------- emplacements
  /** 0..199 (= numero de patch de la pedale), ou null. La lettre est ignoree (toujours A). */
  function slotIndex(bank) {
    const b = Number(bank);
    if (!(Number.isInteger(b) && b >= 1 && b <= SLOT_MAX)) return null;
    return b - 1;
  }
  function slotAt(i) {
    if (!(Number.isInteger(i) && i >= 0 && i < N_SLOTS)) return null;
    return { bank: i + 1, letter: 'A' };
  }
  /** « 042 » (meme format que pcToSlotName). */
  function slotLabel(bank) {
    const i = slotIndex(bank);
    if (i === null) return '?';
    const b = i + 1;
    return (b < 10 ? '00' : b < 100 ? '0' : '') + b;
  }
  /** n emplacements consecutifs a partir de `bank`. Si la place manque : overflow = true et la liste s'arrete a 200. */
  function fill(bank, letter, n) {
    const i0 = slotIndex(bank);
    if (i0 === null || !(n >= 0)) return { slots: [], overflow: n > 0 };
    const slots = [];
    for (let k = 0; k < n && i0 + k < N_SLOTS; k++) slots.push(slotAt(i0 + k));
    return { slots, overflow: i0 + n > N_SLOTS };
  }

  // ------------------------------------------------------------------------ noms
  /** Nom tel que la pedale le recevra : ASCII imprimable, espaces simples, 13 caracteres au plus. */
  function cleanName(v) {
    let t = String(v === null || v === undefined ? '' : v);
    t = t.replace(/[œŒæÆßøØđĐłŁ]/g, c => SPECIAL[c]);
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/[ \t\n\v\f\r  -   　]+/g, ' ');
    t = t.replace(/[^\x20-\x7e]/g, '');
    t = t.replace(/ {2,}/g, ' ');
    return t.trim().slice(0, MAX_NAME).trim();
  }
  function defaultName(f) {
    const raw = (f && f.spec && f.spec.name) || (f && f.decoded && f.decoded.name) || (f && f.filename ? String(f.filename).replace(/\.prst$/i, '') : '');
    return cleanName(raw);
  }

  function forModel(model) {
    const G = C.forModel(model);
    /** Copie du .prst avec un autre nom : seuls les 13 octets du nom, et la somme de controle, changent. */
    function renameRaw(raw, name) {
      const b = Uint8Array.from(raw), nm = cleanName(name);
      for (let i = 0; i < MAX_NAME; i++) b[OFF_NAME + i] = i < nm.length ? nm.charCodeAt(i) : 0;
      return G.fixChecksum(b);
    }

    /**
     * entries : [{ name, bank, letter }] ; ctx : { work: [{ bank }] } (emplacements « de travail » : ecrases a chaque selection).
     * -> { ok, errors, warnings, jobs } comme gp200setlist.plan (la lettre n'est jamais demandee).
     */
    function plan(entries, ctx) {
      const errors = [], warnings = [], jobs = [], seen = new Map(), names = new Map();
      const work = (ctx && ctx.work) || [];
      if (!entries || !entries.length) errors.push({ i: -1, code: 'empty_list' });
      else if (entries.length > N_SLOTS) errors.push({ i: -1, code: 'too_many' });
      (entries || []).forEach((e, i) => {
        const nm = cleanName(e.name);
        if (!nm) errors.push({ i, code: 'name_empty' });
        else {
          if (String(e.name).trim() !== nm) warnings.push({ i, code: 'name_changed' });
          const key = nm.toLowerCase();
          if (names.has(key)) warnings.push({ i, code: 'name_dup', with: names.get(key) }); else names.set(key, i);
        }
        const hasBank = e.bank !== null && e.bank !== undefined && e.bank !== '';
        if (!hasBank) errors.push({ i, code: 'slot_missing' });
        else {
          const si = slotIndex(e.bank);
          if (si === null) errors.push({ i, code: 'slot_range' });
          else {
            if (seen.has(si)) errors.push({ i, code: 'slot_dup', with: seen.get(si) }); else seen.set(si, i);
            if (work.some(w => slotIndex(w.bank) === si)) warnings.push({ i, code: 'slot_work' });
            jobs.push({ i, bank: Number(e.bank), letter: 'A', name: nm, label: slotLabel(e.bank) });
          }
        }
      });
      return { ok: errors.length === 0, errors, warnings, jobs: errors.length ? [] : jobs };
    }
    return { SLOT_MAX, LETTERS, N_SLOTS, OFF_NAME, MAX_NAME, slotIndex, slotAt, slotLabel, fill, cleanName, defaultName, renameRaw, plan };
  }

  return { SLOT_MAX, LETTERS, N_SLOTS, OFF_NAME, MAX_NAME, forModel, cleanName, slotIndex, slotLabel, fill };
});
