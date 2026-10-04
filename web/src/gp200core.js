/* ============================================================================
 * gp200core.js -- coeur de GP-200 Studio Web
 *
 * Port JavaScript FIDELE de gp200lib.py (format .prst) et de la partie "moteur"
 * de gp200_agent.py (validation, boucle d'auto-correction, appels aux
 * fournisseurs d'IA). Aucune dependance, aucun acces au DOM : ce fichier tourne
 * tel quel dans un navigateur ET sous Node (c'est ce qui permet de le comparer
 * octet par octet a la version Python, voir tests/).
 *
 * Conventions de fidelite
 *   - Memes constantes, memes offsets, memes messages d'erreur que le Python.
 *   - Les cas ou Python et JS divergent par nature (round() bancaire, %g,
 *     repr()) sont traites par de petits utilitaires (pyRound, fmtG, pyRepr).
 *   - Ou le Python plante sur une entree invalide (spec mal forme renvoye par
 *     le modele), le JS signale l'erreur proprement au lieu de planter.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GP200 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ format .prst
  const FILE_SIZE = 1224;
  const OFF_NAME = 0x44, OFF_AUTHOR = 0x54, OFF_DESCRIPTION = 0x64;
  const LEN_NAME = 16, LEN_AUTHOR = 16, LEN_DESCRIPTION = 40;
  const REC_MAGIC = [0x14, 0x00, 0x44, 0x00];
  const RECORD_SIZE = 72, PAYLOAD_SIZE = 64, N_MODULES = 11, N_SLOTS = 15;
  const CHECKSUM_MAGIC = 196;
  const OFF_CTRL = 0x460, CTRL_REC_SIZE = 12, N_CTRL = 8;
  const OFF_PATCH_VOL = 0x38;

  const MODULES = ['PRE', 'WAH', 'DST', 'AMP', 'NR', 'CAB', 'EQ', 'MOD', 'DLY', 'RVB', 'VOL'];
  const MODULE_INDEX = {};
  MODULES.forEach((m, i) => { MODULE_INDEX[m] = i; });

  const SLOT_FALLBACK = {
    PRE: 'COMP', WAH: 'V-Wah', DST: 'Green OD', AMP: 'J-120 CL', NR: 'Gate 1',
    CAB: 'Mess', EQ: 'Guitar EQ 1', MOD: 'G-Chorus', DLY: 'Pure', RVB: 'Room',
    VOL: 'Volume',
  };

  const SLOT_ACCEPTS = {
    PRE: [0, 1, 3, 4], WAH: [5, 1], DST: [3, 0, 15], AMP: [7, 8, 15], NR: [0, 4],
    CAB: [10], EQ: [1], MOD: [4, 1], DLY: [11], RVB: [12], VOL: [6],
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const ROLES = ['clean', 'crunch', 'disto', 'lead'];

  // -------------------------------------------------- utilitaires "a la Python"
  class ValueError extends Error {
    constructor(m) { super(m); this.name = 'ValueError'; }
  }

  /** repr() Python d'une valeur JSON (suffisant pour les messages d'erreur). */
  function pyRepr(v) {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') {
      const q = (v.indexOf("'") >= 0 && v.indexOf('"') < 0) ? '"' : "'";
      let out = q;
      for (const ch of v) {
        const c = ch.codePointAt(0);
        if (ch === '\\') out += '\\\\';
        else if (ch === q) out += '\\' + q;
        else if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else if (c < 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0xad)
          out += '\\x' + c.toString(16).padStart(2, '0');
        else out += ch;
      }
      return out + q;
    }
    if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
    if (typeof v === 'object') {
      return '{' + Object.keys(v).map(k => pyRepr(k) + ': ' + pyRepr(v[k])).join(', ') + '}';
    }
    return String(v);
  }

  /** "%g" du C / de Python (6 chiffres significatifs). */
  function fmtG(x, P) {
    P = P || 6;
    x = Number(x);
    if (Number.isNaN(x)) return 'nan';
    if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
    if (x === 0) return Object.is(x, -0) ? '-0' : '0';
    const neg = x < 0 ? '-' : '';
    let ax = Math.abs(x);
    {
      // printf arrondit un cas EXACTEMENT a mi-chemin vers le pair, toExponential/toFixed vers le haut : 999996.5 -> %g donne 999996 (JS : 999997)
      const dg = ax.toExponential(P + 20).split('e')[0].replace('.', '');
      if (dg[P] === '5' && /^0*$/.test(dg.slice(P + 1)) && (dg.charCodeAt(P - 1) - 48) % 2 === 0) ax *= 1 - Math.pow(2, -52);
    }
    const ex = ax.toExponential(P - 1);
    const exp = Number(ex.split('e')[1]);
    let s;
    if (exp < -4 || exp >= P) {
      let [m, e] = ex.split('e');
      if (m.indexOf('.') >= 0) m = m.replace(/0+$/, '').replace(/\.$/, '');
      const en = Number(e);
      s = m + 'e' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0');
    } else {
      s = ax.toFixed(Math.max(0, P - 1 - exp));
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return neg + s;
  }

  /** round() de Python 3 : arrondi au pair le plus proche (pas Math.round). */
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }

  /** Veracite Python : [] {} "" 0 None False sont faux. */
  function pyTruthy(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
    if (typeof v === 'number' && Number.isNaN(v)) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }

  /** float() de Python. Renvoie undefined si Python leverait une exception. */
  function pyFloat(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
      if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
      if (/^[+-]?nan$/i.test(s)) return NaN;
    }
    return undefined;
  }

  /** _norm : le '+' est signifiant chez Valeton (UK 45 != UK 45+). */
  function norm(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9+]/g, '');
  }

  const chars = s => Array.from(String(s));

  // ---------------------------------------------------------------- difflib
  // Port de difflib.SequenceMatcher / get_close_matches (sans heuristique
  // "junk", inutile sur des noms courts). Sert uniquement a suggerer le bon
  // nom au modele quand il en invente un.
  function matchTotal(a, b) {
    const b2j = new Map();
    b.forEach((ch, j) => { if (!b2j.has(ch)) b2j.set(ch, []); b2j.get(ch).push(j); });
    function longest(alo, ahi, blo, bhi) {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const newj2len = new Map();
        const js = b2j.get(a[i]) || [];
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = newj2len;
      }
      return [besti, bestj, bestsize];
    }
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = longest(alo, ahi, blo, bhi);
      if (k) {
        total += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return total;
  }

  function closeMatches(word, possibilities, n, cutoff) {
    n = n || 3; cutoff = cutoff === undefined ? 0.6 : cutoff;
    const b = chars(word);
    const result = [];
    for (const x of possibilities) {
      const a = chars(x);
      const len = a.length + b.length;
      const ratio = len ? 2.0 * matchTotal(a, b) / len : 1.0;
      if (ratio >= cutoff) result.push([ratio, x]);
    }
    // heapq.nlargest sur des tuples (score, nom) : score decroissant, puis nom decroissant
    result.sort((p, q) => (q[0] - p[0]) || (p[1] < q[1] ? 1 : p[1] > q[1] ? -1 : 0));
    return result.slice(0, n).map(r => r[1]);
  }

  // ------------------------------------------------------------------ Tables
  class Tables {
    /** data = {models:[...], cabs:[...], desc:{"cat,id": {short}}} */
    constructor(data) {
      this.models = data.models;
      this.cabs = data.cabs;
      this.desc = data.desc || {};
      this.byKey = new Map();
      for (const m of this.models) this.byKey.set(m.id + ',' + m.cat, m);
      this.cabById = new Map();
      this.cabUser = new Map();
      for (const c of this.cabs) if (!c.user_slot) this.cabById.set(c.model_id, c);
      for (const c of this.cabs) if (c.user_slot) this.cabUser.set(c.model_id, c);
      this._byName = new Map();
      for (const m of this.models) {
        let d = this._byName.get(m.cat);
        if (!d) { d = new Map(); this._byName.set(m.cat, d); }
        const k = norm(m.name);
        if (d.has(k) && d.get(k).id !== m.id) {
          throw new Error('Collision de normalisation en cat ' + m.cat + ' : ' +
            pyRepr(d.get(k).name) + ' et ' + pyRepr(m.name) + ' -> ' + pyRepr(k) +
            '. Corriger _norm().');
        }
        d.set(k, m);
      }
      this._cabByName = new Map();
      for (const c of this.cabs) if (!c.user_slot) this._cabByName.set(norm(c.name), c);
    }

    description(modelId, category) {
      const d = this.desc[category + ',' + modelId];
      return d ? (d.short || '') : '';
    }
    model(id, cat) { return this.byKey.get(id + ',' + cat) || null; }
    cab(id, user) { return (user ? this.cabUser : this.cabById).get(id) || null; }

    /** Resout un nom pour un slot. Leve ValueError si introuvable/ambigu. */
    find(slot, name) {
      if (!has(SLOT_ACCEPTS, slot)) {
        throw new ValueError('Slot inconnu: ' + pyRepr(slot) + ' (attendus: ' + pyRepr(MODULES) + ')');
      }
      const target = norm(name);
      if (slot === 'CAB') {
        const c = this._cabByName.get(target);
        if (!c) throw new ValueError('CAB ' + pyRepr(name) + ' introuvable. Voir data/gp200_cabs.json');
        return [c, 10];
      }
      const hits = [];
      for (const cat of SLOT_ACCEPTS[slot]) {
        const d = this._byName.get(cat);
        const m = d ? d.get(target) : undefined;
        if (m !== undefined) hits.push([m, cat]);
      }
      if (!hits.length) {
        throw new ValueError('Modele ' + pyRepr(name) + ' introuvable pour le slot ' + slot +
          ' (categories ' + pyRepr(SLOT_ACCEPTS[slot]) + '). ' +
          'Verifier l\'orthographe exacte dans data/models_*.json.');
      }
      if (hits.length > 1) {
        throw new ValueError('Modele ' + pyRepr(name) + ' ambigu pour ' + slot + ' : [' +
          hits.map(h => '(' + h[0].id + ', ' + h[1] + ')').join(', ') + ']');
      }
      return hits[0];
    }

    /** Le menu de la pedale propose-t-il ce modele dans ce slot ? (= Tables.in_menu ; plus strict que la categorie, qui n'est qu'un
     *  pre-filtre : 165 couples categorie-compatibles que la pedale ne propose pas). CAB : oui ; sans champ `slots` : oui.
     *  Sert a VALIDER ce que l'IA propose ; le decodage d'un .prst existant reste tolerant. */
    inMenu(slot, m) { return slot === 'CAB' || !m.slots || m.slots.indexOf(slot) >= 0; }

    /** Modeles valides pour un slot : [[model, cat], ...] (= Tables.models_for_slot). */
    modelsForSlot(slot) {
      if (slot === 'CAB') return this.cabs.filter(c => !c.user_slot).map(c => [c, 10]);
      const out = [], seen = new Set();
      for (const cat of (SLOT_ACCEPTS[slot] || [])) {
        for (const m of this.models) {
          if (m.cat !== cat) continue;
          if (m.slots && m.slots.indexOf(slot) < 0) continue;
          const key = m.id + ',' + m.cat;
          if (!seen.has(key)) { seen.add(key); out.push([m, cat]); }
        }
      }
      return out;
    }

    /** Liste ordonnee des parametres (slot/min/max/default). */
    paramsOf(modelId, category) {
      const m = category === 10 ? this.byKey.get('0,10') : this.byKey.get(modelId + ',' + category);
      return m ? m.params : [];
    }
  }

  // -------------------------------------------------------------- bas niveau
  function checksum(data) {
    let s = 0;
    for (let i = 0; i < data.length - 8; i++) s += data[i];
    return (s + CHECKSUM_MAGIC) & 0xFFFF;
  }

  function findBytes(data, pat) {
    outer: for (let i = 0; i + pat.length <= data.length; i++) {
      for (let j = 0; j < pat.length; j++) if (data[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }

  function putStr(buf, off, length, s) {
    const bytes = [];
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      bytes.push(c < 128 ? c : 63);          // encode("ascii", errors="replace")
    }
    for (let i = 0; i < length; i++) buf[off + i] = i < bytes.length ? bytes[i] : 0;
  }

  function getStr(buf, off, length) {
    let out = '';
    for (let i = 0; i < length; i++) {
      if (buf[off + i] === 0) break;
      out += String.fromCharCode(buf[off + i]);       // latin1
    }
    return out;
  }

  function readCtrl(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const res = [];
    for (let n = 0; n < N_CTRL; n++) {
      const mask = dv.getUint32(OFF_CTRL + n * CTRL_REC_SIZE + 8, true);
      res.push(MODULES.filter((_, k) => (mask >>> k) & 1));
    }
    return res;
  }

  function writeCtrl(data, ctrl) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (const key of Object.keys(ctrl)) {
      const n = parseInt(String(key).toUpperCase().replace('CTRL', '').trim(), 10);
      if (!(n >= 1 && n <= N_CTRL)) throw new ValueError('CTRL ' + pyRepr(key) + ' hors 1..' + N_CTRL);
      let mods = ctrl[key];
      if (typeof mods === 'string') mods = [mods];
      let mask = 0;
      for (const m0 of (mods || [])) {
        const m = String(m0).toUpperCase();
        if (!has(MODULE_INDEX, m)) throw new ValueError('Module ' + pyRepr(m) + ' inconnu (attendus: ' + pyRepr(MODULES) + ')');
        mask |= 1 << MODULE_INDEX[m];
      }
      const o = OFF_CTRL + (n - 1) * CTRL_REC_SIZE;
      if (data[o] !== 0x0f || data[o + 1] !== 0 || data[o + 2] !== 8 || data[o + 3] !== 0 || data[o + 4] !== n - 1) {
        throw new ValueError('Table CTRL inattendue a 0x' + o.toString(16));
      }
      dv.setUint32(o + 8, mask >>> 0, true);
    }
    return data;
  }

  function neutralizeAssignments(data) {
    for (let i = 0; i < 9; i++) data[0x3b8 + i * 16 + 5] = 0xFF;
    for (let i = 0; i < 3; i++) data[0x448 + i * 8 + 5] = 0xFF;
    return data;
  }

  function setU16BE(data, off, v) { data[off] = (v >> 8) & 0xFF; data[off + 1] = v & 0xFF; }
  function getU16BE(data, off) { return (data[off] << 8) | data[off + 1]; }

  // ------------------------------------------------------------------ encode
  /**
   * Construit un .prst valide a partir d'un spec. Meme contrat que
   * gp200lib.encode_prst. `template` = Uint8Array de 1224 octets.
   * Renvoie {raw: Uint8Array, warnings: [string]}.
   */
  function encodePrst(spec, tables, template, opts) {
    opts = opts || {};
    const keepAssignments = !!opts.keepAssignments;
    const strict = opts.strict !== false;
    const fillEmptySlots = opts.fillEmptySlots !== false;
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new ValueError('spec invalide (objet attendu)');
    }

    const data = new Uint8Array(template);
    if (data.length !== FILE_SIZE) throw new ValueError('Template invalide (' + data.length + ' octets)');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const name = spec.name === undefined ? 'Untitled' : spec.name;
    if (strict) {
      if (typeof name !== 'string') throw new ValueError('name doit etre une chaine');
      if (chars(name).length > LEN_NAME) {
        throw new ValueError('Nom trop long (' + chars(name).length + ' > ' + LEN_NAME + '): ' + pyRepr(name));
      }
    }
    putStr(data, OFF_NAME, LEN_NAME, name === null ? '' : name);
    putStr(data, OFF_AUTHOR, LEN_AUTHOR, spec.author == null ? '' : spec.author);
    putStr(data, OFF_DESCRIPTION, LEN_DESCRIPTION, spec.description == null ? '' : spec.description);

    const rec0 = findBytes(data, REC_MAGIC);
    if (rec0 < 12) throw new ValueError('Enregistrements de module introuvables');

    const chain = spec.chain_order === undefined ? MODULES.map((_, i) => i) : spec.chain_order;
    const sortedChain = Array.isArray(chain) ? chain.slice().sort((p, q) => p - q) : null;
    if (!sortedChain || sortedChain.length !== N_MODULES || !sortedChain.every((v, i) => v === i)) {
      throw new ValueError('chain_order doit etre une permutation de 0..10, recu ' + pyRepr(chain));
    }
    for (let i = 0; i < N_MODULES; i++) data[rec0 - 12 + i] = chain[i];
    data[rec0 - 1] = 0;

    const warnings = [];
    const modsIn = spec.modules == null ? {} : spec.modules;

    for (let k = 0; k < N_MODULES; k++) {
      const slot = MODULES[k];
      const o = rec0 + k * RECORD_SIZE;
      let ms = has(modsIn, slot) ? modsIn[slot] : undefined;

      if (fillEmptySlots && !(pyTruthy(ms) && pyTruthy(ms.model))) {
        ms = { model: SLOT_FALLBACK[slot], on: slot === 'VOL',
               params: slot === 'VOL' ? { Volume: 100.0 } : {} };
      }

      const hasMs = pyTruthy(ms);
      const onVal = hasMs ? (has(ms, 'on') ? ms.on : true) : false;
      dv.setUint16(o, 20, true);
      dv.setUint16(o + 2, 68, true);
      data[o + 4] = k;
      data[o + 5] = (hasMs && pyTruthy(onVal)) ? 1 : 0;
      dv.setUint16(o + 6, 15, true);

      const payload = new Uint8Array(PAYLOAD_SIZE);
      const pdv = new DataView(payload.buffer);
      if (hasMs && pyTruthy(ms.model)) {
        const found = tables.find(slot, ms.model);
        const m = found[0], cat = found[1];
        const mid = cat === 10 ? m.model_id : m.id;
        pdv.setUint16(0, mid, true);
        payload[2] = 0;
        payload[3] = cat;

        const plist = tables.paramsOf(mid, cat);
        const rawGiven = ms.params == null ? {} : ms.params;
        if (typeof rawGiven !== 'object' || Array.isArray(rawGiven)) {
          throw new ValueError('slot ' + slot + ' : params doit etre un objet');
        }
        const given = Object.entries(rawGiven);
        const known = new Map();
        for (const p of plist) known.set(norm(p.name), p);
        for (const g of given) {
          if (!known.has(norm(g[0]))) {
            const msg = slot + '/' + m.name + ' : parametre ' + pyRepr(g[0]) + ' inconnu (attendus: ' +
              pyRepr(plist.map(p => p.name)) + ')';
            if (strict) throw new ValueError(msg);
            warnings.push(msg);
          }
        }

        for (const p of plist) {
          let val;
          let explicit = false;
          for (const g of given) {
            if (norm(g[0]) === norm(p.name)) {
              val = pyFloat(g[1]);
              if (val === undefined) throw new ValueError('could not convert to float: ' + pyRepr(g[1]));
              explicit = true;
              break;
            }
          }
          if (val === undefined) val = Number(p.default);
          const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max);
          if (!(lo <= val && val <= hi)) {
            // valeur EXPLICITE hors bornes : respectee (mode Sync = index de division).
            if (!explicit) {
              warnings.push(slot + '/' + m.name + '/' + p.name + ' : ' + fmtG(val) +
                ' hors [' + fmtG(lo) + '..' + fmtG(hi) + '], borne');
              val = Math.max(lo, Math.min(hi, val));
            }
          }
          if (p.slot < N_SLOTS) {
            if (Number.isFinite(val) && !Number.isFinite(Math.fround(val))) {
              throw new ValueError('float too large to pack with f format');
            }
            pdv.setFloat32(4 + 4 * p.slot, val, true);
          }
        }
      }
      data.set(payload, o + 8);
    }

    if (!keepAssignments) neutralizeAssignments(data);
    if (pyTruthy(spec.ctrl)) writeCtrl(data, spec.ctrl);

    setU16BE(data, data.length - 2, checksum(data));
    return { raw: data, warnings };
  }

  // ------------------------------------------------------------------ decode
  /** round(f, 4) de Python : toFixed arrondit les egalites vers le haut, Python vers le pair. */
  function round4(f) {
    const s = f * 10000;
    if (Number.isFinite(s) && Math.abs(s - Math.trunc(s)) === 0.5) {
      const lo = Math.floor(s);
      return (lo % 2 === 0 ? lo : lo + 1) / 10000;
    }
    return Number(f.toFixed(4));
  }
  /** Decode un .prst en objet lisible (meme contrat que gp200lib.decode_prst). */
  function decodePrst(data, tables) {
    if (data.length !== FILE_SIZE) throw new ValueError('Taille inattendue: ' + data.length + ' (attendu ' + FILE_SIZE + ')');
    const rec0 = findBytes(data, REC_MAGIC);
    if (rec0 < 12) throw new ValueError('Enregistrements de module introuvables');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

    let chain = Array.from(data.slice(rec0 - 12, rec0 - 1));
    if (!chain.slice().sort((p, q) => p - q).every((v, i) => v === i)) chain = null;

    const out = {
      name: getStr(data, OFF_NAME, LEN_NAME),
      author: getStr(data, OFF_AUTHOR, LEN_AUTHOR),
      description: getStr(data, OFF_DESCRIPTION, LEN_DESCRIPTION),
      chain_order: chain,
      chain_readable: chain ? chain.map(i => MODULES[i]) : null,
      modules: {},
    };

    for (let k = 0; k < N_MODULES; k++) {
      const o = rec0 + k * RECORD_SIZE;
      const midx = data[o + 4], on = data[o + 5];
      const mid = dv.getUint16(o + 8, true), flags = data[o + 10], cat = data[o + 11];
      const floats = [];
      for (let i = 0; i < N_SLOTS; i++) floats.push(dv.getFloat32(o + 12 + 4 * i, true));
      const slot = midx < N_MODULES ? MODULES[midx] : '?' + midx;
      const entry = {
        module_index: midx, on: !!on, model_id: mid, category: cat, flags,
        raw_floats: floats.map(round4),
      };
      if (tables) {
        if (cat === 10) {
          const c = tables.cab(mid) || tables.cab(mid, true);
          entry.model = c ? c.name : null;
          entry.user_ir = !!c && !!c.user_slot;
        } else {
          const m = tables.model(mid, cat);
          entry.model = m ? m.name : null;
          entry.category_label = m ? m.category_label : null;
        }
        entry.params = {};
        for (const p of tables.paramsOf(mid, cat)) {
          if (p.slot < N_SLOTS) entry.params[p.name] = floats[p.slot];
        }
      }
      out.modules[slot] = entry;
    }

    const ctrl = {};
    readCtrl(data).forEach((mods, n) => { if (mods.length) ctrl['CTRL' + (n + 1)] = mods; });
    out.ctrl = ctrl;

    const exp = checksum(data), got = getU16BE(data, data.length - 2);
    out.checksum = { stored: got, computed: exp, valid: exp === got };
    out.patch_vol = data[OFF_PATCH_VOL];
    return out;
  }

  // --------------------------------------------------------- validation (agent)
  /** Pre-valide noms de modeles ET de parametres, avec suggestions. */
  function checkNames(tb, spec, keep) {
    const errs = [];
    const mods = spec.modules || {};
    for (const slot of Object.keys(mods)) {
      const ms = mods[slot];
      if (ms === null || ms === undefined) continue;
      if (typeof ms !== 'object' || Array.isArray(ms)) {
        errs.push('slot ' + slot + ' : doit etre un objet {"model": ..., "on": ..., "params": {...}} ou null');
        continue;
      }
      if (!pyTruthy(ms.model)) continue;
      if (!has(SLOT_ACCEPTS, slot)) {
        errs.push('slot ' + pyRepr(slot) + ' inconnu (attendus: ' + pyRepr(MODULES) + ')');
        continue;
      }
      let found;
      try {
        found = tb.find(slot, ms.model);
      } catch (e) {
        let pool;
        if (slot === 'CAB') pool = tb.cabs.filter(c => !c.user_slot).map(c => c.name);
        else pool = tb.modelsForSlot(slot).map(x => x[0].name);
        const near = closeMatches(String(ms.model), pool, 4, 0.4);
        errs.push('slot ' + slot + ' : le modele ' + pyRepr(ms.model) + " N'EXISTE PAS. Proches : " +
          pyRepr(near.length ? near : pool.slice(0, 8)));
        continue;
      }
      const m = found[0], cat = found[1];
      if (!tb.inMenu(slot, m)) {
        // affinage : un modele deja present dans ce slot du preset d'origine est conserve tel quel (ancien preset hors menu)
        const kept = keep && keep[slot] && keep[slot].model;
        if (!(kept && norm(kept) === norm(ms.model))) {
          const pool = tb.modelsForSlot(slot).map(x => x[0].name);
          const near = closeMatches(String(ms.model), pool, 4, 0.4);
          errs.push('slot ' + slot + ' : le modele ' + pyRepr(m.name) + ' n\'est PAS propose dans ce slot par la pedale (il va dans : ' +
            (m.slots && m.slots.length ? m.slots.join(', ') : '?') + '). Proches dans ' + slot + ' : ' + pyRepr(near.length ? near : pool.slice(0, 8)));
          continue;
        }
      }
      const mid = cat === 10 ? m.model_id : m.id;
      const plist = tb.paramsOf(mid, cat);
      const known = new Map();
      for (const p of plist) known.set(norm(p.name), p);
      const params = ms.params == null ? {} : ms.params;
      if (typeof params !== 'object' || Array.isArray(params)) {
        errs.push('slot ' + slot + ' / ' + m.name + ' : "params" doit etre un objet {"Nom": valeur}');
        continue;
      }
      for (const g of Object.keys(params)) {
        const val = params[g];
        const p = known.get(norm(g));
        if (p === undefined) {
          const near = closeMatches(g, plist.map(p2 => p2.name), 3, 0.4);
          errs.push('slot ' + slot + ' / ' + m.name + ' : le parametre ' + pyRepr(g) +
            " N'EXISTE PAS. Parametres reels : " + pyRepr(plist.map(p2 => p2.name)) +
            (near.length ? ' (proche : ' + pyRepr(near) + ')' : ''));
          continue;
        }
        const v = pyFloat(val);
        if (v === undefined) {
          errs.push('slot ' + slot + ' / ' + m.name + ' / ' + p.name + ' : ' + pyRepr(val) + " n'est pas un nombre");
          continue;
        }
        const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max);
        if (!(lo <= v && v <= hi)) {
          errs.push('slot ' + slot + ' / ' + m.name + ' / ' + p.name + ' : ' + fmtG(v) +
            ' est hors plage [' + fmtG(lo) + '..' + fmtG(hi) + ']');
        }
      }
    }
    const n = spec.name === undefined ? '' : spec.name;
    if (typeof n === 'string' && chars(n).length > 16) {
      errs.push('name ' + pyRepr(n) + ' fait ' + chars(n).length + ' caracteres (max 16)');
    }
    const ch = spec.chain_order;
    if (ch !== undefined && ch !== null) {
      const ok = Array.isArray(ch) && ch.length === 11 &&
        ch.slice().sort((p, q) => p - q).every((v, i) => v === i);
      if (!ok) errs.push('chain_order ' + pyRepr(ch) + " n'est pas une permutation de 0..10");
    }
    return errs;
  }

  function normalizePayload(payload) {
    if (pyTruthy(payload.sections)) return payload;
    const out = Object.assign({}, payload);
    out.sections = [{ nom: 'Preset', role: '', raison: '', variants: payload.variants || [] }];
    return out;
  }

  function variantSignature(v) {
    const spec = (pyTruthy(v.spec) ? v.spec : {});
    const mods = pyTruthy(spec.modules) ? spec.modules : {};
    const g = k => (pyTruthy(mods[k]) ? mods[k] : {});
    const amp = g('AMP').model, cab = g('CAB').model;
    const active = ['PRE', 'WAH', 'DST', 'MOD', 'DLY', 'RVB', 'EQ']
      .filter(k => pyTruthy(g(k).on) && pyTruthy(g(k).model)).sort();
    const fxModels = active.map(k => g(k).model);
    let gain = null;
    for (const gk of ['Gain', 'Gain 1', 'Drive']) {
      const ap = pyTruthy(g('AMP').params) ? g('AMP').params : {};
      const gv = ap[gk];
      if (typeof gv === 'number') { gain = pyRound(gv / 15); break; }
    }
    return JSON.stringify([amp === undefined ? null : amp, cab === undefined ? null : cab,
                           active, fxModels, gain]);
  }

  function checkDivergence(section) {
    const seen = new Map(), errs = [];
    for (const v of (section.variants || [])) {
      const sig = variantSignature(v);
      if (sig === '[null,null,[],[],null]') continue;
      if (seen.has(sig)) {
        errs.push('les variantes ' + pyRepr(seen.get(sig)) + ' et ' + pyRepr(v.label === undefined ? '?' : v.label) +
          ' sont quasi identiques (meme ampli, meme baffle, memes effets et meme gain). ' +
          'Fais-les diverger d\'un cran de facon audible -- change le dosage ou le choix ' +
          'des effets, le niveau de gain/saturation, ou l\'ampli/baffle -- tout en gardant ' +
          'le son du morceau.');
      } else {
        seen.set(sig, v.label === undefined ? '?' : v.label);
      }
    }
    return errs;
  }

  /** Valide la structure renvoyee. Renvoie [erreurs_fatales, avertissements_style]. */
  function checkSections(tb, payload) {
    const errs = [], warns = [];
    const secs = payload.sections || [];
    if (!pyTruthy(secs)) return [['aucune section : il en faut au moins une'], []];
    if (secs.length > 4) {
      errs.push(secs.length + ' sections, c\'est trop (4 maximum). Regroupe les parties qui partagent le meme son.');
    }
    const noms = [];
    for (const sec of secs) {
      const lbl = pyTruthy(sec.nom) ? sec.nom : '?';
      noms.push(lbl);
      if (pyTruthy(sec.role) && ROLES.indexOf(sec.role) < 0) {
        errs.push('section ' + pyRepr(lbl) + ' : role ' + pyRepr(sec.role) + ' invalide (attendus : ' + ROLES.join(', ') + ')');
      }
      const vs = sec.variants || [];
      if (vs.length !== 3) {
        errs.push('section ' + pyRepr(lbl) + ' : ' + vs.length + ' variante(s), il en faut EXACTEMENT 3');
      }
      for (const v of vs) {
        for (const e of checkNames(tb, v.spec === undefined ? {} : (v.spec || {}))) {
          errs.push('[' + lbl + ' / ' + (v.label === undefined ? '?' : v.label) + '] ' + e);
        }
      }
      for (const w of checkDivergence(sec)) warns.push('section ' + pyRepr(lbl) + ' : ' + w);
    }
    if (new Set(noms).size !== noms.length) {
      errs.push('deux sections portent le meme nom : ' + pyRepr(noms));
    }
    const allnames = [];
    for (const sec of secs) for (const v of (sec.variants || [])) allnames.push((v.spec || {}).name);
    const dupes = Array.from(new Set(allnames.filter(n => n && allnames.filter(x => x === n).length > 1))).sort();
    if (dupes.length) {
      errs.push('noms de presets dupliques entre sections : ' + pyRepr(dupes) +
        ". Rends-les distincts (ex. 'MOP Rythm Fid' et 'MOP Solo Fid').");
    }
    return [errs, warns];
  }

  // -------------------------------------------------------- JSON de reponse
  function extractJson(txt) {
    txt = String(txt).trim().replace(/^\s*```(?:json)?|```\s*$/gim, '');
    const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
    if (i < 0 || j < 0) throw new ValueError('Aucun JSON dans la reponse : ' + txt.slice(0, 200));
    const s = txt.slice(i, j + 1).replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(s); } catch (e) { throw new ValueError(e.message); }
  }

  // --------------------------------------------------------- noms de fichiers
  function safeFilename(s) {
    return String(s).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'preset';
  }
  /** os.path.splitext(os.path.basename(name))[0] (les points de tete ne comptent pas comme extension). */
  function splitextBase(name) {
    let b = String(name); b = b.slice(b.lastIndexOf('/') + 1);
    let lead = 0; while (lead < b.length && b[lead] === '.') lead++;
    const dot = b.lastIndexOf('.');
    return dot > lead ? b.slice(0, dot) : b;
  }
  function safeDirname(s) {
    s = String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
    return s || 'preset';
  }

  // ---------------------------------------------------------- consignes (prompt)
  function forcedPrompt(roles, roleHint) {
    if (!roles || !roles.length) return '';
    return '\n\nCONSIGNE IMPERATIVE : ne determine PAS la structure toi-meme. ' +
      'Produis EXACTEMENT ' + roles.length + ' section(s), une par role demande, dans cet ' +
      'ordre : ' + roles.join(', ') + '.\n' +
      roles.map(r => '  - ' + r + ' : ' + roleHint[r]).join('\n');
  }

  /** = fill_default_cab (gp200_agent.py) : pose la baffle par defaut de l'ampli quand l'IA n'en donne pas (audit du 04/10 : un changement
   *  d'ampli fait charger a la pedale sa baffle par defaut ; 71 amplis confirmes, tous d'accord avec `defcab`). */
  function fillDefaultCab(spec, tb) {
    const mods = pyTruthy(spec) && pyTruthy(spec.modules) && typeof spec.modules === 'object' ? spec.modules : null;
    if (!mods) return spec;
    const amp = mods.AMP;
    if (!pyTruthy(amp) || !pyTruthy(amp.model) || !pyTruthy(has(amp, 'on') ? amp.on : true)) return spec;
    const cab = mods.CAB;
    if (pyTruthy(cab) && pyTruthy(cab.model)) return spec;
    let found;
    try { found = tb.find('AMP', amp.model); } catch (e) { if (e instanceof ValueError) return spec; throw e; }
    const m = found[0];
    if (m.defcab === null || m.defcab === undefined) return spec;
    const c = tb.cabById.get(m.defcab);
    if (!c) return spec;
    mods.CAB = { model: c.name, on: true, params: {} };
    return spec;
  }

  function applyPatchVol(raw, pv) {
    pv = pv === undefined ? 70 : pv;
    const b = new Uint8Array(raw);
    b[OFF_PATCH_VOL] = pv;
    setU16BE(b, FILE_SIZE - 2, checksum(b));
    return [b, pv];
  }

  // =============================================================== generation
  /**
   * Boucle complete : demande -> API -> validation -> auto-correction -> .prst.
   * Reprend generate() de gp200_agent.py.
   *
   *   cfg   : {provider, apiKey, model, webSearch, maxRetries, pickup, lang, maxTokens}
   *   prompts: {SYSTEM, catalogFull, catalogLight, ROLE_HINT, pickup:{}, lang:{}}
   *   hooks : {callApi(cfg, system, msgs) -> {text, truncated}, log(line), t(key,...args),
   *            template (Uint8Array), now (Date, optionnel), signal (AbortSignal)}
   * Renvoie {payload, files:[{section, variant, filename, folder, raw, spec, warnings,
   *          decoded}], folder}.
   */
  async function generate(cfg, tb, demande, prompts, hooks, roles) {
    const log = hooks.log || (() => {});
    const t = hooks.t || (k => k);
    const model = String(cfg.model || '').toLowerCase();
    const isFree = model.indexOf('free') >= 0;
    if (isFree) log(t('log_light_catalog'));
    const system = prompts.SYSTEM + (isFree ? prompts.catalogLight : prompts.catalogFull);
    const lang = cfg.lang || 'fr';
    const pk = prompts.pickup[cfg.pickup || 'auto'] || '';
    const langInstr = prompts.lang[lang] || prompts.lang.fr;
    const content = demande + forcedPrompt(roles, prompts.ROLE_HINT) + pk + langInstr;
    let msgs = [{ role: 'user', content }];

    const maxRetries = cfg.maxRetries === undefined ? 2 : Number(cfg.maxRetries);
    let payload = null, ok = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (hooks.signal && hooks.signal.aborted) throw new Error('aborted');
      log(t('log_api_attempt', attempt + 1));
      const reply = await hooks.callApi(cfg, system, msgs);
      const txt = reply.text;
      try {
        payload = extractJson(txt);
      } catch (e) {
        if (reply.truncated) {
          log(t('log_json_cut'));
          msgs = [{ role: 'user', content: demande + forcedPrompt(roles, prompts.ROLE_HINT) + pk + langInstr +
            '\n\nIMPORTANT : ta reponse precedente a ete coupee car trop longue. Sois BEAUCOUP plus ' +
            'concis : le champ "recherche" fait 5 phrases maximum, "axe", "ecoute" et "raison" une ' +
            'phrase chacun, "notes" 3 phrases. Ne precise que les parametres qui comptent, et ne cree ' +
            'pas de section inutile.' }];
        } else {
          log(t('log_unreadable', e.message));
          msgs = msgs.concat([{ role: 'assistant', content: txt },
            { role: 'user', content: "Ta reponse n'etait pas un JSON valide. Renvoie UNIQUEMENT l'objet JSON demande, sans texte ni balises." }]);
        }
        continue;
      }

      payload = normalizePayload(payload);
      const [errs, warns] = checkSections(tb, payload);
      if (roles && roles.length) {
        const got = (payload.sections || []).map(s => s.role);
        if (JSON.stringify(got) !== JSON.stringify(roles)) {
          errs.push('sections imposees : attendu ' + pyRepr(roles) + ', recu ' + pyRepr(got));
        }
      }
      // "Turbo & Eco" : pour Claude, les avertissements de style ne declenchent pas de relance.
      const isPremium = model.indexOf('claude') >= 0;
      let toFix;
      if (isPremium) {
        toFix = errs;
        if (warns.length) {
          log(t('log_style_ignored', model));
          for (const w of warns) log('  ! ' + w);
        }
      } else {
        toFix = errs.concat(warns);
      }
      if (!toFix.length) { ok = true; break; }

      log(t('log_errors_fix', toFix.length));
      for (const e of toFix) log('    - ' + e);
      msgs = msgs.concat([{ role: 'assistant', content: txt },
        { role: 'user', content: 'Erreurs a corriger dans ta reponse :\n- ' + toFix.join('\n- ') +
          "\n\nRenvoie l'objet JSON complet corrige, en n'utilisant que des noms presents dans le catalogue." }]);
    }
    if (!ok) throw new Error(t('err_gen_failed', maxRetries + 1));

    // ---- noms de dossier / fichiers (meme convention que l'appli de bureau)
    const now = hooks.now || new Date();
    const p2 = n => String(n).padStart(2, '0');
    const datePart = '' + now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate());
    const heurePart = p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds());
    const artiste = safeDirname(String(payload.artiste || '').trim());
    const titre = chars(safeDirname(String(payload.titre || '').trim())).slice(0, 40).join('').trim();
    let prefixe;
    if (artiste && artiste !== 'preset') prefixe = artiste + ' - ' + titre;
    else if (titre && titre !== 'preset') prefixe = titre;
    else prefixe = chars(safeDirname(demande)).slice(0, 40).join('').trim();
    const folder = prefixe + ' - ' + datePart + ' - ' + heurePart;

    const files = [];
    const secs = payload.sections || [];
    secs.forEach((sec, si0) => {
      const si = si0 + 1;
      const secdir = secs.length > 1
        ? si + '_' + safeFilename(sec.nom || sec.role || 'section') : '';
      log(t('log_section', si, secs.length, sec.nom, sec.role || '?'));
      (sec.variants || []).forEach((v, i) => {
        try {
          const spec = v.spec;
          if (!spec) throw new ValueError("pas de 'spec'");
          fillDefaultCab(spec, tb);
          let enc = encodePrst(spec, tb, hooks.template);
          const pvr = applyPatchVol(enc.raw);
          const raw = pvr[0];
          const filename = safeFilename(spec.name === undefined ? 'preset' : spec.name) + '_' +
            (i < 3 ? 'ABC'[i] : String(i)) + '.prst';
          const decoded = decodePrst(raw, tb);
          if (!decoded.checksum.valid) log(t('log_checksum_bad', filename));
          for (const w of enc.warnings) log(t('log_warn', w));
          files.push({ section: sec, variant: v, filename, folder: secdir, raw, spec,
                       warnings: enc.warnings, decoded });
          log(t('log_written', filename));
        } catch (e) {
          log(t('log_variant_skip', v.label === undefined ? i : v.label, e.message));
        }
      });
    });
    return { payload, files, folder };
  }

  // ================================================================ AFFINER
  /** Marque un nombre comme "float" Python pour json.dumps (50 -> 50.0). */
  class PyFloat { constructor(v) { this.v = v; } }
  function pyFloatJson(x) {
    if (Number.isNaN(x)) return 'NaN';
    if (x === Infinity) return 'Infinity';
    if (x === -Infinity) return '-Infinity';
    if (Number.isInteger(x) && Math.abs(x) < 1e16) return Object.is(x, -0) ? '-0.0' : x.toFixed(1);
    return String(x);
  }
  /** json.dumps(obj, indent=indent, ensure_ascii=False) de Python, avec PyFloat. */
  function pyJsonDumps(obj, indent, level) {
    level = level || 0;
    const pad = n => ' '.repeat(indent * n);
    if (obj instanceof PyFloat) return pyFloatJson(obj.v);
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'boolean') return obj ? 'true' : 'false';
    if (typeof obj === 'number') return String(obj);
    if (typeof obj === 'string') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      if (!obj.length) return '[]';
      return '[\n' + obj.map(x => pad(level + 1) + pyJsonDumps(x, indent, level + 1)).join(',\n') + '\n' + pad(level) + ']';
    }
    const keys = Object.keys(obj);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(k => pad(level + 1) + JSON.stringify(k) + ': ' + pyJsonDumps(obj[k], indent, level + 1)).join(',\n') + '\n' + pad(level) + '}';
  }

  /** Preset decode -> spec reutilisable par l'encodeur (= decoded_to_spec). Valeurs en PyFloat. */
  function decodedToSpec(d) {
    const mods = {};
    for (const slot of MODULES) {
      const e = d.modules[slot];
      if (!e.model) { mods[slot] = null; continue; }
      const params = {};
      for (const k of Object.keys(e.params || {})) params[k] = new PyFloat(round4(Number(e.params[k])));
      mods[slot] = { model: e.model, on: e.on, params };
    }
    return { name: d.name, author: d.author || '', description: d.description || '',
      chain_order: d.chain_order || Array.from({ length: 11 }, (_, i) => i), modules: mods };
  }
  /** Retire les PyFloat : spec "ordinaire" (pour affichage). */
  function plainSpec(spec) {
    return JSON.parse(JSON.stringify(spec, (k, v) => (v instanceof PyFloat ? v.v : v)));
  }

  /** Diff REEL entre deux presets decodes (= diff_presets). */
  function diffPresets(before, after) {
    const out = [];
    if (before.name !== after.name) out.push('nom : ' + pyRepr(before.name) + ' -> ' + pyRepr(after.name));
    if (JSON.stringify(before.chain_order) !== JSON.stringify(after.chain_order)) {
      out.push('chaine : ' + pyRepr(before.chain_readable) + ' -> ' + pyRepr(after.chain_readable));
    }
    for (const slot of MODULES) {
      const b = before.modules[slot], a = after.modules[slot];
      if ((b.model || null) !== (a.model || null)) {
        out.push(slot + ' : ' + (b.model || '(vide)') + ' -> ' + (a.model || '(vide)'));
        continue;
      }
      if (b.on !== a.on) out.push(slot + ' : ' + (b.on ? 'ON' : 'off') + ' -> ' + (a.on ? 'ON' : 'off'));
      const pb = b.params || {}, pa = a.params || {};
      for (const k of Object.keys(pa)) {
        if (has(pb, k) && Math.abs(Number(pb[k]) - Number(pa[k])) > 0.005) {
          out.push(slot + ' / ' + k + ' : ' + fmtG(Number(pb[k])) + ' -> ' + fmtG(Number(pa[k])));
        }
      }
    }
    return out;
  }

  /**
   * Modifie un preset existant (= refine / refine_live de gp200_agent.py).
   * mode 'refine' (consigne libre) ou 'live' (prompt "pret pour le concert", consigne pre-cablee).
   * src = {raw: Uint8Array, name: nom du fichier source}. Renvoie
   * {payload, raw, filename, folder, spec, diff, warnings, decoded, before}.
   */
  async function refine(cfg, tb, src, instruction, prompts, hooks, mode) {
    const log = hooks.log || (() => {});
    const t = hooks.t || (k => k);
    const live = mode === 'live';
    const before = decodePrst(src.raw, tb);
    if (!before.checksum.valid) log(t('log_src_checksum'));
    const specIn = decodedToSpec(before);
    const system = (live ? prompts.SYSTEM_LIVE_READY : prompts.SYSTEM_REFINE) + prompts.catalogFull;
    const lang = cfg.lang || 'fr';
    const demande = 'PRESET ACTUEL :\n' + pyJsonDumps(specIn, 1) + '\n\nDEMANDE DE MODIFICATION :\n' +
      (live ? prompts.LIVE_READY_INSTRUCTION : instruction) + (prompts.lang[lang] || prompts.lang.fr);
    let msgs = [{ role: 'user', content: demande }];

    const maxRetries = cfg.maxRetries === undefined ? 2 : Number(cfg.maxRetries);
    let payload = null, ok = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (hooks.signal && hooks.signal.aborted) throw new Error('aborted');
      log(t('log_api_attempt', attempt + 1));
      const reply = await hooks.callApi(cfg, system, msgs);
      const txt = reply.text;
      try {
        payload = extractJson(txt);
      } catch (e) {
        log(t('log_unreadable', e.message));
        msgs = [{ role: 'user', content: demande + "\n\nRenvoie UNIQUEMENT l'objet JSON demande, sans texte ni balises." }];
        continue;
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('reponse inattendue : ' + pyRepr(payload));
      const errs = checkNames(tb, payload.spec || {}, specIn.modules);
      if (!errs.length) { ok = true; break; }
      log(t('log_errors_fix', errs.length));
      for (const e of errs) log(t('log_bullet', e));
      msgs = msgs.concat([{ role: 'assistant', content: txt },
        { role: 'user', content: 'Erreurs a corriger :\n- ' + errs.join('\n- ') + "\n\nRenvoie l'objet JSON complet corrige." }]);
    }
    if (!ok) throw new Error(t('err_gen_failed', maxRetries + 1));

    const now = hooks.now || new Date();
    const p2 = n => String(n).padStart(2, '0');
    const datePart = '' + now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate());
    const heurePart = p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds());
    const srcBase = splitextBase(src.name || 'preset');
    const srcDir = chars(safeDirname(srcBase)).slice(0, 40).join('').trim();
    const folder = srcDir + (live ? ' (live)' : ' (affine)') + ' - ' + datePart + ' - ' + heurePart;

    const spec = payload.spec;
    const enc = encodePrst(spec, tb, hooks.template);
    const base = safeFilename(pyTruthy(spec.name) ? spec.name : srcBase);
    const filename = base + (live ? '_live.prst' : '_v2.prst');
    for (const w of enc.warnings) log(t('log_warn', w));
    const after = decodePrst(enc.raw, tb);
    if (!after.checksum.valid) throw new Error('checksum invalide : ' + filename);
    log(t('log_written2', filename));
    return { payload, raw: enc.raw, filename, folder, spec, diff: diffPresets(before, after), warnings: enc.warnings, decoded: after, before };
  }

  /** Edition "en place" d'un parametre (= SlotControlPopup._sync_param_value) + checksum. */
  function patchParam(raw, moduleIdx, paramIdx, value) {
    const rec0 = findBytes(raw, REC_MAGIC);
    if (rec0 < 12) throw new ValueError('Enregistrements de module introuvables');
    if (!(moduleIdx >= 0 && moduleIdx < N_MODULES) || !(paramIdx >= 0 && paramIdx < N_SLOTS)) throw new ValueError('slot/parametre hors limites');
    new DataView(raw.buffer, raw.byteOffset, raw.byteLength).setFloat32(rec0 + moduleIdx * RECORD_SIZE + 12 + paramIdx * 4, value, true);
    setU16BE(raw, raw.length - 2, checksum(raw));
    return raw;
  }

  /** Bascule ON/OFF d'un module dans les octets (octet +5 de l'enregistrement) + checksum. */
  function patchOn(raw, moduleIdx, on) {
    const rec0 = findBytes(raw, REC_MAGIC);
    if (rec0 < 12) throw new ValueError('Enregistrements de module introuvables');
    raw[rec0 + moduleIdx * RECORD_SIZE + 5] = on ? 1 : 0;
    setU16BE(raw, raw.length - 2, checksum(raw));
    return raw;
  }

  /** Remplace l'enregistrement du module k de `raw` par celui de `other` (EN PLACE) + checksum. */
  function replaceRecord(raw, other, moduleIdx) {
    const a = findBytes(raw, REC_MAGIC), b = findBytes(other, REC_MAGIC);
    if (a < 12 || b < 12) throw new ValueError('Enregistrements de module introuvables');
    for (let i = 0; i < RECORD_SIZE; i++) raw[a + moduleIdx * RECORD_SIZE + i] = other[b + moduleIdx * RECORD_SIZE + i];
    setU16BE(raw, raw.length - 2, checksum(raw));
    return raw;
  }

  /** Ecrit la table CTRL ({1: ['AMP',..], ...}) dans une COPIE et recalcule le checksum
   *  (= CtrlDialog._save du Python). */
  function setCtrl(raw, ctrl) {
    const out = Uint8Array.from(raw);
    writeCtrl(out, ctrl);
    setU16BE(out, out.length - 2, checksum(out));
    return out;
  }

  /** Recopie d'un preset source vers un preset affine : table CTRL et patch volume
   *  (que l'encodeur remet a zero / par defaut). Ne fait PAS partie du Python. */
  function carryOver(srcRaw, raw) {
    const out = Uint8Array.from(raw);
    const ctrl = {};
    readCtrl(srcRaw).forEach((mods, n) => { ctrl[n + 1] = mods; });
    writeCtrl(out, ctrl);
    out[OFF_PATCH_VOL] = srcRaw[OFF_PATCH_VOL];
    setU16BE(out, out.length - 2, checksum(out));
    return out;
  }

  // ===================================================================== ZIP
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** Zip "stored" (sans compression : les .prst font 1224 octets, inutile de compresser). */
  function buildZip(entries, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const nameB = enc.encode(e.name);
      const crc = crc32(e.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, e.data.length, true); lh.setUint32(22, e.data.length, true);
      lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameB, e.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, e.data.length, true);
      ch.setUint32(24, e.data.length, true); ch.setUint16(28, nameB.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + e.data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // ============================================================= fournisseurs
  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const ANTHROPIC_VERSION = '2023-06-01';
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  class ApiError extends Error {
    constructor(status, message, extra) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      Object.assign(this, extra || {});
    }
  }

  const sleep = (ms, signal) => new Promise((res, rej) => {
    const id = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(id); rej(new Error('aborted')); }, { once: true });
  });

  /**
   * POST/GET JSON avec delai maximal, annulation et relances sur 429/503
   * (les offres gratuites renvoient souvent "modele surcharge").
   */
  async function httpJson(url, body, headers, o) {
    o = o || {};
    const timeout = o.timeout || 180000;
    const retries = o.retries === undefined ? 2 : o.retries;
    const log = o.log || (() => {});
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeout);
      if (o.signal) {
        if (o.signal.aborted) throw new Error('aborted');
        o.signal.addEventListener('abort', () => ctl.abort(new Error('aborted')), { once: true });
      }
      let res;
      try {
        res = await fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (o.signal && o.signal.aborted) throw new Error('aborted');
        if (ctl.signal.aborted) throw new ApiError(0, 'timeout', { kind: 'timeout' });
        throw new ApiError(0, String(e && e.message || e), { kind: 'network' });
      }
      clearTimeout(timer);
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (_) { /* corps non JSON */ }
      if (res.ok) return data === null ? {} : data;

      let msg = raw.slice(0, 400);
      if (data && data.error) {
        msg = (typeof data.error === 'string' ? data.error : (data.error.message || msg));
      }
      const retryAfter = res.headers.get('retry-after');
      const credit = res.status === 429 && /credit/i.test(msg);
      if ((res.status === 429 || res.status === 503) && !credit && attempt < retries) {
        const wait = Math.min(30000, retryAfter ? Number(retryAfter) * 1000 || 4000 : 4000 * (attempt + 1) * (attempt + 1));
        log('http', res.status, Math.round(wait / 1000));
        await sleep(wait, o.signal);
        continue;
      }
      throw new ApiError(res.status, msg, { retryAfter, credit });
    }
  }

  function keyOf(cfg) { return String(cfg.apiKey || '').trim(); }

  async function callGemini(cfg, system, msgs, ctx) {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: Number(cfg.maxTokens || 16000), temperature: 0.7 },
    };
    // le grounding Google Search est incompatible avec le mode JSON force
    if (cfg.webSearch) body.tools = [{ google_search: {} }];
    else body.generationConfig.responseMimeType = 'application/json';
    const d = await httpJson(GEMINI_BASE + '/models/' + cfg.model + ':generateContent', body,
      { 'content-type': 'application/json', 'x-goog-api-key': keyOf(cfg) }, ctx);
    const u = d.usageMetadata || {};
    ctx.log('tokens', u.promptTokenCount, u.candidatesTokenCount);
    const cands = d.candidates || [];
    if (!cands.length) {
      throw new ApiError(0, 'Gemini n\'a rien renvoye (' + JSON.stringify(d.promptFeedback || 'raison inconnue') + ')', { kind: 'empty' });
    }
    const c = cands[0];
    if (['SAFETY', 'RECITATION', 'BLOCKLIST'].indexOf(c.finishReason) >= 0) {
      throw new ApiError(0, 'Reponse bloquee par Gemini : ' + c.finishReason, { kind: 'blocked' });
    }
    const truncated = c.finishReason === 'MAX_TOKENS';
    if (truncated) ctx.log('truncated');
    const parts = (c.content && c.content.parts) || [];
    return { text: parts.filter(p => 'text' in p && !p.thought).map(p => p.text).join('\n').trim(), truncated };
  }

  async function callAnthropic(cfg, system, msgs, ctx) {
    const body = {
      model: cfg.model, max_tokens: Number(cfg.maxTokens || 16000),
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: msgs,
    };
    if (cfg.webSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: Number(cfg.maxSearches || 3) }];
    }
    const d = await httpJson(ANTHROPIC_URL, body, {
      'content-type': 'application/json', 'x-api-key': keyOf(cfg),
      'anthropic-version': ANTHROPIC_VERSION,
      // obligatoire pour appeler l'API depuis un navigateur
      'anthropic-dangerous-direct-browser-access': 'true',
    }, ctx);
    const u = d.usage || {};
    ctx.log('tokens', u.input_tokens, u.output_tokens);
    const truncated = d.stop_reason === 'max_tokens';
    if (truncated) ctx.log('truncated');
    return { text: (d.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim(), truncated };
  }

  async function callOpenRouter(cfg, system, msgs, ctx) {
    const full = [{ role: 'system', content: system }].concat(
      msgs.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })));
    const body = { model: cfg.model, messages: full, temperature: 0.7, max_tokens: Number(cfg.maxTokens || 16000) };
    const hdrs = {
      'content-type': 'application/json', 'authorization': 'Bearer ' + keyOf(cfg),
      'HTTP-Referer': 'https://github.com/rudywidmer/GP200-Studio', 'X-Title': 'GP-200 Studio',
    };
    let d;
    try {
      d = await httpJson(OPENROUTER_URL, body, hdrs, ctx);
    } catch (e) {
      // Un modele gratuit peut passer en payant du jour au lendemain : l'API 404
      // en indiquant le bon identifiant. On le reprend et on reessaie une fois.
      const m = /use this slug instead:\s*([\w./:-]+)/.exec(String(e.message));
      if (e.status === 404 && m) {
        const nm = m[1].replace(/\.$/, '');
        ctx.log('model_switch', nm);
        body.model = nm; cfg.model = nm;
        d = await httpJson(OPENROUTER_URL, body, hdrs, ctx);
      } else throw e;
    }
    const u = d.usage || {};
    ctx.log('tokens', u.prompt_tokens, u.completion_tokens);
    const choices = d.choices || [];
    if (!choices.length) {
      throw new ApiError(0, 'OpenRouter n\'a rien renvoye (' + JSON.stringify(d.error || '?') + ')', { kind: 'empty' });
    }
    const ch = choices[0];
    const truncated = ch.finish_reason === 'length';
    if (truncated) ctx.log('truncated');
    return { text: String((ch.message || {}).content || '').trim(), truncated };
  }

  /** Point d'entree unique : choisit le fournisseur. ctx = {log(kind,...), signal, timeout}. */
  async function callApi(cfg, system, msgs, ctx) {
    if (!keyOf(cfg)) throw new ApiError(0, 'Aucune cle API', { kind: 'nokey' });
    if (cfg.provider === 'gemini') return callGemini(cfg, system, msgs, ctx);
    if (cfg.provider === 'anthropic') return callAnthropic(cfg, system, msgs, ctx);
    if (cfg.provider === 'openrouter') return callOpenRouter(cfg, system, msgs, ctx);
    throw new ApiError(0, 'Fournisseur inconnu : ' + cfg.provider, { kind: 'provider' });
  }

  // ------------------------------------------------- liste reelle des modeles
  const OPENROUTER_FAMILY_RANK = ['deepseek/', 'qwen/', 'meta-llama/', 'google/', 'z-ai/', 'moonshotai/',
    'mistralai/', 'nvidia/', 'microsoft/', 'openai/', 'anthropic/', 'x-ai/'];

  function openrouterModels(data, cfg) {
    const priceOf = m => {
      let pr = m.pricing;
      if (Array.isArray(pr)) pr = pr.length ? pr[0] : {};
      if (!pr || typeof pr !== 'object') return [null, null];
      const f = v => { const n = parseFloat(v); return Number.isNaN(n) ? null : n; };
      return [f(pr.prompt), f(pr.completion)];
    };
    const wantOut = Math.min(Number(cfg.maxTokens || 16000), 4096);
    const needCtx = 16000;
    const scored = [];
    for (const m of data) {
      const mid = m.id;
      if (!mid || mid === 'openrouter/free') continue;
      const [pin, pout] = priceOf(m);
      if (pin === null || pout === null || pin > 0 || pout > 0) continue;
      const ctxLen = parseInt(m.context_length || 0, 10) || 0;
      if (ctxLen && ctxLen < needCtx) continue;
      const top = m.top_provider || {};
      const mx = parseInt(top.max_completion_tokens || m.max_completion_tokens || 0, 10) || 0;
      if (mx && mx < wantOut) continue;
      const outs = (m.architecture || {}).output_modalities || [];
      if (outs.length && outs.indexOf('text') < 0) continue;
      const feats = new Set(m.supported_parameters || []);
      let sc = 0;
      if (feats.has('structured_outputs')) sc += 4;
      if (feats.has('response_format')) sc += 3;
      if (feats.has('json_mode')) sc += 3;
      if (feats.has('tools')) sc += 1;
      sc += Math.min(ctxLen, 400000) / 200000.0;
      scored.push([sc, ctxLen, mid]);
    }
    const rank = mid => {
      const i = OPENROUTER_FAMILY_RANK.findIndex(f => mid.startsWith(f));
      return i < 0 ? OPENROUTER_FAMILY_RANK.length : i;
    };
    scored.sort((a, b) => (rank(a[2]) - rank(b[2])) || (b[0] - a[0]) || (b[1] - a[1]));
    return ['openrouter/free'].concat(scored.slice(0, 20).map(s => s[2]));
  }

  /** Interroge le fournisseur pour la liste reelle des modeles (les noms changent vite). */
  async function listModels(cfg, fallback, ctx) {
    ctx = ctx || {};
    const key = keyOf(cfg);
    try {
      if (cfg.provider === 'openrouter') {
        const d = await httpJson('https://openrouter.ai/api/v1/models', undefined, {}, Object.assign({ retries: 0 }, ctx));
        return openrouterModels(d.data || [], cfg);
      }
      if (!key) return fallback;
      if (cfg.provider === 'gemini') {
        const d = await httpJson(GEMINI_BASE + '/models?pageSize=200', undefined, { 'x-goog-api-key': key },
          Object.assign({ retries: 0 }, ctx));
        const out = (d.models || [])
          .filter(m => (m.supportedGenerationMethods || m.supportedActions || []).indexOf('generateContent') >= 0)
          .map(m => String(m.name).split('/').pop());
        return Array.from(new Set(out)).sort();
      }
      if (cfg.provider === 'anthropic') {
        const d = await httpJson('https://api.anthropic.com/v1/models?limit=100', undefined, {
          'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true' }, Object.assign({ retries: 0 }, ctx));
        return Array.from(new Set((d.data || []).map(m => m.id))).sort();
      }
    } catch (e) { /* repli sur la liste statique */ }
    return fallback;
  }

  // ===================================================================== PKCE
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** (code_verifier, code_challenge) en methode S256, comme gp200_oauth.make_pkce. */
  async function makePkce(cryptoImpl) {
    const c = cryptoImpl || (typeof crypto !== 'undefined' ? crypto : null);
    const verifier = b64url(c.getRandomValues(new Uint8Array(32)));
    const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)) };
  }

  function openrouterAuthUrl(callbackUrl, challenge) {
    const q = new URLSearchParams({
      callback_url: callbackUrl, code_challenge: challenge, code_challenge_method: 'S256',
    });
    return 'https://openrouter.ai/auth?' + q.toString();
  }

  /** Echange le code a usage unique contre une cle API. */
  async function openrouterExchange(code, verifier, ctx) {
    const d = await httpJson('https://openrouter.ai/api/v1/auth/keys',
      { code, code_verifier: verifier, code_challenge_method: 'S256' },
      { 'content-type': 'application/json' }, Object.assign({ retries: 0, timeout: 30000 }, ctx || {}));
    if (!d || !d.key) throw new ApiError(0, 'Reponse sans cle', { kind: 'nokey' });
    return d.key;
  }

  return {
    FILE_SIZE, MODULES, MODULE_INDEX, SLOT_ACCEPTS, SLOT_FALLBACK, ROLES, OFF_PATCH_VOL, N_MODULES,
    ValueError, ApiError, Tables,
    pyRepr, fmtG, pyRound, pyTruthy, pyFloat, norm, closeMatches,
    checksum, encodePrst, decodePrst, readCtrl, writeCtrl, setCtrl, patchParam, patchOn, replaceRecord, N_CTRL, N_SLOTS,
    checkNames, checkSections, checkDivergence, normalizePayload, extractJson,
    safeFilename, safeDirname, forcedPrompt, applyPatchVol, fillDefaultCab, generate,
    PyFloat, pyJsonDumps, decodedToSpec, plainSpec, diffPresets, refine, carryOver,
    crc32, buildZip,
    httpJson, callApi, listModels, openrouterModels, makePkce, openrouterAuthUrl, openrouterExchange, b64url,
  };
});
