#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const U = require('../web/src/gp200usb.js');
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_usb.json'), 'utf8'));
const hex = u => Buffer.from(u).toString('hex');
const unhex = h => new Uint8Array(Buffer.from(h, 'hex'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

// 1. trames --------------------------------------------------------------------
exp.frames.forEach((f, i) => {
  const raw = unhex(f.raw), pc = U.slotToPc(f.slot, f.letter);
  ok(pc === f.pc, 'pc #' + i);
  ok(hex(U.prstToDevicePayload(raw, pc)) === f.payload, 'payload #' + i);
  const ch = U.buildSysexChunks(raw, pc).map(hex);
  ok(JSON.stringify(ch) === JSON.stringify(f.chunks), 'chunks #' + i);
  ok(hex(U.buildHandshakeSysex(pc)) === f.hs, 'handshake #' + i);
  ok(ch.length === 7 && ch.every(c => c.startsWith('f0') && c.endsWith('f7')), 'forme #' + i);
});
exp.errors.forEach(e => {
  let threw = false; try { U.slotToPc(e.slot, e.letter); } catch (x) { threw = x instanceof U.UsbError; }
  ok(threw === !e.ok, 'validation slot ' + JSON.stringify(e));
});
{ let t = false; try { U.prstToDevicePayload(new Uint8Array(100), 3); } catch (x) { t = true; } ok(t === exp.sizeerr, 'taille .prst invalide'); }
exp.names.forEach(([pc, n]) => ok(U.pcToSlotName(pc) === n, 'nom slot ' + pc));
exp.select.forEach(s => ok(JSON.stringify(U.selectMessages(s.slot, s.letter, s.ch).map(hex)) === JSON.stringify(s.sent), 'select ' + JSON.stringify(s)));

// 2. sequences completes avec une fausse pedale -----------------------------------
function fakeAccess(ackAfter, blind) {
  const sent = [];
  let hs = 0, acked = false;
  const input = { id: 'in1', name: 'GP-200', state: 'connected', onmidimessage: null, open: async () => input, close: async () => {} };
  const output = { id: 'out1', name: 'GP-200', state: 'connected', open: async () => output, close: async () => {},
    send(d) {
      const b = Uint8Array.from(d); sent.push(b);
      if (b.length === 30 && b[0] === 0xF0 && b[8] === 0x12 && b[9] === 0x08) {
        hs++;
        if (ackAfter !== null && hs >= ackAfter && !acked && input.onmidimessage) {
          acked = true; input.onmidimessage({ data: Uint8Array.from([0xF0].concat(Array.from({ length: 40 }, (_, i) => i), [0xF7])) });
        }
      }
    } };
  const mk = (...p) => ({ forEach: f => p.forEach(f), get: id => p.find(x => x.id === id) });
  return { sent, access: { outputs: mk(output), inputs: blind ? mk() : mk(input), onstatechange: null } };
}
(async () => {
  for (const s of exp.seqs) {
    const { sent, access } = fakeAccess(s.ack_after, s.blind);
    const link = new U.MidiLink({ sleep: async () => {} });
    link.attach(access);
    ok(link.findGp200() === 'out1', 'detection GP-200');
    link.select('out1'); await link.open();
    ok(link.blind === s.blind, 'mode aveugle ' + s.slot);
    const raw = unhex(s.raw);
    const r = s.push ? await link.pushPreset(s.slot, s.letter, raw) : await link.writePreset(s.slot, s.letter, raw);
    const want = s.sent.map(x => x.hex);
    const got = sent.map(hex);
    ok(JSON.stringify(got) === JSON.stringify(want), 'sequence ' + s.slot + s.letter + ' (' + got.length + ' vs ' + want.length + ')');
    ok(r.ack === (!s.blind && s.ack_after !== null && s.ack_after <= 5), 'ack rapporte ' + s.slot);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      for (let i = 0; i < Math.max(got.length, want.length); i++) if (got[i] !== want[i]) { console.log('   premier ecart #' + i, (got[i] || '').slice(0, 60), (want[i] || '').slice(0, 60)); break; }
    }
  }
  // 3. erreurs : pedale debranchee en cours d'envoi, envoi concurrent
  {
    const { access } = fakeAccess(1, false);
    const link = new U.MidiLink({ sleep: async () => {} }); link.attach(access); link.select('out1'); await link.open();
    link.out.state = 'disconnected';
    let code = null; try { await link.writePreset(1, 'A', unhex(exp.seqs[0].raw)); } catch (e) { code = e.code; }
    ok(code === 'gone', 'pedale debranchee -> erreur gone');
    ok(link.busy === false, 'verrou libere apres erreur');
  }
  {
    const { access } = fakeAccess(1, false);
    let release; const gate = new Promise(r => { release = r; });
    const link = new U.MidiLink({ sleep: () => gate }); link.attach(access); link.select('out1'); await link.open();
    const p1 = link.writePreset(1, 'A', unhex(exp.seqs[0].raw));
    let code = null; try { await link.writePreset(2, 'A', unhex(exp.seqs[0].raw)); } catch (e) { code = e.code; }
    ok(code === 'busy', 'deux envois simultanes refuses');
    release(); await p1;
  }
  {
    // ouverture de l'entree impossible -> repli en mode aveugle sans planter
    const { access } = fakeAccess(1, false);
    access.inputs.get('in1').open = async () => { throw new Error('busy'); };
    const link = new U.MidiLink({ sleep: async () => {} }); link.attach(access); link.select('out1'); await link.open();
    ok(link.blind, 'entree occupee -> mode aveugle');
  }
  // 4. mises a jour temps reel
  for (const c of exp.live) {
    const raw = unhex(c.raw);
    const m = U.buildParamUpdateMsg(c.mod, c.par, c.val, raw);
    ok(hex(m) === c.msg, 'param update mod ' + c.mod + ' par ' + c.par + ' val ' + c.val);
    ok(hex(U.buildParamUpdateMsg(c.mod, c.par, c.val, raw, undefined)) === c.msg2, 'param update (rec0 auto)');
  }
  for (const c of exp.pv) ok(hex(U.buildPatchVolMsg(c.v)) === c.msg, 'patch vol ' + c.v);
  {
    const { sent, access } = fakeAccess(1, false);
    const link = new U.MidiLink({ sleep: async () => {} }); link.attach(access); link.select('out1'); await link.open();
    const raw = unhex(exp.live[0].raw);
    link.sendParam(3, 2, 61, raw); link.sendPatchVol(70);
    ok(sent.length === 2 && sent[0].length === 62 && sent[1].length === 46, 'sendParam/sendPatchVol envoient 2 trames');
  }
  for (const c of exp.ec) ok(hex(U.buildEffectChangeMsg(c.blk, c.mid, c.cat)) === c.msg, 'effect change ' + JSON.stringify([c.blk, c.mid, c.cat]));
  for (const c of exp.byp) ok(hex(U.buildBypassMsg(c.mod, c.on)) === c.msg, 'bypass ' + c.mod + ' ' + c.on);
  {
    const { sent, access } = fakeAccess(1, false);
    const link = new U.MidiLink({ sleep: async () => {} }); link.attach(access); link.select('out1'); await link.open();
    link.sendEffectChange(3, 12, 4); link.sendBypass(3, false);
    ok(sent.length === 2 && sent[0].length === 54 && sent[1].length === 30, 'sendEffectChange/sendBypass envoient 2 trames');
  }
  console.log('=== usb : ' + pass + ' OK, ' + fail + ' echecs ===');
  process.exit(fail ? 1 : 0);
})();
