/* ============================================================================
 * gp150agent.js -- generation et affinage de presets par IA pour le GP-150 / GP-180
 *
 * Port de ref/gp150_agent.py (l'oracle, voir tests/). Meme boucle que generate() / refine() de gp200core.js (qui n'est pas modifie) :
 * demande -> API -> validation -> auto-correction -> .prst. Ce qui est propre au format de la pedale (12 modules, noms de 13 caracteres,
 * slot NS reserve, reglages a options, volume du patch sur 16 bits) vient du moteur `E` (GP150.forModel) ; ce qui ne depend pas du format
 * (appels reseau, extraction du JSON, noms de fichiers, controle de divergence des variantes) vient de GP200 et n'est pas duplique.
 *
 *   const A = GP150AGENT.forModel('gp150', GP150.forModel('gp150'), GP200)  ->  { generate, refine, checkNames, checkSections, ... }
 * Aucun acces au DOM, au reseau (les appels passent par hooks.callApi), a l'horloge (hooks.now) ni au stockage.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gp150core.js'));
  else root.GP150AGENT = factory(root.GP150);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const MODULES = C.MODULES, NAME_MAX = 13, DEFAULT_PATCH_VOL = 50;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const chars = s => Array.from(String(s));
  const norm = C.norm;

  function forModel(id, E, G) {
    const { pyRepr, fmtG, pyTruthy, pyFloat, closeMatches, extractJson, safeFilename, safeDirname, forcedPrompt, normalizePayload,
      checkDivergence, PyFloat, pyJsonDumps, ROLES } = G;
    const ValueError = E.ValueError;

    const isUserIr = m => m.category_label === 'User IR';

    // ------------------------------------------------------------ validation
    /** = check_names (gp150_agent.py). keep = modules du preset d'origine {slot: {model}} (affinage). */
    function checkNames(tb, spec, keep) {
      const errs = [];
      const mods = pyTruthy(spec.modules) ? spec.modules : {};
      for (const slot of Object.keys(mods)) {
        const ms = mods[slot];
        if (!pyTruthy(ms)) continue;
        if (typeof ms !== 'object' || Array.isArray(ms)) {
          errs.push('slot ' + slot + ' : doit etre un objet {"model": ..., "on": ..., "params": {...}} ou null');
          continue;
        }
        if (!pyTruthy(ms.model)) continue;
        if (MODULES.indexOf(slot) < 0) {
          errs.push('slot ' + pyRepr(slot) + ' inconnu (attendus: ' + pyRepr(MODULES) + ')');
          continue;
        }
        if (slot === 'NS') {
          const kept = keep && keep.NS && keep.NS.model;
          if (!(kept && norm(kept) === norm(ms.model))) errs.push("slot NS : n'est pas propose dans le catalogue. Mets-le a null.");
          continue;
        }
        let found;
        try {
          found = tb.find(slot, ms.model);
        } catch (e) {
          if (!(e instanceof ValueError) && !(e instanceof C.ValueError)) throw e;
          const pool = tb.modelsForSlot(slot).map(x => x[0]).filter(x => !isUserIr(x)).map(x => x.name);
          const near = closeMatches(String(ms.model), pool, 4, 0.4);
          errs.push('slot ' + slot + ' : le modele ' + pyRepr(ms.model) + " N'EXISTE PAS. Proches : " + pyRepr(near.length ? near : pool.slice(0, 8)));
          continue;
        }
        const m = found[0];
        const plist = tb.paramsOf(m.id, m.cat);
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
            const near = closeMatches(g, plist.map(q => q.name), 3, 0.4);
            errs.push('slot ' + slot + ' / ' + m.name + ' : le parametre ' + pyRepr(g) + " N'EXISTE PAS. Parametres reels : " +
              pyRepr(plist.map(q => q.name)) + (near.length ? ' (proche : ' + pyRepr(near) + ')' : ''));
            continue;
          }
          const v = pyFloat(val);
          if (v === undefined) {
            errs.push('slot ' + slot + ' / ' + m.name + ' / ' + p.name + ' : ' + pyRepr(val) + " n'est pas un nombre");
            continue;
          }
          const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max);
          if (!(lo <= v && v <= hi)) {
            errs.push('slot ' + slot + ' / ' + m.name + ' / ' + p.name + ' : ' + fmtG(v) + ' est hors plage [' + fmtG(lo) + '..' + fmtG(hi) + ']');
          } else if (p.options && p.options.length && Math.trunc(v) !== v) {
            errs.push('slot ' + slot + ' / ' + m.name + ' / ' + p.name + ' : ' + fmtG(v) + " n'est pas un numero d'option valide (0 a " + (p.options.length - 1) + ')');
          }
        }
      }
      const n = spec.name === undefined ? '' : spec.name;
      if (typeof n === 'string' && chars(n).length > NAME_MAX) errs.push('name ' + pyRepr(n) + ' fait ' + chars(n).length + ' caracteres (max ' + NAME_MAX + ')');
      const ch = spec.chain_order;
      if (ch !== undefined && ch !== null) {
        const ok = Array.isArray(ch) && ch.length === MODULES.length && ch.slice().sort((p, q) => p - q).every((v, i) => v === i);
        if (!ok) errs.push('chain_order ' + pyRepr(ch) + " n'est pas une permutation de 0.." + (MODULES.length - 1));
      }
      return errs;
    }

    /** = check_amp_cab : un ampli actif doit etre suivi d'une baffle active. */
    function checkAmpCab(spec) {
      const mods = pyTruthy(spec.modules) ? spec.modules : {};
      const amp = mods.AMP, cab = mods.CAB;
      const act = x => pyTruthy(x) && typeof x === 'object' && !Array.isArray(x) && pyTruthy(x.model);
      if (act(amp) && pyTruthy(has(amp, 'on') ? amp.on : true)) {
        if (!(act(cab) && pyTruthy(has(cab, 'on') ? cab.on : true))) {
          return ["slot CAB : un ampli actif doit etre suivi d'une baffle active (choisis-en une coherente avec l'ampli)"];
        }
      }
      return [];
    }

    /** = check_sections : [erreurs fatales, avertissements de style]. */
    function checkSections(tb, payload) {
      const errs = [], warns = [];
      const secs = payload.sections || [];
      if (!pyTruthy(secs)) return [['aucune section : il en faut au moins une'], []];
      if (secs.length > 4) errs.push(secs.length + " sections, c'est trop (4 maximum). Regroupe les parties qui partagent le meme son.");
      const noms = [];
      for (const sec of secs) {
        const lbl = pyTruthy(sec.nom) ? sec.nom : '?';
        noms.push(lbl);
        if (pyTruthy(sec.role) && ROLES.indexOf(sec.role) < 0) errs.push('section ' + pyRepr(lbl) + ' : role ' + pyRepr(sec.role) + ' invalide (attendus : ' + ROLES.join(', ') + ')');
        const vs = sec.variants || [];
        if (vs.length !== 3) errs.push('section ' + pyRepr(lbl) + ' : ' + vs.length + ' variante(s), il en faut EXACTEMENT 3');
        for (const v of vs) {
          const sp = v.spec === undefined ? {} : (v.spec || {});
          for (const e of checkNames(tb, sp).concat(checkAmpCab(sp))) errs.push('[' + lbl + ' / ' + (v.label === undefined ? '?' : v.label) + '] ' + e);
        }
        for (const w of checkDivergence(sec)) warns.push('section ' + pyRepr(lbl) + ' : ' + w);
      }
      if (new Set(noms).size !== noms.length) errs.push('deux sections portent le meme nom : ' + pyRepr(noms));
      const allnames = [];
      for (const sec of secs) for (const v of (sec.variants || [])) allnames.push((v.spec || {}).name);
      const dupes = Array.from(new Set(allnames.filter(n => n && allnames.filter(x => x === n).length > 1))).sort();
      if (dupes.length) errs.push('noms de presets dupliques entre sections : ' + pyRepr(dupes) + ". Rends-les distincts (ex. 'MOP Rythm Fid' et 'MOP Solo Fid').");
      return [errs, warns];
    }

    // ------------------------------------------------------------ diff
    /** = diff_presets : diff REEL entre deux presets decodes (12 modules). */
    function diffPresets(before, after) {
      const out = [];
      if (before.name !== after.name) out.push('nom : ' + pyRepr(before.name) + ' -> ' + pyRepr(after.name));
      if (JSON.stringify(before.chain_order) !== JSON.stringify(after.chain_order)) out.push('chaine : ' + pyRepr(before.chain_readable) + ' -> ' + pyRepr(after.chain_readable));
      for (const slot of MODULES) {
        const b = before.modules[slot], a = after.modules[slot];
        if ((b.model || null) !== (a.model || null)) { out.push(slot + ' : ' + (b.model || '(vide)') + ' -> ' + (a.model || '(vide)')); continue; }
        if (b.on !== a.on) out.push(slot + ' : ' + (b.on ? 'ON' : 'off') + ' -> ' + (a.on ? 'ON' : 'off'));
        const pb = b.params || {}, pa = a.params || {};
        for (const k of Object.keys(pa)) {
          if (has(pb, k) && Math.abs(Number(pb[k]) - Number(pa[k])) > 0.005) out.push(slot + ' / ' + k + ' : ' + fmtG(Number(pb[k])) + ' -> ' + fmtG(Number(pa[k])));
        }
      }
      return out;
    }

    // ------------------------------------------------------------ noms
    function stamp(now) {
      const p2 = n => String(n).padStart(2, '0');
      return '' + now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + ' - ' + p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds());
    }
    function splitextBase(name) {
      let b = String(name); b = b.slice(b.lastIndexOf('/') + 1);
      let lead = 0; while (lead < b.length && b[lead] === '.') lead++;
      const dot = b.lastIndexOf('.');
      return dot > lead ? b.slice(0, dot) : b;
    }

    // ------------------------------------------------------------ generation
    /** = generate (gp200core.js) pour ce format. Renvoie {payload, files:[{section, variant, filename, folder, raw, spec, warnings, decoded}], folder}. */
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
          if (JSON.stringify(got) !== JSON.stringify(roles)) errs.push('sections imposees : attendu ' + pyRepr(roles) + ', recu ' + pyRepr(got));
        }
        const isPremium = model.indexOf('claude') >= 0;
        let toFix;
        if (isPremium) {
          toFix = errs;
          if (warns.length) { log(t('log_style_ignored', model)); for (const w of warns) log('  ! ' + w); }
        } else toFix = errs.concat(warns);
        if (!toFix.length) { ok = true; break; }
        log(t('log_errors_fix', toFix.length));
        for (const e of toFix) log('    - ' + e);
        msgs = msgs.concat([{ role: 'assistant', content: txt },
          { role: 'user', content: 'Erreurs a corriger dans ta reponse :\n- ' + toFix.join('\n- ') +
            "\n\nRenvoie l'objet JSON complet corrige, en n'utilisant que des noms presents dans le catalogue." }]);
      }
      if (!ok) throw new Error(t('err_gen_failed', maxRetries + 1));

      const now = hooks.now || new Date();
      const artiste = safeDirname(String(payload.artiste || '').trim());
      const titre = chars(safeDirname(String(payload.titre || '').trim())).slice(0, 40).join('').trim();
      let prefixe;
      if (artiste && artiste !== 'preset') prefixe = artiste + ' - ' + titre;
      else if (titre && titre !== 'preset') prefixe = titre;
      else prefixe = chars(safeDirname(demande)).slice(0, 40).join('').trim();
      const folder = prefixe + ' - ' + stamp(now);

      const files = [];
      const secs = payload.sections || [];
      secs.forEach((sec, si0) => {
        const si = si0 + 1;
        const secdir = secs.length > 1 ? si + '_' + safeFilename(sec.nom || sec.role || 'section') : '';
        log(t('log_section', si, secs.length, sec.nom, sec.role || '?'));
        (sec.variants || []).forEach((v, i) => {
          try {
            const spec = v.spec;
            if (!spec) throw new ValueError("pas de 'spec'");
            const enc = E.encodePrst(spec, tb, hooks.template);
            const raw = E.applyPatchVol(enc.raw, DEFAULT_PATCH_VOL)[0];
            const filename = safeFilename(spec.name === undefined ? 'preset' : spec.name) + '_' + (i < 3 ? 'ABC'[i] : String(i)) + '.prst';
            const decoded = E.decodePrst(raw, tb);
            if (!decoded.checksum.valid) log(t('log_checksum_bad', filename));
            for (const w of enc.warnings) log(t('log_warn', w));
            files.push({ section: sec, variant: v, filename, folder: secdir, raw, spec, warnings: enc.warnings, decoded });
            log(t('log_written', filename));
          } catch (e) {
            log(t('log_variant_skip', v.label === undefined ? i : v.label, e.message));
          }
        });
      });
      return { payload, files, folder };
    }

    // ------------------------------------------------------------ affinage
    /** Spec montre a l'IA : valeurs en PyFloat (50.0), sans volume ni tempo du patch (conserves tels quels). */
    function specForAi(before) {
      const sp = E.decodedToSpec(before);
      for (const slot of MODULES) {
        const e = sp.modules[slot];
        if (e && e.params) for (const k of Object.keys(e.params)) e.params[k] = new PyFloat(e.params[k]);
      }
      delete sp.patch_vol; delete sp.bpm;
      return sp;
    }

    /** = refine (gp200core.js) pour ce format. mode 'refine' (consigne libre) ou 'live'. */
    async function refine(cfg, tb, src, instruction, prompts, hooks, mode) {
      const log = hooks.log || (() => {});
      const t = hooks.t || (k => k);
      const live = mode === 'live';
      const before = E.decodePrst(src.raw, tb);
      if (!before.checksum.valid) log(t('log_src_checksum'));
      const specIn = specForAi(before);
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
      const srcBase = splitextBase(src.name || 'preset');
      const srcDir = chars(safeDirname(srcBase)).slice(0, 40).join('').trim();
      const folder = srcDir + (live ? ' (live)' : ' (affine)') + ' - ' + stamp(now);

      const spec = payload.spec;
      spec.patch_vol = before.patch_vol; spec.bpm = before.bpm;             // la modification ne touche ni au volume du patch ni au tempo
      // le preset d'origine sert de modele : un module « keep » (modele hors catalogue) garde ainsi ses octets d'origine
      const enc = E.encodePrst(spec, tb, src.raw);
      const base = safeFilename(pyTruthy(spec.name) ? spec.name : srcBase);
      const filename = base + (live ? '_live.prst' : '_v2.prst');
      for (const w of enc.warnings) log(t('log_warn', w));
      const after = E.decodePrst(enc.raw, tb);
      if (!after.checksum.valid) throw new Error('checksum invalide : ' + filename);
      log(t('log_written2', filename));
      return { payload, raw: enc.raw, filename, folder, spec, diff: diffPresets(before, after), warnings: enc.warnings, decoded: after, before };
    }

    return { id, generate, refine, checkNames, checkAmpCab, checkSections, diffPresets, specForAi, NAME_MAX, DEFAULT_PATCH_VOL };
  }

  return { forModel, NAME_MAX, DEFAULT_PATCH_VOL };
});
