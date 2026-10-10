/* ============================================================================
 * gp200setlist.js -- « Set list » : logique pure
 *
 * Module INDEPENDANT (nouveau en v0.24) : il ne modifie rien de l'existant, il n'est lu que par la
 * fenetre « Set list » de app.js. Aucun acces au DOM, au MIDI, a l'horloge ni au stockage.
 *
 *   - emplacements de la pedale : 64 banques x 4 lettres (A-D) = 256 slots, dans l'ordre 01-A, 01-B, ... 64-D
 *     (meme numerotation que slotToPc / pcToSlotName de gp200usb.js ; verifie par les tests)
 *   - nom d'un preset : champ de 16 octets ASCII du .prst (OFF_NAME 0x44). Les accents sont remplaces par la lettre
 *     de base (« Cafe » et pas « Caf? »), le reste de ce qui n'est pas de l'ASCII imprimable est supprime.
 *   - renameRaw : copie du .prst avec un autre nom (et le checksum recalcule) ; le fichier d'origine n'est jamais touche.
 *   - validate / plan : controles avant l'ecriture en masse (noms vides, emplacements manquants, hors plage, doublons).
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gp200core.js'));
  else root.GP200SETLIST = factory(root.GP200);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  const SLOT_MAX = 64, LETTERS = ['A', 'B', 'C', 'D'], N_SLOTS = SLOT_MAX * LETTERS.length;
  const OFF_NAME = 0x44, MAX_NAME = 16;
  const SPECIAL = { 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L' };

  // ----------------------------------------------------------------- emplacements
  const letterIndex = l => (typeof l === 'string' && l.length === 1 ? LETTERS.indexOf(l.toUpperCase()) : -1);
  /** 0..255 (= numero de Program Change), ou null si le couple n'existe pas. */
  function slotIndex(bank, letter) {
    const b = Number(bank), li = letterIndex(letter);
    if (!(Number.isInteger(b) && b >= 1 && b <= SLOT_MAX) || li < 0) return null;
    return (b - 1) * 4 + li;
  }
  function slotAt(i) {
    if (!(Number.isInteger(i) && i >= 0 && i < N_SLOTS)) return null;
    return { bank: Math.floor(i / 4) + 1, letter: LETTERS[i % 4] };
  }
  /** « 01-A » (meme format que pcToSlotName). */
  function slotLabel(bank, letter) {
    const i = slotIndex(bank, letter);
    if (i === null) return '?';
    const b = Math.floor(i / 4) + 1;
    return (b < 10 ? '0' : '') + b + '-' + LETTERS[i % 4];
  }
  /** n emplacements consecutifs a partir de (bank, letter). Si la place manque : overflow = true et la liste s'arrete a 64-D. */
  function fill(bank, letter, n) {
    const i0 = slotIndex(bank, letter);
    if (i0 === null || !(n >= 0)) return { slots: [], overflow: n > 0 };
    const slots = [];
    for (let k = 0; k < n && i0 + k < N_SLOTS; k++) slots.push(slotAt(i0 + k));
    return { slots, overflow: i0 + n > N_SLOTS };
  }

  // ------------------------------------------------------------------------ noms
  /** Nom tel que la pedale le recevra : ASCII imprimable, espaces simples, 16 caracteres au plus. */
  function cleanName(v) {
    let t = String(v === null || v === undefined ? '' : v);
    t = t.replace(/[œŒæÆßøØđĐłŁ]/g, c => SPECIAL[c]);
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/[ \t\n\v\f\r\u00a0\u2000-\u200a\u202f\u205f\u3000]+/g, ' ');
    t = t.replace(/[^\x20-\x7e]/g, '');
    t = t.replace(/ {2,}/g, ' ');
    return t.trim().slice(0, MAX_NAME).trim();
  }
  /** Nom propose par defaut : celui du preset (champ « name » du .prst), sinon le nom du fichier. */
  function defaultName(f) {
    const raw = (f && f.spec && f.spec.name) || (f && f.decoded && f.decoded.name) || (f && f.filename ? String(f.filename).replace(/\.prst$/i, '') : '');
    return cleanName(raw);
  }

  /** Copie du .prst avec un autre nom : seuls les 16 octets du nom et le checksum changent. */
  function renameRaw(raw, name) {
    const b = Uint8Array.from(raw), nm = cleanName(name);
    for (let i = 0; i < MAX_NAME; i++) b[OFF_NAME + i] = i < nm.length ? nm.charCodeAt(i) : 0;
    const cs = G.checksum(b);
    b[b.length - 2] = (cs >> 8) & 0xFF;
    b[b.length - 1] = cs & 0xFF;
    return b;
  }

  // ------------------------------------------------------------------ validation
  /**
   * entries : [{ name, bank, letter }] dans l'ordre d'ecriture ; ctx : { work: [{ bank, letter, why }] } (emplacements « de travail » : ecrases a chaque selection).
   * -> { ok, errors: [{ i, code, with? }], warnings: [{ i, code, with? }], jobs: [{ i, bank, letter, name, label }] }
   *    erreurs : empty_list, too_many, name_empty, slot_missing, slot_range, slot_dup (with = autre ligne)
   *    avertissements : name_changed (accents retires / nom raccourci), name_dup (with), slot_work
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
      const hasBank = e.bank !== null && e.bank !== undefined && e.bank !== '', hasLetter = !!e.letter;
      if (!hasBank || !hasLetter) errors.push({ i, code: 'slot_missing' });
      else {
        const si = slotIndex(e.bank, e.letter);
        if (si === null) errors.push({ i, code: 'slot_range' });
        else {
          if (seen.has(si)) errors.push({ i, code: 'slot_dup', with: seen.get(si) }); else seen.set(si, i);
          if (work.some(w => slotIndex(w.bank, w.letter) === si)) warnings.push({ i, code: 'slot_work' });
          jobs.push({ i, bank: Number(e.bank), letter: String(e.letter).toUpperCase(), name: nm, label: slotLabel(e.bank, e.letter) });
        }
      }
    });
    return { ok: errors.length === 0, errors, warnings, jobs: errors.length ? [] : jobs };
  }

  return { SLOT_MAX, LETTERS, N_SLOTS, OFF_NAME, MAX_NAME, slotIndex, slotAt, slotLabel, fill, cleanName, defaultName, renameRaw, plan };
});
