/* ============================================================================
 * setlistsong.js -- « Set list » : emplacements par chanson (logique pure, GP-200 : banques x lettres)
 *
 * Idee (concert) : les presets gardes (♥) d'une meme chanson restent ensemble dans UNE banque (lettres consecutives),
 * pour passer de l'un a l'autre sans changer de banque. Une chanson n'est jamais a cheval sur deux banques tant qu'elle
 * tient dans une banque (4 lettres) ; sinon elle passe a la banque suivante.
 *
 *   SLSONG.pack([1, 2, 3], { bank: 50, letter: 'A' }) ->
 *     slots : [[50A], [50B, 50C], [51A, 51B, 51C]]
 *
 * Regles :
 *   - on remplit les lettres dans l'ordre a partir du point de depart ;
 *   - si la chanson ne tient pas dans les lettres restantes de la banque courante, elle commence a la banque suivante (lettre A) ;
 *   - une chanson de plus de 4 presets prend des banques entieres (4 par banque), le reste est range comme une petite chanson ;
 *   - au-dela de la derniere banque, les presets restants n'ont pas d'emplacement (null) et overflow les compte.
 * Aucun acces au DOM, au MIDI ni a l'horloge.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SLSONG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LETTERS = ['A', 'B', 'C', 'D'], PER_BANK = LETTERS.length;

  /**
   * sizes : nombre de presets de chaque chanson, dans l'ordre. start : { bank (1..), letter }. bankMax : derniere banque (64).
   * Retourne { slots : [ [ {bank, letter} | null, ... ] par chanson ], overflow : nombre de presets sans emplacement, lastBank }.
   */
  function pack(sizes, start, bankMax) {
    const max = Number.isInteger(bankMax) ? bankMax : 64;
    let bank = Math.max(1, Math.trunc(Number(start && start.bank)) || 1);
    let li = Math.max(0, LETTERS.indexOf(String(start && start.letter || 'A').toUpperCase()));
    const slots = [];
    let overflow = 0, lastBank = 0;
    const next = () => { bank++; li = 0; };
    const take = () => {                                  // un emplacement, puis on avance d'une lettre
      if (bank > max) { overflow++; return null; }
      const s = { bank, letter: LETTERS[li] };
      lastBank = bank;
      if (++li >= PER_BANK) next();
      return s;
    };
    for (const raw of sizes) {
      let n = Math.max(0, Math.trunc(Number(raw)) || 0);
      const out = [];
      while (n > PER_BANK) {                              // grosse chanson : banques entieres
        if (li > 0) next();
        for (let k = 0; k < PER_BANK; k++) out.push(take());
        n -= PER_BANK;
      }
      if (n > 0 && PER_BANK - li < n) next();             // ne tient pas dans le reste de la banque : banque suivante
      for (let k = 0; k < n; k++) out.push(take());
      slots.push(out);
    }
    return { slots, overflow, lastBank };
  }

  /**
   * Regroupe des elements par chanson : les chansons dans l'ordre de leur premiere apparition, les elements de chaque
   * chanson dans leur ordre d'origine. keyOf(item) identifie la chanson. Retourne { items (nouvel ordre), sizes }.
   */
  function group(items, keyOf) {
    const order = [], by = new Map();
    items.forEach(it => { const k = keyOf(it); if (!by.has(k)) { by.set(k, []); order.push(k); } by.get(k).push(it); });
    const out = [], sizes = [];
    order.forEach(k => { const g = by.get(k); sizes.push(g.length); g.forEach(x => out.push(x)); });
    return { items: out, sizes };
  }

  return { pack, group, LETTERS, PER_BANK };
});
