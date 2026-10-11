/* ============================================================================
 * gp150core.js -- GP-150 / GP-180 : format .prst, catalogue, encodage / decodage
 *
 * Port de ref/gp150lib.py (l'oracle, voir tests/). Meme role que gp200core.js pour le GP-200 : il expose un objet « moteur » dont les
 * fonctions portent les memes noms (MODULES, FILE_SIZE, decodePrst, encodePrst, patchParam, ...) pour que l'interface puisse utiliser
 * l'un ou l'autre sans rien savoir du format.
 *
 *   const G = GP150.forModel('gp150')   // ou 'gp180' : seule la somme de controle du fichier differe
 *
 * Le format (1128 octets, en-tete 11 30 64 04) vient du projet valeton-gp150-editor (MIT) ; voir ref/data/GP150_THIRD_PARTY.md.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GP150 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FILE_SIZE = 1128;
  const HEADER = [0x11, 0x30, 0x64, 0x04];
  const OFF_SLOT = 0x04, OFF_BPM = 0x24, OFF_PATCH_VOL = 0x26, OFF_NAME = 0x2C, LEN_NAME = 13, OFF_ORDER = 0x78;
  const MODULES = ['PRE', 'WAH', 'DST', 'NS', 'AMP', 'NR', 'CAB', 'EQ', 'MOD', 'DLY', 'RVB', 'VOL'];
  const N_MODULES = 12, N_SLOTS = 10;
  const MODEL_OFF0 = 0x88, STRIDE = 0x44;
  const FXID_NONE = 100663299;
  const CHECK_OFF = 0x0E, CHECK_START = 0x10, CHECK_END = 1124;
  const CHECK_INIT = { gp150: 0xE011, gp180: 0x2380 };
  const MASK_OFF = 0x444;
  const SLOT_COUNT = 200;
  const ROLES = ['clean', 'crunch', 'disto', 'lead'];
  const modelOff = k => MODEL_OFF0 + STRIDE * k;

  class ValueError extends Error { constructor(m) { super(m); this.name = 'ValueError'; } }

  const norm = s => String(s).toLowerCase().split('+').join('plus').replace(/[^a-z0-9]/g, '');
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pyTruthy = x => !(x === undefined || x === null || x === false || x === 0 || x === '' || (Array.isArray(x) && !x.length) ||
    (typeof x === 'object' && x !== null && !Array.isArray(x) && !Object.keys(x).length));
  const round4 = f => { if (f === 0) return f; const s = f * 10000; if (Number.isFinite(s) && Math.abs(s - Math.trunc(s)) === 0.5) { const lo = Math.floor(s); return (lo % 2 === 0 ? lo : lo + 1) / 10000; } return Number(f.toFixed(4)); };
  const fmtG = v => String(Number(Number(v).toPrecision(6)));

  function crc16(b, init) {
    let c = init;
    for (let i = CHECK_START; i < CHECK_END; i++) {
      c ^= b[i];
      for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xA001) : (c >>> 1);
    }
    return c & 0xFFFF;
  }

  // ------------------------------------------------------------------ catalogue
  class Tables {
    /** data = {models:[{id (fxid), cat (indice du module), name, category_label, params:[{name, slot (algId), min, max, step, default, options?}], slots:[module], origin?}], desc?} */
    constructor(data) {
      this.models = data.models;
      this.cabs = [];                         // les baffles du GP-150 sont des modeles du module CAB
      this.desc = data.desc || {};
      this.byKey = new Map();
      for (const m of this.models) this.byKey.set(m.id + ',' + m.cat, m);
      this._byName = new Map();
      for (const m of this.models) {
        let d = this._byName.get(m.cat);
        if (!d) { d = new Map(); this._byName.set(m.cat, d); }
        const k = norm(m.name);
        if (d.has(k) && d.get(k).id !== m.id) throw new Error('Collision de noms : ' + d.get(k).name + ' / ' + m.name);
        d.set(k, m);
      }
      const none = this.byKey.get(FXID_NONE + ',11');
      this.noneParams = none ? none.params : [];
    }
    description(modelId, category) {
      const d = this.desc[category + ',' + modelId];
      if (d) return d.short || '';
      const m = this.byKey.get(modelId + ',' + category);
      return m && m.origin ? m.origin : '';
    }
    model(id, cat) { return this.byKey.get(id + ',' + cat) || null; }
    cab() { return null; }
    inMenu(slot, m) { return !m.slots || m.slots.indexOf(slot) >= 0; }
    find(slot, name) {
      const k = MODULES.indexOf(slot);
      if (k < 0) throw new ValueError('Slot inconnu: ' + JSON.stringify(slot) + ' (attendus: ' + JSON.stringify(MODULES) + ')');
      const d = this._byName.get(k), m = d && d.get(norm(name));
      if (!m) throw new ValueError('Modele ' + JSON.stringify(name) + ' introuvable pour le slot ' + slot + '. Verifier l\'orthographe exacte dans le catalogue.');
      return [m, k];
    }
    modelsForSlot(slot) {
      const k = MODULES.indexOf(slot);
      return this.models.filter(m => m.cat === k).map(m => [m, k]);
    }
    paramsOf(modelId, category) {
      const m = this.byKey.get(modelId + ',' + category);
      if (m) return m.params;
      return modelId === FXID_NONE ? this.noneParams : [];
    }
  }

  // ------------------------------------------------------------------ moteur par modele
  function forModel(model) {
    if (!has(CHECK_INIT, model)) throw new Error('modele inconnu : ' + model);
    const INIT = CHECK_INIT[model];
    const dvOf = b => new DataView(b.buffer, b.byteOffset, b.byteLength);

    const checksumOf = b => crc16(b, INIT);
    function fixChecksum(b) { const c = checksumOf(b); b[CHECK_OFF] = c >> 8; b[CHECK_OFF + 1] = c & 0xFF; return b; }
    const checksumOk = b => checksumOf(b) === ((b[CHECK_OFF] << 8) | b[CHECK_OFF + 1]);
    function setMask(b) {
      let m = 0;
      for (let k = 0; k < N_MODULES; k++) if (b[modelOff(k) - 4]) m |= 1 << k;
      b[MASK_OFF] = m & 0xFF; b[MASK_OFF + 1] = m >> 8;
    }
    function getName(b) { let s = ''; for (let i = OFF_NAME; i < OFF_NAME + LEN_NAME; i++) { if (!b[i]) break; s += String.fromCharCode(b[i]); } return s.trim(); }
    function putName(b, n) { for (let i = 0; i < LEN_NAME; i++) b[OFF_NAME + i] = i < n.length ? n.charCodeAt(i) & 0xFF : 0; }

    function decodePrst(data, tables) {
      if (data.length !== FILE_SIZE) throw new ValueError('Taille inattendue: ' + data.length + ' (attendu ' + FILE_SIZE + ')');
      for (let i = 0; i < 4; i++) if (data[i] !== HEADER[i]) throw new ValueError("En-tete inattendu (ce n'est pas un preset GP-150 / GP-180)");
      const dv = dvOf(data);
      let chain = Array.from(data.slice(OFF_ORDER, OFF_ORDER + N_MODULES));
      if (!chain.slice().sort((p, q) => p - q).every((v, i) => v === i)) chain = null;
      const out = {
        name: getName(data), author: '', description: '',
        chain_order: chain, chain_readable: chain ? chain.map(i => MODULES[i]) : null, modules: {},
      };
      for (let k = 0; k < N_MODULES; k++) {
        const o = modelOff(k), slot = MODULES[k];
        const fx = dv.getUint32(o, true);
        const floats = [];
        for (let i = 0; i < N_SLOTS; i++) floats.push(dv.getFloat32(o + 4 + 4 * i, true));
        const entry = { module_index: k, on: !!data[o - 4], model_id: fx, category: k, flags: 0, raw_floats: floats.map(round4) };
        if (tables) {
          const m = tables.model(fx, k);
          entry.model = m && (fx !== FXID_NONE || slot === 'VOL') ? m.name : null;
          entry.category_label = m ? m.category_label : null;
          entry.params = {};
          for (const p of tables.paramsOf(fx, k)) if (p.slot < N_SLOTS) entry.params[p.name] = floats[p.slot];
        }
        out.modules[slot] = entry;
      }
      out.ctrl = {};
      out.patch_vol = dv.getInt16(OFF_PATCH_VOL, true);
      out.bpm = dv.getInt16(OFF_BPM, true);
      out.slot = data[OFF_SLOT];
      const exp = checksumOf(data), got = (data[CHECK_OFF] << 8) | data[CHECK_OFF + 1];
      out.checksum = { stored: got, computed: exp, valid: exp === got };
      return out;
    }

    /** spec = {name, chain_order (permutation 0..11), modules:{slot:{model, on, params} | {keep:true, on} | null}, patch_vol?, bpm?}. */
    function encodePrst(spec, tables, template, opts) {
      opts = opts || {};
      const strict = opts.strict !== false;
      if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new ValueError('spec invalide (objet attendu)');
      const data = new Uint8Array(template);
      if (data.length !== FILE_SIZE) throw new ValueError('Template invalide (' + data.length + ' octets)');
      const dv = dvOf(data);
      const warnings = [];
      let name = spec.name === undefined ? 'Untitled' : spec.name;
      if (name === null) name = '';
      if (strict) {
        if (typeof name !== 'string') throw new ValueError('name doit etre une chaine');
        if (name.length > LEN_NAME) throw new ValueError('Nom trop long (' + name.length + ' > ' + LEN_NAME + '): ' + JSON.stringify(name));
      }
      putName(data, name);
      const chain = spec.chain_order === undefined || spec.chain_order === null ? MODULES.map((_, i) => i) : spec.chain_order;
      const sorted = Array.isArray(chain) ? chain.slice().sort((p, q) => p - q) : null;
      if (!sorted || sorted.length !== N_MODULES || !sorted.every((v, i) => v === i)) throw new ValueError('chain_order doit etre une permutation de 0..11, recu ' + JSON.stringify(chain));
      for (let i = 0; i < N_MODULES; i++) data[OFF_ORDER + i] = chain[i];
      if (spec.patch_vol !== undefined && spec.patch_vol !== null) dv.setInt16(OFF_PATCH_VOL, Math.trunc(spec.patch_vol), true);
      if (spec.bpm !== undefined && spec.bpm !== null) dv.setInt16(OFF_BPM, Math.trunc(spec.bpm), true);
      const modsIn = spec.modules == null ? {} : spec.modules;
      for (let k = 0; k < N_MODULES; k++) {
        const slot = MODULES[k], o = modelOff(k);
        let ms = has(modsIn, slot) ? modsIn[slot] : undefined;
        if (ms && ms.keep) { data[o - 4] = (has(ms, 'on') ? ms.on : true) ? 1 : 0; continue; }
        const hasModel = pyTruthy(ms) && pyTruthy(ms.model);
        const oldFx = dv.getUint32(o, true);
        let on = pyTruthy(ms) ? (has(ms, 'on') ? !!pyTruthy(ms.on) : true) : false;
        let fx, plist, mname = ms ? ms.model : null;
        if (hasModel) {
          const found = tables.find(slot, ms.model);
          fx = found[0].id; plist = found[0].params;
        } else {
          fx = FXID_NONE; plist = tables.paramsOf(FXID_NONE, k);
          on = slot === 'VOL';
          ms = ms || {};
        }
        if (fx !== oldFx) for (let i = 0; i < N_SLOTS; i++) dv.setFloat32(o + 4 + 4 * i, 0, true);
        dv.setUint32(o, fx, true);
        data[o - 4] = on ? 1 : 0;
        if (!hasModel && fx === oldFx) plist = [];
        const rawGiven = ms.params == null ? {} : ms.params;
        if (typeof rawGiven !== 'object' || Array.isArray(rawGiven)) throw new ValueError('slot ' + slot + ' : params doit etre un objet');
        const given = Object.entries(rawGiven);
        const known = new Map();
        for (const p of plist) known.set(norm(p.name), p);
        for (const g of given) {
          if (!known.has(norm(g[0]))) {
            const msg = slot + '/' + mname + ' : parametre ' + JSON.stringify(g[0]) + ' inconnu (attendus: ' + JSON.stringify(plist.map(p => p.name)) + ')';
            if (strict) throw new ValueError(msg);
            warnings.push(msg);
          }
        }
        for (const p of plist) {
          let val, explicit = false;
          for (const g of given) if (norm(g[0]) === norm(p.name)) { val = Number(g[1]); explicit = true; break; }
          if (explicit && !Number.isFinite(val)) throw new ValueError('could not convert to float: ' + JSON.stringify(given.find(g => norm(g[0]) === norm(p.name))[1]));
          if (val === undefined) val = Number(p.default);
          const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max);
          if (!(lo <= val && val <= hi) && !explicit) {
            warnings.push(slot + '/' + mname + '/' + p.name + ' : ' + fmtG(val) + ' hors [' + fmtG(lo) + '..' + fmtG(hi) + '], borne');
            val = Math.max(lo, Math.min(hi, val));
          }
          if (p.slot < N_SLOTS) dv.setFloat32(o + 4 + 4 * p.slot, val, true);
        }
      }
      setMask(data);
      fixChecksum(data);
      return { raw: data, warnings };
    }

    function decodedToSpec(d) {
      const mods = {};
      for (const slot of MODULES) {
        const e = d.modules[slot];
        if (!e.model || (slot === 'VOL' && e.model_id === FXID_NONE)) {
          if (slot === 'VOL') { const params = {}; for (const k of Object.keys(e.params || {})) params[k] = round4(Number(e.params[k])); mods[slot] = { model: 'Volume', on: e.on, params }; }
          else if (e.model_id !== FXID_NONE) mods[slot] = { keep: true, on: e.on };
          else mods[slot] = null;
          continue;
        }
        const params = {};
        for (const k of Object.keys(e.params || {})) params[k] = round4(Number(e.params[k]));
        mods[slot] = { model: e.model, on: e.on, params };
      }
      return { name: d.name, author: '', description: '', chain_order: d.chain_order || MODULES.map((_, i) => i), modules: mods, patch_vol: d.patch_vol, bpm: d.bpm };
    }
    const plainSpec = spec => JSON.parse(JSON.stringify(spec));

    // ---- modifications « sur place » des octets (+ somme de controle)
    function patchParam(raw, moduleIdx, paramIdx, value) {
      if (!(moduleIdx >= 0 && moduleIdx < N_MODULES) || !(paramIdx >= 0 && paramIdx < N_SLOTS)) throw new ValueError('slot/parametre hors limites');
      dvOf(raw).setFloat32(modelOff(moduleIdx) + 4 + 4 * paramIdx, value, true);
      fixChecksum(raw);
      return raw;
    }
    function patchOn(raw, moduleIdx, on) {
      raw[modelOff(moduleIdx) - 4] = on ? 1 : 0;
      setMask(raw); fixChecksum(raw);
      return raw;
    }
    /** Remplace le bloc du module k de `raw` par celui de `other` (EN PLACE). */
    function replaceRecord(raw, other, moduleIdx) {
      const a = modelOff(moduleIdx) - 4;
      for (let i = 0; i < STRIDE; i++) raw[a + i] = other[a + i];
      setMask(raw); fixChecksum(raw);
      return raw;
    }
    function applyPatchVol(raw, pv) {
      pv = pv === undefined ? 50 : pv;
      const b = new Uint8Array(raw);
      dvOf(b).setInt16(OFF_PATCH_VOL, pv, true);
      fixChecksum(b);
      return [b, pv];
    }
    function carryOver(srcRaw, raw) {
      const out = Uint8Array.from(raw);
      dvOf(out).setInt16(OFF_PATCH_VOL, dvOf(srcRaw).getInt16(OFF_PATCH_VOL, true), true);
      fixChecksum(out);
      return out;
    }
    const readCtrl = () => [];
    const setCtrl = raw => Uint8Array.from(raw);

    /** Lecture sur la pedale : le corps recu EST un .prst (1128 octets). On y remet un en-tete valide et la somme de controle. */
    function prstFromDeviceRead(data) {
      if (!data || data.length !== FILE_SIZE) throw new ValueError('Lecture pedale inattendue : ' + (data ? data.length : 0) + ' octets au lieu de ' + FILE_SIZE);
      return fixChecksum(Uint8Array.from(data));
    }
    const deviceReadName = data => getName(data);

    return {
      id: model, FILE_SIZE, MODULES, N_MODULES, N_SLOTS, OFF_PATCH_VOL, ROLES, SLOT_COUNT, FXID_NONE, LEN_NAME, OFF_SLOT,
      Tables, ValueError,
      checksum: checksumOf, fixChecksum, checksumOk, decodePrst, encodePrst, decodedToSpec, plainSpec,
      patchParam, patchOn, replaceRecord, applyPatchVol, carryOver, readCtrl, setCtrl, prstFromDeviceRead, deviceReadName,
      getName, modelOff, setMask,
    };
  }

  return { FILE_SIZE, HEADER, MODULES, N_MODULES, N_SLOTS, FXID_NONE, CHECK_INIT, SLOT_COUNT, ROLES, Tables, ValueError, crc16, modelOff, norm, forModel, round4 };
});
