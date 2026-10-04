/* ============================================================================
 * gp200usb.js -- envoi de presets au Valeton GP-200 par USB (Web MIDI)
 *
 * Port FIDELE de gp200_usb.py (protocole retro-ingenierie sur capture USBPcap) :
 *   - memes trames SysEx (verifiees octet par octet contre le Python, voir tests/)
 *   - meme sequence : handshake (ACK attendu, 5 essais de 100 ms) -> 7 morceaux
 *     SysEx -> Bank Select + Program Change pour activer le preset.
 *
 * Aucun acces au DOM. La partie "protocole" est pure ; la classe MidiLink recoit
 * l'objet MIDIAccess du navigateur (ou un faux dans les tests).
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GP200USB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------- constantes protocole
  const NUX_ID = [0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32];            // "!%~GP-2"
  const SYSEX_CMD_HDR = [0xF0].concat(NUX_ID, [0x12, 0x20, 0x09]);         // 11 octets
  const CHUNK_SIZE = 183;
  const DEV_HDR_SIZE = 36;
  const PRST_HDR_OFFSET = 68;
  const PRST_DATA_END = 1216;
  const PRST_PC_OFFSET = 76;
  const PRST_SIZE = 1224;
  const GP200_MIDI_NAME = 'GP-200';
  const MIDI_CHANNEL = 0;
  const PC_MAX_MIDI = 127;
  const SLOT_MAX = 64;

  class UsbError extends Error {
    constructor(code, message) { super(message); this.name = 'UsbError'; this.code = code; }
  }

  // ------------------------------------------------------------------ trames
  /** Numero PC (0-based) d'un slot. letter = 'A'..'D' ou 0..3. */
  function slotToPc(slot, letter) {
    if (typeof letter === 'string') letter = letter.toUpperCase().charCodeAt(0) - 65;
    if (!(slot >= 1 && slot <= SLOT_MAX) || Math.floor(slot) !== slot) {
      throw new UsbError('slot', 'slot doit etre 1-' + SLOT_MAX + ', recu ' + slot);
    }
    if (!(letter >= 0 && letter <= 3) || Math.floor(letter) !== letter) {
      throw new UsbError('letter', 'letter doit etre 0-3 ou A-D, recu ' + letter);
    }
    return (slot - 1) * 4 + letter;
  }

  function pcToSlotName(pc) {
    const n = Math.floor(pc / 4) + 1;
    return (n < 10 ? '0' : '') + n + '-' + 'ABCD'[pc % 4];
  }

  function nibbleEncode(data) {
    const out = new Uint8Array(data.length * 2);
    for (let i = 0; i < data.length; i++) {
      out[2 * i] = (data[i] >> 4) & 0x0F;
      out[2 * i + 1] = data[i] & 0x0F;
    }
    return out;
  }

  function buildDeviceHeader(destPc, prst) {
    const h = new Uint8Array(DEV_HDR_SIZE);
    h[2] = 0x04; h[4] = 0x01; h[6] = destPc;
    h[8] = 0x01; h[10] = 0x04; h[12] = destPc; h[14] = destPc;
    h[16] = 0x02; h[18] = 0x58; h[20] = destPc; h[22] = 0x78;
    h[24] = prst[56];
    h[28] = 0x05;
    return h;
  }

  /** .prst (1224 octets) -> payload device (1184 octets). */
  function prstToDevicePayload(prst, destPc) {
    if (prst.length !== PRST_SIZE) throw new UsbError('size', '.prst doit faire 1224 bytes, recu ' + prst.length);
    const header = buildDeviceHeader(destPc, prst);
    const body = Uint8Array.from(prst.subarray ? prst.subarray(PRST_HDR_OFFSET, PRST_DATA_END) : prst.slice(PRST_HDR_OFFSET, PRST_DATA_END));
    body[PRST_PC_OFFSET] = destPc;
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0); out.set(body, header.length);
    return out;
  }

  /** Les 7 messages SysEx (F0 ... F7) qui ecrivent un preset. */
  function buildSysexChunks(prst, destPc) {
    const payload = prstToDevicePayload(prst, destPc);
    const msgs = [];
    for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
      const chunk = payload.subarray(offset, Math.min(offset + CHUNK_SIZE, payload.length));
      const nib = nibbleEncode(chunk);
      const msg = new Uint8Array(SYSEX_CMD_HDR.length + 2 + nib.length + 1);
      msg.set(SYSEX_CMD_HDR, 0);
      msg[SYSEX_CMD_HDR.length] = offset & 0x7F;
      msg[SYSEX_CMD_HDR.length + 1] = offset >> 7;
      msg.set(nib, SYSEX_CMD_HDR.length + 2);
      msg[msg.length - 1] = 0xF7;
      msgs.push(msg);
    }
    return msgs;
  }

  /** Handshake (30 octets) envoye avant chaque preset. */
  function buildHandshakeSysex(destPc) {
    return Uint8Array.from([
      0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
      0x12, 0x08, 0x00, 0x00, 0x00, 0x00, 0x08, 0x01,
      0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, (destPc >> 4) & 0x0F, destPc & 0x0F, 0x00, 0x00, 0xF7,
    ]);
  }

  /** Bank Select (CC0) + Program Change pour activer un slot. */
  function selectMessages(slot, letter, channel) {
    const ch = (channel === undefined ? MIDI_CHANNEL : channel) & 0x0F;
    const pc = slotToPc(slot, letter);
    const bank = pc > PC_MAX_MIDI ? 1 : 0;
    const prog = pc > PC_MAX_MIDI ? pc - 128 : pc;
    return [Uint8Array.from([0xB0 | ch, 0, bank]), Uint8Array.from([0xC0 | ch, prog])];
  }

  // ------------------------------------------------------------------ liaison
  const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

  /**
   * Liaison avec la pedale. `access` = MIDIAccess (navigateur) ou equivalent.
   *   const link = new MidiLink({ log, sleep });
   *   await link.attach(access);              // liste les ports
   *   link.select(outputId);                  // choisit la sortie (+ entree du meme nom)
   *   await link.open();                      // ouvre les ports
   *   await link.pushPreset(12, 'A', prstBytes, { onProgress });
   */
  class MidiLink {
    constructor(o) {
      o = o || {};
      this.log = o.log || (() => {});
      this.sleep = o.sleep || defaultSleep;
      this.chunkDelay = o.chunkDelay === undefined ? 25 : o.chunkDelay;   // ms entre morceaux
      this.hint = (o.hint || GP200_MIDI_NAME).toLowerCase();
      this.access = null; this.out = null; this.inp = null;
      this.rx = [];            // messages SysEx recus depuis le dernier drainage
      this.onchange = null;
      this.onnotify = null;    // (evt, raw) : notification de la pedale (bypass, patch, volume du patch, reglage en facade)
      this.onrx = null;        // (raw) : tout SysEx recu (journal)
      this.busy = false;
      this.waiters = [];       // attentes de confirmation 12/0C (voir changeEffect)
      // seen = confirmations reconnues, miss = changements d'effet sans confirmation, off = le format n'est pas reconnu : retour a l'attente fixe
      this.confirm = { seen: 0, miss: 0, off: false };
    }

    static supported(nav) {
      nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
      return !!nav && typeof nav.requestMIDIAccess === 'function';
    }

    /** Demande l'acces MIDI avec SysEx (le navigateur affiche une demande d'autorisation). */
    static async request(nav) {
      nav = nav || navigator;
      return nav.requestMIDIAccess({ sysex: true });
    }

    attach(access) {
      this.access = access;
      access.onstatechange = () => { if (this.onchange) this.onchange(); };
    }

    ports() {
      const lst = m => { const r = []; if (m) m.forEach(p => r.push({ id: p.id, name: p.name || '', state: p.state })); return r; };
      return { outputs: lst(this.access && this.access.outputs), inputs: lst(this.access && this.access.inputs) };
    }

    /** Id de la sortie qui ressemble a un GP-200, ou null. */
    findGp200() {
      const o = this.ports().outputs.filter(p => p.state !== 'disconnected');
      const hit = o.find(p => p.name.toLowerCase().indexOf(this.hint) >= 0);
      return hit ? hit.id : null;
    }

    select(outputId) {
      const outs = this.access.outputs, ins = this.access.inputs;
      this.closeInput();
      this.out = outs.get ? outs.get(outputId) : null;
      if (!this.out) throw new UsbError('noport', 'port MIDI introuvable');
      // l'entree a le meme nom que la sortie (c'est elle qui porte l'ACK du handshake)
      let inp = null;
      const name = (this.out.name || '').toLowerCase();
      ins.forEach(p => { if (!inp && p.state !== 'disconnected' && (p.name || '').toLowerCase() === name) inp = p; });
      if (!inp) ins.forEach(p => { if (!inp && p.state !== 'disconnected' && (p.name || '').toLowerCase().indexOf(this.hint) >= 0 && name.indexOf(this.hint) >= 0) inp = p; });
      this.inp = inp;
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
        } catch (e) {
          // Sans entree on travaille "en aveugle", comme le Python sans port IN.
          this.log('input_blind', String(e && e.message || e));
          this.inp = null;
        }
      }
    }

    closeInput() {
      if (this.inp) { try { this.inp.onmidimessage = null; if (this.inp.close) this.inp.close(); } catch (e) { /* rien */ } }
      this.inp = null;
      for (const w of this.waiters.slice()) w.done(false);
    }

    _rxSysex(d) {
      if (!d || d[0] !== 0xF0) return;
      const m = Uint8Array.from(d);
      this.rx.push(m);
      if (this.rx.length > 64) this.rx.splice(0, this.rx.length - 64);   // en direct personne ne vide rx : on ne garde que les derniers
      if (this.onrx) { try { this.onrx(m); } catch (e) { /* rien */ } }
      if (this.onnotify) { const n = parseNotify(m) || parsePanelParam(m); if (n) { try { this.onnotify(n, m); } catch (e) { /* rien */ } } }
      const c = parseEffectConfirm(m);
      if (!c) return;
      for (const w of this.waiters.slice()) if (w.module === c.module && w.mid === c.mid && w.cat === c.cat) w.done(true);
    }

    /** Promesse resolue a true des que la pedale confirme (12/0C) le modele `mid`/`cat` du module, false apres `ms`. */
    waitConfirm(moduleIdx, mid, cat, ms) {
      return new Promise(resolve => {
        const w = {
          module: moduleIdx, mid: mid & 0xFF, cat: cat & 0xFF,
          done: ok => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); resolve(ok); } },
        };
        this.waiters.push(w);
        this.sleep(ms).then(() => w.done(false));
      });
    }

    /**
     * Change le modele d'un slot, puis attend que la pedale l'ait charge.
     * L'audit du 04/10 (216 modeles) montre qu'elle confirme chaque changement par un SysEx 12/0C ([22] = module, [29]<<4|[30] = modele,
     * [-2] = categorie) pour tous les modeles sauf Gate 1, Volume (deja charges) et les SnapTone. On attend donc cette confirmation
     * (au lieu des 400 ms a l'aveugle) et on renvoie le changement une fois si elle ne vient pas : des parametres envoyes pendant le
     * chargement sont perdus, c'est ce qui donnait un Time parfois faux. Sans entree MIDI, ou tant que le format de confirmation n'est
     * pas reconnu, on garde l'attente fixe. Renvoie { confirmed: true | false | null (rien attendu), tries }.
     *   o.alreadyLoaded : la pedale est censee avoir deja ce modele -> pas de confirmation garantie, attente courte, un seul essai.
     */
    async changeEffect(moduleIdx, mid, cat, o) {
      o = o || {};
      const fixed = o.fixedMs === undefined ? 400 : o.fixedMs;
      const settle = o.settleMs === undefined ? 150 : o.settleMs;
      const tmo = o.timeoutMs === undefined ? 600 : o.timeoutMs;
      const c = this.confirm;
      const exempt = cat === 15 || (cat === 6 && mid === 3) || (cat === 0 && mid === 27);
      if (!this.inp || c.off || exempt) {
        this.sendEffectChange(moduleIdx, mid, cat);
        await this.sleep(fixed);
        return { confirmed: null, tries: 1 };
      }
      const loaded = !!o.alreadyLoaded;
      const tries = (loaded || c.seen === 0) ? 1 : 2;      // tant qu'aucune confirmation n'a ete reconnue : un seul essai (sonde)
      const timeout = loaded ? Math.min(tmo, 250) : tmo;
      for (let t = 1; t <= tries; t++) {
        const w = this.waitConfirm(moduleIdx, mid, cat, timeout);
        this.sendEffectChange(moduleIdx, mid, cat);
        if (await w) { c.seen++; c.miss = 0; await this.sleep(settle); return { confirmed: true, tries: t }; }
        this.log('no_confirm', moduleIdx, mid, cat, t);
      }
      if (!loaded) {
        c.miss++;
        if (c.seen === 0 && c.miss >= 2) { c.off = true; this.log('confirm_off'); }   // jamais reconnue : on ne ralentit plus
      }
      return { confirmed: false, tries };
    }

    async close() {
      this.closeInput();
      if (this.out && this.out.close) { try { await this.out.close(); } catch (e) { /* rien */ } }
      this.out = null;
    }

    get blind() { return !this.inp; }

    _send(bytes) {
      if (!this.out || this.out.state === 'disconnected') throw new UsbError('gone', 'la pedale a ete debranchee');
      this.out.send(Array.from(bytes));
    }

    /**
     * Ecrit un .prst dans un slot (= write_preset du Python).
     * onProgress(step, total, label) : 0 = handshake, 1..N = morceaux, N+1 = fin.
     * Renvoie {ack, attempts, blind}.
     */
    async writePreset(slot, letter, prst, o) {
      o = o || {};
      if (this.busy) throw new UsbError('busy', 'un envoi est deja en cours');
      const destPc = slotToPc(slot, letter);
      const chunks = buildSysexChunks(prst, destPc);   // valide aussi la taille
      const total = chunks.length;
      const progress = o.onProgress || (() => {});
      this.busy = true;
      try {
        progress(0, total, 'handshake');
        this.rx = [];
        let hsOk = false, attempts = 0;
        for (let attempt = 0; attempt < 5; attempt++) {
          attempts = attempt + 1;
          this._send(buildHandshakeSysex(destPc));
          this.log('handshake', attempts);
          await this.sleep(100);
          if (this.inp) {
            // meme critere que le Python : un SysEx d'au moins 20 octets de donnees
            const got = this.rx.splice(0, this.rx.length);
            if (got.some(m => m.length - 2 >= 20)) { hsOk = true; }
          } else if (attempt >= 1) {
            hsOk = true;                      // aucun MIDI IN : 2 envois minimum puis on tente
          }
          if (hsOk) break;
        }
        if (!hsOk) this.log('no_ack');
        await this.sleep(50);
        for (let i = 0; i < total; i++) {
          progress(i + 1, total, 'chunk ' + (i + 1) + '/' + total);
          this._send(chunks[i]);
          if (i < total - 1 && this.chunkDelay > 0) await this.sleep(this.chunkDelay);
        }
        await this.sleep(100);               // laisse la pedale finir (flush_input du Python)
        this.rx = [];
        progress(total + 1, total, 'done');
        return { ack: hsOk && !this.blind, attempts, blind: this.blind, pc: destPc };
      } finally {
        this.busy = false;
      }
    }

    /** Parametre en temps reel (sans ecriture ni coupure du son). */
    sendParam(moduleIdx, paramIdx, value, prst) {
      this._send(buildParamUpdateMsg(moduleIdx, paramIdx, value, prst));
      return true;
    }

    /** Change le modele d'un slot (a faire suivre de ~400 ms d'attente, puis des parametres). */
    sendEffectChange(moduleIdx, mid, cat) {
      this._send(buildEffectChangeMsg(moduleIdx, mid, cat));
      return true;
    }

    /** Bypass d'un slot. */
    sendBypass(moduleIdx, active) {
      this._send(buildBypassMsg(moduleIdx, active));
      return true;
    }

    /** Patch volume en temps reel. */
    sendPatchVol(vol) {
      this._send(buildPatchVolMsg(vol));
      return true;
    }

    /** Active un slot (Bank Select + Program Change). */
    selectPreset(slot, letter, channel) {
      for (const m of selectMessages(slot, letter, channel)) this._send(m);
      return slotToPc(slot, letter);
    }

    /** write + pause + select (= push_preset du Python). */
    async pushPreset(slot, letter, prst, o) {
      o = o || {};
      const r = await this.writePreset(slot, letter, prst, o);
      if (o.activate !== false) {
        await this.sleep(o.delayAfterWrite === undefined ? 350 : o.delayAfterWrite);
        this.selectPreset(slot, letter, o.channel);
      }
      return r;
    }
  }

  // ------------------------------------------- mises a jour temps reel (sans ecriture)
  // Port de build_param_update_msg / send_patch_vol_update (gp200_usb.py) : utilises par
  // l'harmonisation de volume pour regler l'ampli / le patch volume sans couper le son.
  const REC_MAGIC = [0x14, 0x00, 0x44, 0x00];
  const RECORD_SIZE = 72;
  const PARAM_UPDATE_HEADER = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x00, 0x00, 0x00,
    0x0C, 0x00, 0x00, 0x00,
  ];

  function findMagic(d) {
    outer: for (let i = 0; i + 4 <= d.length; i++) {
      for (let k = 0; k < 4; k++) if (d[i + k] !== REC_MAGIC[k]) continue outer;
      return i;
    }
    return -1;
  }

  /** float32 little-endian -> 8 octets "nibble" (quartet de poids fort d'abord). */
  function nibbleEncodeFloat(value) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, Number(value), true);
    const out = [];
    for (let i = 0; i < 4; i++) { const b = dv.getUint8(i); out.push((b >> 4) & 0x0F, b & 0x0F); }
    return out;
  }

  /** Message de mise a jour d'un parametre (62 octets, cmd 0x18). prst = .prst courant. */
  function buildParamUpdateMsg(moduleIdx, paramIdx, value, prst, rec0) {
    let typeMeta;
    if (moduleIdx === 5) typeMeta = [0x03, 0x0E, 0x04, 0x00];          // CAB
    else if (moduleIdx === 6) typeMeta = [0x03, 0x00, 0x04, 0x00];     // EQ
    else typeMeta = [0x07, 0x06, 0x00, 0x00];
    if (rec0 === undefined || rec0 === null) rec0 = findMagic(prst);
    const blk = rec0 + moduleIdx * RECORD_SIZE;
    const b812 = prst.length > blk + 12 ? Array.from(prst.slice(blk + 8, blk + 12)) : [0, 0, 0, 0];
    const b8 = [];
    for (const b of b812) b8.push((b >> 4) & 0x0F, b & 0x0F);
    const msg = [0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32, 0x12, 0x18]
      .concat(PARAM_UPDATE_HEADER, [moduleIdx & 0xFF, 0x00, paramIdx & 0xFF], typeMeta, b8, nibbleEncodeFloat(value), [0xF7]);
    if (msg.length !== 62) throw new Error('Taille invalide: ' + msg.length);
    return Uint8Array.from(msg);
  }

  /** Message de patch volume en temps reel (cmd 0x12/0x10, 46 octets). */
  function buildPatchVolMsg(patchVol) {
    const vol = Math.max(0, Math.min(100, Math.trunc(patchVol)));
    return Uint8Array.from([
      0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
      0x12, 0x10,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00,
      0x06, 0x00, 0x00, 0x00,
      0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      (vol >> 4) & 0x0F, vol & 0x0F,
      0x00, 0x00,
      0xF7,
    ]);
  }

  /** Changement de modele d'un slot (cmd 0x12/0x14, 54 octets) : ouvre le contexte d'edition. */
  function buildEffectChangeMsg(blockIdx, mid, cat) {
    const variant = mid & 0xFF;
    return Uint8Array.from([
      0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
      0x12, 0x14,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x04, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x06,
      0x00, 0x00, 0x00,
      0x08,
      0x00, 0x00, 0x00,
      blockIdx & 0x0F,
      0x00, 0x00,
      0x07, 0x06, 0x00, 0x02,
      (variant >> 4) & 0x0F, variant & 0x0F,
      0x00, 0x00, 0x00, 0x00, 0x00,
      cat & 0xFF,
      0xF7,
    ]);
  }

  /** Confirmation de changement d'effet envoyee par la pedale (12/0C) -> {module, mid, cat} ou null. Les 204 modeles confirmes par l'audit
   *  du 04/10 sont lus ainsi : [22] = module, [29]<<4|[30] = modele, [-2] = categorie. */
  function parseEffectConfirm(b) {
    if (!b || b.length < 32 || b[0] !== 0xF0 || b[b.length - 1] !== 0xF7) return null;
    for (let i = 0; i < NUX_ID.length; i++) if (b[1 + i] !== NUX_ID[i]) return null;
    if (b[8] !== 0x12 || b[9] !== 0x0C) return null;
    if (b[29] > 0x0F || b[30] > 0x0F) return null;
    return { module: b[22], mid: (b[29] << 4) | b[30], cat: b[b.length - 2] };
  }

  const _TAIL_FS = [0x03, 0x0D, 0x08, 0x00], _TAIL_PANEL = [0x00, 0x00, 0x00, 0x00];
  const _tailIs = (b, i, t) => t[0] === b[i] && t[1] === b[i + 1] && t[2] === b[i + 2] && t[3] === b[i + 3];
  const _isNux = b => { for (let i = 0; i < NUX_ID.length; i++) if (b[1 + i] !== NUX_ID[i]) return false; return true; };

  /** Notification de la pedale (12/08, 30 octets) = parse_notify du Python.
   *  -> {kind:'bypass', module, on, source:'fs'|'panel'} | {kind:'patch', pc} | {kind:'patchvol', v} | null */
  function parseNotify(b) {
    if (!b || b.length !== 30 || b[0] !== 0xF0 || !_isNux(b) || b[8] !== 0x12 || b[9] !== 0x08 || b[18] !== 0x04) return null;
    if (b[13] === 0x01 && b[14] === 0x05 && b[22] >= 0 && b[22] <= 10 && (b[24] === 0 || b[24] === 1) && (_tailIs(b, 25, _TAIL_FS) || _tailIs(b, 25, _TAIL_PANEL))) {
      return { kind: 'bypass', module: b[22], on: b[24] === 1, source: _tailIs(b, 25, _TAIL_FS) ? 'fs' : 'panel' };
    }
    if (b[13] === 0x00 && b[14] === 0x06 && b[15] === 0x00 && b[25] <= 0x0F && b[26] <= 0x0F && ((b[25] << 4) | b[26]) <= 100) {
      return { kind: 'patchvol', v: (b[25] << 4) | b[26] };
    }
    if (b[13] === 0x00 && b[14] === 0x08 && b[15] === 0x01 && b[25] <= 0x0F && b[26] <= 0x0F) {
      const pc = (b[25] << 4) | b[26];
      if (pc <= 255) return { kind: 'patch', pc };
    }
    return null;
  }

  /** Parametre tourne en facade (12/10, 46 octets) : la valeur (float32 en nibbles LE, octets [37..44]) est lisible, mais ni le module ni le
   *  parametre ne sont identifiables d'apres les captures (cf. gp200_usb.py). [22] = octet de controle (0x0A au chargement d'un patch : 100.0). */
  function parsePanelParam(b) {
    if (!b || b.length !== 46 || b[0] !== 0xF0 || !_isNux(b) || b[8] !== 0x12 || b[9] !== 0x10) return null;
    const dv = new DataView(new ArrayBuffer(4));
    for (let i = 0; i < 4; i++) { const hi = b[37 + 2 * i], lo = b[38 + 2 * i]; if (hi > 0x0F || lo > 0x0F) return null; dv.setUint8(i, (hi << 4) | lo); }
    return { kind: 'panel', ctrl: b[22], value: dv.getFloat32(0, true) };
  }

  /** Bypass ON/OFF d'un slot (30 octets). */
  function buildBypassMsg(moduleIdx, active) {
    return Uint8Array.from([
      0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
      0x12, 0x08, 0x00, 0x00, 0x00, 0x01, 0x05, 0x00,
      0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
      moduleIdx & 0xFF,
      0x00,
      active ? 0x01 : 0x00,
      0x03, 0x0D, 0x08, 0x00, 0xF7,
    ]);
  }

  return {
    NUX_ID, SYSEX_CMD_HDR, CHUNK_SIZE, DEV_HDR_SIZE, PRST_SIZE, GP200_MIDI_NAME, MIDI_CHANNEL, SLOT_MAX,
    UsbError, slotToPc, pcToSlotName, nibbleEncode, buildDeviceHeader, prstToDevicePayload, buildSysexChunks,
    buildHandshakeSysex, selectMessages, MidiLink,
    buildParamUpdateMsg, buildPatchVolMsg, nibbleEncodeFloat, buildEffectChangeMsg, buildBypassMsg, parseEffectConfirm, parseNotify, parsePanelParam,
  };
});
