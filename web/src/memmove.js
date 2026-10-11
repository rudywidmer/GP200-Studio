/* ============================================================================
 * memmove.js -- reorganiser la memoire de la pedale (GP-200) : logique pure
 *
 * « order » decrit l'etat souhaite de la memoire : order[i] = numero (0..255) de l'emplacement d'ou vient le contenu qui doit se
 * trouver dans l'emplacement i. Au depart order[i] = i (rien ne bouge). Glisser des presets modifie `order` ; ce n'est qu'a
 * l'application que la page lit les contenus concernes dans la pedale et les reecrit.
 *
 *   MEMMOVE.move(order, [2], 2, 5)  -> le preset 2 se retrouve en 5, ceux qui sont entre se decalent d'un cran vers le haut
 *   MEMMOVE.move(order, [5], 5, 2)  -> le preset 5 se retrouve en 2, ceux qui sont entre se decalent d'un cran vers le bas
 *
 * Regle de depot (identique a celle d'un seul preset quand il y en a un) : on retire les presets selectionnes, puis on les remet
 * en bloc (ordre relatif conserve) juste AVANT l'emplacement vise si on remonte, juste APRES s'il faut descendre (la direction
 * est celle du preset saisi, `anchor`, vers la cible). Aucun acces au DOM, au MIDI ni a l'horloge.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MEMMOVE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORED_SIZE = 1176, BODY_OFF = 28, PC_IN_BODY = 76;

  const identity = n => Array.from({ length: n }, (_, i) => i);
  const isPerm = (order, n) => Array.isArray(order) && order.length === n && order.slice().sort((a, b) => a - b).every((v, i) => v === i);

  /** Emplacements dont le contenu change. */
  const changed = order => { const out = []; order.forEach((src, i) => { if (src !== i) out.push(i); }); return out; };

  /**
   * order : permutation actuelle ; sel : positions saisies (n'importe quel ordre, doublons ignores) ; anchor : position du preset
   * sur lequel on a pris la main ; target : position sur laquelle on depose.
   * -> { order, sel } (sel = nouvelles positions du bloc deplace) ou null si rien ne change (cible dans la selection, entrees invalides).
   */
  function move(order, sel, anchor, target) {
    const n = order.length;
    const ok = v => Number.isInteger(v) && v >= 0 && v < n;
    const S = Array.from(new Set((sel || []).filter(ok))).sort((a, b) => a - b);
    if (!S.length || !ok(target) || S.indexOf(target) >= 0) return null;
    const inSel = new Set(S), a = ok(anchor) && inSel.has(anchor) ? anchor : S[0];
    const rest = [];
    for (let i = 0; i < n; i++) if (!inSel.has(i)) rest.push(i);          // positions restantes (anciennes), dans l'ordre
    const at = rest.indexOf(target) + (target > a ? 1 : 0);
    const seq = rest.slice(0, at).concat(S, rest.slice(at));            // anciennes positions, dans le nouvel ordre
    const out = seq.map(p => order[p]);
    const newSel = S.map(p => seq.indexOf(p));
    if (out.every((v, i) => v === order[i])) return null;
    return { order: out, sel: newSel };
  }

  /**
   * Deplace la selection en bloc pour qu'elle COMMENCE a l'emplacement `start` (0..n-1) : ordre relatif conserve, les autres se decalent.
   * Sert au « Deplacer vers... » (numero de banque + lettre) : pas besoin de glisser sur de longues distances. `start` est ramene a n - taille du bloc
   * si le bloc ne tient pas. -> { order, sel } ou null si rien ne change (bloc deja la, entrees invalides).
   */
  function moveTo(order, sel, start) {
    const n = order.length, ok = v => Number.isInteger(v) && v >= 0 && v < n;
    const S = Array.from(new Set((sel || []).filter(ok))).sort((a, b) => a - b);
    if (!S.length || !Number.isInteger(start)) return null;
    const t = Math.max(0, Math.min(start, n - S.length)), inSel = new Set(S);
    const rest = [];
    for (let i = 0; i < n; i++) if (!inSel.has(i)) rest.push(i);
    const seq = rest.slice(0, t).concat(S, rest.slice(t));
    const out = seq.map(p => order[p]);
    if (out.every((v, i) => v === order[i])) return null;
    return { order: out, sel: S.map(p => seq.indexOf(p)) };
  }

  /** Deplace la selection d'un cran (touches Alt + fleches) : dir = -1 (vers le haut) ou +1 (vers le bas). null si on est au bout. */
  function nudge(order, sel, dir) {
    const n = order.length, S = Array.from(new Set(sel || [])).sort((a, b) => a - b);
    if (!S.length) return null;
    if (dir < 0) { const t = S[0] - 1; return t < 0 ? null : move(order, S, S[0], t); }
    const t = S[S.length - 1] + 1; return t >= n ? null : move(order, S, S[S.length - 1], t);
  }

  /**
   * Controle de la relecture : `got` (1176 octets lus apres l'ecriture) a le meme corps que `src` (1176 octets lus avant), au numero de patch pres
   * (le corps contient le numero de l'emplacement, qui change). L'en-tete de 28 octets (porte le numero) n'est pas compare ici : la lecture le verifie deja.
   */
  function sameStored(src, got) {
    if (!src || !got || src.length !== STORED_SIZE || got.length !== STORED_SIZE) return false;
    for (let i = BODY_OFF; i < STORED_SIZE; i++) {
      if (i === BODY_OFF + PC_IN_BODY) continue;
      if (src[i] !== got[i]) return false;
    }
    return true;
  }

  /** Numero d'emplacement (0..255) d'apres un nom de fichier « 07-B_nom.prst » (celui des sauvegardes) ; null si le nom n'en porte pas. */
  function slotOfName(name) {
    const base = String(name || '').split(/[\\/]/).pop(), m = /^(\d{1,2})-([A-Da-d])(?=[_ .\-]|$)/.exec(base);
    if (!m) return null;
    const bank = +m[1];
    return bank >= 1 && bank <= 64 ? (bank - 1) * 4 + 'ABCD'.indexOf(m[2].toUpperCase()) : null;
  }

  /**
   * Lit un .zip (entrees « stockees » comme celles de la sauvegarde, ou compressees « deflate » si le navigateur sait les decompresser).
   * Rend [{ name, data: Uint8Array }] pour les fichiers ; leve une Error si le zip est illisible. Asynchrone (decompression).
   */
  async function unzip(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('zip');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const out = [], dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (/\/$/.test(name)) continue;
      if (lho + 30 > b.length || dv.getUint32(lho, true) !== 0x04034b50) throw new Error('zip');
      const st = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), raw = b.subarray(st, st + csize);
      if (raw.length !== csize) throw new Error('zip');
      let data;
      if (method === 0) data = Uint8Array.from(raw);
      else if (method === 8 && typeof DecompressionStream === 'function') {
        const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(raw); w.close();
        data = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      } else throw new Error('zip-method');
      if (data.length !== usize) throw new Error('zip');
      out.push({ name, data });
    }
    return out;
  }

  return { slotOfName, unzip, move, moveTo, nudge, changed, identity, isPerm, sameStored, STORED_SIZE, BODY_OFF, PC_IN_BODY };
});
