/* ============================================================================
 * gp150usb.js -- Valeton GP-150 et GP-180 par USB (Web MIDI)
 *
 * Meme role que gp200usb.js pour le GP-200, pour les deux pedales qui parlent le protocole « 7F » :
 *   trame brute (entre F0 et F7)   7F  K  Llo Lhi  Olo Ohi  T  I  <quartets>
 *     K = CRC-8 (poly 0x31) de raw[2:] sur 7 bits ; L = longueur totale, O = decalage du morceau (7 bits + 7 bits) ;
 *     T = numero de transaction (repris dans l'accuse de reception) ; I = indice du morceau
 *   message logique                01  C  Nlo Nhi  <charge utile>      (C = CRC-8 de la charge utile)
 *
 * Fonctions pures verifiees octet par octet contre ref/gp150_usb.py et contre le code de reference
 * (valeton-gp150-editor, MIT) -- voir tests/. Aucun acces au DOM : la classe GP150Link recoit le MIDIAccess du navigateur
 * (ou un faux dans les tests). Regles de prudence reprises de ce projet : une seule requete a la fois, un accuse de reception
 * apres chaque reponse complete, une seule sonde apres la connexion (la pedale met jusqu'a ~6 s a repondre), jamais de renvoi
 * automatique, jamais de remise a zero d'usine.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GP150USB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODULES = ['PRE', 'WAH', 'DST', 'NS', 'AMP', 'NR', 'CAB', 'EQ', 'MOD', 'DLY', 'RVB', 'VOL'];
  const MODULE_FF = {}; MODULES.forEach((m, i) => { MODULE_FF[m] = i; });
  const FILE_SIZE = 1128;
  const HEADER = [0x11, 0x30, 0x64, 0x04];
  const CHUNK = 119;                       // octets logiques par trame (248 octets de SysEx)
  const SLOT_MAX = 200;
  const PREFIX = 8;                        // 01 C Nlo Nhi + 4 octets de type, avant le corps d'un patch
  const NAMES_LEN = 12 + 200 * 20;         // 4012
  const MODEL_OFF0 = 0x88, STRIDE = 0x44;
  const modelOff = k => MODEL_OFF0 + STRIDE * k;
  const PEDALS = { gp150: { id: 'gp150', name: 'GP-150', rx: /gp[\s_-]?150/i }, gp180: { id: 'gp180', name: 'GP-180', rx: /gp[\s_-]?180/i } };

  class UsbError extends Error {
    constructor(code, message) { super(message); this.name = 'UsbError'; this.code = code; }
  }

  /** Quel Valeton est derriere ce nom de port MIDI ? 'gp150' | 'gp180' | 'gp200' | null. */
  function modelOfPortName(name) {
    const n = String(name || '');
    if (/gp[\s_-]?180/i.test(n)) return 'gp180';
    if (/gp[\s_-]?150/i.test(n)) return 'gp150';
    if (/gp[\s_-]?200/i.test(n)) return 'gp200';
    return null;
  }

  // ------------------------------------------------------------------ emplacements (1..200, sans lettre)
  function slotToPc(slot) {
    if (!(slot >= 1 && slot <= SLOT_MAX) || Math.floor(slot) !== slot) throw new UsbError('slot', 'slot doit etre 1-' + SLOT_MAX + ', recu ' + slot);
    return slot - 1;
  }
  function pcToSlotName(pc) { const n = pc + 1; return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
  /** Selection par CC0 + PC (fiable une seule fois par session) : emplacement 0..199 -> [banque, programme]. */
  function bankAndPc(slot) {
    if (!(slot >= 0 && slot <= 199)) throw new UsbError('slot', 'emplacement hors 0..199 : ' + slot);
    return slot < 128 ? [0, slot] : [1, slot - 128];
  }

  // ------------------------------------------------------------------ codec
  function crc8(bytes) {
    let c = 0;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i];
      for (let k = 0; k < 8; k++) c = (c & 0x80) ? ((c << 1) ^ 0x31) & 0xFF : (c << 1) & 0xFF;
    }
    return c;
  }
  function toNibbles(bytes) {
    const o = [];
    for (let i = 0; i < bytes.length; i++) o.push((bytes[i] >> 4) & 15, bytes[i] & 15);
    return o;
  }
  function fromNibbles(n) {
    const o = [];
    for (let i = 0; i + 1 < n.length; i += 2) o.push(((n[i] & 15) << 4) | (n[i + 1] & 15));
    return o;
  }
  const wireTag = raw => crc8(raw.slice(2)) & 0x7F;
  /** 01 C Nlo Nhi + charge utile. */
  function logical(payload) {
    return [0x01, crc8(payload), payload.length & 0xFF, (payload.length >> 8) & 0xFF].concat(Array.from(payload));
  }
  /** Decoupe un message logique en trames brutes. */
  function frames(stream, t, firstIndex) {
    const total = stream.length, out = [];
    for (let off = 0, idx = 0; off < Math.max(total, 1); off += CHUNK, idx++) {
      const raw = [0x7F, 0, total & 0x7F, total >> 7, off & 0x7F, off >> 7, t & 0x7F, ((firstIndex || 0) + idx) & 0x7F].concat(toNibbles(stream.slice(off, off + CHUNK)));
      raw[1] = wireTag(raw);
      out.push(raw);
    }
    return out;
  }
  function ack(t) { const raw = [0x7F, 0, 0, 0, 0, 0, t & 0x7F, 0]; raw[1] = wireTag(raw); return raw; }
  const sysex = raw => Uint8Array.from([0xF0].concat(Array.from(raw), [0xF7]));

  const f32le = v => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return Array.from(b); };
  const u32be = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const u32le = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const modIdx = m => { const k = typeof m === 'number' ? m : MODULE_FF[m]; if (!(k >= 0 && k <= 11)) throw new UsbError('module', 'module inconnu : ' + m); return k; };

  // ------------------------------------------------------------------ messages (hote -> pedale)
  /** flag 0 : selectionne le patch ; flag 1 : le lit sans le selectionner ; slot 0xFFFF + flag 1 : patch actif. */
  function msgSelect(slot, flag, t) {
    return frames(logical([0x03, 0x03, 0x11, 0x30, 0x11, 0x30, 0x02, 0x00, slot & 255, (slot >> 8) & 255, flag ? 1 : 0]), t == null ? 1 : t)[0];
  }
  const msgActive = t => msgSelect(0xFFFF, 1, t);
  /** Requete de catalogue : 0x70 = info, 0x10 = noms des 200 patchs, 0x42 = IR utilisateur, 0x52 = SnapTones, 0x92 = NAM. */
  function msgRead(code, t) { return frames(logical([0x03, 0x01, code, 0x10, code, 0x10, 0x02, 0x00]), t == null ? 0 : t)[0]; }
  function msgSetParam(module, fxid, alg, value, t) {
    return frames(logical([0x00, 0x03, 0x33, 0x30, 0x33, 0x30, 0x10, 0x00].concat(u32be(fxid >>> 0), f32le(value), [modIdx(module), alg & 255, 0, 0])), t == null ? 1 : t)[0];
  }
  function msgEnable(module, on, t) {
    return frames(logical([0x00, 0x03, 0x31, 0x30, 0x31, 0x30, 0x08, 0x00, modIdx(module), on ? 1 : 0, 0, 0]), t == null ? 1 : t)[0];
  }
  function msgModelSwap(module, fxid, t) {
    return frames(logical([0x00, 0x03, 0x32, 0x30, 0x32, 0x30, 0x0C, 0x00].concat(u32le(fxid >>> 0), [modIdx(module), 0, 0, 0])), t == null ? 1 : t)[0];
  }
  function msgReorder(order, t) {
    const o = Array.from(order, modIdx);
    if (o.slice().sort((a, b) => a - b).join() !== '0,1,2,3,4,5,6,7,8,9,10,11') throw new UsbError('order', 'la chaine doit contenir les 12 modules une fois');
    return frames(logical([0x00, 0x03, 0x34, 0x30, 0x34, 0x30, 0x10, 0x00].concat(o)), t == null ? 1 : t)[0];
  }
  /** Ecriture de la structure « infos du patch » (BPM, volume du patch, ... : 80 octets pris tels quels dans le corps lu). */
  function msgPresetInfo(data80, t) {
    if (data80.length !== 80) throw new UsbError('data', 'structure de 80 octets attendue');
    return frames(logical([0x00, 0x03, 0x20, 0x30, 0x20, 0x30, 0x50, 0x00].concat(Array.from(data80))), t == null ? 1 : t)[0];
  }
  /** Ecriture d'un preset complet dans un emplacement, sans le selectionner : 1136 octets logiques, 10 trames. */
  function msgWritePreset(body, slot, t) {
    if (body.length !== FILE_SIZE) throw new UsbError('size', 'preset de ' + body.length + ' octets au lieu de ' + FILE_SIZE);
    if (!(slot >= 0 && slot < SLOT_MAX)) throw new UsbError('slot', 'emplacement hors 0..199');
    const b = Array.from(body); b[4] = slot;
    return frames(logical([0x01, 0x03, 0x11, 0x30].concat(b)), t == null ? 7 : t);
  }

  // ------------------------------------------------------------------ reception
  function parseChunk(inner) {
    if (!inner || inner.length <= 8 || inner[0] !== 0x7F) return null;
    return { t: inner[6], i: inner[7], total: inner[2] | (inner[3] << 7), off: inner[4] | (inner[5] << 7), nib: Array.from(inner.slice(8)) };
  }
  /** Les 4 premiers octets d'un message logique sont-ils coherents ? -> charge utile ou null. */
  function payloadOf(stream) {
    if (!stream || stream.length < 4 || stream[0] !== 1) return null;
    const n = stream[2] | (stream[3] << 8);
    return stream.length === 4 + n ? stream.slice(4) : null;
  }
  function bodyOf(stream) {
    if (!stream || stream.length !== PREFIX + FILE_SIZE) return null;
    if (stream[4] !== 3 || stream[5] !== 3 || stream[6] !== 0x11 || stream[7] !== 0x30) return null;
    for (let i = 0; i < 4; i++) if (stream[PREFIX + i] !== HEADER[i]) return null;
    return Uint8Array.from(stream.slice(PREFIX, PREFIX + FILE_SIZE));
  }
  function decodeNames(stream) {
    if (!stream || stream.length < 12 || (stream.length - 12) % 20) throw new UsbError('names', 'reponse des noms inattendue (' + (stream && stream.length) + ' octets)');
    const out = [];
    for (let i = 0; i < (stream.length - 12) / 20; i++) {
      const r = stream.slice(12 + 20 * i, 32 + 20 * i);
      let nm = '';
      for (let k = 4; k < 20 && r[k]; k++) nm += String.fromCharCode(r[k]);
      out.push({ index: (r[0] | (r[1] << 8) | (r[2] << 16) | (r[3] << 24)) >>> 0, name: nm.trim() });
    }
    return out;
  }

  /** Message spontane de la pedale (message logique complet) -> evenement du meme genre que ceux du GP-200, ou null.
   *  {kind:'bypass', module, on, source:'panel'} | {kind:'panel', module, param, value, fxid} | {kind:'patchvol', v}
   *  | {kind:'model', module, fxid} | {kind:'order', order} | {kind:'body', slot, body} */
  function parseNotify(stream) {
    const body = bodyOf(stream);
    if (body) return { kind: 'body', slot: body[4], body };
    const p = payloadOf(stream);
    if (!p || p.length < 8 || p[0] !== 3 || p[1] !== 3) return null;
    const code = p[2] | (p[3] << 8);
    const dv = new DataView(Uint8Array.from(p).buffer);
    if (code === 0x3031 && p.length >= 10 && p[8] <= 11 && p[9] <= 1) return { kind: 'bypass', module: p[8], on: p[9] === 1, source: 'panel' };
    if (code === 0x3033 && p.length >= 18 && p[16] <= 11) {
      const value = dv.getFloat32(12, true);
      if (!Number.isFinite(value)) return null;
      return { kind: 'panel', module: p[16], param: p[17], value, fxid: dv.getUint32(8, true) };
    }
    if (code === 0x3032 && p.length >= 13 && p[12] <= 11) return { kind: 'model', module: p[12], fxid: dv.getUint32(8, true) };
    if (code === 0x3034 && p.length >= 20) return { kind: 'order', order: Array.from(p.slice(8, 20)) };
    if (code === 0x3020 && p.length >= 12) return { kind: 'patchvol', v: dv.getInt16(10, true), bpm: dv.getInt16(8, true) };
    return null;
  }

  /** Corps (1128 octets) auquel on applique une notification : la copie que l'on garde de la pedale reste a jour sans attendre la
   *  prochaine diffusion complete. */
  function applyNotify(body, e) {
    if (!body || !e) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (e.kind === 'bypass') body[modelOff(e.module) - 4] = e.on ? 1 : 0;
    else if (e.kind === 'panel' && e.param >= 0 && e.param < 10) dv.setFloat32(modelOff(e.module) + 4 + 4 * e.param, e.value, true);
    else if (e.kind === 'patchvol') dv.setInt16(0x26, e.v, true);
  }

  /** Ce qui a change entre deux corps du MEME patch : evenements equivalents a ceux que la pedale enverrait. */
  function diffBodies(a, b) {
    const ev = [];
    const da = new DataView(a.buffer, a.byteOffset, a.byteLength), db = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let structural = false;
    for (let i = 0; i < 12; i++) if (a[0x78 + i] !== b[0x78 + i]) structural = true;
    for (let k = 0; k < 12; k++) {
      const o = modelOff(k);
      if (da.getUint32(o, true) !== db.getUint32(o, true)) { structural = true; continue; }
      if (a[o - 4] !== b[o - 4]) ev.push({ kind: 'bypass', module: k, on: !!b[o - 4], source: 'panel' });
      for (let p = 0; p < 10; p++) {
        const x = da.getFloat32(o + 4 + 4 * p, true), y = db.getFloat32(o + 4 + 4 * p, true);
        if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) ev.push({ kind: 'panel', module: k, param: p, value: y, fxid: db.getUint32(o, true) });
      }
    }
    for (let i = 0x2C; i < 0x2C + 13; i++) if (a[i] !== b[i]) structural = true;
    if (da.getInt16(0x26, true) !== db.getInt16(0x26, true)) ev.push({ kind: 'patchvol', v: db.getInt16(0x26, true) });
    return { events: ev, structural };
  }

  // ------------------------------------------------------------------ lien
  const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
  const T_MAX = 120;

  class GP150Link {
    constructor(o) {
      o = o || {};
      this.log = o.log || (() => {});
      this.sleep = o.sleep || defaultSleep;
      this.chunkDelay = o.chunkDelay === undefined ? 8 : o.chunkDelay;
      this.model = o.model || null;                     // 'gp150' | 'gp180' (choisi par le port si absent)
      this.loose = !!o.loose;
      this.primeMs = o.primeMs === undefined ? 6000 : o.primeMs;
      this.timeoutMs = o.timeoutMs === undefined ? 6000 : o.timeoutMs;
      this.access = null; this.out = null; this.inp = null;
      this.onchange = null; this.onnotify = null; this.onrx = null;
      this.rx = [];
      this.busy = false;
      this.active = null;                               // {slot, body} : derniere copie complete du patch actif
      this.confirm = { seen: 0, miss: 0, off: true };
      this._t = 0; this._asm = new Map(); this._waiters = []; this._rq = null; this._frag = null;
      this._primed = false; this._deferred = []; this._lastRx = null;
    }

    static supported(nav) {
      nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
      return !!nav && typeof nav.requestMIDIAccess === 'function';
    }
    static async request(nav) { nav = nav || navigator; return nav.requestMIDIAccess({ sysex: true }); }

    attach(access) { this.access = access; access.onstatechange = () => { if (this.onchange) this.onchange(); }; }

    ports() {
      const lst = m => { const r = []; if (m) m.forEach(p => r.push({ id: p.id, name: p.name || '', state: p.state })); return r; };
      return { outputs: lst(this.access && this.access.outputs), inputs: lst(this.access && this.access.inputs) };
    }
    _rxFor(model) { return model && PEDALS[model] ? PEDALS[model].rx : /gp[\s_-]?1[58]0/i; }
    /** Id de la sortie qui ressemble a la pedale (GP-150 ou GP-180), ou null. */
    findPedal() {
      const o = this.ports().outputs.filter(p => p.state !== 'disconnected');
      const rx = this._rxFor(this.model);
      const hit = o.find(p => rx.test(p.name));
      if (hit || !this.loose) return hit ? hit.id : null;
      const alt = o.find(p => /valeton|gp[\s_-]?1[58]0/i.test(p.name));
      if (alt) return alt.id;
      return o.length === 1 ? o[0].id : null;
    }
    findGp200() { return this.findPedal(); }

    select(outputId) {
      const outs = this.access.outputs, ins = this.access.inputs;
      this.closeInput();
      this.out = outs.get ? outs.get(outputId) : null;
      if (!this.out) throw new UsbError('noport', 'port MIDI introuvable');
      const name = (this.out.name || '').toLowerCase();
      if (!this.model) this.model = modelOfPortName(name) === 'gp180' ? 'gp180' : 'gp150';
      let inp = null;
      ins.forEach(p => { if (!inp && p.state !== 'disconnected' && (p.name || '').toLowerCase() === name) inp = p; });
      if (!inp) { const rx = this._rxFor(this.model); ins.forEach(p => { if (!inp && p.state !== 'disconnected' && rx.test(p.name || '') && rx.test(name)) inp = p; }); }
      if (!inp && this.loose) {
        const live = []; ins.forEach(p => { if (p.state !== 'disconnected') live.push(p); });
        inp = live.find(p => /valeton|gp[\s_-]?1[58]0/i.test(p.name || '')) || (live.length === 1 ? live[0] : null);
      }
      this._frag = null; this.inp = inp;
    }

    async open() {
      if (!this.out) throw new UsbError('noport', 'aucune sortie choisie');
      try { if (this.out.open) await this.out.open(); }
      catch (e) { throw new UsbError('busy', 'impossible d\'ouvrir la sortie : ' + (e && e.message || e)); }
      this.rx = [];
      if (this.inp) {
        try {
          if (this.inp.open) await this.inp.open();
          this.inp.onmidimessage = ev => this._rxSysex(ev.data);
        } catch (e) { this.log('input_blind', String(e && e.message || e)); this.inp = null; }
      }
      if (!this._primed && this.inp) await this._prime();
    }

    closeInput() {
      if (this.inp) { try { this.inp.onmidimessage = null; if (this.inp.close) this.inp.close(); } catch (e) { /* rien */ } }
      this.inp = null;
      for (const w of this._waiters.slice()) w.fail(new UsbError('gone', 'connexion fermee'));
    }
    async close() {
      this.closeInput();
      if (this.out && this.out.close) { try { await this.out.close(); } catch (e) { /* rien */ } }
      this.out = null;
    }
    get blind() { return !this.inp; }

    _send(raw) {
      if (!this.out || this.out.state === 'disconnected') throw new UsbError('gone', 'la pedale a ete debranchee');
      this.out.send(Array.from(sysex(raw)));
    }
    _next() { this._t = this._t % T_MAX + 1; return this._t; }

    // ---- reception
    _rxSysex(d) {
      if (!d || !d.length) return;
      if (this.loose || this._frag) {
        if (d[0] === 0xF0) { this._frag = null; if (d[d.length - 1] !== 0xF7) { this._frag = Array.from(d); return; } }
        else if (this._frag) {
          if (d[0] >= 0xF8) return;
          if (d[0] >= 0x80 && d[0] !== 0xF7) { this._frag = null; return; }
          for (let i = 0; i < d.length; i++) this._frag.push(d[i]);
          if (this._frag.length > 4096) { this._frag = null; return; }
          if (d[d.length - 1] !== 0xF7) return;
          d = Uint8Array.from(this._frag); this._frag = null;
        } else return;
      }
      if (d[0] !== 0xF0 || d[d.length - 1] !== 0xF7) return;
      const m = Uint8Array.from(d);
      this._lastRx = m;
      this.rx.push(m); if (this.rx.length > 64) this.rx.splice(0, this.rx.length - 64);
      if (this.onrx) { try { this.onrx(m); } catch (e) { /* rien */ } }
      const inner = m.subarray(1, m.length - 1);
      if (inner[0] !== 0x7F) return;
      if (inner.length <= 8) {                                  // accuse de reception ou poignee de main : rien a assembler
        for (const w of this._waiters.slice()) if (w.ackT !== undefined && w.ackT === inner[6]) w.ok(null);
        return;
      }
      const c = parseChunk(inner);
      if (!c) return;
      let a = this._asm.get(c.t);
      if (!a || (c.off === 0 && a.parts.has(0))) { a = { total: c.total, parts: new Map() }; this._asm.set(c.t, a); }
      a.parts.set(c.off, c.nib);
      let pos = 0;
      const offs = Array.from(a.parts.keys()).sort((x, y) => x - y);
      for (const o of offs) { if (o !== pos) break; pos += a.parts.get(o).length >> 1; }
      if (this._asm.size > 24) this._asm.delete(this._asm.keys().next().value);
      if (pos >= a.total) {
        this._asm.delete(c.t);
        let nib = []; for (const o of offs) nib = nib.concat(a.parts.get(o));
        this._complete(c.t, fromNibbles(nib).slice(0, a.total), m);
      }
    }

    _complete(t, stream, raw) {
      this._ackLater(t);
      const body = bodyOf(stream);
      let eaten = false;
      for (const w of this._waiters.slice()) {
        let r; try { r = w.match ? w.match(stream, t, body) : undefined; } catch (e) { r = undefined; }
        if (r !== undefined && r !== false) { w.ok(r === true ? stream : r); eaten = true; break; }
      }
      if (body) this._onBody(body, eaten);
      else if (!eaten) {
        const e = parseNotify(stream);
        if (e) { applyNotify(this.active && this.active.body, e); if (this.onnotify) { try { this.onnotify(e, raw); } catch (x) { /* rien */ } } }
      }
    }

    _onBody(body, quiet) {
      const prev = this.active;
      this.active = { slot: body[4], body: Uint8Array.from(body) };
      this.log('body', body[4]);
      if (quiet || !this.onnotify) return;
      if (!prev) { this.onnotify({ kind: 'body', slot: body[4], body }, this._lastRx); return; }
      if (prev.slot !== body[4]) { this.onnotify({ kind: 'patch', pc: body[4] }, this._lastRx); return; }
      const d = diffBodies(prev.body, body);
      if (d.structural) { this.onnotify({ kind: 'patch', pc: body[4], changed: true }, this._lastRx); return; }
      for (const e of d.events) { try { this.onnotify(e, this._lastRx); } catch (x) { /* rien */ } }
    }

    _ackLater(t) {
      if (this.busy) { this._deferred.push(t); return; }
      try { this._send(ack(t)); } catch (e) { /* la lecture elle-meme a reussi */ }
    }
    _flushAcks() { const l = this._deferred.splice(0); for (const t of l) { try { this._send(ack(t)); } catch (e) { /* rien */ } } }

    /** Attend un message dont match(stream, t, body) rend autre chose que undefined/false (la valeur est la reponse). */
    _wait(match, ms) {
      return new Promise((resolve, reject) => {
        const w = {
          match,
          ok: v => { clear(); resolve(v); },
          fail: e => { clear(); reject(e); },
        };
        const timer = setTimeout(() => { clear(); reject(new UsbError('timeout', 'la pedale n\'a pas repondu')); }, ms || this.timeoutMs);
        const clear = () => { clearTimeout(timer); const i = this._waiters.indexOf(w); if (i >= 0) this._waiters.splice(i, 1); };
        this._waiters.push(w);
        w._cancel = clear;
      });
    }

    /** Une seule requete a la fois : celle-ci attend la fin de la precedente. */
    async _serial(fn) {
      const prev = this._rq || Promise.resolve();
      let release; this._rq = new Promise(r => { release = r; });
      try { await prev; } catch (e) { /* rien */ }
      try { return await fn(); } finally { release(); }
    }
    _readyToRead() {
      if (!this.out || this.out.state === 'disconnected') throw new UsbError('noport', 'aucune sortie ouverte');
      if (!this.inp) throw new UsbError('noread', "pas d'entree MIDI : lecture impossible");
    }

    /** Sonde unique apres la connexion (le premier echange suit parfois de plusieurs secondes l'ouverture). */
    async _prime() {
      this._primed = true;
      try {
        const p = this._wait(() => true, this.primeMs);
        this._send(msgRead(0x70, 0));
        await p;
      } catch (e) { this.log('prime_timeout'); }
    }

    /** Patch actif de la pedale (lecture seule : rien n'est selectionne). -> { data (corps de 1128 octets), pc }. */
    async readCurrentPatch(o) {
      o = o || {};
      const ms = o.timeout || o.timeoutMs;
      return this._serial(async () => {
        this._readyToRead();
        const p = this._wait((s, t, body) => (body ? body : undefined), ms);
        this._send(msgActive(this._next()));
        let body = await p;
        // numero connu (annonce de la pedale) et corps d'un autre patch (diffusion perimee) : on relit CE patch, sans le selectionner
        if (o.pc !== undefined && o.pc !== null && body[4] !== o.pc) {
          const q = this._wait((s, t, b) => (b && b[4] === o.pc ? b : undefined), ms);
          this._send(msgSelect(o.pc, 1, this._next()));
          body = await q;
        }
        return { data: body, pc: body[4], via: 'active' };
      });
    }
    /** Patch `pc` (0..199) tel qu'enregistre, sans le selectionner. */
    async readStoredPatch(pc, o) {
      o = o || {};
      return this._serial(async () => {
        this._readyToRead();
        const p = this._wait((s, t, body) => (body && body[4] === pc ? body : undefined), o.timeout || o.timeoutMs);
        this._send(msgSelect(pc, 1, this._next()));
        const body = await p;
        return { data: body, pc, via: 'stored' };
      });
    }
    /** Les 200 noms en une requete -> [{index, name}]. */
    async readNames(o) {
      o = o || {}; o = Object.assign({}, o, { timeout: o.timeout || o.timeoutMs });
      return this._serial(async () => {
        this._readyToRead();
        const pi = this._wait((s) => (s.length === 16 || (s.length < 64 && payloadOf(s) && payloadOf(s)[2] === 0x70)) ? true : undefined, 2500).catch(() => null);
        this._send(msgRead(0x70, 0));
        await pi;
        await this.sleep(150);
        const p = this._wait((s) => (s.length === NAMES_LEN ? s : undefined), o.timeout || 8000);
        this._send(msgRead(0x10, 2));
        return decodeNames(await p);
      });
    }

    // ---- ecriture
    /** Ecrit un .prst dans un emplacement (slot = 1..200), sans le selectionner, puis le relit pour verifier.
     *  onProgress(step, total, label) : 0 = preparation, 1..N = trames, N+1 = fin. -> {ack, attempts, blind, pc}. */
    async writePreset(slot, letter, prst, o) {
      o = o || {};
      if (this.busy) throw new UsbError('busy', 'un envoi est deja en cours');
      const pc = slotToPc(slot);
      const fr = msgWritePreset(prst, pc, 7);
      const total = fr.length, progress = o.onProgress || (() => {});
      this.busy = true;
      try {
        progress(0, total, 'handshake');
        for (let i = 0; i < total; i++) {
          progress(i + 1, total, 'chunk ' + (i + 1) + '/' + total);
          this._send(fr[i]);
          if (i < total - 1 && this.chunkDelay > 0) await this.sleep(this.chunkDelay);
        }
      } finally { this.busy = false; this._flushAcks(); }
      await this.sleep(o.settle === undefined ? 400 : o.settle);
      let verified = false;
      if (this.inp && o.verify !== false) {
        const r = await this.readStoredPatch(pc, { timeout: 7000 }).catch(() => null);
        if (!r) throw new UsbError('verify', "la pedale n'a pas confirme l'ecriture (relecture impossible)");
        if (!sameSound(r.data, prst)) throw new UsbError('verify', "la pedale n'a pas conserve le preset (relecture differente)");
        verified = true;
      }
      progress(total + 1, total, 'done');
      return { ack: verified, attempts: 1, blind: this.blind, pc };
    }
    async pushPreset(slot, letter, prst, o) {
      o = o || {};
      const r = await this.writePreset(slot, letter, prst, o);
      if (o.activate !== false) {
        await this.sleep(o.delayAfterWrite === undefined ? 350 : o.delayAfterWrite);
        this.selectPreset(slot);
      }
      return r;
    }
    /** Charge un emplacement (1..200) sur la pedale. */
    selectPreset(slot) {
      const pc = slotToPc(slot);
      this._send(msgSelect(pc, 0, this._next()));
      return pc;
    }

    // ---- reglages en direct (rien n'est enregistre)
    _fxidAt(prst, k) { return new DataView(prst.buffer, prst.byteOffset, prst.byteLength).getUint32(modelOff(k), true); }
    sendParam(moduleIdx, paramIdx, value, prst) {
      this._send(msgSetParam(moduleIdx, this._fxidAt(prst, moduleIdx), paramIdx, value, this._next()));
      if (this.active && this.active.body) applyNotify(this.active.body, { kind: 'panel', module: moduleIdx, param: paramIdx, value });
      return true;
    }
    sendEffectChange(moduleIdx, mid) { this._send(msgModelSwap(moduleIdx, mid, this._next())); return true; }
    /** Change de modele : la pedale ne confirme pas, on laisse le temps de charger. */
    async changeEffect(moduleIdx, mid, cat, o) {
      this.sendEffectChange(moduleIdx, mid);
      await this.sleep((o && o.wait) || 400);
      return { confirmed: false, waited: true };
    }
    waitConfirm() { return Promise.resolve(false); }
    sendBypass(moduleIdx, active) {
      this._send(msgEnable(moduleIdx, active, this._next()));
      if (this.active && this.active.body) applyNotify(this.active.body, { kind: 'bypass', module: moduleIdx, on: !!active });
      return true;
    }
    /** Volume du patch : on renvoie la structure « infos du patch » du corps le plus recent lu sur la pedale. */
    sendPatchVol(vol, prst) {
      const a = (prst && prst.length === FILE_SIZE ? Uint8Array.from(prst) : null) || (this.active && this.active.body);      // prst : le preset que l'on vient d'envoyer (mesure de volume), sinon le dernier patch lu
      if (!a) throw new UsbError('nobody', "le patch de la pedale n'a pas encore ete lu");
      const d = Uint8Array.from(a.subarray(0x24, 0x24 + 80));
      new DataView(d.buffer).setInt16(2, vol, true);
      this._send(msgPresetInfo(d, this._next()));
      applyNotify(a, { kind: 'patchvol', v: vol });
      return true;
    }
    sendReorder(order) { this._send(msgReorder(order, this._next())); return true; }
  }

  /** Deux corps decrivent-ils le meme son (nom, chaine, modeles, etats, reglages) ? Le numero d'emplacement, la somme de controle et
   *  le masque des modules (recalcules par la pedale) ne comptent pas. */
  function sameSound(a, b) {
    if (a.length !== FILE_SIZE || b.length !== FILE_SIZE) return false;
    for (let i = 0x2C; i < 0x2C + 13; i++) if (a[i] !== b[i]) return false;
    for (let i = 0x78; i < 0x84; i++) if (a[i] !== b[i]) return false;
    const da = new DataView(a.buffer, a.byteOffset, a.byteLength), db = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let k = 0; k < 12; k++) {
      const o = modelOff(k);
      if (da.getUint32(o, true) !== db.getUint32(o, true) || !!a[o - 4] !== !!b[o - 4]) return false;
      for (let p = 0; p < 10; p++) if (Math.abs(da.getFloat32(o + 4 + 4 * p, true) - db.getFloat32(o + 4 + 4 * p, true)) > 1e-3) return false;
    }
    return true;
  }

  return {
    MODULES, MODULE_FF, FILE_SIZE, SLOT_MAX, CHUNK, PEDALS, NAMES_LEN,
    UsbError, modelOfPortName, slotToPc, pcToSlotName, bankAndPc,
    crc8, toNibbles, fromNibbles, wireTag, logical, frames, ack, sysex,
    msgSelect, msgActive, msgRead, msgSetParam, msgEnable, msgModelSwap, msgReorder, msgPresetInfo, msgWritePreset,
    parseChunk, payloadOf, bodyOf, decodeNames, parseNotify, applyNotify, diffBodies, sameSound,
    GP150Link, MidiLink: GP150Link,
  };
});
