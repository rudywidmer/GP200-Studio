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
      // [Android] o.loose : reconnaissance plus tolerante du port + reassemblage des SysEx fragmentes. Faux par defaut = comportement inchange.
      this.loose = !!o.loose;
      this._frag = null;
      this._col = null;          // collecteur d'une lecture en cours (voir _ask) ; null = rien ne change dans la reception
      this._reading = false;
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
      if (hit || !this.loose) return hit ? hit.id : null;
      // [Android] le nom du port vient de la chaine produit USB : on accepte « GP200 », « Valeton… », ou l'unique sortie MIDI presente
      const alt = o.find(p => /gp[\s_-]?200|valeton/i.test(p.name));
      if (alt) return alt.id;
      return o.length === 1 ? o[0].id : null;
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
      if (!inp && this.loose) {
        // [Android] noms d'entree et de sortie parfois differents : une seule entree presente, ou une entree qui ressemble a la pedale
        const live = []; ins.forEach(p => { if (p.state !== 'disconnected') live.push(p); });
        inp = live.find(p => /gp[\s_-]?200|valeton/i.test(p.name || '')) || (live.length === 1 ? live[0] : null);
      }
      this._frag = null;
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
      if (this.loose || this._col || this._frag) {
        // [Android] Chrome peut livrer un SysEx en plusieurs morceaux : on recolle jusqu'au F7 final (un message entier passe tel quel)
        if (!d || !d.length) return;
        if (d[0] === 0xF0) { this._frag = null; if (d[d.length - 1] !== 0xF7) { this._frag = Array.from(d); return; } }
        else if (this._frag) {
          if (d[0] >= 0xF8) return;                                   // temps reel intercale : on l'ignore
          if (d[0] >= 0x80 && d[0] !== 0xF7) { this._frag = null; return; }   // autre message : le SysEx est abandonne
          for (let i = 0; i < d.length; i++) this._frag.push(d[i]);
          if (this._frag.length > 4096) { this._frag = null; return; }
          if (d[d.length - 1] !== 0xF7) return;
          d = Uint8Array.from(this._frag); this._frag = null; this.log('rx_reassembled', d.length);
        } else { this._orph = (this._orph || 0) + 1; if (this._orph <= 5) this.log('rx_orphan', d.length, d[0]); return; }
      }
      if (!d || d[0] !== 0xF0) return;
      const m = Uint8Array.from(d);
      if (this._col) { let eaten = false; try { eaten = this._col(m); } catch (e) { /* rien */ } if (eaten) return; }     // reponse a une lecture : ni journal ni notification
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

    // ------------------------------------------------ lecture (pedale -> page) : LECTURE SEULE, aucune ecriture
    /** Envoie `bytes`, collecte (sans les laisser au reste de l'application) les messages que `accept` reconnait, jusqu'a ce que `done(collectes)` soit vrai. */
    _ask(bytes, accept, done, ms) {
      return new Promise((resolve, reject) => {
        const got = []; let fin = false;
        const end = err => { if (fin) return; fin = true; if (this._col === col) this._col = null; if (err) reject(err); else resolve(got); };
        const col = m => { if (fin || !accept(m)) return false; got.push(m); if (done(got)) end(); return true; };
        this._col = col;
        this.sleep(ms).then(() => { if (!fin) this.log('read_timeout', got.length, bytes[9]); end(new UsbError('timeout', "la pedale n'a pas repondu")); });
        try { this._send(bytes); } catch (e) { end(e); }
      });
    }

    async _readBlock(request, sub, third, size, ms) {
      const parse = g => g.map(m => parseReadChunk(m, sub, third));
      const got = await this._ask(request, m => !!parseReadChunk(m, sub, third), g => assembleReadChunks(parse(g), size).have >= size, ms);
      const r = assembleReadChunks(parse(got), size);
      if (!r.data) throw new UsbError('badread', 'lecture incomplete ou de taille inattendue (' + r.have + ' octets)');
      return r.data;
    }

    /** Numero du patch charge (0..255), lu dans le bloc « systeme ». Si la pedale ne repond pas a la lecture seule, on refait ce que fait l'editeur Valeton
     *  (ouverture de session, puis la meme lecture), puis on referme la session. */
    async _readCurrentPc(ms) {
      const sys = () => this._readBlock(buildSystemRead(), 0x4E, 0x06, SYSTEM_READ_SIZE, ms);
      let d, opened = false;
      try {
        try { d = await sys(); }
        catch (e) {
          if (!e || e.code !== 'timeout') throw e;
          this.log('read_session');
          this._send(buildSessionMsg(0x01)); opened = true;
          await this.sleep(150);
          this._send(buildEditorOpen());
          await this.sleep(150);
          d = await sys();
        }
      } finally {
        if (opened) { try { this._send(buildSessionMsg(0x02)); } catch (e) { /* rien */ } }
      }
      const pc = d[8] | (d[9] << 8);
      if (d[9] !== 0 || pc > 255) throw new UsbError('badread', 'patch courant illisible');
      return pc;
    }

    /** Lit le patch charge sur la pedale : { pc, data (1176 octets), via: 'edit' | 'stored' }.
     *  o.pc : numero deja connu (annonce 12/08 de la pedale) ; sinon on le lit. On demande d'abord le tampon d'edition (reglages non enregistres compris),
     *  puis, s'il manque ou designe un autre patch, le patch enregistre. Necessite les ports ouverts (open()) et une entree MIDI. */
    async readCurrentPatch(o) {
      o = o || {};
      const ms = o.timeoutMs || 1500;
      if (!this.out || this.out.state === 'disconnected') throw new UsbError('noport', 'aucune sortie ouverte');
      if (!this.inp) throw new UsbError('noread', "pas d'entree MIDI : lecture impossible");
      if (this._reading) throw new UsbError('busy', 'une lecture est deja en cours');
      this._reading = true;
      try {
        const pc = (o.pc === undefined || o.pc === null) ? await this._readCurrentPc(ms) : o.pc;
        if (!(pc >= 0 && pc <= 255)) throw new UsbError('badread', 'numero de patch invalide');
        const same = d => !!d && (d[6] | (d[7] << 8)) === pc;
        let data = null, via = 'edit';
        try { data = await this._readBlock(buildPatchRead(pc, true), 0x18, 0x09, READ_SIZE, ms); }
        catch (e) { if (!e || (e.code !== 'timeout' && e.code !== 'badread')) throw e; }
        if (!same(data)) {
          via = 'stored';
          data = await this._readBlock(buildPatchRead(pc, false), 0x18, 0x09, READ_SIZE, ms);
          if (!same(data)) throw new UsbError('badread', "le patch lu n'est pas celui demande");
        }
        this.log('read_ok', pc, via);
        return { pc, data, via };
      } finally { this._reading = false; }
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

  /** Reglage tourne en facade (12/10, 46 octets, pedale -> PC) = un 12/18 ampute de 16 octets (confirme sur la pedale le 4/10/2026 :
   *  112 trames, 16 series, 0 discordance). [14]=05, [18]=0C, [22]=module (0 PRE ... 10 VOL), [24]=slot du parametre (meme numerotation que
   *  le [40] du 12/18), [37..44]=valeur (float32 LE en nibbles, hi d'abord ; valeur de l'ecran, sans conversion). [25..28] = residus de
   *  tampon variables et [29..36] : jamais verifies. Debit ~10 trames/s : seule la derniere valeur compte.
   *  -> {kind:'panel', module, param, value} | null (= parsePanelParam ; Python : parse_panel_param). */
  function parsePanelParam(b) {
    if (!b || b.length !== 46 || b[0] !== 0xF0 || !_isNux(b) || b[8] !== 0x12 || b[9] !== 0x10 || b[14] !== 0x05 || b[18] !== 0x0C) return null;
    if (b[22] > 10 || b[24] > 14) return null;
    const dv = new DataView(new ArrayBuffer(4));
    for (let i = 0; i < 4; i++) { const hi = b[37 + 2 * i], lo = b[38 + 2 * i]; if (hi > 0x0F || lo > 0x0F) return null; dv.setUint8(i, (hi << 4) | lo); }
    const value = dv.getFloat32(0, true);
    if (!Number.isFinite(value)) return null;
    return { kind: 'panel', module: b[22], param: b[24], value };
  }

  // ---- lecture d'un patch (requetes de l'editeur Valeton, relevees sur une capture USB ; reponses 12/xx en nibbles, octet haut d'abord)
  const READ_SIZE = 1176, SYSTEM_READ_SIZE = 846;
  /** 11/04 ... 06 01 : bloc « systeme » (846 octets decodes, dont le numero du patch charge en [8..9], petit-boutiste). */
  const buildSystemRead = () => Uint8Array.from([0xF0].concat(NUX_ID, [0x11, 0x04, 0, 0, 0, 0, 0x06, 0x01, 0, 0, 0, 0, 0, 0xF7]));
  /** 11/04 ... kind 02 : kind 01 = ouverture de session de l'editeur, 02 = fermeture (utilises seulement si la pedale ne repond pas a la lecture seule). */
  const buildSessionMsg = kind => Uint8Array.from([0xF0].concat(NUX_ID, [0x11, 0x04, 0, 0, 0, 0, kind & 0xFF, 0x02, 0, 0, 0, 0, 0, 0xF7]));
  const buildEditorOpen = () => Uint8Array.from([0xF0].concat(NUX_ID, [0x11, 0x12, 0, 0, 0, 0xF7]));
  /** 11/10 : patch `pc` (0..255) tel qu'enregistre, ou (edit = true) tampon d'edition du patch `pc` = etat actuel, reglages non enregistres compris. */
  function buildPatchRead(pc, edit) {
    const hi = (pc >> 4) & 0x0F, lo = pc & 0x0F, F = 0x0F;
    return Uint8Array.from([0xF0].concat(NUX_ID, [0x11, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0x04, 0, 0, 0, edit ? 0 : 1, 0, 0, hi, lo, 0, 0, 0, 0x01, 0, 0, 0,
      0x04, 0, 0], edit ? [F, F, F, F] : [hi, lo, 0, 0], [hi, lo, 0, 0, 0xF7]));
  }
  /** Morceau d'une reponse 12/<sub>/<third> -> { off (octets decodes), data } ou null si ce n'est pas un morceau bien forme. Les 12/18 de 62 octets (3e octet 00) n'en sont pas. */
  function parseReadChunk(b, sub, third) {
    if (!b || b.length < 16 || b[0] !== 0xF0 || b[b.length - 1] !== 0xF7 || !_isNux(b) || b[8] !== 0x12 || b[9] !== sub || b[10] !== third) return null;
    const n = b.length - 14;
    if (n < 2 || (n & 1)) return null;
    const data = new Uint8Array(n >> 1);
    for (let i = 0; i < data.length; i++) {
      const hi = b[13 + 2 * i], lo = b[14 + 2 * i];
      if (hi > 0x0F || lo > 0x0F) return null;
      data[i] = (hi << 4) | lo;
    }
    return { off: b[11] | (b[12] << 7), data };
  }
  /** Recolle des morceaux (dans n'importe quel ordre, doublons permis) : { data (taille exacte) | null, have (octets contigus depuis 0) }. */
  function assembleReadChunks(chunks, size) {
    const cs = chunks.filter(Boolean).sort((a, b) => a.off - b.off);
    const out = new Uint8Array(Math.max(size, 0));
    let have = 0, over = false;
    for (const c of cs) {
      if (c.off > have) break;
      for (let i = 0; i < c.data.length; i++) { if (c.off + i < size) out[c.off + i] = c.data[i]; else over = true; }
      have = Math.max(have, c.off + c.data.length);
    }
    return { data: have === size && !over ? out : null, have };
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
    READ_SIZE, SYSTEM_READ_SIZE, buildSystemRead, buildSessionMsg, buildEditorOpen, buildPatchRead, parseReadChunk, assembleReadChunks,
  };
});
