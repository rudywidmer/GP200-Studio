#!/usr/bin/env node
/* Attente de la confirmation 12/0C de la pedale apres un changement d'effet (MidiLink.changeEffect) :
   confirmation reconnue, renvoi, sonde (format non reconnu -> retour a l'attente fixe), modeles qui ne confirment pas, mode aveugle. */
'use strict';
const U = require('../web/src/gp200usb.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

const NUX = [0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32];
function confirmFrame(mod, mid, cat, len) {
  const f = new Array(len || 54).fill(0);
  f[0] = 0xF0; NUX.forEach((v, i) => { f[1 + i] = v; });
  f[8] = 0x12; f[9] = 0x0C; f[22] = mod; f[29] = mid >> 4; f[30] = mid & 15; f[f.length - 2] = cat; f[f.length - 1] = 0xF7;
  return Uint8Array.from(f);
}

// ---- parseEffectConfirm
ok(JSON.stringify(U.parseEffectConfirm(confirmFrame(8, 0x4E, 11))) === JSON.stringify({ module: 8, mid: 0x4E, cat: 11 }), 'parse : module, modele (nibbles), categorie');
ok(JSON.stringify(U.parseEffectConfirm(confirmFrame(3, 119, 7, 38))) === JSON.stringify({ module: 3, mid: 119, cat: 7 }), 'parse : la categorie est l\'avant-dernier octet quelle que soit la longueur');
const bad = confirmFrame(8, 4, 11); bad[9] = 0x14;
ok(U.parseEffectConfirm(bad) === null, 'parse : 12/14 n\'est pas une confirmation');
const bad2 = confirmFrame(8, 4, 11); bad2[3] = 0x00;
ok(U.parseEffectConfirm(bad2) === null, 'parse : autre fabricant refuse');
const bad3 = confirmFrame(8, 4, 11); bad3[29] = 0x20;
ok(U.parseEffectConfirm(bad3) === null, 'parse : nibble hors plage refuse');
ok(U.parseEffectConfirm(Uint8Array.from([0xF0, 0xF7])) === null && U.parseEffectConfirm(null) === null, 'parse : trames courtes / nulles');

// ---- liaison factice. La pedale repond selon `script(frame, emit)`.
function mkLink(script, opts) {
  opts = opts || {};
  const sent = [];
  const link = new U.MidiLink({ log: () => {}, sleep: ms => new Promise(r => setTimeout(r, Math.ceil(ms / 10))) });   // 10x plus vite : 600 ms -> 60 ms
  const inp = { name: 'GP-200', state: 'connected', onmidimessage: null, open: async () => inp, close: async () => {} };
  const emit = (f, after) => setTimeout(() => { if (inp.onmidimessage) inp.onmidimessage({ data: f }); }, after || 3);
  link.out = { name: 'GP-200', state: 'connected', open: async () => {}, close: async () => {}, send(d) { sent.push(Uint8Array.from(d)); if (script) script(Uint8Array.from(d), emit); } };
  link.inp = opts.blind ? null : inp;
  return { link, sent, inp, emit };
}
const effFrames = sent => sent.filter(m => m.length === 54);
const pedalOk = (f, emit) => { if (f.length === 54 && f[9] === 0x14) { if (f[38] === 3) emit(confirmFrame(5, 0, 10), 2); emit(confirmFrame(f[38], (f[45] << 4) | f[46], f[52]), 6); } };

(async () => {
  // confirmation recue : un envoi, confirmed true, deux messages parasites ignores
  { const { link, sent } = mkLink(pedalOk); await link.open();
    const t0 = Date.now(); const r = await link.changeEffect(3, 119, 7);
    ok(r.confirmed === true && r.tries === 1 && effFrames(sent).length === 1, 'confirmation : un seul envoi, confirmed = true');
    ok(Date.now() - t0 < 50, 'confirmation : on n\'attend pas les 400 ms fixes (' + (Date.now() - t0) + ' ms simules x10)');
    ok(link.confirm.seen === 1 && link.waiters.length === 0, 'confirmation : compteur, plus d\'attente en cours');
    ok(JSON.stringify(Array.from(effFrames(sent)[0])) === JSON.stringify(Array.from(U.buildEffectChangeMsg(3, 119, 7))), 'la trame envoyee est bien l\'effect change'); }

  // la baffle par defaut (module 5) arrive avant l'ampli : elle ne libere pas l'attente de l'ampli
  { const { link } = mkLink((f, emit) => { if (f.length === 54) emit(confirmFrame(5, 0, 10), 3); }); await link.open();
    const r = await link.changeEffect(3, 119, 7);
    ok(r.confirmed === false, 'la confirmation de la baffle ne vaut pas celle de l\'ampli'); }

  // une mauvaise categorie / un autre modele ne comptent pas
  { const { link } = mkLink((f, emit) => { if (f.length === 54) emit(confirmFrame(f[38], 12, f[52]), 3); }); await link.open();
    const r = await link.changeEffect(8, 4, 11);
    ok(r.confirmed === false, 'une confirmation pour un autre modele est ignoree'); }

  // sonde : jamais de confirmation -> 1 essai, 1 essai, puis attente fixe (off)
  { const { link, sent } = mkLink(null); await link.open();
    const r1 = await link.changeEffect(8, 4, 11), r2 = await link.changeEffect(7, 15, 4);
    ok(r1.confirmed === false && r1.tries === 1 && r2.confirmed === false && r2.tries === 1, 'sonde : un seul essai tant que rien n\'a jamais ete reconnu');
    ok(link.confirm.off === true, 'apres 2 absences : mode « format non reconnu »');
    const t0 = Date.now(); const r3 = await link.changeEffect(9, 1, 12);
    ok(r3.confirmed === null && Date.now() - t0 >= 38 && effFrames(sent).length === 3, 'ensuite : attente fixe (400 ms), un seul envoi, rien d\'attendu'); }

  // confirmations deja vues : un manque est renvoye une fois
  { let drop = 0;
    const { link, sent } = mkLink((f, emit) => { if (f.length === 54 && f[9] === 0x14) { if (drop > 0) { drop--; return; } pedalOk(f, emit); } }); await link.open();
    await link.changeEffect(8, 4, 11);                             // 1re : reconnue
    drop = 1; const r = await link.changeEffect(7, 15, 4);
    ok(r.confirmed === true && r.tries === 2 && effFrames(sent).length === 3, 'confirmation perdue : renvoyee une fois, puis confirmee');
    drop = 2; const r2 = await link.changeEffect(9, 1, 12);
    ok(r2.confirmed === false && r2.tries === 2 && effFrames(sent).length === 5 && !link.confirm.off && link.confirm.miss === 1, 'deux absences : on abandonne sans bloquer, format toujours considere reconnu'); }

  // modele deja charge : attente courte, un seul essai, pas compte comme une absence
  { const { link, sent } = mkLink(pedalOk); await link.open(); await link.changeEffect(8, 4, 11);
    link.out.send = d => { sent.push(Uint8Array.from(d)); };      // la pedale ne confirme plus
    const t0 = Date.now(); const r = await link.changeEffect(8, 4, 11, { alreadyLoaded: true });
    ok(r.confirmed === false && r.tries === 1 && Date.now() - t0 < 40 && link.confirm.miss === 0, 'deja charge : un essai, attente <= 250 ms, pas une absence'); }

  // modeles qui ne confirment pas : Gate 1, Volume, SnapTone -> attente fixe
  for (const [mod, mid, cat, nm] of [[4, 27, 0, 'Gate 1'], [10, 3, 6, 'Volume'], [2, 3, 15, 'SnapTone DST'], [3, 8, 15, 'SnapTone AMP']]) {
    const { link, sent } = mkLink(pedalOk); await link.open(); await link.changeEffect(8, 4, 11);   // format deja reconnu
    const n0 = sent.length, t0 = Date.now(); const r = await link.changeEffect(mod, mid, cat);
    ok(r.confirmed === null && sent.length === n0 + 1 && Date.now() - t0 >= 38, nm + ' : pas de confirmation attendue (attente fixe)');
  }

  // sans entree MIDI : attente fixe
  { const { link, sent } = mkLink(null, { blind: true }); await link.open();
    const t0 = Date.now(); const r = await link.changeEffect(8, 4, 11);
    ok(r.confirmed === null && effFrames(sent).length === 1 && Date.now() - t0 >= 38, 'sans entree MIDI : comme avant (400 ms)'); }

  // fermeture de l'entree pendant l'attente : l'attente se libere (false)
  { const { link } = mkLink(null); await link.open();
    link.confirm.seen = 1;
    const p = link.changeEffect(8, 4, 11, { timeoutMs: 5000 });
    setTimeout(() => link.closeInput(), 5);
    const r = await p;
    ok(r.tries === 2 && r.confirmed === false && link.waiters.length === 0, 'entree fermee pendant l\'attente : rien ne reste en suspens'); }

  // rx ne grossit pas indefiniment
  { const { link, inp } = mkLink(null); await link.open();
    for (let i = 0; i < 500; i++) inp.onmidimessage({ data: Uint8Array.from([0xF0, 1, 2, 0xF7]) });
    ok(link.rx.length === 64, 'les derniers SysEx recus seulement (' + link.rx.length + ')'); }

  console.log('\n=== confirmations : ' + pass + ' OK, ' + fail + ' echecs ===');
  process.exit(fail ? 1 : 0);
})();
