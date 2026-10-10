/* GP-200 Studio Web -- interface. Tout le moteur est dans gp200core.js (global GP200). */
(function () {
  'use strict';
  const G = self.GP200;
  const USB = self.GP200USB;
  const LUFS = self.GP200LUFS;
  const TUNE = self.GP200TUNE;
  const SL = self.GP200SETLIST;
  const TIPS = self.GP200TIPS;
  const B = JSON.parse(document.getElementById('gp200-bundle').textContent);
  const tb = new G.Tables(B.tables);
  const template = Uint8Array.from(atob(B.template), c => c.charCodeAt(0));
  const STORE = 'gp200studio.web.v1', PKCE_KEY = 'gp200studio.web.pkce';
  // [Android] Chrome Android + cable USB OTG : memes trames, rythme plus prudent, textes d'aide propres. Faux ailleurs = rien ne change.
  const IS_ANDROID = /Android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  const PROVIDERS = ['gemini', 'openrouter', 'anthropic'];
  const FAMILY = { PRE: 'GEN', DST: 'GEN', AMP: 'GEN', NR: 'CAB', CAB: 'CAB', EQ: 'CAB', WAH: 'FX', MOD: 'FX', DLY: 'FX', RVB: 'FX', VOL: 'FX' };

  // ------------------------------------------------------------------ textes
  const D = {
    fr: {
      tagline: 'Presets pour Valeton GP-200, générés par IA',
      s1: 'Connecte une IA', s1_done: 'IA connectée', s2: 'Décris le son que tu veux',
      s2_sub: "Une chanson, un artiste, une ambiance. L'IA identifie le rig et génère 3 variantes par section.",
      change: 'Modifier', provider: 'Fournisseur', model: 'Modèle', key: 'Clé API', show: 'Afficher', hide: 'Masquer',
      refresh: 'Actualiser la liste', refreshing: 'Chargement…', models_ok: '%d modèles disponibles.', models_ko: "Liste indisponible, liste de secours affichée.",
      remember: 'Mémoriser la clé sur cet ordinateur (à décocher sur un ordinateur partagé)',
      privacy: "La clé reste dans ce navigateur et n'est envoyée qu'au fournisseur choisi : aucun serveur de GP-200 Studio n'est impliqué. Chaque fournisseur applique ses propres conditions sur les données, et certaines offres peuvent servir à améliorer leurs produits.",
      p_gemini: 'Google Gemini',
      p_openrouter: 'OpenRouter : connexion en 1 clic, modèles gratuits',
      p_anthropic: "Anthropic Claude : payant à l'usage",
      h_gemini: [['Ouvre ', ' et connecte-toi avec ton compte Google.'], 'Clique sur « Create API key » (créer une clé API).', 'Copie la clé et colle-la dans le champ ci-dessous.'],
      h_openrouter: "Clique sur le bouton : OpenRouter te demande l'autorisation puis te ramène ici avec la clé. Tu peux aussi coller une clé créée sur openrouter.ai/keys.",
      h_anthropic: "Crée une clé sur console.anthropic.com (un compte avec des crédits est nécessaire), puis colle-la dans le champ ci-dessous.",
      get_key: 'Obtenir une clé', or_login: 'Se connecter avec OpenRouter', or_https: "La connexion en 1 clic ne fonctionne que sur la version en ligne (https). Colle ta clé à la main, ou ouvre la page depuis son adresse web.",
      or_wait: 'Échange du code avec OpenRouter…', or_ok: 'Connecté à OpenRouter : la clé est enregistrée.', or_ko: 'La connexion OpenRouter a échoué : %s',
      key_hint_bad: "Cette clé ressemble à une clé %s, mais le fournisseur choisi est %s. Change de fournisseur ou vérifie que tu as copié la bonne clé.",
      sound_ph: 'Master of Puppets - Metallica, son rythmique album',
      examples: 'Exemples', structure: 'Structure', auto: 'Détection automatique',
      structure_auto: "L'IA détermine la structure : 1 son = 3 presets, 2 sons = 6, 3 sons = 9.",
      structure_forced: 'Sections imposées, dans cet ordre : %s. Clique à nouveau pour retirer.',
      role_clean: 'clean', role_crunch: 'crunch', role_disto: 'disto', role_lead: 'lead',
      pickup: 'Micros de ta guitare', pk_auto: 'Non précisé (l\'IA décide)', pk_humbucker: 'Humbucker (double bobinage)', pk_single: 'Simple bobinage', pk_p90: 'P90', pk_active: 'Actif (EMG, etc.)',
      web: 'Recherche web (identifier le vrai rig)', web_na: "Indisponible avec ce fournisseur.",
      go: 'Générer les presets', stop: 'Annuler', need_text: 'Écris d\'abord ce que tu veux comme son.', need_key: 'Il faut d\'abord coller une clé API (étape 1).',
      setup_skip: 'Continuer sans IA', setup_skip_help: "Pas de clé ? Tu peux quand même ouvrir un preset, l'envoyer à la pédale et harmoniser les volumes (bouton Volume) : seules la génération et l'affinage par IA demandent une clé. Tu pourras en ajouter une plus tard avec « Connecter une IA », en haut.",
      st_wait: 'Appel à l\'IA en cours, compte une à deux minutes…', st_attempt: 'Tentative %d : l\'IA répond…', st_fix: 'L\'IA corrige ses erreurs (relance automatique)…', st_cancel: 'Génération annulée.',
      rack: 'Rack', rack_empty: 'Chaîne vide : décris un son pour remplir le rack.', rack_busy: 'Le rack se prépare…',
      presets_ready: '%d presets prêts', empty_slot: 'vide', bypass: 'bypass', active: 'actif',
      inspector_hint: 'Clique un module pour voir tous ses réglages.',
      download: 'Télécharger ce preset (.prst)', download_all: 'Tout télécharger (.zip)',
      dl_hint: "Importe les fichiers .prst avec l'éditeur Valeton GP-200, ou envoie-les directement à la pédale avec la section ci-dessous.",
      rig: 'Rig identifié', structure_l: 'Structure', notes: 'Notes', angle: 'Angle', listen: 'À écouter', file: 'Fichier', section: 'Section',
      log: 'Journal technique', log_empty: 'Rien pour le moment.',
      warn_title: 'Remarques du convertisseur',
      e_key: "La clé API est refusée par le fournisseur. Vérifie qu'elle est complète et qu'elle correspond bien au fournisseur choisi.",
      e_quota: 'Le quota est atteint (trop de demandes). Patiente une minute, ou choisis un autre modèle.',
      e_credit: 'Le compte du fournisseur n\'a plus de crédits.',
      e_network: "Impossible de joindre le fournisseur. Vérifie ta connexion ; un bloqueur de pubs, un VPN ou un pare-feu peut aussi bloquer l'appel.",
      e_timeout: "Le fournisseur n'a pas répondu à temps. Réessaie, ou choisis un modèle plus rapide.",
      e_model: "Ce modèle n'existe pas ou n'est pas accessible avec ta clé. Choisis-en un autre dans la liste.",
      e_generic: 'Erreur : %s',
      e_gen_failed: "Après %d tentatives, l'IA n'a pas produit de presets valides. Réessaie, ou choisis un modèle plus puissant.",
      l_light: '[Info] Modèle gratuit : catalogue allégé utilisé pour éviter les dépassements de délai.',
      l_attempt: '  appel API (tentative %d)…', l_cut: '  ! JSON coupé par la limite de tokens : on repart en demandant plus court',
      l_unreadable: '  ! réponse illisible : %s', l_fix: '  ! %d erreur(s), correction demandée :', l_style: '[Info] Avertissements de style ignorés pour %s.',
      l_section: '  section %d/%d : %s (%s)', l_checksum: '    ! checksum invalide sur %s', l_warn: '    ! %s', l_written: '      prêt : %s', l_skip: '    ! variante %s ignorée : %s',
      l_tokens: '  tokens : %s entrée, %s sortie', l_trunc: '  ! réponse tronquée (limite de tokens)', l_switch: '  modèle remplacé par %s', l_http: '  ! erreur %s, nouvel essai dans %s s',
      foot_a: "Tout se passe dans ton navigateur : cette page ne charge aucune police, aucun script ni aucun suivi extérieur. Les fichiers .prst sont fabriqués ici, avec le même encodeur que GP-200 Studio.",
      foot_b: 'Projet libre, non affilié à Valeton.',
      pedal_title: 'Envoyer sur la pédale', pedal_sub: "Écris le preset directement dans ton GP-200 par USB, sans éditeur.",
      pedal_unsupported: "Ce navigateur ne peut pas parler à la pédale en USB (c'est le cas de Safari et des iPhone/iPad). Ouvre cette page avec Chrome ou Edge sur ordinateur, ou télécharge les fichiers .prst ci-dessus.",
      pedal_steps: ['Branche le GP-200 en USB et allume-le.', "Ferme l'éditeur Valeton et GP-200 Studio s'ils sont ouverts : un seul programme peut utiliser la pédale à la fois.", "Clique sur « Connecter la pédale » et autorise l'accès MIDI quand le navigateur le demande."],
      pedal_steps_android: ['Utilise Chrome pour Android (pas un autre navigateur) et un câble USB OTG : adaptateur OTG + câble USB-B de la pédale, ou câble USB-C vers USB-B.', "Branche le câble au téléphone, puis allume le GP-200. Si Android propose d'ouvrir la pédale avec une application, choisis « Annuler » ou « Aucune ».", "Ferme l'application Valeton (GP-2XX) et les autres applications MIDI : un seul programme peut utiliser la pédale à la fois.", "Clique sur « Connecter la pédale » et autorise l'accès MIDI quand Chrome le demande. Les envois sont un peu plus lents que sur ordinateur : c'est voulu."],
      pedal_none_android: "Sur Android, vérifie aussi que le câble OTG transmet bien les données (certains câbles ne font que charger) et que Chrome n'est pas en mode « version pour ordinateur ». Si rien ne change, clique sur « Signaler un problème » en bas de page et copie le rapport.",
      pedal_unsupported_android: "Ce navigateur Android ne peut pas parler à la pédale en USB. Ouvre cette page avec Chrome pour Android, ou télécharge les fichiers .prst ci-dessus.",
      pedal_connect: 'Connecter la pédale', pedal_asking: "Autorise l'accès MIDI dans la fenêtre du navigateur…",
      pedal_denied_local: "Chrome refuse le MIDI parce que cette page est ouverte depuis un fichier (pièce jointe, Téléchargements…) et non depuis son adresse web. Ouvre-la depuis https://rudywidmer.github.io/GP200-Studio/ puis réessaie.",
      pedal_denied: "L'accès MIDI a été refusé. Clique sur le cadenas à gauche de l'adresse, autorise les appareils MIDI, puis réessaie.",
      pedal_found: 'GP-200 détectée : %s', pedal_none: "Aucune pédale GP-200 détectée. Vérifie le câble USB, que la pédale est allumée, et qu'aucun autre programme ne l'utilise.",
      pedal_port: 'Port MIDI', pedal_retry: 'Chercher à nouveau',
      pedal_slot: 'Emplacement dans la pédale', pedal_bank: 'Numéro (1 à 64)', pedal_letter: 'Lettre',
      pedal_send_one: 'Envoyer ce preset sur %s', pedal_send_three: 'Envoyer les %d variantes sur %s',
      pedal_confirm: "Ça va écraser ce qui se trouve actuellement sur %s. Ces presets de la pédale seront perdus : sauvegarde-les avant si tu y tiens.",
      pedal_confirm_go: 'Écraser et envoyer', cancel: 'Annuler',
      pedal_hs: 'Poignée de main avec la pédale…', pedal_chunk: 'Envoi %d/%d…', pedal_job: ' (preset %d sur %d)',
      pedal_done: 'Terminé : %s. La pédale est positionnée sur le premier preset envoyé.',
      pedal_noack: "La pédale n'a pas confirmé la poignée de main : l'envoi a quand même été tenté. Si le preset n'apparaît pas, ferme les autres programmes qui utilisent la pédale et recommence.",
      pedal_blind: "Le canal de retour de la pédale n'a pas pu être ouvert : l'envoi s'est fait sans confirmation.",
      e_pedal_busy: "Impossible d'ouvrir la pédale : un autre programme (éditeur Valeton, GP-200 Studio…) l'utilise sûrement. Ferme-le puis réessaie.",
      e_pedal_gone: "La pédale a été débranchée pendant l'envoi.", e_pedal_generic: "Erreur d'envoi : %s",
      ver: 'Version %s · %s',
      pop_close: 'Fermer', slot_tip: 'Un clic sélectionne le module ; un clic de plus l\'active ou le coupe.', slot_tip_on: 'Cliquer pour couper ce module.', slot_tip_off: 'Cliquer pour activer ce module.', tab_module: 'Module', tab_result: 'Résultat', tab_pedal: 'Pédale', tab_ctrl: 'CTRL', tab_tune: 'Volume', tab_log: 'Journal',
      lib_title: 'Mes presets', lib_empty: "Rien pour l'instant : génère un morceau, ou ouvre un fichier .prst (bouton en haut, ou glisse-le dans la page).",
      tab_setlist: 'Set list', sl_title: 'Set list : envoyer ta sélection dans la pédale',
      sl_sub: "Écoute tes presets un par un, garde ceux qui te plaisent avec le ♥ de la liste de gauche, donne-leur un nom, puis envoie-les d'un coup dans les emplacements de ton choix.",
      sl_keep: 'Garder dans la set list : %s', sl_unkeep: 'Retirer de la set list : %s',
      sl_empty: "La set list est vide. Clique sur le ♥ à droite d'un preset de la liste de gauche pour le garder ici.",
      sl_name: 'Nom sur la pédale (16 caractères au maximum)', sl_slot_bank: 'Banque (1 à 64)', sl_slot_letter: 'Lettre',
      sl_fill_from: 'Emplacements consécutifs à partir de', sl_fill: 'Attribuer', sl_fill_title: 'Donne un emplacement à chaque preset de la liste, les uns après les autres, à partir de celui-ci.',
      sl_fill_over: "Pas assez de place : %d preset(s) restent sans emplacement (la dernière banque est 64-D).",
      sl_count: '%d preset(s) dans la set list.',
      sl_e_many: "Plus de 256 presets : la pédale n'a que 256 emplacements.", sl_e_name: 'Ligne %d : le nom est vide.', sl_e_range: 'Ligne %d : emplacement invalide.',
      sl_e_dup: 'Ligne %d : même emplacement que la ligne %d.', sl_e_missing: '%d preset(s) sans emplacement : choisis-les, ou utilise « Attribuer ».',
      sl_w_changed: 'Ligne %d : le nom sera envoyé sous la forme « %s » (accents retirés).', sl_w_dup: 'Ligne %d : même nom que la ligne %d (difficile à distinguer sur la pédale).',
      sl_w_work: "Ligne %d : %s est l'emplacement de travail de la page (celui où chaque preset sélectionné est envoyé pour être écouté) ; il sera réécrit dès que tu sélectionneras un autre preset.",
      sl_need_pedal: 'Connecte la pédale pour envoyer la set list.',
      sl_send: 'Envoyer %d preset(s) dans la pédale', sl_confirm: 'Ces emplacements de la pédale vont être ÉCRASÉS :', sl_confirm_go: 'Écraser et envoyer',
      sl_zip: 'Télécharger la set list (ZIP)', sl_zip_hint: "La liste des presets n'est conservée que dans cet onglet du navigateur : télécharge la set list pour la garder.",
      sl_done: 'Terminé : %d preset(s) écrit(s) (%s). La pédale est positionnée sur %s.',
      sl_fail: 'Interrompu après %d preset(s) sur %d (écrits : %s). %s',
      lib_remove: 'Retirer de la liste', kind_gen: 'généré', kind_open: 'ouvert', kind_refine: 'affiné', kind_live: 'concert', kind_pedal: 'pédale',
      open_prst: '📂 Ouvrir un .prst', batch_btn: '🎚️ Harmoniser par batch', batch_btn_tip: 'Mettre plusieurs presets au même volume, sans en charger un d\'abord', drop_here: 'Dépose ton ou tes fichiers .prst ici', opts_title: 'Options de génération',
      ref_target: 'Preset à affiner : %s', ref_target_none: "Aucun preset sélectionné : choisis-en un dans la liste, ou ouvre un fichier .prst.",
      ref_opened: '%d preset(s) ouvert(s).',
      w_title: 'Par où commencer ?',
      w_items: ['Décris un morceau dans la zone ci-dessus : l\'IA génère 3 variantes par section.', 'Ou ouvre un fichier .prst (bouton en haut, ou glisse-le dans la page) pour le voir, le régler à la main, l\'affiner avec l\'IA, puis l\'envoyer à la pédale.', 'Une fois la pédale connectée (pastille en haut), tous les réglages partent en direct, sans rien enregistrer.'],
      chip_ai_none: 'Connecter une IA', chip_pedal_off: 'Connecter la pédale', chip_pedal_none: 'Pédale introuvable', chip_live: 'Direct',
      chip_live_tip: "Direct : chaque réglage part tout de suite sur la pédale. Décoche pour ne modifier que le preset affiché.",
      pedal_nofile: 'Aucun preset à envoyer pour le moment.',
      bypass_it: 'Mettre en bypass', activate_it: 'Activer',
      mod_live: '⚡ En direct : chaque réglage part tout de suite sur la pédale (sans l\'enregistrer).',
      mod_live_off: 'Direct coupé (interrupteur en haut) : les réglages ne modifient que le preset affiché.',
      mod_offline: 'Hors ligne : les réglages modifient le preset affiché. Connecte la pédale (pastille en haut) pour les entendre en direct.',
      mod_match: "Pour que la pédale ait exactement le preset de l'écran, injecte-le (🔌) : il est écrit dans le slot d'injection puis sélectionné. Les réglages partent ensuite en direct sur ce patch, sans l'enregistrer. Si le patch de la pédale n'est pas celui de l'écran, le premier réglage d'un module lui envoie d'abord son modèle et ses valeurs.",
      mod_send: '↻ Envoyer ce module à la pédale', mod_save: '💾 Enregistrer sur la pédale…',
      pv_title: 'Volume du patch',
      ctrl_auto: "Chaque case est appliquée tout de suite au preset affiché. Envoie ensuite le preset à la pédale pour qu'elle en tienne compte.", ctrl_send: 'Envoyer le preset à la pédale…',
      res_open: 'Preset ouvert', res_author: 'Auteur', res_desc: 'Description', res_chain: 'Chaîne du signal', res_vol: 'Volume du patch', res_ctrl: 'CTRL', res_chk: 'Intégrité', res_chk_ok: 'valide', res_chk_ko: 'invalide',
      res_from: 'Affiné à partir de : %s',
      ed_changing_pedal: 'Envoi du module à la pédale…', ed_sent: '%s envoyé à la pédale.',
      mode_new: 'Nouveau morceau', mode_refine: 'Affiner un preset existant', mode_label: 'Mode',
      s2_refine: 'Ouvre un preset et dis ce que tu veux changer',
      s2_refine_sub: "Charge un fichier .prst (un preset de ta pédale exporté, ou un de ceux générés ici). L'IA le modifie, puis la page te montre exactement ce qui a changé.",
      ref_open: 'Ouvrir un fichier .prst', ref_drop: 'ou glisse-le ici',
      ref_loaded: 'Preset chargé : %s', ref_none: 'Aucun fichier chargé pour le moment.',
      ref_bad: "Ce fichier n'est pas un preset GP-200 lisible (%s).", ref_size: 'taille de %d octets au lieu de 1224',
      ref_checksum: "Attention : le contrôle d'intégrité (checksum) de ce fichier est faux. Il a peut-être été modifié ou abîmé ; on peut quand même s'en servir.",
      ref_sec: 'Preset chargé', ref_now: 'Décris maintenant ce que tu veux changer.',
      refine_title: 'Que veux-tu changer sur ce preset ?', refine_sub: 'En clair : « trop de reverb, il manque un flanger, ampli plus saturé ».',
      ref_ph: 'Ex. : trop de reverb, il manque un flanger…',
      go_refine: 'Affiner le preset', go_live: '🎤 Optimiser pour concert',
      live_hint: "« Optimiser pour concert » ne change aucun effet : il règle seulement le gain, le mix, l'EQ et le baffle pour jouer fort, en groupe.",
      need_file: "Ouvre d'abord un fichier .prst.", need_instr: 'Dis ce que tu veux changer sur ce preset.',
      exa: ['Il y a trop de reverb, et il manque un flanger', 'Pas assez de gain, et le son est trop sourd dans les aigus', 'Ajoute un delay en croche pointée, mix discret',
        'Enlève le chorus, mets un phaser à la place', 'Trop de basses, ça bave en groupe : resserre le bas', 'Coupe tous les effets de temps, je veux le son brut',
        "Rends-le utilisable en clean : baisse le gain de l'ampli"],
      r_title: "Résultat de l'affinage", r_count: '%d changement(s)', r_analysis: 'Analyse',
      r_real: 'Changements réels', r_real_sub: "calculés en comparant les deux fichiers, pas déclarés par l'IA",
      r_none: "Aucun : le preset est identique. La demande n'a peut-être pas été comprise.",
      r_claimed: "Ce que l'IA dit avoir fait", r_warn: "Avertissements de l'IA",
      r_carried: "Les assignations CTRL et le volume du patch de ton fichier d'origine ont été conservés (ce que l'outil de bureau ne faisait pas).",
      r_again: 'Repartir de ce résultat', r_rebased: 'Le résultat est maintenant le preset de départ : tu peux enchaîner une nouvelle modification.',
      r_live: 'Version concert',
      l_src_checksum: '  ! le preset source a un checksum invalide, on continue quand même', l_bullet: '      - %s', l_written2: '    écrit : %s',
      ctrl_btn: '🎛 Pédales CTRL', ctrl_title: 'Affectations CTRL', ctrl_help: "Les CTRL 1 à 8 sont les « interrupteurs » du preset : chacun allume ou éteint, d'un seul appui, les modules que tu coches.",
      ctrl_hint: 'Le footswitch qui envoie CTRL n se règle dans Global > Footswitch, sur la pédale.', ctrl_save: 'Enregistrer', ctrl_save_send: 'Enregistrer et envoyer à la pédale', ctrl_cancel: 'Annuler',
      ctrl_saved: 'CTRL enregistrés : %s', ctrl_none: 'aucun',
      ed_start: '🎚 Régler ce module', ed_stop: 'Terminer les réglages', ed_sub: 'Déplace les curseurs : le preset est modifié dans la page (télécharge-le ensuite). Avec la pédale branchée, tu peux aussi entendre le résultat tout de suite.',
      ed_live: '⚡ Entendre en direct sur la pédale', ed_live_off: 'Couper la liaison directe', ed_live_need: "Pour entendre en direct, branche la pédale dans le cadre « Envoyer sur la pédale » plus bas, et envoie-y d'abord ce preset.",
      ed_live_on: 'Liaison directe active : chaque réglage part immédiatement sur la pédale (sans l\'enregistrer).', ed_live_ko: 'Liaison directe interrompue : %s',
      ed_model: 'Modèle', ed_on: 'Module actif', ed_changing: 'Changement de modèle…', ed_applied: '%s appliqué.', ed_applied_live: '%s appliqué sur la pédale (pas encore enregistré).',
      ed_unsaved: "Sur la pédale, ces réglages restent provisoires jusqu'à l'envoi du preset (cadre « Envoyer sur la pédale »). Le fichier téléchargé contient déjà tes réglages.",
      tune_batch_hint: "Le lot : l'ordre est celui de la mesure ; tous les presets passent, un à la fois, par le même emplacement de travail. Tu peux mélanger des presets générés, ouverts ou affinés.",
      tune_sel_empty: 'Aucun preset dans le lot : ajoute-en ci-dessous.', tune_add_title: 'Ajouter des presets à harmoniser (%d disponibles)', tune_add_all: 'Tout ajouter', tune_clear: 'Vider le lot',
      tune_open_files: 'Ouvrir des .prst…', tune_up: 'Monter', tune_down: 'Descendre', tune_rm: 'Retirer du lot', tune_add: 'Ajouter', tune_none_avail: 'Tous les presets de la liste sont déjà dans le lot. Ouvre d\'autres .prst pour en ajouter.',
      tune_zip: 'Tout télécharger (zip)', tune_count: '%d preset(s) dans le lot',
      tune_title: 'Harmoniser le volume', tune_sub: "Tous tes presets au même niveau sonore, mesuré en LUFS, réglé automatiquement.",
      tune_what: "Un preset trop fort ou trop faible gâche un enchaînement de morceaux. Ici, tu joues un accord en boucle sur ta guitare : l'appli écoute le son qui sort de la pédale, mesure son volume (LUFS, la même unité que sur YouTube ou Spotify) et corrige toute seule le volume de l'ampli, du baffle ou du preset jusqu'à atteindre la cible.",
      tune_steps: ["La pédale est branchée en USB (et ton instrument est branché sur la pédale).", "Tu choisis l'entrée audio du GP-200 : c'est ce qui permet à la page de l'écouter.", "Tu joues un accord en boucle, preset après preset. Aucun clic entre deux mesures : quand le volume est bon pendant 3 secondes, c'est validé."],
      tune_unsupported: "Ce navigateur ne sait pas écouter l'entrée audio ou parler à la pédale en USB. Utilise Chrome ou Edge sur un ordinateur.",
      tune_a: 'La pédale', tune_b: "L'entrée audio", tune_c: 'Emplacement de travail', tune_d: 'Les presets et leur volume cible',
      tune_pedal_busy: "La pédale est utilisée par l'harmonisation du volume : termine-la ou arrête-la pour envoyer des presets.",
      tune_pedal_need: "Connecte d'abord la pédale (bouton ci-dessous).", tune_pedal_ok: 'GP-200 prêt : %s',
      tune_audio_ask: "Choisir l'entrée audio", tune_audio_asking: "Autorise l'accès au micro / à l'entrée audio dans le navigateur…",
      inj_btn: '🔌 Injecter', inj_tip: "Écrit le preset affiché dans le slot %s de la pédale (son contenu est remplacé) puis le sélectionne, comme « Injecter » de la version Windows.",
      inj_slot_btn: '📍 %s', inj_slot_choose: '📍 Choisir le slot', inj_slot_tip: "Slot de la pédale où les presets sont injectés (remplacé à chaque injection).",
      inj_panel_title: "Slot d'injection", inj_panel_msg: "Sur quel slot de la pédale injecter les presets ? Son contenu est remplacé à chaque injection : choisis un slot de travail, pas un preset que tu veux garder.",
      inj_auto: "Injecter automatiquement dès qu'un preset est choisi", inj_need: "Choisis d'abord le slot d'injection (📍) : rien n'est écrit sur la pédale tant que ce n'est pas fait.",
      listen_chk: "Écouter la pédale : ce qui change dessus (patch, modules) se met à jour ici. Garde le port MIDI ouvert : à décocher pour utiliser l'éditeur Valeton.",
      listen_on: 'GP-200 sur %s', listen_other: "GP-200 sur %s, mais le preset affiché est dans %s : les réglages en direct sont suspendus pour ne pas modifier un autre patch.",
      listen_reloaded: "La pédale a rechargé %s depuis sa mémoire : les réglages faits depuis l'injection ne sont plus dessus.",
      listen_panel: "Un réglage tourné sur la pédale n'a pas pu être appliqué ici : l'écran peut différer de la pédale.",
      listen_resend: 'Renvoyer le preset', listen_patch: 'patch %s', listen_byp_on: '%s activé sur la pédale', listen_byp_off: '%s coupé sur la pédale', listen_vol: 'volume du patch %d', listen_knob: 'réglage tourné (%s)',
      listen_log: 'Ce que dit la pédale', listen_log_sub: 'Derniers messages reçus de la pédale. Utile pour décoder de nouveaux messages : copie ce journal et envoie-le.', listen_log_empty: "Rien reçu pour l'instant : change de patch ou tourne un bouton sur la pédale.", listen_copy: 'Copier le journal', listen_off: "L'écoute de la pédale est désactivée (case du panneau 📍).",
      inj_prog: 'Injection en %s… %d %%', inj_done: '✅ Injecté et sélectionné sur la pédale en %s.', inj_fail: "❌ Injection en %s impossible : %s",
      live_noconf: "⚠ La pédale n'a pas confirmé le chargement de : %s. Vérifie l'effet (ou relance « Envoyer ce module »).",
      pflag_tip: "Ce réglage ne s'entend pas en direct : la pédale ne le prend en compte qu'au chargement du preset (enregistre-le ou envoie-le depuis l'onglet Pédale).",
      lvl_line: 'Niveau mesuré (réglages par défaut) : %s dBFS, soit %s dB par rapport à la médiane (%s dBFS).',
      render_err: "Erreur d'affichage.", reload: 'Recharger la page', diag_link: 'Signaler un problème', diag_link_tip: "Prépare un rapport de diagnostic que tu peux copier (rien n'est envoyé automatiquement).", diag_title: 'Un problème est survenu', diag_sub: "Rien n'est envoyé automatiquement. Copie le rapport (sans clé API) et colle-le dans un message ou une « issue » GitHub.", diag_copy: 'Copier le rapport', diag_copied: 'Copié ✓', diag_copy_ko: 'Copie impossible : sélectionne le texte ci-dessous.', diag_details: 'Détails', diag_hide: 'Masquer', diag_close: 'Fermer', pr_read: 'Lire le patch en cours', pr_read_tip: "Lit sur la pédale le patch actuellement chargé et l'affiche dans le rack (rien n'est écrit sur la pédale).", pr_read_help: "Au branchement, la page lit déjà le patch en cours. Ce bouton le relit si tu veux repartir de l'état actuel de la pédale.", pr_busy: 'Lecture de la pédale…', pr_done: 'Patch lu sur la pédale : %s (%s).', pr_fail: 'Lecture de la pédale impossible : %s', pr_timeout: "la pédale n'a pas répondu.", pr_noread: "pas d'entrée MIDI (lecture impossible).", mem_title: 'Mémoire de la pédale', mem_sub: "Un clic sélectionne l'emplacement sur la pédale (comme au pied) et l'affiche. Rien n'est écrit.", mem_pick: "Sélectionner %s sur la pédale et l'afficher", mem_refresh: 'Relire les noms des 256 emplacements de la pédale', mem_count: 'Emplacements dont le nom a été lu', mem_loading: 'Lecture des noms… %s/%s', mem_err: 'Lecture interrompue : %s', tune_audio_refresh: 'Actualiser la liste', tune_audio_pick: "Entrée audio", tune_audio_found: "Entrée « GP-200 » détectée et sélectionnée.",
      tune_audio_guess: "Aucune entrée nommée « GP-200 » : choisis celle de la pédale dans la liste (la pédale apparaît comme une carte son USB).",
      tune_audio_denied: "L'accès à l'entrée audio a été refusé. Clique sur le cadenas à gauche de l'adresse, autorise le micro, puis réessaie.",
      tune_audio_none: "Aucune entrée audio trouvée. Vérifie que la pédale est branchée et allumée.",
      tune_slot_help: "Chaque preset est envoyé dans cet emplacement, le temps de le régler. Ce qu'il contient actuellement sera écrasé. Choisis un emplacement dont tu n'as pas besoin.",
      tune_type: 'Type', tune_normal: 'Normal (−16 LUFS)', tune_lead: 'Lead (−11 LUFS)',
      tune_start: "Lancer l'harmonisation", tune_start_need: "Il manque la pédale ou l'entrée audio.",
      tune_confirm: "Chaque preset sera écrit dans %s pendant le réglage. Le contenu actuel de cet emplacement sera perdu.",
      tune_confirm_go: 'Écraser et démarrer',
      tune_cur: 'Preset %d/%d :  %s  |  %s  |  Cible %s LUFS',
      m_mom: 'Instantané (0,4 s)', m_st: 'Court terme (3 s)', m_itg: 'Intégré', m_delta: 'Écart à la cible',
      tune_hint_play: "Joue ton accord en boucle, régulièrement, sans changer de force.",
      tune_pause: 'Pause', tune_resume: 'Reprendre', tune_resend: 'Renvoyer le preset', tune_prev: 'Précédent', tune_next: 'Suivant', tune_finish: 'Terminer',
      tune_keep: 'Garder ce réglage', tune_stop: 'Arrêter',
      tune_pushing: 'Envoi du preset à la pédale… (%s)', tune_audio_on: "Écoute active : joue ton accord.",
      tune_paused: 'En pause : change de preset sur la pédale si besoin, puis reprends.',
      tune_done_title: 'Harmonisation terminée', tune_done_fmt: '%d preset(s) sur %d harmonisé(s). Les fichiers .prst de la page sont à jour : télécharge-les, ou renvoie-les sur la pédale avec le bloc « Envoyer sur la pédale ».',
      tune_stopped: 'Harmonisation arrêtée. Les presets déjà validés sont à jour dans la page.',
      tune_st_wait: 'à faire', tune_st_run: 'en cours', tune_st_done: 'validé', tune_st_skip: 'non validé',
      tune_row: 'Patch %s · Ampli %s',
      tune_applied: '%s validé à %s LUFS. Corrigé sur la pédale (%s).',
      tune_err_audio: "Impossible de lire l'entrée audio : %s", tune_err_usb: 'Erreur USB : %s',
      tune_focus: "Garde cet onglet visible pendant la mesure (le navigateur ralentit les onglets cachés).",
      tuned_badge: 'Volume harmonisé : %s LUFS · Patch %s · Ampli %s',
      batch_hint_validated: '✅ Validé (Patch: %.0f, Ampli: %s)',
      batch_hint_settling: "⏳ Stabilisation en cours (%ds)... Laisse sonner l'accord.",
      batch_hint_silence: '⏸️ En attente de signal... Jouez un accord pour lancer l\'ajustement.',
      batch_hint_stable_ok: '✅ Volume stable depuis 3s ! Sauvegarde automatique...',
      batch_hint_stable_wait: '🎯 Cible atteinte, stabilisation en cours (%ds)... Ne bougez plus.',
      batch_hint_patch_ceil: '⚠️ Patch en butée → recours gain...',
      batch_hint_patch_adj: '⚠️ Patch vol. Correction #%d : Patch → %.0f%s',
      batch_hint_patch_limit: ' [Patch en butée]',
      batch_hint_cab_adj: '⚙️ Correction #%d : CAB vol → %.0f',
      batch_hint_cab_limit: '⚠️ CAB %s → Patch vol...',
      batch_hint_amp_adj: '⚙️ Correction #%d : Ampli → %.0f',
      batch_hint_amp_limit: '⚠️ Ampli %s → CAB...',
      batch_hint_gain_adj: '⚠️ [Last resort] Gain → %.0f (max %.0f)',
      batch_hint_gain_limit: '🔴 Gain en butée (%.0f) — volume insuffisant pour atteindre %.0f dB',
      batch_hint_floor: 'au plancher', batch_hint_ceiling: 'en butée',
      batch_hint_no_usb: '⚠️ Écart de %+.1f dB (Auto-tweak désactivé sans USB)',
    },
    en: {
      tagline: 'AI-generated presets for the Valeton GP-200',
      s1: 'Connect an AI', s1_done: 'AI connected', s2: 'Describe the sound you want',
      s2_sub: 'A song, an artist, a mood. The AI identifies the rig and generates 3 variants per section.',
      change: 'Change', provider: 'Provider', model: 'Model', key: 'API key', show: 'Show', hide: 'Hide',
      refresh: 'Refresh list', refreshing: 'Loading…', models_ok: '%d models available.', models_ko: 'List unavailable, showing the built-in list.',
      remember: 'Remember the key on this computer (untick on a shared computer)',
      privacy: "The key stays in this browser and is only sent to the provider you picked: no GP-200 Studio server is involved. Each provider applies its own data terms, and some plans may be used to improve their products.",
      p_gemini: 'Google Gemini',
      p_openrouter: 'OpenRouter: one-click login, free models',
      p_anthropic: 'Anthropic Claude: pay as you go',
      h_gemini: [['Open ', ' and sign in with your Google account.'], 'Click “Create API key”.', 'Copy the key and paste it in the field below.'],
      h_openrouter: 'Click the button: OpenRouter asks for permission, then brings you back here with the key. You can also paste a key created at openrouter.ai/keys.',
      h_anthropic: 'Create a key at console.anthropic.com (an account with credits is required), then paste it in the field below.',
      get_key: 'Get a key', or_login: 'Sign in with OpenRouter', or_https: 'One-click login only works on the online version (https). Paste your key by hand, or open the page from its web address.',
      or_wait: 'Exchanging the code with OpenRouter…', or_ok: 'Connected to OpenRouter: the key is saved.', or_ko: 'OpenRouter login failed: %s',
      key_hint_bad: 'This key looks like it belongs to %s, but the provider selected is %s. Switch provider, or check that you copied the right key.',
      sound_ph: 'Master of Puppets - Metallica, album rhythm tone',
      examples: 'Examples', structure: 'Structure', auto: 'Auto-detect',
      structure_auto: 'The AI decides the structure: 1 sound = 3 presets, 2 = 6, 3 = 9.',
      structure_forced: 'Forced sections, in this order: %s. Click again to remove.',
      role_clean: 'clean', role_crunch: 'crunch', role_disto: 'dist', role_lead: 'lead',
      pickup: 'Your guitar pickups', pk_auto: 'Unspecified (the AI decides)', pk_humbucker: 'Humbucker', pk_single: 'Single-coil', pk_p90: 'P90', pk_active: 'Active (EMG, etc.)',
      web: 'Web search (identify the real rig)', web_na: 'Not available with this provider.',
      go: 'Generate presets', stop: 'Cancel', need_text: 'First write the sound you are after.', need_key: 'Paste an API key first (step 1).',
      setup_skip: 'Continue without AI', setup_skip_help: 'No key? You can still open a preset, send it to the pedal and level the volumes (Volume button): only AI generation and refining need a key. You can add one later with "Connect an AI" at the top.',
      st_wait: 'Calling the AI, allow a minute or two…', st_attempt: 'Attempt %d: waiting for the AI…', st_fix: 'The AI is fixing its errors (automatic retry)…', st_cancel: 'Generation cancelled.',
      rack: 'Rack', rack_empty: 'Empty chain: describe a sound to fill the rack.', rack_busy: 'The rack is getting ready…',
      presets_ready: '%d presets ready', empty_slot: 'empty', bypass: 'bypassed', active: 'on',
      inspector_hint: 'Click a module to see all its settings.',
      download: 'Download this preset (.prst)', download_all: 'Download all (.zip)',
      dl_hint: 'Import the .prst files with the Valeton GP-200 editor, or send them straight to the pedal with the section below.',
      rig: 'Identified rig', structure_l: 'Structure', notes: 'Notes', angle: 'Angle', listen: 'Listen for', file: 'File', section: 'Section',
      log: 'Technical log', log_empty: 'Nothing yet.',
      warn_title: 'Converter remarks',
      e_key: 'The provider rejected the API key. Check that it is complete and belongs to the provider you picked.',
      e_quota: 'The quota is used up (too many requests). Wait a minute, or pick another model.',
      e_credit: "The provider account is out of credits.",
      e_network: 'Could not reach the provider. Check your connection; an ad blocker, VPN or firewall can also block the call.',
      e_timeout: 'The provider did not answer in time. Try again, or pick a faster model.',
      e_model: 'This model does not exist or is not available with your key. Pick another one in the list.',
      e_generic: 'Error: %s',
      e_gen_failed: 'After %d attempts the AI did not produce valid presets. Try again, or pick a more capable model.',
      l_light: '[Info] Free model: light catalog used to avoid timeouts.',
      l_attempt: '  API call (attempt %d)…', l_cut: '  ! JSON cut by the token limit: retrying with a shorter request',
      l_unreadable: '  ! unreadable response: %s', l_fix: '  ! %d error(s), correction requested:', l_style: '[Info] Style warnings ignored for %s.',
      l_section: '  section %d/%d: %s (%s)', l_checksum: '    ! invalid checksum on %s', l_warn: '    ! %s', l_written: '      ready: %s', l_skip: '    ! variant %s skipped: %s',
      l_tokens: '  tokens: %s in, %s out', l_trunc: '  ! response truncated (token limit)', l_switch: '  model replaced by %s', l_http: '  ! error %s, retrying in %s s',
      foot_a: 'Everything happens in your browser: this page loads no font, script or tracker from elsewhere. The .prst files are built here, with the same encoder as GP-200 Studio.',
      foot_b: 'Free project, not affiliated with Valeton.',
      pedal_title: 'Send to the pedal', pedal_sub: 'Write the preset straight into your GP-200 over USB, no editor needed.',
      pedal_unsupported: 'This browser cannot talk to the pedal over USB (Safari and iPhone/iPad cannot). Open this page with Chrome or Edge on a computer, or download the .prst files above.',
      pedal_steps: ['Plug the GP-200 in over USB and switch it on.', 'Close the Valeton editor and GP-200 Studio if they are open: only one program can use the pedal at a time.', 'Click “Connect the pedal” and allow MIDI access when the browser asks.'],
      pedal_steps_android: ['Use Chrome for Android (not another browser) and a USB OTG cable: OTG adapter + the pedal\'s USB-B cable, or a USB-C to USB-B cable.', 'Plug the cable into the phone, then switch the GP-200 on. If Android offers to open the pedal with an app, choose “Cancel” or “None”.', 'Close the Valeton app (GP-2XX) and any other MIDI app: only one program can use the pedal at a time.', 'Click “Connect the pedal” and allow MIDI access when Chrome asks. Transfers are a little slower than on a computer: this is intended.'],
      pedal_none_android: 'On Android, also check that the OTG cable carries data (some cables only charge) and that Chrome is not in “desktop site” mode. If nothing changes, click “Report a problem” at the bottom of the page and copy the report.',
      pedal_unsupported_android: 'This Android browser cannot talk to the pedal over USB. Open this page with Chrome for Android, or download the .prst files above.',
      pedal_connect: 'Connect the pedal', pedal_asking: 'Allow MIDI access in the browser prompt…',
      pedal_denied_local: 'Chrome refuses MIDI because this page was opened from a file (attachment, Downloads…) instead of its web address. Open it from https://rudywidmer.github.io/GP200-Studio/ and try again.',
      pedal_denied: 'MIDI access was refused. Click the padlock left of the address, allow MIDI devices, then try again.',
      pedal_found: 'GP-200 found: %s', pedal_none: 'No GP-200 found. Check the USB cable, that the pedal is on, and that no other program is using it.',
      pedal_port: 'MIDI port', pedal_retry: 'Search again',
      pedal_slot: 'Location in the pedal', pedal_bank: 'Number (1 to 64)', pedal_letter: 'Letter',
      pedal_send_one: 'Send this preset to %s', pedal_send_three: 'Send the %d variants to %s',
      pedal_confirm: 'This will overwrite what is currently stored in %s. Those presets on the pedal will be lost: back them up first if you care about them.',
      pedal_confirm_go: 'Overwrite and send', cancel: 'Cancel',
      pedal_hs: 'Handshaking with the pedal…', pedal_chunk: 'Sending %d/%d…', pedal_job: ' (preset %d of %d)',
      pedal_done: 'Done: %s. The pedal is now on the first preset sent.',
      pedal_noack: 'The pedal did not confirm the handshake: the transfer was attempted anyway. If the preset does not show up, close other programs that use the pedal and try again.',
      pedal_blind: "The pedal's return channel could not be opened: the transfer was sent without confirmation.",
      e_pedal_busy: 'Could not open the pedal: another program (Valeton editor, GP-200 Studio…) is probably using it. Close it and try again.',
      e_pedal_gone: 'The pedal was unplugged during the transfer.', e_pedal_generic: 'Transfer error: %s',
      ver: 'Version %s · %s',
      pop_close: 'Close', slot_tip: 'One click selects the module; another click turns it on or off.', slot_tip_on: 'Click to bypass this module.', slot_tip_off: 'Click to turn this module on.', tab_module: 'Module', tab_result: 'Result', tab_pedal: 'Pedal', tab_ctrl: 'CTRL', tab_tune: 'Volume', tab_log: 'Log',
      lib_title: 'My presets', lib_empty: 'Nothing yet: generate a song, or open a .prst file (button above, or drop it on the page).',
      tab_setlist: 'Set list', sl_title: 'Set list: send your selection to the pedal',
      sl_sub: 'Audition your presets one by one, keep the ones you like with the ♥ in the left-hand list, give them a name, then send them all at once to the slots you choose.',
      sl_keep: 'Keep in the set list: %s', sl_unkeep: 'Remove from the set list: %s',
      sl_empty: 'The set list is empty. Click the ♥ to the right of a preset in the left-hand list to keep it here.',
      sl_name: 'Name on the pedal (16 characters at most)', sl_slot_bank: 'Bank (1 to 64)', sl_slot_letter: 'Letter',
      sl_fill_from: 'Consecutive slots starting at', sl_fill: 'Assign', sl_fill_title: 'Gives each preset in the list a slot, one after the other, starting with this one.',
      sl_fill_over: 'Not enough room: %d preset(s) are left without a slot (the last bank is 64-D).',
      sl_count: '%d preset(s) in the set list.',
      sl_e_many: 'More than 256 presets: the pedal only has 256 slots.', sl_e_name: 'Line %d: the name is empty.', sl_e_range: 'Line %d: invalid slot.',
      sl_e_dup: 'Line %d: same slot as line %d.', sl_e_missing: '%d preset(s) without a slot: pick one for each, or use "Assign".',
      sl_w_changed: 'Line %d: the name will be sent as "%s" (accents removed).', sl_w_dup: 'Line %d: same name as line %d (hard to tell apart on the pedal).',
      sl_w_work: "Line %d: %s is the page's working slot (where each selected preset is sent so you can hear it); it will be rewritten as soon as you select another preset.",
      sl_need_pedal: 'Connect the pedal to send the set list.',
      sl_send: 'Send %d preset(s) to the pedal', sl_confirm: 'These pedal slots will be OVERWRITTEN:', sl_confirm_go: 'Overwrite and send',
      sl_zip: 'Download the set list (ZIP)', sl_zip_hint: 'The list of presets is only kept in this browser tab: download the set list to keep it.',
      sl_done: 'Done: %d preset(s) written (%s). The pedal is now on %s.',
      sl_fail: 'Stopped after %d of %d preset(s) (written: %s). %s',
      lib_remove: 'Remove from the list', kind_gen: 'generated', kind_open: 'opened', kind_refine: 'refined', kind_live: 'live', kind_pedal: 'pedal',
      open_prst: '📂 Open a .prst', batch_btn: '🎚️ Match volumes (batch)', batch_btn_tip: 'Bring several presets to the same volume, no need to load one first', drop_here: 'Drop your .prst file(s) here', opts_title: 'Generation options',
      ref_target: 'Preset to refine: %s', ref_target_none: 'No preset selected: pick one in the list, or open a .prst file.',
      ref_opened: '%d preset(s) opened.',
      w_title: 'Where to start?',
      w_items: ['Describe a song in the box above: the AI generates 3 variants per section.', 'Or open a .prst file (button above, or drop it on the page) to view it, tweak it by hand, refine it with the AI, then send it to the pedal.', 'Once the pedal is connected (pill at the top), every adjustment goes out live, nothing to save.'],
      chip_ai_none: 'Connect an AI', chip_pedal_off: 'Connect the pedal', chip_pedal_none: 'Pedal not found', chip_live: 'Live',
      chip_live_tip: 'Live: each adjustment goes to the pedal right away. Untick to change only the displayed preset.',
      pedal_nofile: 'No preset to send yet.',
      bypass_it: 'Bypass', activate_it: 'Turn on',
      mod_live: '⚡ Live: each adjustment goes to the pedal right away (without saving it).',
      mod_live_off: 'Live switched off (switch at the top): adjustments only change the displayed preset.',
      mod_offline: 'Offline: adjustments change the displayed preset. Connect the pedal (pill at the top) to hear them live.',
      mod_match: "To get exactly the displayed preset on the pedal, inject it (🔌): it is written to the injection slot and selected. Adjustments then go live to that patch without saving it. If the pedal is on another patch, the first adjustment of a module sends its model and values first.",
      mod_send: '↻ Send this module to the pedal', mod_save: '💾 Save on the pedal…',
      pv_title: 'Patch volume',
      ctrl_auto: 'Each box is applied to the displayed preset right away. Then send the preset to the pedal so it takes effect.', ctrl_send: 'Send the preset to the pedal…',
      res_open: 'Opened preset', res_author: 'Author', res_desc: 'Description', res_chain: 'Signal chain', res_vol: 'Patch volume', res_ctrl: 'CTRL', res_chk: 'Integrity', res_chk_ok: 'valid', res_chk_ko: 'invalid',
      res_from: 'Refined from: %s',
      ed_changing_pedal: 'Sending the module to the pedal…', ed_sent: '%s sent to the pedal.',
      mode_new: 'New song', mode_refine: 'Refine an existing preset', mode_label: 'Mode',
      s2_refine: 'Open a preset and say what to change',
      s2_refine_sub: 'Load a .prst file (one exported from your pedal, or one generated here). The AI changes it, then the page shows exactly what changed.',
      ref_open: 'Open a .prst file', ref_drop: 'or drop it here',
      ref_loaded: 'Preset loaded: %s', ref_none: 'No file loaded yet.',
      ref_bad: 'This file is not a readable GP-200 preset (%s).', ref_size: 'size is %d bytes instead of 1224',
      ref_checksum: "Careful: this file's integrity check (checksum) is wrong. It may have been edited or damaged; you can still use it.",
      ref_sec: 'Loaded preset', ref_now: 'Now describe what you want to change.',
      refine_title: 'What do you want to change on this preset?', refine_sub: 'In plain words: "too much reverb, add a flanger, more amp gain".',
      ref_ph: 'E.g.: too much reverb, add a flanger…',
      go_refine: 'Refine the preset', go_live: '🎤 Optimize for live',
      live_hint: '"Optimize for live" changes no effect: it only adjusts gain, mix, EQ and the cab so the preset holds up loud, with a band.',
      need_file: 'Open a .prst file first.', need_instr: 'Say what you want to change on this preset.',
      exa: ['Too much reverb, and a flanger is missing', 'Not enough gain, and the tone is too dull on the highs', 'Add a dotted-eighth delay, subtle mix',
        'Remove the chorus, put a phaser instead', 'Too much bass, it gets muddy with the band: tighten the low end', 'Cut all time-based effects, I want the raw tone',
        'Make it usable clean: lower the amp gain'],
      r_title: 'Refine result', r_count: '%d change(s)', r_analysis: 'Analysis',
      r_real: 'Actual changes', r_real_sub: 'computed by comparing the two files, not claimed by the AI',
      r_none: 'None: the preset is identical. The request may not have been understood.',
      r_claimed: 'What the AI says it did', r_warn: 'AI warnings',
      r_carried: "The CTRL assignments and patch volume of your original file were kept (the desktop tool did not do that).",
      r_again: 'Start again from this result', r_rebased: 'The result is now the starting preset: you can chain another change.',
      r_live: 'Live version',
      l_src_checksum: '  ! source preset has an invalid checksum, continuing anyway', l_bullet: '      - %s', l_written2: '    written: %s',
      ctrl_btn: '🎛 CTRL pedals', ctrl_title: 'CTRL assignments', ctrl_help: 'CTRL 1 to 8 are the preset\'s "switches": each one turns the modules you tick on or off with a single press.',
      ctrl_hint: 'The footswitch that sends CTRL n is set in Global > Footswitch, on the pedal.', ctrl_save: 'Save', ctrl_save_send: 'Save and send to the pedal', ctrl_cancel: 'Cancel',
      ctrl_saved: 'CTRL saved: %s', ctrl_none: 'none',
      ed_start: '🎚 Adjust this module', ed_stop: 'Finish adjusting', ed_sub: 'Move the sliders: the preset is changed in the page (download it afterwards). With the pedal plugged in you can also hear the result right away.',
      ed_live: '⚡ Hear it live on the pedal', ed_live_off: 'Cut the live link', ed_live_need: 'To hear it live, plug in the pedal in the "Send to the pedal" box below, and send this preset there first.',
      ed_live_on: 'Live link active: each change goes to the pedal immediately (without saving it).', ed_live_ko: 'Live link interrupted: %s',
      ed_model: 'Model', ed_on: 'Module on', ed_changing: 'Changing model…', ed_applied: '%s applied.', ed_applied_live: '%s applied on the pedal (not saved yet).',
      ed_unsaved: 'On the pedal these settings stay temporary until you send the preset ("Send to the pedal" box). The downloaded file already contains your settings.',
      tune_batch_hint: 'The batch: the order is the measuring order; presets go one at a time through the same working slot. You can mix generated, opened and refined presets.',
      tune_sel_empty: 'No preset in the batch: add some below.', tune_add_title: 'Add presets to match (%d available)', tune_add_all: 'Add all', tune_clear: 'Clear the batch',
      tune_open_files: 'Open .prst files…', tune_up: 'Move up', tune_down: 'Move down', tune_rm: 'Remove from the batch', tune_add: 'Add', tune_none_avail: 'Every preset in the list is already in the batch. Open more .prst files to add them.',
      tune_zip: 'Download all (zip)', tune_count: '%d preset(s) in the batch',
      tune_title: 'Match the volume', tune_sub: 'All your presets at the same loudness, measured in LUFS and set automatically.',
      tune_what: "A preset that is too loud or too quiet ruins a setlist. Here you play a chord in a loop on your guitar: the app listens to what comes out of the pedal, measures its loudness (LUFS, the same unit YouTube or Spotify use) and adjusts the amp, cab or preset volume by itself until it hits the target.",
      tune_steps: ['The pedal is plugged in over USB (and your instrument is plugged into the pedal).', "You pick the GP-200's audio input: this is what lets the page listen.", 'You play a chord in a loop, preset after preset. No click between measurements: once the volume is right for 3 seconds, it is validated.'],
      tune_unsupported: 'This browser cannot listen to the audio input or talk to the pedal over USB. Use Chrome or Edge on a computer.',
      tune_a: 'The pedal', tune_b: 'The audio input', tune_c: 'Working slot', tune_d: 'Presets and their target volume',
      tune_pedal_busy: 'The pedal is in use by the volume matching: finish or stop it before sending presets.',
      tune_pedal_need: 'Connect the pedal first (button below).', tune_pedal_ok: 'GP-200 ready: %s',
      tune_audio_ask: 'Choose the audio input', tune_audio_asking: 'Allow microphone / audio input access in the browser prompt…',
      inj_btn: '🔌 Inject', inj_tip: "Writes the displayed preset into slot %s of the pedal (its content is replaced) and selects it, like « Inject » in the Windows version.",
      inj_slot_btn: '📍 %s', inj_slot_choose: '📍 Choose the slot', inj_slot_tip: 'Pedal slot where presets are injected (replaced on every injection).',
      inj_panel_title: 'Injection slot', inj_panel_msg: 'Which pedal slot should presets be injected into? Its content is replaced on every injection: pick a working slot, not a preset you want to keep.',
      inj_auto: 'Inject automatically as soon as a preset is chosen', inj_need: 'Choose the injection slot first (📍): nothing is written to the pedal until you do.',
      listen_chk: 'Listen to the pedal: what changes on it (patch, modules) is mirrored here. Keeps the MIDI port open: untick to use the Valeton editor.',
      listen_on: 'GP-200 on %s', listen_other: 'GP-200 is on %s, but the displayed preset lives in %s: live changes are paused so another patch is not modified.',
      listen_reloaded: 'The pedal reloaded %s from its memory: changes made since the injection are no longer on it.',
      listen_panel: 'A setting turned on the pedal could not be applied here: the screen may differ from the pedal.',
      listen_resend: 'Send the preset again', listen_patch: 'patch %s', listen_byp_on: '%s turned on at the pedal', listen_byp_off: '%s bypassed at the pedal', listen_vol: 'patch volume %d', listen_knob: 'setting turned (%s)',
      listen_log: 'What the pedal says', listen_log_sub: 'Latest messages received from the pedal. Handy to decode new messages: copy this log and send it over.', listen_log_empty: 'Nothing received yet: change patch or turn a knob on the pedal.', listen_copy: 'Copy the log', listen_off: 'Listening to the pedal is off (checkbox in the 📍 panel).',
      inj_prog: 'Injecting into %s… %d %%', inj_done: '✅ Injected and selected on the pedal in %s.', inj_fail: '❌ Could not inject into %s: %s',
      live_noconf: '⚠ The pedal did not confirm loading: %s. Check the effect (or run « Send this module » again).',
      pflag_tip: 'This setting is not audible live: the pedal only applies it when the preset is loaded (save it or send it from the Pedal tab).',
      lvl_line: 'Measured level (default settings): %s dBFS, %s dB versus the median (%s dBFS).',
      render_err: 'Display error.', reload: 'Reload the page', diag_link: 'Report a problem', diag_link_tip: 'Prepares a diagnostic report you can copy (nothing is sent automatically).', diag_title: 'Something went wrong', diag_sub: 'Nothing is sent automatically. Copy the report (no API key in it) and paste it in a message or a GitHub issue.', diag_copy: 'Copy the report', diag_copied: 'Copied ✓', diag_copy_ko: 'Copy failed: select the text below.', diag_details: 'Details', diag_hide: 'Hide', diag_close: 'Close', pr_read: 'Read the current patch', pr_read_tip: 'Reads the patch currently loaded on the pedal and shows it in the rack (nothing is written to the pedal).', pr_read_help: "The page already reads the current patch when the pedal is connected. This button reads it again if you want to start from the pedal's current state.", pr_busy: 'Reading the pedal…', pr_done: 'Patch read from the pedal: %s (%s).', pr_fail: 'Could not read the pedal: %s', pr_timeout: 'the pedal did not answer.', pr_noread: 'no MIDI input (reading is not possible).', mem_title: 'Pedal memory', mem_sub: 'One click selects the slot on the pedal (like a footswitch) and shows it. Nothing is written.', mem_pick: 'Select %s on the pedal and show it', mem_refresh: 'Read the names of the 256 pedal slots again', mem_count: 'Slots whose name has been read', mem_loading: 'Reading names… %s/%s', mem_err: 'Reading interrupted: %s', tune_audio_refresh: 'Refresh the list', tune_audio_pick: 'Audio input', tune_audio_found: 'A “GP-200” input was found and selected.',
      tune_audio_guess: 'No input named “GP-200”: pick the pedal in the list (it shows up as a USB sound card).',
      tune_audio_denied: 'Audio input access was refused. Click the padlock left of the address, allow the microphone, then try again.',
      tune_audio_none: 'No audio input found. Check that the pedal is plugged in and on.',
      tune_slot_help: 'Each preset is sent to this slot while it is tuned. What it currently holds will be overwritten. Pick a slot you do not need.',
      tune_type: 'Type', tune_normal: 'Normal (−16 LUFS)', tune_lead: 'Lead (−11 LUFS)',
      tune_start: 'Start matching', tune_start_need: 'The pedal or the audio input is missing.',
      tune_confirm: 'Each preset will be written to %s while it is tuned. The current content of that slot will be lost.',
      tune_confirm_go: 'Overwrite and start',
      tune_cur: 'Preset %d/%d:  %s  |  %s  |  Target %s LUFS',
      m_mom: 'Momentary (0.4 s)', m_st: 'Short-term (3 s)', m_itg: 'Integrated', m_delta: 'Gap to target',
      tune_hint_play: 'Play your chord in a loop, steadily, without changing how hard you pick.',
      tune_pause: 'Pause', tune_resume: 'Resume', tune_resend: 'Send the preset again', tune_prev: 'Previous', tune_next: 'Next', tune_finish: 'Finish',
      tune_keep: 'Keep this setting', tune_stop: 'Stop',
      tune_pushing: 'Sending the preset to the pedal… (%s)', tune_audio_on: 'Listening: play your chord.',
      tune_paused: 'Paused: switch preset on the pedal if needed, then resume.',
      tune_done_title: 'Matching finished', tune_done_fmt: '%d of %d preset(s) matched. The .prst files on this page are up to date: download them, or send them back to the pedal with the “Send to the pedal” block.',
      tune_stopped: 'Matching stopped. Presets that were already validated are up to date on the page.',
      tune_st_wait: 'to do', tune_st_run: 'in progress', tune_st_done: 'validated', tune_st_skip: 'not validated',
      tune_row: 'Patch %s · Amp %s',
      tune_applied: '%s validated at %s LUFS. Updated on the pedal (%s).',
      tune_err_audio: 'Cannot read the audio input: %s', tune_err_usb: 'USB error: %s',
      tune_focus: 'Keep this tab visible while measuring (browsers slow down hidden tabs).',
      tuned_badge: 'Volume matched: %s LUFS · Patch %s · Amp %s',
      batch_hint_validated: '✅ Validated (Patch: %.0f, Amp: %s)',
      batch_hint_settling: '⏳ Settling (%ds)... Let the chord ring.',
      batch_hint_silence: '⏸️ Waiting for signal... Play a chord to start adjustment.',
      batch_hint_stable_ok: '✅ Volume stable for 3s! Auto-saving...',
      batch_hint_stable_wait: '🎯 Target reached, stabilising (%ds)... Hold steady.',
      batch_hint_patch_ceil: '⚠️ Patch at ceiling → falling back to gain...',
      batch_hint_patch_adj: '⚠️ Patch vol. Correction #%d: Patch → %.0f%s',
      batch_hint_patch_limit: ' [Patch at limit]',
      batch_hint_cab_adj: '⚙️ Correction #%d: CAB vol → %.0f',
      batch_hint_cab_limit: '⚠️ CAB %s → Patch vol...',
      batch_hint_amp_adj: '⚙️ Correction #%d: Amp → %.0f',
      batch_hint_amp_limit: '⚠️ Amp %s → CAB...',
      batch_hint_gain_adj: '⚠️ [Last resort] Gain → %.0f (max %.0f)',
      batch_hint_gain_limit: '🔴 Gain at ceiling (%.0f) — volume insufficient to reach %.0f dB',
      batch_hint_floor: 'at floor', batch_hint_ceiling: 'at ceiling',
      batch_hint_no_usb: '⚠️ Gap of %+.1f dB (Auto-tweak disabled without USB)',
    },
  };
  const SLOT_NAMES = {
    fr: { PRE: 'Pré / Comp', WAH: 'Wah', DST: 'Drive', AMP: 'Ampli', NR: 'Noise Gate', CAB: 'Baffle / IR', EQ: 'Égaliseur', MOD: 'Modulation', DLY: 'Delay', RVB: 'Reverbe', VOL: 'Volume' },
    en: { PRE: 'Pre / Comp', WAH: 'Wah', DST: 'Drive', AMP: 'Amp', NR: 'Noise Gate', CAB: 'Cab / IR', EQ: 'Equalizer', MOD: 'Modulation', DLY: 'Delay', RVB: 'Reverb', VOL: 'Volume' },
  };
  // Prefixes connus, utilises UNIQUEMENT pour reperer une cle collee chez le mauvais fournisseur. Jamais pour dire qu'une cle est « fausse » :
  // les formats evoluent (Google emet aussi des cles qui ne commencent pas par AIza), seul le fournisseur sait si une cle est valide.
  const KEY_PREFIX = { gemini: 'AIza', anthropic: 'sk-ant-', openrouter: 'sk-or-' };
  function foreignKeyOwner(p, v) {
    for (const q of Object.keys(KEY_PREFIX)) if (q !== p && v.indexOf(KEY_PREFIX[q]) === 0) return q;
    return null;
  }
  const PROV_NAME = { gemini: 'Gemini', anthropic: 'Anthropic', openrouter: 'OpenRouter' };

  // -------------------------------------------------------------------- etat
  const s = {
    lang: /^fr/i.test(navigator.language || '') ? 'fr' : 'en',
    provider: 'gemini', models: {}, keys: {}, remember: true, pickup: 'auto', web: false,
    roles: [], demande: '', setupOpen: null, noAi: false,   // noAi = « continuer sans IA » choisi (la fenetre de connexion ne s'ouvre plus d'elle-meme)
    modelList: {}, modelMsg: '',
    run: null,          // {running, status, log:[], error, controller}
    res: null, sel: { si: 0, vi: 0, slot: 'AMP' }, fresh: false, notice: null,
    usb: { link: null, state: (USB && USB.MidiLink.supported()) ? 'idle' : 'unsupported', outId: null, ports: [], bank: 1, letter: 'A',
           confirm: null, sending: null, result: null, flags: {}, error: '' },
    mode: 'new', tab: 'module', lib: [], ref: { instr: '' },
    ed: { live: false, want: true, busy: false, opening: null, msg: '', err: '', last: 0, timer: null, idle: null, pending: null, sync: { file: null, set: new Set() }, pm: new Map(), tails: new Map(), noConf: [], bsent: new Map(), psent: new Map(), vsent: 0 },
    // injection = ecrire le preset affiche dans un slot choisi puis le selectionner (comme « Injecter » de la version Windows) ; set = slot confirme par l'utilisateur
    inj: { bank: 1, letter: 'A', auto: true, set: false, open: false, asked: false, busy: false, queued: null, t: null, msg: '', err: '', warn: '' },
    // ecoute de la pedale (sens pedale -> page) : pc = patch courant de la pedale (null = inconnu), desync = elle a recharge le patch sans nos reglages
    listen: { want: true, pc: null, desync: false, touched: false, last: '', log: [], rt: null },
    sl: { items: [], start: { bank: 1, letter: 'A' }, confirm: false, result: null, fillMsg: '' },     // set list : [{ f (fichier de la bibliotheque), name, bank, letter }]
    // lecture du patch charge sur la pedale (voir pedalFetch) : busy = lecture en cours, auto = lecture au branchement, t/rt = minuteries
    pr: { busy: false, auto: true, t: null, rt: null, last: null },
    // memoire de la pedale (colonne de gauche) : items[pc] = { name, stale?, err? } ou null (pas encore lu) ; busy = lecture des noms en cours
    mem: { items: Array.from({ length: 256 }, () => null), busy: false, auto: true, err: '', t: null, done: 0, todo: 0, shownPc: null, follow: false },
    tune: { open: false, audio: { state: 'idle', devs: [], id: '', guessed: false, err: '' }, sel: null, bank: null, letter: null, confirm: false, run: null, msg: null },
  };
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (o.lang === 'fr' || o.lang === 'en') s.lang = o.lang;
      if (PROVIDERS.indexOf(o.provider) >= 0) s.provider = o.provider;
      if (o.models && typeof o.models === 'object') s.models = o.models;
      if (o.keys && typeof o.keys === 'object') s.keys = o.keys;
      if (typeof o.remember === 'boolean') s.remember = o.remember;
      if (typeof o.noAi === 'boolean') s.noAi = o.noAi;
      if (o.pickup) s.pickup = o.pickup;
      if (typeof o.liveWant === 'boolean') s.ed.want = o.liveWant;
      if (typeof o.listen === 'boolean') s.listen.want = o.listen;
      if (o.usb && o.usb.bank >= 1 && o.usb.bank <= USB.SLOT_MAX) s.usb.bank = o.usb.bank | 0;
      if (o.usb && 'ABCD'.indexOf(o.usb.letter) >= 0 && o.usb.letter) s.usb.letter = o.usb.letter;
      if (o.inj && o.inj.bank >= 1 && o.inj.bank <= USB.SLOT_MAX && 'ABCD'.indexOf(o.inj.letter) >= 0 && o.inj.letter) { s.inj.bank = o.inj.bank | 0; s.inj.letter = o.inj.letter; s.inj.set = !!o.inj.set; }
      if (o.inj && typeof o.inj.auto === 'boolean') s.inj.auto = o.inj.auto;
    } catch (e) { /* stockage indisponible : on travaille en memoire */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        lang: s.lang, provider: s.provider, models: s.models, remember: s.remember, noAi: s.noAi, pickup: s.pickup, liveWant: s.ed.want, listen: s.listen.want, usb: { bank: s.usb.bank, letter: s.usb.letter }, inj: { bank: s.inj.bank, letter: s.inj.letter, auto: s.inj.auto, set: s.inj.set },
        keys: s.remember ? s.keys : {},
      }));
    } catch (e) { /* idem */ }
  }
  const T = (k, ...a) => {
    let str = (D[s.lang] && D[s.lang][k] !== undefined) ? D[s.lang][k] : (D.fr[k] !== undefined ? D.fr[k] : k);
    if (typeof str !== 'string') return str;
    let i = 0;
    return str.replace(/%[sd]/g, () => (i < a.length ? a[i++] : ''));
  };
  // ------------------------------------------------------------ diagnostic (v0.25)
  // Journal d'evenements en memoire + rapport copiable a la main. Rien n'est jamais envoye automatiquement ; aucune cle API dans le rapport.
  const DIAG = { ev: [], last: null, seen: new Map(), el: null, show: false, details: false, copied: '', manual: false };
  function redact(x) {
    let t = String(x === undefined || x === null ? '' : x);
    try { for (const k of Object.keys(s.keys || {})) { const v = String(s.keys[k] || '').trim(); if (v.length >= 6) t = t.split(v).join('[key hidden]'); } } catch (e) { /* rien */ }
    return t
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[key hidden]')
      .replace(/\bsk-[A-Za-z0-9_\-]{12,}/g, '[key hidden]')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+\/=]{8,}/gi, '$1 [key hidden]')
      .replace(/((?:api[_-]?key|x-api-key|x-goog-api-key|authorization|access_token|code_verifier|token)["']?\s*[:=]\s*["']?)[^\s"'&,}]{6,}/gi, '$1[hidden]');
  }
  function dg(kind, txt) {
    try { DIAG.ev.push({ t: Date.now(), kind, txt: redact(txt).slice(0, 400) }); if (DIAG.ev.length > 80) DIAG.ev.shift(); } catch (e) { /* rien */ }
  }
  /** Note une erreur dans le journal et, si elle n'est pas une simple erreur d'utilisateur, ouvre le panneau (une seule fois par erreur distincte). */
  function diagErr(e, where) {
    try {
      if (e === null || e === undefined || e.message === 'aborted' || (typeof e === 'object' && e.__dg)) return;
      if (typeof e === 'object') { try { e.__dg = true; } catch (_) { /* fige */ } }
      const msg = String((e && e.message) || e);
      const sig = where + '|' + msg.slice(0, 120);
      const prev = DIAG.seen.get(sig);
      if (prev) { prev.n++; return; }
      DIAG.seen.set(sig, { n: 1, where, msg: redact(msg).slice(0, 160) });
      const code = e && e.code, st = e && e.status;
      DIAG.last = { t: Date.now(), where, name: (e && e.name) || typeof e, status: st, kind: e && e.kind, code, message: redact(msg).slice(0, 600), url: e && e.url, raw: e && e.raw };
      dg('error:' + where, [DIAG.last.name, st, DIAG.last.kind, code, msg].filter(x => x !== undefined && x !== '').join(' | '));
      const userSide = (e && e.kind === 'nokey') || st === 401 || st === 403 || code === 'busy' || code === 'gone' || /denied|not allowed|permission/i.test(msg);
      if (!userSide) diagShow(false);
    } catch (x) { /* le diagnostic ne doit jamais faire planter l'appli */ }
  }
  function diagPorts(kind) {
    try {
      const u = s.usb, p = u.link ? u.link.ports() : { outputs: [], inputs: [] };
      const f = a => a.map(x => (x.name || x.id) + (x.state && x.state !== 'connected' ? ' [' + x.state + ']' : '')).join(' ; ') || '-';
      dg('midi', kind + ': out=' + f(p.outputs) + ' | in=' + f(p.inputs) + ' | picked=' + ((u.ports.find(x => x.id === u.outId) || {}).name || '-'));
    } catch (e) { /* rien */ }
  }
  function diagReport() {
    const L = [], add = x => L.push(x);
    const p2 = (n, k) => String(n).padStart(k || 2, '0');
    const hms = t => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + '.' + p2(d.getMilliseconds(), 3); };
    const sec = (t, fn) => { add(''); add('## ' + t); try { fn(); } catch (e) { add('(unavailable: ' + ((e && e.message) || e) + ')'); } };
    const u = s.usb, nv = navigator;
    add('# GP-200 Studio Web - diagnostic report');
    sec('App', () => {
      add('Version: ' + (B.build ? B.build.version + ' (build ' + B.build.iso + ')' : '?'));
      add('Report date: ' + new Date().toISOString());
      add('Page: ' + (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : location.protocol + ' (local page, address hidden)'));
      add('UI language: ' + s.lang + ' (browser: ' + nv.language + ')');
    });
    sec('Browser', () => {
      add('User agent: ' + nv.userAgent);
      add('Platform: ' + (nv.platform || '?') + ' | touch points: ' + (nv.maxTouchPoints || 0) + ' | viewport: ' + window.innerWidth + 'x' + window.innerHeight);
      add('Android mode: ' + (IS_ANDROID ? 'yes' : 'no'));
    });
    sec('AI', () => {
      add('Provider: ' + s.provider + ' | model: ' + curModel() + ' | web search: ' + (s.web ? 'on' : 'off'));
      add('API key set: ' + (curKey() ? 'yes' : 'no') + ' | no-AI mode: ' + (s.noAi ? 'yes' : 'no'));
    });
    sec('Pedal / Web MIDI', () => {
      add('Web MIDI supported: ' + (USB && USB.MidiLink.supported() ? 'yes' : 'no'));
      add('State: ' + u.state + ' | port in use: ' + (((u.ports || []).find(x => x.id === u.outId) || {}).name || '-'));
      if (u.link) { const p = u.link.ports(), f = a => a.map(x => (x.name || x.id) + (x.state ? ' [' + x.state + ']' : '')).join(' ; ') || '-'; add('Outputs: ' + f(p.outputs)); add('Inputs: ' + f(p.inputs)); }
      add('Live sync open: ' + (s.ed.live ? 'yes' : 'no') + ' | listening: ' + (s.listen.want ? 'on' : 'off') + ' | pedal patch: ' + (s.listen.pc === null ? '?' : s.listen.pc));
    });
    if (DIAG.last) sec('Last error', () => {
      const e = DIAG.last;
      add('When: ' + hms(e.t) + ' | where: ' + e.where);
      add('Type: ' + e.name + (e.status !== undefined ? ' | HTTP status: ' + e.status : '') + (e.kind ? ' | kind: ' + e.kind : '') + (e.code ? ' | code: ' + e.code : ''));
      add('Message: ' + e.message);
      if (e.url) add('URL: ' + String(e.url).replace(/[?#].*$/, ''));
      if (e.raw) { add('Raw response:'); add(String(e.raw).slice(0, 1500)); }
    });
    if (DIAG.seen.size) sec('Distinct errors (count)', () => { DIAG.seen.forEach(v => add(v.n + ' x [' + v.where + '] ' + v.msg)); });
    sec('Recent events (' + DIAG.ev.length + ')', () => { if (!DIAG.ev.length) add('-'); DIAG.ev.forEach(x => add('[' + hms(x.t) + '] ' + x.kind + ' ' + x.txt)); });
    sec('Last pedal messages', () => {
      const l = (s.listen.log || []).slice(-15);
      if (!l.length) add('-');
      l.forEach(x => add('[' + hms(x.t) + '] ' + x.kind + ' ' + (x.txt || '') + (x.hex ? ' | ' + x.hex : '')));
    });
    return redact(L.join('\n'));
  }
  function diagShow(manual) {
    DIAG.show = true; DIAG.manual = !!manual; DIAG.copied = '';
    if (!manual) DIAG.details = false;
    diagPaint();
  }
  function diagClose() { DIAG.show = false; diagPaint(); }
  async function diagCopy() {
    const txt = diagReport();
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; }
    catch (e) {
      try { const ta = h('textarea', { value: txt, 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' }); document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e2) { ok = false; }
    }
    DIAG.copied = ok ? 'ok' : 'ko';
    if (!ok) DIAG.details = true;
    diagPaint();
  }
  function diagPaint() {
    let el = DIAG.el;
    if (!DIAG.show) { if (el) el.remove(); DIAG.el = null; return; }
    if (!el) { el = h('div', { id: 'diag-panel' }); document.body.appendChild(el); DIAG.el = el; }
    const err = !DIAG.manual && !!DIAG.last;
    el.className = 'diag' + (err ? ' err' : '');
    el.setAttribute('role', err ? 'alert' : 'status');
    el.style.bottom = document.getElementById('render-error') ? '72px' : '';
    el.textContent = '';
    el.appendChild(h('header', null, h('b', { text: T(err ? 'diag_title' : 'diag_link') }),
      h('button', { type: 'button', class: 'x', id: 'diag-close', 'aria-label': T('diag_close'), title: T('diag_close'), onclick: diagClose }, '×')));
    el.appendChild(h('p', { class: 'help', text: T('diag_sub') }));
    const gh = (B.repo || '').replace(/\/$/, '');
    el.appendChild(h('div', { class: 'drow' },
      h('button', { type: 'button', class: 'btn small', id: 'diag-copy', onclick: diagCopy }, T('diag_copy')),
      h('button', { type: 'button', class: 'btn small ghost', id: 'diag-details', 'aria-expanded': String(DIAG.details), onclick: () => { DIAG.details = !DIAG.details; diagPaint(); } }, T(DIAG.details ? 'diag_hide' : 'diag_details')),
      gh ? h('a', { class: 'btn small ghost', id: 'diag-gh', href: gh + '/issues', target: '_blank', rel: 'noopener noreferrer' }, 'GitHub') : null,
      DIAG.copied ? h('span', { class: DIAG.copied === 'ok' ? 'dok' : 'dko', role: 'status', text: T(DIAG.copied === 'ok' ? 'diag_copied' : 'diag_copy_ko') }) : null));
    if (DIAG.details) el.appendChild(h('textarea', { class: 'dtext', id: 'diag-text', readonly: true, rows: '10', spellcheck: 'false', 'aria-label': T('diag_details'), value: diagReport() }));
  }
  function diagInit() {
    window.addEventListener('error', ev => {
      if (!ev || (!ev.error && !ev.message)) return;                                   // erreur de chargement d'une ressource : sans interet
      if (/ResizeObserver/i.test(String(ev.message || ''))) return;                    // bruit connu des navigateurs
      diagErr(ev.error || new Error(String(ev.message) + (ev.lineno ? ' @' + ev.lineno + ':' + ev.colno : '')), 'js');
    });
    window.addEventListener('unhandledrejection', ev => { if (ev) diagErr(ev.reason === undefined ? new Error('unhandled rejection') : ev.reason, 'promise'); });
    window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && DIAG.show && DIAG.el && DIAG.el.contains(document.activeElement)) diagClose(); });
    dg('app', 'start v' + (B.build ? B.build.version : '?'));
  }

  const provInfo = p => B.providers[p];
  const curModel = () => s.models[s.provider] || provInfo(s.provider).default_model;
  const curKey = () => String(s.keys[s.provider] || '').trim();

  // ------------------------------------------------------------- DOM helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'style') el.setAttribute('style', v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const svgLogo = () => {
    const d = document.createElement('div');
    d.innerHTML = '<svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#141414" stroke="#333a3f"/><rect x="5" y="9" width="22" height="14" rx="3" fill="none" stroke="#1a9fc7" stroke-width="2"/><circle cx="11" cy="16" r="2.4" fill="#3fc4e8"/><circle cx="21" cy="16" r="2.4" fill="#ff5a4a"/><path d="M13.6 16h4.8" stroke="#1a9fc7" stroke-width="1.6"/></svg>';
    return d.firstChild;
  };

  // --------------------------------------------------------- erreurs lisibles
  function friendly(e) {
    diagErr(e, 'api');
    if (e && e.message === 'aborted') return T('st_cancel');
    const m = String((e && e.message) || e);
    if (/^err_gen_failed/.test(m)) return T('e_gen_failed', m.split(':')[1] || '?');
    if (e instanceof G.ApiError) {
      if (e.credit) return T('e_credit');
      if (e.kind === 'network') return T('e_network');
      if (e.kind === 'timeout') return T('e_timeout');
      if (e.status === 401 || e.status === 403 || /api key|apikey|api_key|unauthor|invalid x-api|authentication/i.test(m)) return T('e_key') + '\n(' + m.slice(0, 200) + ')';
      if (e.status === 429) return T('e_quota');
      if (e.status === 404) return T('e_model') + '\n(' + m.slice(0, 200) + ')';
    }
    return T('e_generic', m.slice(0, 400));
  }

  // -------------------------------------------------------------- generation
  function logLine(line) {
    dg('gen', line);
    if (!s.run) return;
    s.run.log.push(line);
    const el = document.getElementById('logbox');
    if (el) paintLog(el);
  }
  function paintLog(el) {
    el.textContent = '';
    for (const l of (s.run ? s.run.log : [])) {
      const cls = /^\s*!/.test(l) ? (/erreur|error|illisible|unreadable|invalid|invalide/i.test(l) ? 'e' : 'w') : (/prêt|ready/.test(l) ? 'g' : '');
      el.appendChild(h('div', { class: cls, text: l }));
    }
    el.scrollTop = el.scrollHeight;
  }
  function setStatus(txt) {
    if (s.run) s.run.status = txt;
    const el = document.getElementById('status-text');
    if (el) el.textContent = txt;
  }

  /** Configuration IA + crochets partages par la generation et l'affinage. */
  function aiSetup(controller) {
    const cfg = {
      provider: s.provider, apiKey: curKey(), model: curModel(), webSearch: !!s.web && s.provider !== 'openrouter',
      maxRetries: 2, pickup: s.pickup, lang: s.lang, maxTokens: 16000,
    };
    dg('ai', 'request: provider=' + cfg.provider + ' model=' + cfg.model + ' web=' + cfg.webSearch + ' key=' + (cfg.apiKey ? 'set' : 'none'));
    const ctx = {
      signal: controller.signal, timeout: 240000,
      log: (kind, a, b) => {
        if (kind === 'tokens') logLine(T('l_tokens', a, b));
        else if (kind === 'truncated') logLine(T('l_trunc'));
        else if (kind === 'model_switch') logLine(T('l_switch', a));
        else if (kind === 'http') logLine(T('l_http', a, b));
      },
    };
    const hooks = {
      template, signal: controller.signal, now: new Date(),
      callApi: (c, system, msgs) => G.callApi(c, system, msgs, ctx),
      log: logLine,
      t: (k, ...a) => {
        if (k === 'log_api_attempt') { setStatus(a[0] > 1 ? T('st_fix') : T('st_wait')); return T('l_attempt', a[0]); }
        if (k === 'err_gen_failed') return 'err_gen_failed:' + a[0];
        const map = { log_light_catalog: 'l_light', log_json_cut: 'l_cut', log_unreadable: 'l_unreadable', log_style_ignored: 'l_style',
          log_errors_fix: 'l_fix', log_section: 'l_section', log_checksum_bad: 'l_checksum', log_warn: 'l_warn', log_written: 'l_written', log_variant_skip: 'l_skip',
          log_src_checksum: 'l_src_checksum', log_bullet: 'l_bullet', log_written2: 'l_written2' };
        return T(map[k] || k, ...a);
      },
    };
    return { cfg, hooks };
  }

  async function generate() {
    if (s.run && s.run.running) return;
    const demande = s.demande.trim();
    if (!demande) { s.notice = { kind: 'err', text: T('need_text') }; render(); focusId('demande'); return; }
    if (!curKey()) { s.notice = { kind: 'err', text: T('need_key') }; s.setupOpen = true; render(); focusId('apikey'); return; }
    const controller = new AbortController();
    s.run = { running: true, status: T('st_wait'), log: [], error: null, controller };
    s.notice = null; if (s.tab === 'log') s.tab = 'module';   // le journal est une fenetre : on ne l'ouvre pas de force pendant le calcul
    render();
    const ai = aiSetup(controller);
    let res = null;
    try {
      res = await G.generate(ai.cfg, tb, demande, B.prompts, ai.hooks, s.roles.length ? s.roles.slice() : null);
      if (!res.files.length) throw new Error('err_gen_failed:' + (ai.cfg.maxRetries + 1));
    } catch (e) {
      s.run.error = friendly(e);
      logLine('  ! ' + String((e && e.message) || e));
    }
    s.run.running = false;
    if (res && res.files.length) {
      const title = [res.payload.artiste, res.payload.titre].filter(x => x && String(x).trim()).join(' - ') || demande.slice(0, 40);
      addRes(res, 'gen', title);
      s.tab = 'module';
    }
    render();
  }

  function focusId(id) { setTimeout(() => { const e = document.getElementById(id); if (e) e.focus(); }, 0); }
  // ------------------------------------------------ bibliotheque de presets
  let libId = 0;
  const groupsOf = res => (res.payload.sections || []).map(sc => res.files.filter(f => f.section === sc));
  function addRes(res, kind, label, quiet) {
    res.id = ++libId; res.kind = kind; res.label = label || res.headline || '';
    s.lib.push(res);
    if (quiet) { if (!s.res) { s.res = res; s.sel = { si: 0, vi: 0, slot: s.sel.slot || 'AMP' }; } return; }   // lot a harmoniser : on range le fichier, sans toucher a l'affichage ni a la pedale
    s.res = res; s.sel = { si: 0, vi: 0, slot: s.sel.slot || 'AMP' }; s.fresh = true;
    scheduleInject();
  }
  function normSel() {
    const r = s.res;
    if (!r) return;
    const gs = groupsOf(r);
    if (!gs.length) return;
    if (s.sel.si >= gs.length || !gs[s.sel.si].length) s.sel.si = Math.max(0, gs.findIndex(g => g.length));
    if (s.sel.vi >= (gs[s.sel.si] || []).length) s.sel.vi = 0;
  }
  function curFile() {
    const r = s.res;
    if (!r) return null;
    normSel();
    const g = groupsOf(r)[s.sel.si] || [];
    return g[s.sel.vi] || r.files[0] || null;
  }
  function selectFile(res, si, vi) { s.res = res; s.sel.si = si; s.sel.vi = vi; s.fresh = true; render(); scheduleInject(); }
  function removeRes(res) {
    const i = s.lib.indexOf(res);
    if (i < 0 || (tuneActive() && s.res === res)) return;
    s.lib.splice(i, 1);
    if (s.res === res) { s.res = s.lib[Math.min(i, s.lib.length - 1)] || null; s.sel.si = 0; s.sel.vi = 0; scheduleInject(); }
    render();
  }

  // ------------------------------------------------- affiner / ouvrir un .prst
  /** Enveloppe un seul preset dans la meme structure qu'une generation (pour reutiliser rack, pedale, harmonisation). */
  function singleRes(filename, raw, decoded, spec, warnings, folder, headline) {
    const sec = { nom: T('ref_sec'), role: '', raison: '' };
    return {
      single: true, headline: headline || decoded.name || filename, folder: folder || 'preset',
      payload: { artiste: '', titre: '', sections: [sec], notes: '' },
      files: [{ section: sec, variant: { label: '', axe: '', ecoute: '' }, filename, folder: '', raw, spec: spec || G.plainSpec(G.decodedToSpec(decoded)),
        warnings: warnings || [], decoded }],
    };
  }

  /** Ouvre un ou plusieurs .prst (bouton, glisser-deposer) et les ajoute a la liste. */
  async function openFiles(list) {
    const arr = Array.from(list || []);
    if (!arr.length) return;
    let n = 0, badSum = false;
    const errs = [], added = [];
    const batch = s.tab === 'tune';          // ouverts depuis la fenetre Volume : ils rejoignent le lot, la fenetre reste ouverte, rien n'est envoye a la pedale
    for (const f of arr) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        if (buf.length !== G.FILE_SIZE) throw new Error(T('ref_size', buf.length));
        const dec = G.decodePrst(buf, tb);
        if (!dec.checksum.valid) badSum = true;
        const r1 = singleRes(f.name || 'preset.prst', buf, dec);
        addRes(r1, 'open', dec.name || f.name, batch);
        added.push(r1.files[0]);
        n++;
      } catch (e) { errs.push((f.name || '?') + ' : ' + T('ref_bad', String((e && e.message) || e))); }
    }
    if (n && batch) {
      const t = s.tune;
      if (!t.sel) t.sel = s.res ? s.res.files.slice() : [];
      added.forEach(x => { if (t.sel.indexOf(x) < 0) t.sel.push(x); });
      t.confirm = false; t.msg = errs.length ? { kind: 'err', text: errs.join('\n') } : null;
      s.notice = null; render(); return;
    }
    if (n) { s.mode = 'refine'; s.tab = 'module'; }
    if (errs.length) s.notice = { kind: 'err', text: errs.join('\n') };
    else if (badSum) s.notice = { kind: 'warn', text: T('ref_checksum') };
    else s.notice = { kind: 'ok', text: T('ref_opened', n) };
    render();
  }

  async function refineRun(live) {
    if (s.run && s.run.running) return;
    const file = curFile();
    if (!file) { s.notice = { kind: 'err', text: T('need_file') }; render(); return; }
    const instr = s.ref.instr.trim();
    if (!live && !instr) { s.notice = { kind: 'err', text: T('need_instr') }; render(); focusId('instr'); return; }
    if (!curKey()) { s.notice = { kind: 'err', text: T('need_key') }; s.setupOpen = true; render(); focusId('apikey'); return; }
    const controller = new AbortController();
    s.run = { running: true, status: T('st_wait'), log: [], error: null, controller };
    s.notice = null; if (s.tab === 'log') s.tab = 'module';   // le journal est une fenetre : on ne l'ouvre pas de force pendant le calcul
    render();
    const ai = aiSetup(controller);
    const src = { name: file.filename, raw: Uint8Array.from(file.raw) };
    const fromName = file.spec.name || file.filename;
    let out = null;
    try {
      out = await G.refine(ai.cfg, tb, src, instr, B.prompts, ai.hooks, live ? 'live' : 'refine');
    } catch (e) {
      s.run.error = friendly(e);
      logLine('  ! ' + String((e && e.message) || e));
    }
    s.run.running = false;
    if (out) {
      // l'encodeur remet la table CTRL et le patch volume a zero : on les recopie depuis le preset de depart
      const raw = G.carryOver(src.raw, out.raw);
      const decoded = G.decodePrst(raw, tb);
      const hadCtrl = G.readCtrl(src.raw).some(m => m.length) || src.raw[G.OFF_PATCH_VOL] !== out.raw[G.OFF_PATCH_VOL];
      const res = singleRes(out.filename, raw, decoded, out.spec, out.warnings, out.folder, (out.spec && out.spec.name) || out.filename);
      res.refine = { payload: out.payload, diff: out.diff, live: !!live, carried: hadCtrl, from: fromName };
      addRes(res, live ? 'live' : 'refine', res.headline);
      s.tab = 'result';
    }
    render();
  }

  function asList(x) { return Array.isArray(x) ? x.map(String) : (x ? [String(x)] : []); }

  // ---------------------------------------------------------------- telechargement
  function download(name, bytes, type) {
    const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  /** Zip de plusieurs presets (.prst + .json) ; les noms en double recoivent un suffixe. */
  function zipFiles(items, root) {
    const enc = new TextEncoder(), entries = [], used = new Set();
    for (const { f, res } of items) {
      let base = (f.folder ? f.folder + '/' : '') + f.filename.replace(/\.prst$/, ''), n = 1, cand = base;
      while (used.has(cand.toLowerCase())) cand = base + '_' + (++n);
      used.add(cand.toLowerCase());
      entries.push({ name: root + '/' + cand + '.prst', data: f.raw });
      entries.push({ name: root + '/' + cand + '.json', data: enc.encode(JSON.stringify(f.spec, null, 1)) });
    }
    download(root + '.zip', G.buildZip(entries, new Date()), 'application/zip');
  }
  function downloadAll() { zipFiles(s.res.files.map(f => ({ f, res: s.res })), s.res.folder); }
  function downloadTuned(r) {
    const d = new Date(), p2 = n => (n < 10 ? '0' : '') + n;
    zipFiles(r.items.map(i => ({ f: i.file, res: tuneResOf(i.file) })), 'harmonise_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()));
  }

  // ---------------------------------------------------------------- OpenRouter
  async function orLogin() {
    try {
      const p = await G.makePkce();
      try { sessionStorage.setItem(PKCE_KEY, p.verifier); } catch (e) { localStorage.setItem(PKCE_KEY, p.verifier); }
      location.href = G.openrouterAuthUrl(location.origin + location.pathname, p.challenge);
    } catch (e) { s.notice = { kind: 'err', text: T('or_ko', e.message) }; render(); }
  }
  async function orCallback() {
    const q = new URLSearchParams(location.search), code = q.get('code');
    if (!code) return;
    let verifier = null;
    try { verifier = sessionStorage.getItem(PKCE_KEY) || localStorage.getItem(PKCE_KEY); } catch (e) { /* rien */ }
    history.replaceState(null, '', location.pathname);
    if (!verifier) return;
    s.provider = 'openrouter'; s.setupOpen = true;
    s.notice = { kind: 'ok', text: T('or_wait') }; render();
    try {
      s.keys.openrouter = await G.openrouterExchange(code, verifier);
      s.notice = { kind: 'ok', text: T('or_ok') }; s.setupOpen = false; save();
    } catch (e) { s.notice = { kind: 'err', text: T('or_ko', friendly(e)) }; }
    try { sessionStorage.removeItem(PKCE_KEY); localStorage.removeItem(PKCE_KEY); } catch (e) { /* rien */ }
    render();
  }

  async function refreshModels() {
    s.modelMsg = T('refreshing'); paintModelMsg();
    const fallback = provInfo(s.provider).models;
    const list = await G.listModels({ provider: s.provider, apiKey: curKey(), maxTokens: 16000 }, fallback, { timeout: 20000 });
    const ok = list !== fallback && list.length;
    dg('models', s.provider + ': ' + (ok ? list.length + ' models' : 'list unavailable, built-in list used'));
    s.modelList[s.provider] = ok ? list : fallback;
    s.modelMsg = ok ? T('models_ok', list.length) : T('models_ko');
    render();
  }
  function paintModelMsg() { const e = document.getElementById('model-msg'); if (e) e.textContent = s.modelMsg; }

  // ------------------------------------------------------------------ rendu
  const TABS = ['module', 'result', 'pedal', 'ctrl', 'tune', 'setlist', 'log'];

  // ------------------------------------------------------------ info-bulles
  /** Pose un title sur tout controle ou indicateur qui n'en a pas encore (les title deja ecrits ne sont jamais remplaces). Textes : gp200tips.js. */
  function applyTips() {
    const U = k => TIPS.ui[s.lang][k] || '';
    const fmt = (t, ...a) => { let i = 0; return t.replace(/%s/g, () => a[i++]); };
    const set = (el, txt) => { if (el && txt && !el.getAttribute('title') && !el.closest('label[title]')) el.setAttribute('title', txt); };
    const all = (sel, fn) => document.querySelectorAll(sel).forEach(el => set(el, typeof fn === 'string' ? U(fn) : fn(el)));
    const ids = { 'mode-new': 'mode_new', 'mode-refine': 'mode_refine', 'open-prst': 'open_prst', demande: 'demande', instr: 'instr', go: 'go', 'go-refine': 'go_refine',
      'dl-all': 'dl_all', 'dl-one': 'dl_one', 'pop-close': 'pop_close', 'slot-close': 'pop_close', 'setup-close': 'setup_close', provider: 'provider', model: 'model', apikey: 'apikey',
      'setup-ok': 'setup_ok', 'setup-skip': 'setup_skip', 'ed-model': 'ed_model', 'ed-send': 'ed_send', 'ed-save': 'ed_save', 'ctrl-send': 'ctrl_send', 'pedal-connect': 'pedal_connect', 'pedal-port': 'pedal_port',
      'pedal-bank': 'pedal_bank', 'pedal-letter': 'pedal_letter', 'pedal-one': 'pedal_one', 'pedal-three': 'pedal_three', 'pedal-yes': 'pedal_yes', 'pd-log-copy': 'pd_log_copy',
      'pd-resend': 'pd_resend', 'inj-bank': 'inj_bank', 'inj-letter': 'inj_letter', 'inj-auto': 'inj_auto', 'listen-chk': 'listen_chk', 'inj-ok': 'inj_ok', 'tune-open': 'tune_open',
      'tune-pedal': 'tune_pedal', 'tune-audio': 'tune_audio', 'tune-audio-sel': 'tune_audio_sel', 'tune-audio-refresh': 'tune_audio_refresh', 'tune-bank': 'tune_bank',
      'tune-letter': 'tune_letter', 'tune-open-files': 'tune_open_files', 'tune-add-all': 'tune_add_all', 'tune-clear': 'tune_clear', 'tune-start': 'tune_start', 'tune-yes': 'tune_yes',
      'tune-zip': 'tune_zip', 't-pause': 't_pause', 't-resend': 't_resend', 't-prev': 't_prev', 't-next': 't_next', 't-keep': 't_keep', 't-stop': 't_stop', 't-gauge': 't_gauge',
      pickup: 'pickup', 'ref-loaded': 'ref_loaded', 't-cur': 'tune_row', 'tabbtn-result': 'tab_result', 'tabbtn-pedal': 'tab_pedal', 'tabbtn-ctrl': 'tab_ctrl', 'tabbtn-tune': 'tab_tune', 'tabbtn-setlist': 'tab_setlist',
      'tabbtn-log': 'tab_log' };
    for (const id in ids) set(document.getElementById(id), U(ids[id]));
    // pastille de la pedale (connectee : le titre existant donne le nom du port)
    const pc = document.getElementById('pedal-chip');
    if (pc && !pc.classList.contains('ok')) set(pc, U(s.usb.state === 'ready' ? 'pedal_chip_none' : 'pedal_chip_off'));
    all('.tb-right .seg button', el => U(el.textContent.trim() === 'FR' ? 'lang_fr' : 'lang_en'));
    all('.statusbar .x', 'notice_x'); all('.statusbar .sdot', 'sdot'); all('.tab .sdot', 'sdot_tab');
    // zone de demande / bibliotheque
    all('.ask-zone .chips .chip', el => U('example') + el.textContent.trim());
    all('.ask-zone .btn.stop', 'stop');
    all('.side-h .count', 'lib_count');
    all('.vfile', 'vfile'); all('.badge.warn', 'badge_warn');
    all('.lib-h .badge', el => { const t = el.textContent.trim(); const k = ['gen', 'open', 'refine', 'live', 'pedal'].find(x => T('kind_' + x) === t); return k ? U('kind_' + k) : ''; });
    all('.lib-row', el => { const vl = el.querySelector('.vl'); return vl ? fmt(U('lib_row_variant'), vl.textContent.trim()) : U('lib_row'); });
    // options de generation
    all('.opts > summary', 'opts');
    all('.opts .roles .chip', el => {
      const t = (el.firstChild ? el.firstChild.textContent : el.textContent).trim();
      if (t === T('auto')) return U('role_auto');
      const r = G.ROLES.find(x => T('role_' + x) === t);
      return r ? U('role_' + r) : '';
    });
    all('.opts label.check input', 'web');
    // rack : modules vides ou sans preset (les autres ont deja leur info-bulle)
    all('.rack .sbtn', el => { const li = el.closest('li'), nm = slotName(li ? li.getAttribute('data-slot') : ''); return fmt(U(el.disabled ? 'slot_off' : 'slot_empty'), nm); });
    // connexion a l'IA
    all('#setup-modal .btn.small.ghost', el => { const t = el.textContent.trim(); return t === T('refresh') ? U('refresh') : (t === T('show') || t === T('hide')) ? U('key_toggle') : ''; });
    all('#setup-modal a.btn', 'get_key'); all('#setup-modal .help a', 'key_link');
    all('#setup-modal .btn.go', el => el.id === 'setup-ok' ? '' : U('or_login'));
    all('#setup-modal label.check input', 'remember');
    // CTRL
    all('input[data-ctrl]', el => fmt(U('ctrl_cell'), el.getAttribute('data-ctrl'), slotName(el.getAttribute('data-mod'))));
    // pedale / harmonisation
    all('button', el => { const t = el.textContent.trim(); return t === T('cancel') ? U('cancel') : t === T('pedal_retry') ? U('pedal_retry') : ''; });
    all('#pd-log > summary', 'pd_log');
    all('.pstate', 'pstate'); all('.pled', 'pled');
    all('#tune-add > summary', 'tune_add_sum'); all('.tune-add', 'tune_add');
    all('.tlist select[data-file]', 'tune_type'); all('.tlist .tmv', 'tune_up_down');
    all('.meters .meter', 't_meter');
  }

  function render() {
    const app = document.getElementById('app');
    const q = sel => document.querySelector(sel);
    const keep = { y: window.scrollY, side: q('.side') ? q('.side').scrollTop : 0, mem: q('.mem-list') ? q('.mem-list').scrollTop : 0, tab: q('.popbody') ? q('.popbody').scrollTop : (q('.tabbody') ? q('.tabbody').scrollTop : 0), tabName: s.tab };
    normSel();
    document.documentElement.lang = s.lang;
    if (pedalFound() && !s.inj.set && !s.inj.asked) { s.inj.open = true; s.inj.asked = true; }   // 1re connexion : on demande le slot avant tout
    let shell, modal, pop, slotd;
    try {
      const mem = memPanel();
      shell = h('div', { class: 'shell' + (mem ? ' has-mem' : '') }, topbar(), askZone(), sidePanel(), mem, rackZone(), tabsZone(), statusbar());
      pop = popup();
      slotd = slotDialog();
      modal = setupModal();
    } catch (e) {
      // une erreur d'affichage ne doit jamais vider la page : on garde l'ecran actuel et on previent
      console.error(e);
      renderFail(e);
      return;
    }
    const rf = document.getElementById('render-error'); if (rf) rf.remove();
    app.textContent = '';
    app.appendChild(shell);
    if (pop) app.appendChild(pop);
    if (slotd) app.appendChild(slotd);
    if (modal) app.appendChild(modal);
    window.scrollTo(0, keep.y);
    if (q('.side')) q('.side').scrollTop = keep.side;
    if (q('.mem-list')) q('.mem-list').scrollTop = keep.mem;
    memScroll();
    if ((q('.popbody') || q('.tabbody')) && keep.tabName === s.tab) (q('.popbody') || q('.tabbody')).scrollTop = keep.tab;
    const lb = document.getElementById('logbox'); if (lb) paintLog(lb);
    paintTune();
    applyTips();
    if (s.fresh) { s.fresh = false; clearTimeout(render.t); render.t = setTimeout(() => { const r = document.querySelector('.rack.lit'); if (r) r.classList.remove('lit'); }, 1600); }
  }

  function renderFail(e) {
    diagErr(e, 'render');
    const old = document.getElementById('render-error'); if (old) old.remove();
    const box = h('div', { id: 'render-error', role: 'alert', class: 'render-error' },
      h('b', { text: T('render_err') }), ' ' + String((e && e.message) || e).slice(0, 200), ' ',
      h('button', { type: 'button', class: 'btn small', onclick: () => location.reload() }, T('reload')));
    document.body.appendChild(box);
  }

  function slotName(slot) { return SLOT_NAMES[s.lang][slot]; }
  const pedalFound = () => s.usb.state === 'ready' && !!s.usb.outId;

  // ---------------------------------------------------------- barre du haut
  function modeSwitch() {
    return h('div', { class: 'seg modes', role: 'group', 'aria-label': T('mode_label') },
      ['new', 'refine'].map(m => h('button', { type: 'button', id: 'mode-' + m, 'aria-pressed': String(s.mode === m),
        onclick: () => { if (s.mode !== m) { s.mode = m; s.notice = null; render(); } } }, T('mode_' + m))));
  }

  function topbar() {
    const u = s.usb, hasKey = !!curKey(), found = pedalFound();
    const cur = u.ports.find(x => x.id === u.outId);
    const dot = on => h('span', { class: 'sdot' + (on ? ' on' : '') });
    const ai = h('button', { type: 'button', class: 'chip-st' + (hasKey ? ' ok' : ''), id: 'ai-chip', title: T('change'),
      onclick: () => { s.setupOpen = true; render(); } }, dot(hasKey), hasKey ? PROV_NAME[s.provider] + ' · ' + curModel() : T('chip_ai_none'));
    let pedal;
    if (u.state === 'unsupported') pedal = h('span', { class: 'chip-st off', id: 'pedal-chip', title: T('pedal_unsupported') }, dot(false), 'USB ✕');
    else if (u.state !== 'ready') pedal = h('button', { type: 'button', class: 'chip-st', id: 'pedal-chip', disabled: u.state === 'asking', onclick: pedalConnect }, dot(false), u.state === 'asking' ? T('pedal_asking') : T('chip_pedal_off'));
    else if (found) pedal = h('button', { type: 'button', class: 'chip-st ok', id: 'pedal-chip', title: cur ? cur.name : '', onclick: () => { s.tab = 'pedal'; render(); } }, dot(true), 'GP-200');
    else pedal = h('button', { type: 'button', class: 'chip-st', id: 'pedal-chip', onclick: () => { pedalRefresh(); render(); } }, dot(false), T('chip_pedal_none'));
    const slotChip = found ? h('button', { type: 'button', class: 'chip-st' + (s.inj.set ? ' ok' : ''), id: 'slot-chip', title: T('inj_slot_tip'), 'aria-haspopup': 'dialog',
      onclick: () => { s.inj.open = true; render(); } }, s.inj.set ? T('inj_slot_btn', injName()) : T('inj_slot_choose')) : null;
    const live = found ? h('label', { class: 'switch', title: T('chip_live_tip') },
      h('input', { type: 'checkbox', id: 'live-switch', checked: s.ed.want, onchange: e => { s.ed.want = e.target.checked; save(); if (!s.ed.want) liveStop(); render(); } }),
      h('span', { class: 'sw' }), T('chip_live')) : null;
    return h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, svgLogo(), h('h1', null, 'GP-200 Studio Web')),
      modeSwitch(),
      h('button', { type: 'button', class: 'btn small', id: 'open-prst', onclick: () => document.getElementById('prst-file').click() }, T('open_prst')),
      h('button', { type: 'button', class: 'btn small', id: 'batch-btn', title: T('batch_btn_tip'), 'aria-haspopup': 'dialog',
        onclick: () => { s.tab = 'tune'; if (!tuneActive() && (!s.tune.open || !s.lib.length)) tuneOpenForm(); render(); } }, T('batch_btn')),
      h('div', { class: 'tb-right' }, ai, pedal, slotChip, live,
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Langue / Language' },
          ['fr', 'en'].map(l => h('button', { type: 'button', 'aria-pressed': String(s.lang === l), onclick: () => { s.lang = l; save(); render(); } }, l.toUpperCase())))));
  }

  // ----------------------------------------------------------- zone de demande
  function askZone() {
    const running = !!(s.run && s.run.running), refine = s.mode === 'refine';
    const file = curFile();
    const id = refine ? 'instr' : 'demande';
    const go = refine ? () => refineRun(false) : generate;
    const ta = h('textarea', { id, rows: '2', placeholder: refine ? T('ref_ph') : T('sound_ph'), 'aria-label': refine ? T('refine_title') : T('s2'),
      disabled: running || (refine && !file),
      oninput: e => { if (refine) s.ref.instr = e.target.value; else s.demande = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } } });
    ta.value = refine ? s.ref.instr : s.demande;
    const exs = refine ? D[s.lang].exa : B.examples[s.lang].slice(0, 6);
    const box = h('section', { class: 'ask-zone zone', 'aria-labelledby': 'h-ask' });
    box.appendChild(h('div', { class: 'ask-head' },
      h('h2', { id: 'h-ask', text: refine ? T('refine_title') : T('s2') }),
      h('span', { class: 'sub', text: refine ? T('refine_sub') : T('s2_sub') })));
    if (refine) {
      box.appendChild(file
        ? h('p', { class: 'target', id: 'ref-loaded' }, h('b', { text: T('ref_target', file.spec.name || file.filename) }), h('span', { class: 'vfile', text: ' · ' + file.filename }),
            !file.decoded.checksum.valid ? h('span', { class: 'badge warn', text: T('res_chk') + ' : ' + T('res_chk_ko') }) : null)
        : h('p', { class: 'target none', id: 'ref-loaded', text: T('ref_target_none') }));
    }
    box.appendChild(ta);
    box.appendChild(h('div', { class: 'chips scrollx', role: 'group', 'aria-label': T('examples') },
      exs.map(ex => h('button', { type: 'button', class: 'chip', disabled: running || (refine && !file), onclick: () => { if (refine) s.ref.instr = ex; else s.demande = ex; ta.value = ex; ta.focus(); } }, ex))));
    box.appendChild(h('div', { class: 'actions' },
      running ? h('button', { type: 'button', class: 'btn stop', onclick: () => { s.run.controller.abort(); setStatus(T('st_cancel')); } }, T('stop'))
        : refine ? [h('button', { type: 'button', class: 'btn go', id: 'go-refine', onclick: () => refineRun(false) }, T('go_refine')),
                    h('button', { type: 'button', class: 'btn', id: 'go-live', title: T('live_hint'), onclick: () => refineRun(true) }, T('go_live')),
                    h('span', { class: 'help hint-inline', text: T('live_hint') })]
                 : h('button', { type: 'button', class: 'btn go', id: 'go', onclick: generate }, T('go'))));
    if (s.run && s.run.error) box.appendChild(h('p', { class: 'note err', role: 'alert', text: s.run.error, style: 'white-space:pre-line' }));
    return box;
  }

  // ------------------------------------------------------- colonne de gauche
  const KIND_BADGE = { gen: 'kind_gen', open: 'kind_open', refine: 'kind_refine', live: 'kind_live', pedal: 'kind_pedal' };
  function presetList() {
    if (!s.lib.length) return h('p', { class: 'help', id: 'lib-empty', text: T('lib_empty') });
    return h('div', { class: 'lib' }, s.lib.map(res => {
      const gs = groupsOf(res), cur = res === s.res;
      const rows = [];
      gs.forEach((g, si) => {
        if (!res.single && g.length) rows.push(h('div', { class: 'lib-sec', text: (si + 1) + '. ' + ((res.payload.sections[si] || {}).nom || '?') + ((res.payload.sections[si] || {}).role ? ' · ' + res.payload.sections[si].role : '') }));
        g.forEach((f, vi) => {
          const on = cur && s.sel.si === si && s.sel.vi === vi;
          const kept = slKept(f), kname = f.spec.name || f.filename;
          rows.push(h('div', { class: 'lib-line' },
            h('button', { type: 'button', class: 'lib-row' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-file': f.filename, onclick: () => selectFile(res, si, vi) },
              res.single ? null : h('span', { class: 'vl', text: f.variant.label || 'ABC'[vi] }),
              h('span', { class: 'ln', text: f.spec.name || f.filename }),
              f.tuned ? h('span', { class: 'badge ok', title: T('tuned_badge', f.tuned.lufs.toFixed(1), f.tuned.patch, f.tuned.amp === null ? '–' : Math.round(f.tuned.amp)), text: '✓' }) : null),
            h('button', { type: 'button', class: 'keep' + (kept ? ' on' : ''), 'aria-pressed': String(kept), 'data-file': f.filename, title: T(kept ? 'sl_unkeep' : 'sl_keep', kname),
              'aria-label': T(kept ? 'sl_unkeep' : 'sl_keep', kname), onclick: () => slToggle(f) }, kept ? '♥' : '♡')));
        });
      });
      return h('div', { class: 'lib-entry' + (cur ? ' cur' : '') },
        h('div', { class: 'lib-h' }, h('b', { text: res.label || res.headline }), h('span', { class: 'badge', text: T(KIND_BADGE[res.kind] || 'kind_open') }),
          h('button', { type: 'button', class: 'x', 'aria-label': T('lib_remove'), title: T('lib_remove'), onclick: () => removeRes(res) }, '×')),
        rows);
    }));
  }

  function genOptions() {
    const running = !!(s.run && s.run.running), webOk = s.provider !== 'openrouter';
    const roleBtns = G.ROLES.map(r => {
      const i = s.roles.indexOf(r);
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i >= 0), onclick: () => { if (i >= 0) s.roles.splice(i, 1); else if (s.roles.length < 4) s.roles.push(r); render(); } },
        T('role_' + r), i >= 0 ? h('span', { class: 'order', text: ' ' + (i + 1) }) : null);
    });
    return h('details', { class: 'opts', open: s.mode === 'new' },
      h('summary', { text: T('opts_title') }),
      h('div', { class: 'optbody' },
        h('div', null, h('div', { class: 'f', style: 'font-size:14px;color:var(--ink-dim);margin-bottom:6px', text: T('structure') }),
          h('div', { class: 'roles' }, h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!s.roles.length), onclick: () => { s.roles = []; render(); } }, T('auto')), roleBtns),
          h('p', { class: 'help', style: 'margin-top:6px', text: s.roles.length ? T('structure_forced', s.roles.map(r => T('role_' + r)).join(' → ')) : T('structure_auto') })),
        h('label', { class: 'f' }, T('pickup'), h('select', { id: 'pickup', disabled: running, onchange: e => { s.pickup = e.target.value; save(); } },
          ['auto', 'humbucker', 'single', 'p90', 'active'].map(k => h('option', { value: k, selected: s.pickup === k }, T('pk_' + k))))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.web && webOk, disabled: !webOk, onchange: e => { s.web = e.target.checked; } }),
          T('web') + (webOk ? '' : ' ' + T('web_na')))));
  }

  function sidePanel() {
    return h('aside', { class: 'side zone', 'aria-label': T('lib_title') },
      h('div', { class: 'side-h' }, h('h2', { text: T('lib_title') }), s.lib.length ? h('span', { class: 'count', text: String(s.lib.length) }) : null),
      presetList(), genOptions());
  }

  // ------------------------------------------------------------------- rack
  function rackZone() {
    const running = !!(s.run && s.run.running), res = s.res, file = curFile();
    const dec = file ? file.decoded : null;
    const order = dec && dec.chain_order ? dec.chain_order : G.MODULES.map((_, i) => i);
    const zone = h('section', { class: 'rack-wrap rack-zone', id: 'rack-panel', 'aria-label': T('rack') });
    zone.appendChild(h('div', { class: 'rack-head' },
      h('h2', { text: file ? (file.spec.name || file.filename) : T('rack') }),
      file ? h('span', { class: 'vfile', text: file.filename }) : null,
      file && file.tuned ? h('span', { class: 'badge ok', text: T('tuned_badge', file.tuned.lufs.toFixed(1), file.tuned.patch, file.tuned.amp === null ? '–' : Math.round(file.tuned.amp)) }) : null,
      h('div', { class: 'btns' },
        res && !res.single && res.files.length > 1 ? h('button', { type: 'button', class: 'btn small', id: 'dl-all', onclick: downloadAll }, T('download_all')) : null,
        file && pedalFound() ? injectBtns(file) : null,
        file ? h('button', { type: 'button', class: 'btn small', id: 'dl-one', onclick: () => download(file.filename, file.raw) }, T('download')) : null)));
    const ij = file && pedalFound() ? injectPanel(file) : null;
    if (ij) zone.appendChild(ij);
    if (file) zone.appendChild(patchVolBlock(file));
    const rack = h('ol', { class: 'rack' + (running ? ' scan' : '') + (s.fresh && res ? ' lit' : '') });
    order.forEach((mi, pos) => {
      const slot = G.MODULES[mi], e = dec ? dec.modules[slot] : null;
      const has = !!(e && e.model), on = has && e.on;
      rack.appendChild(h('li', { class: 'slot' + (on ? ' on' : '') + (has && !on ? ' off' : '') + (has ? '' : ' empty') + (dec ? ' fresh' : ''), 'data-fam': FAMILY[slot], 'data-slot': slot, style: '--i:' + pos },
        h('button', { type: 'button', class: 'sbtn', disabled: !dec, 'aria-pressed': String(!!dec && s.sel.slot === slot),
          'aria-label': slotName(slot) + ' : ' + (has ? e.model + ' (' + (on ? T('active') : T('bypass')) + ')' : T('empty_slot')),
          title: has ? (s.armed && s.armed.slot === slot && s.armed.file === file ? (on ? T('slot_tip_on') : T('slot_tip_off')) : T('slot_tip')) : '',
          onclick: () => {
            // focus : 1er clic = on va sur le module ; clic suivant (module deja au focus) = on l'active / on le coupe
            if (has && file && s.armed && s.armed.slot === slot && s.armed.file === file) { s.fresh = false; edOn(file, slot, !on); return; }
            s.sel.slot = slot; s.fresh = false; s.tab = 'module'; s.armed = file ? { slot, file } : null; render(); } },
          h('span', { class: 'ledgap' }, running && !has ? h('span', { class: 'led', 'aria-hidden': 'true' }) : null), h('span', { class: 'abbr', text: slot }), h('span', { class: 'kind', text: slotName(slot) }),
          h('span', { class: 'mname', text: has ? e.model : (running ? '' : '–') })),
        has ? h('button', { type: 'button', class: 'ledbtn', 'aria-pressed': String(on), title: on ? T('bypass_it') : T('activate_it'),
          'aria-label': (on ? T('bypass_it') : T('activate_it')) + ' : ' + slotName(slot), onclick: () => edOn(file, slot, !on) }, h('span', { class: 'led' })) : null));
    });
    rack.addEventListener('keydown', ev => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      const btns = Array.from(rack.querySelectorAll('.sbtn:not(:disabled)')), i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      ev.preventDefault();
      const j = clampN(i + (ev.key === 'ArrowRight' ? 1 : -1), 0, btns.length - 1);
      if (j === i) return;
      btns[j].click();
      setTimeout(() => { const nb = document.querySelectorAll('.sbtn:not(:disabled)')[j]; if (nb) nb.focus(); }, 0);
    });
    zone.appendChild(rack);
    return zone;
  }

  // ----------------------------------------------------------------- onglets
  function tabsZone() {
    const file = curFile(), hasLog = !!(s.run && s.run.log.length);
    if (s.tab === 'log' && !hasLog) s.tab = 'module';
    const running = !!(s.run && s.run.running), tuning = tuneActive();
    const names = TABS.filter(t => t !== 'module' && (t !== 'log' || hasLog));
    const bar = h('div', { class: 'tabbar', role: 'toolbar' }, names.map(t => h('button', { type: 'button', class: 'tab', id: 'tabbtn-' + t, 'aria-haspopup': 'dialog', 'aria-expanded': String(s.tab === t),
      onclick: () => { s.tab = t; if (t === 'tune' && !s.lib.length && !tuneActive()) tuneOpenForm(); render(); } }, T('tab_' + t) + (t === 'setlist' && slItems().length ? ' (' + slItems().length + ')' : ''), (t === 'log' && running) || (t === 'tune' && tuning) ? h('span', { class: 'sdot on run' }) : null)));
    const body = h('div', { class: 'tabbody', id: 'tab-module' });
    body.appendChild(file ? moduleTab(file) : welcome());
    return h('section', { class: 'tabs-zone zone', 'aria-label': 'Détails' }, bar, body);
  }

  /** Fenetre flottante (Resultat, Pedale, CTRL, Volume, Journal) : meme contenu qu'avant, ouverte par s.tab. */
  function popup() {
    const tab = s.tab;
    if (!tab || tab === 'module') return null;
    const file = curFile();
    const close = () => { s.tab = 'module'; render(); };
    const body = h('div', { class: 'tabbody popbody', role: 'document', id: 'tab-' + tab });
    if (tab === 'log') body.appendChild(h('div', { class: 'logbox', id: 'logbox' }));
    else if (tab === 'pedal') body.appendChild(pedalBlock(s.res ? (groupsOf(s.res)[s.sel.si] || []) : []));
    else if (tab === 'tune') body.appendChild(tunePanel());
    else if (tab === 'setlist') body.appendChild(setlistPanel());
    else if (!file) body.appendChild(welcome());
    else if (tab === 'result') body.appendChild(resultTab(file));
    else if (tab === 'ctrl') body.appendChild(ctrlTab(file));
    else return null;
    return h('div', { class: 'modal-veil pop-veil', id: 'pop', onclick: e => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pop-title' },
        h('header', { class: 'pop-head' }, h('h2', { id: 'pop-title', text: T('tab_' + tab) }),
          h('button', { type: 'button', class: 'btn small ghost x-close', id: 'pop-close', 'aria-label': T('pop_close'), onclick: close }, '✕')),
        body));
  }

  function welcome() {
    return h('div', { class: 'welcome', id: 'welcome' }, h('h3', { text: T('w_title') }), h('ul', null, D[s.lang].w_items.map(x => h('li', { text: x }))));
  }

  // ------------------------------------------------------------------ resultat
  function resultTab(file) {
    const res = s.res, box = h('div', { class: 'result', id: 'refine-result' });
    const rf = res.refine;
    if (rf) {
      const pl = rf.payload || {}, claimed = asList(pl.changements), warn = String(pl.avertissements || '').trim();
      box.appendChild(h('h3', { text: (rf.live ? T('r_live') : T('r_title')) + ' · ' + T('r_count', rf.diff.length) }));
      box.appendChild(h('p', { class: 'help', text: T('res_from', rf.from) }));
      if (pl.analyse) box.appendChild(h('div', null, h('h4', { text: T('r_analysis') }), h('p', { class: 'analysis', text: String(pl.analyse) })));
      box.appendChild(h('div', null, h('h4', null, T('r_real'), h('small', { class: 'sub2', text: ' ' + T('r_real_sub') })),
        rf.diff.length ? h('ul', { class: 'diff', id: 'diff-list' }, rf.diff.map(d => h('li', { text: d })))
                       : h('p', { class: 'note', id: 'diff-none', text: T('r_none') })));
      if (claimed.length) box.appendChild(h('div', null, h('h4', { text: T('r_claimed') }), h('ul', { class: 'claimed' }, claimed.map(c => h('li', { text: c })))));
      if (warn) box.appendChild(h('div', null, h('h4', { text: T('r_warn') }), h('p', { class: 'note', text: warn })));
      if (rf.carried) box.appendChild(h('p', { class: 'help', text: T('r_carried') }));
    } else if (res.kind === 'gen') {
      const gs = groupsOf(res), sec = res.payload.sections[s.sel.si] || {}, v = file.variant, pl = res.payload;
      box.appendChild(h('h3', { text: (sec.nom || '?') + (sec.role ? ' · ' + sec.role : '') }));
      if (sec.raison) box.appendChild(h('p', { class: 'why', text: sec.raison }));
      if (v.axe || v.ecoute) box.appendChild(h('dl', { class: 'kv' },
        v.axe ? [h('dt', { text: T('angle') }), h('dd', { text: v.axe })] : null,
        v.ecoute ? [h('dt', { text: T('listen') }), h('dd', { text: v.ecoute })] : null));
      if (pl.recherche || pl.structure || pl.notes) box.appendChild(h('div', { class: 'more-info' },
        pl.recherche ? h('p', null, h('b', { text: T('rig') + ' : ' }), String(pl.recherche)) : null,
        pl.structure ? h('p', null, h('b', { text: T('structure_l') + ' : ' }), String(pl.structure)) : null,
        pl.notes ? h('p', null, h('b', { text: T('notes') + ' : ' }), String(pl.notes)) : null));
      void gs;
    } else {
      const d = file.decoded, ctrl = G.readCtrl(file.raw).map((m, i) => m.length ? 'CTRL' + (i + 1) + '=' + m.join('+') : null).filter(Boolean).join(', ');
      box.appendChild(h('h3', { text: T('res_open') }));
      box.appendChild(h('dl', { class: 'kv' },
        h('dt', { text: T('res_author') }), h('dd', { text: d.author || '–' }),
        h('dt', { text: T('res_desc') }), h('dd', { text: d.description || '–' }),
        h('dt', { text: T('res_chain') }), h('dd', { text: d.chain_readable ? d.chain_readable.join(' → ') : '–' }),
        h('dt', { text: T('res_vol') }), h('dd', { text: String(d.patch_vol) }),
        h('dt', { text: T('res_ctrl') }), h('dd', { text: ctrl || T('ctrl_none') }),
        h('dt', { text: T('res_chk') }), h('dd', { text: d.checksum.valid ? T('res_chk_ok') : T('res_chk_ko') })));
      box.appendChild(h('p', { class: 'help', text: T('ref_now') }));
    }
    if (file.warnings && file.warnings.length) box.appendChild(h('ul', { class: 'warns' }, file.warnings.map(w => h('li', { text: w }))));
    return box;
  }

  // ------------------------------------------------------------ pedales CTRL
  function ctrlTab(file) {
    const cur = G.readCtrl(file.raw), u = s.usb;
    const sum = () => cur.map((m, i) => m.length ? 'CTRL' + (i + 1) + '=' + m.join('+') : null).filter(Boolean).join(', ') || T('ctrl_none');
    const sumEl = h('p', { class: 'ctrl-sum', id: 'ctrl-sum', text: sum() });
    const head = h('tr', null, h('th', null), G.MODULES.map(m => h('th', { class: 'mh', title: slotName(m), text: m })));
    const rows = cur.map((mods, n) => h('tr', null, h('th', { scope: 'row', text: 'CTRL ' + (n + 1) }),
      G.MODULES.map(m => h('td', null, h('input', { type: 'checkbox', 'aria-label': 'CTRL ' + (n + 1) + ' · ' + slotName(m), 'data-ctrl': String(n + 1), 'data-mod': m, checked: mods.indexOf(m) >= 0,
        onchange: e => ctrlToggle(file, n, m, e.target.checked, cur, sumEl, sum) })))));
    return h('div', { class: 'ctrl', id: 'ctrl-panel' },
      h('p', { class: 'help', text: T('ctrl_help') }),
      h('div', { class: 'scrollx' }, h('table', { class: 'ctrl-grid', id: 'ctrl-grid' }, h('thead', null, head), h('tbody', null, rows))),
      sumEl,
      h('p', { class: 'help', text: T('ctrl_auto') }), h('p', { class: 'help', text: T('ctrl_hint') }),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn small', id: 'ctrl-send', onclick: () => { s.tab = 'pedal'; if (pedalFound()) { u.confirm = 'one'; u.result = null; } render(); } }, T('ctrl_send'))));
  }
  function ctrlToggle(file, n, m, on, cur, sumEl, sum) {
    const set = new Set(cur[n]);
    if (on) set.add(m); else set.delete(m);
    cur[n] = G.MODULES.filter(x => set.has(x));
    const spec = {}; cur.forEach((mods, i) => { spec[i + 1] = mods; });
    try {
      file.raw = G.setCtrl(file.raw, spec);
      file.decoded = G.decodePrst(file.raw, tb);
      file.spec = Object.assign({}, file.spec, { ctrl: file.decoded.ctrl });
    } catch (e) { s.notice = { kind: 'err', text: T('e_generic', String((e && e.message) || e)) }; render(); return; }
    sumEl.textContent = sum();
  }

  // ------------------------------------------------- reglage d'un module (direct)
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const linkReady = () => pedalFound() && s.ed.want && !s.usb.sending && !tuneActive();      // on peut tenir le port ouvert
  const liveReady = () => linkReady() && !patchMismatch();                                    // on peut envoyer des reglages (la pedale est sur le patch affiche)

  async function liveStop() {
    const ed = s.ed;
    clearTimeout(ed.timer); ed.timer = null; clearTimeout(ed.idle); ed.idle = null; ed.pending = new Map();
    for (const tm of ed.tails.values()) clearTimeout(tm);
    ed.tails = new Map();
    ed.sync = { file: null, set: new Set() }; ed.pm = new Map();   // la pedale a pu changer de preset entre-temps : on ne suppose plus rien d'elle
    if (!ed.live) return;
    ed.live = false;
    try { if (s.usb.link) await s.usb.link.close(); } catch (e) { /* rien */ }
  }
  /** Ouvre la liaison a la demande (au premier reglage) ; elle se referme apres 15 s d'inactivite pour laisser la pedale a l'editeur Valeton. */
  async function liveEnsure() {
    const ed = s.ed, u = s.usb;
    if (ed.live) return true;
    if (!linkReady()) return false;
    if (ed.opening) return ed.opening;
    ed.opening = (async () => {
      try { u.link.select(u.outId); await u.link.open(); ed.live = true; ed.err = ''; await sleep(IS_ANDROID ? 700 : 300); return true; }   // 300 ms : le temps que le port soit pret avant la 1re trame
      catch (e) { ed.err = T('ed_live_ko', usbErr(e)); render(); return false; }
      finally { ed.opening = null; }
    })();
    return ed.opening;
  }
  function liveTouch() {
    const ed = s.ed;
    clearTimeout(ed.idle);
    if (s.listen.want) return;      // a l'ecoute : le port reste ouvert (decocher l'ecoute pour le rendre a l'editeur Valeton)
    ed.idle = setTimeout(() => { if (!ed.busy && !(ed.pending && ed.pending.size)) liveStop(); else liveTouch(); }, 15000);
  }
  function liveFail(e) {
    liveStop();
    s.ed.err = T('ed_live_ko', usbErr(e)); s.ed.msg = '';
    render();
  }
  // Un numero de parametre n'a de sens que pour le modele charge dans le module : avant le premier reglage d'un module, on envoie donc
  // le module complet (effect change + valeurs), comme le fait la version Windows, pour que la pedale soit sur le meme modele que l'ecran.
  // « synchronise » = la pedale a, pour ce module, le modele ET les valeurs de CE fichier (le dernier envoye).
  const isSynced = (file, slot) => s.ed.sync.file === file && s.ed.sync.set.has(slot);
  function markSynced(file, slot) { const sy = s.ed.sync; if (sy.file !== file) { sy.file = file; sy.set = new Set(); } sy.set.add(slot); }
  function unsync(file, slot) { const sy = s.ed.sync; if (sy.file === file) sy.set.delete(slot); }
  const modKey = e => e.model_id + ',' + e.category;     // modele que la pedale est censee avoir dans un module (connu seulement apres un de nos envois)
  const PGAP = IS_ANDROID ? 45 : 30;                                       // ms entre deux trames de parametres (la pedale en avale en dessous de ~19 ms)
  function dropPending(file, slot) {
    const ed = s.ed;
    if (!ed.pending) return;
    for (const [k, v] of Array.from(ed.pending)) if (v.meta && v.meta.file === file && v.meta.slot === slot) ed.pending.delete(k);
  }
  /** Envoi limite a 1 trame / 40 ms (le pedalier avale les trames trop rapprochees) ; la derniere valeur de chaque reglage gagne. */
  function liveQueue(key, fn, meta) {
    const ed = s.ed;
    if (patchMismatch() || (!ed.live && !liveReady())) return;
    if (!ed.pending) ed.pending = new Map();
    ed.pending.set(key, { fn, meta });
    if (ed.timer) return;
    const run = async () => {
      ed.timer = null;
      if (!ed.pending || !ed.pending.size) return;
      if (ed.busy) { ed.timer = setTimeout(run, 60); return; }
      if (!ed.live && !(await liveEnsure())) { ed.pending = new Map(); return; }
      if (!ed.pending || !ed.pending.size) return;           // une injection a pu vider la file pendant l'ouverture de la liaison
      const first = ed.pending.keys().next().value, it = ed.pending.get(first);
      ed.pending.delete(first);
      ed.last = Date.now();
      if (it.meta && !it.meta.vol && !isSynced(it.meta.file, it.meta.slot)) {
        // premier reglage de ce module : on envoie le module entier (les valeurs a jour, dont ce reglage, y sont deja)
        dropPending(it.meta.file, it.meta.slot);
        await liveSendModule(it.meta.file, it.meta.slot, false, true);
        if (ed.pending.size && !ed.timer) ed.timer = setTimeout(run, 40);
        return;
      }
      try { it.fn(); } catch (e) { liveFail(e); return; }
      liveTouch();
      tailArm(first, it);
      if (ed.pending.size) ed.timer = setTimeout(run, 40);
    };
    ed.timer = setTimeout(run, Math.max(0, ed.last + 40 - Date.now()));
  }

  /** Renvoie la derniere valeur d'un reglage 180 ms apres le dernier mouvement : la pedale avale parfois une trame (surtout le Time
   *  d'un delay, qui realloue sa ligne a retard) et la derniere valeur est la seule qui compte. Sans effet si le module a change entre-temps. */
  function tailArm(key, it) {
    const ed = s.ed;
    if (!it.meta || (!it.meta.mk && !it.meta.vol)) return;
    clearTimeout(ed.tails.get(key));
    ed.tails.set(key, setTimeout(function fire() {
      ed.tails.delete(key);
      const m = it.meta, e = m.vol ? null : m.file.decoded.modules[m.slot];
      if (!ed.live || ed.busy || (ed.pending && ed.pending.has(key)) || (!m.vol && (!e || modKey(e) !== m.mk || !isSynced(m.file, m.slot)))) return;
      if (Date.now() - ed.last < 25) { ed.tails.set(key, setTimeout(fire, 40)); return; }
      ed.last = Date.now();
      try { it.fn(); liveTouch(); } catch (err) { /* liaison deja fermee : rien a renvoyer */ }
    }, 180));
  }

  function edParam(file, slot, p, v) {
    const k = G.MODULES.indexOf(slot);
    G.patchParam(file.raw, k, p.slot, v);
    const m = file.decoded.modules[slot];
    if (m && m.params) m.params[p.name] = v;
    const sm = file.spec && file.spec.modules && file.spec.modules[slot];
    if (sm && sm.params) sm.params[p.name] = v;
    liveQueue(slot + '/' + p.name, () => s.usb.link.sendParam(k, p.slot, v, file.raw), { file, slot, mk: m && m.model ? modKey(m) : '' });
  }
  /** Volume du patch (0-100) : ecrit dans le fichier affiche (octet 0x38 + checksum, sur place) puis envoye en direct (12/10), derniere valeur renvoyee apres 180 ms. */
  function edPatchVol(file, v) {
    v = Math.round(clampN(Number(v), 0, 100));
    if (file.raw[G.OFF_PATCH_VOL] !== v) file.raw.set(G.applyPatchVol(file.raw, v)[0]);
    file.decoded.patch_vol = v;
    liveQueue('patchvol', () => { s.ed.vsent = Date.now(); s.usb.link.sendPatchVol(v); }, { file, vol: true });
  }
  async function edOn(file, slot, active) {
    const k = G.MODULES.indexOf(slot);
    G.patchOn(file.raw, k, active);
    if (file.decoded.modules[slot]) file.decoded.modules[slot].on = active;
    const sm = file.spec && file.spec.modules && file.spec.modules[slot];
    if (sm) sm.on = active;
    render();
    if (!patchMismatch() && (liveReady() || s.ed.live)) {
      if (active && !isSynced(file, slot) && file.decoded.modules[slot] && file.decoded.modules[slot].model) { await liveSendModule(file, slot, false, true); if (!s.ed.live) return; }
      if (await liveEnsure()) { try { s.ed.bsent.set(k, Date.now()); s.usb.link.sendBypass(k, active); liveTouch(); } catch (e) { liveFail(e); } }
    }
  }
  /** Change le modele a l'ecran / dans le fichier, puis (si la pedale est la) l'applique en direct. */
  async function edModel(file, slot, idx) {
    const ed = s.ed;
    if (ed.busy) return;
    const pick = tb.modelsForSlot(slot)[idx];
    if (!pick) return;
    const m = pick[0], cat = pick[1], mid = cat === 10 ? m.model_id : m.id, name = m.name;
    const k = G.MODULES.indexOf(slot), cur = file.decoded.modules[slot];
    const old = (cur && cur.params) || {}, params = {};
    for (const p of tb.paramsOf(mid, cat)) if (p.slot < G.N_SLOTS) params[p.name] = Object.prototype.hasOwnProperty.call(old, p.name) ? old[p.name] : p.default;
    ed.err = ''; ed.msg = '';
    try {
      const spec = G.plainSpec(G.decodedToSpec(file.decoded));
      spec.modules[slot] = { model: name, on: cur ? cur.on : true, params };
      const enc = G.encodePrst(spec, tb, template);
      G.replaceRecord(file.raw, enc.raw, k);        // seul ce module change : les autres restent identiques au bit pres
      file.decoded = G.decodePrst(file.raw, tb);
      if (file.spec && file.spec.modules) file.spec.modules[slot] = { model: name, on: cur ? cur.on : true, params: Object.assign({}, params) };
    } catch (e) { ed.err = T('e_generic', String((e && e.message) || e)); render(); return; }
    ed.msg = T('ed_applied', name);
    if (!patchMismatch() && (liveReady() || ed.live)) await liveSendModule(file, slot, true);
    else render();
  }
  /** Envoie un module a la pedale : effect change + 400 ms (seulement si elle n'a pas deja ce modele), valeurs (la 1re renvoyee),
   *  et l'etat ON/OFF si demande. = SlotControlPopup._live_preview_model. Renvoie false si interrompu. */
  async function sendModuleFrames(file, slot, opt) {
    const ed = s.ed, u = s.usb, k = G.MODULES.indexOf(slot), e = file.decoded.modules[slot];
    const key = modKey(e), stop = () => !ed.live || (opt.abort && opt.abort());
    if (opt.force || ed.pm.get(k) !== key) {
      // la pedale confirme le chargement du modele (12/0C) : on attend cette confirmation au lieu de 400 ms a l'aveugle, et on renvoie si elle manque
      const r = await u.link.changeEffect(k, e.model_id, e.category, { alreadyLoaded: ed.pm.get(k) === key });
      ed.pm.set(k, key);
      if (r.confirmed === false) ed.noConf.push(e.model);
      // changer d'ampli fait recharger sa baffle par defaut a la pedale (audit du 04/10) : la baffle de l'ecran n'y est plus
      if (slot === 'AMP') { ed.pm.delete(G.MODULES.indexOf('CAB')); unsync(file, 'CAB'); opt.reloaded = true; }
    }
    const list = tb.paramsOf(e.model_id, e.category).filter(p => p.slot < G.N_SLOTS);
    const val = p => Number((e.params || {})[p.name]);
    for (const p of list) { if (stop()) return false; u.link.sendParam(k, p.slot, val(p), file.raw); await sleep(PGAP); }
    if (list.length) { if (stop()) return false; u.link.sendParam(k, list[0].slot, val(list[0]), file.raw); await sleep(PGAP); }   // le pedalier avale le 1er parametre
    for (const p of list.slice(1)) { if (/^time\b/i.test(p.name)) { if (stop()) return false; u.link.sendParam(k, p.slot, val(p), file.raw); await sleep(PGAP); } }   // le Time est le reglage le plus souvent perdu
    if (opt.bypass) { if (stop()) return false; ed.bsent.set(k, Date.now()); u.link.sendBypass(k, !!e.on); await sleep(PGAP); }
    if (stop()) return false;
    markSynced(file, slot);
    return true;
  }
  async function liveSendModule(file, slot, changed, quiet) {
    const ed = s.ed;
    const e = file.decoded.modules[slot];
    if (!e || !e.model) return;
    if (ed.busy) return;
    if (!(await liveEnsure())) { if (!quiet) render(); return; }
    ed.busy = true; ed.noConf = []; ed.msg = changed ? T('ed_changing') : T('ed_changing_pedal');
    if (quiet) paintLiveNote(ed.msg); else render();   // en reglage continu on ne reconstruit pas l'ecran : le curseur tenu par la souris doit rester en main
    try {
      dropPending(file, slot);
      // nouveau modele choisi ou bouton « Envoyer ce module » : on renvoie tout ; synchronisation automatique (quiet) : seulement si la pedale n'a pas ce modele
      const o = { force: !quiet || changed };
      let done = await sendModuleFrames(file, slot, o);
      // la pedale vient de recharger la baffle par defaut de cet ampli : on lui remet celle du preset (si elle est active)
      const cab = file.decoded.modules.CAB;
      if (done && slot === 'AMP' && o.reloaded && cab && cab.model && cab.on) done = await sendModuleFrames(file, 'CAB', { force: false });
      if (done) { ed.msg = ed.noConf.length ? T('live_noconf', Array.from(new Set(ed.noConf)).join(', ')) : changed ? T('ed_applied_live', e.model) : T('ed_sent', e.model); liveTouch(); }
    } catch (err) { ed.busy = false; liveFail(err); return; }
    finally { ed.busy = false; }
    if (quiet) paintLiveNote(ed.noConf.length ? T('live_noconf', Array.from(new Set(ed.noConf)).join(', ')) : T('mod_live')); else render();
  }

  // ------------------------------------------------------------ injection (slot d'injection)
  const injName = () => slotName2(s.inj.bank, s.inj.letter);
  function injectBtns(file) {
    const j = s.inj, busy = j.busy || !!s.usb.sending;
    return h('span', { class: 'injgrp' },
      h('button', { type: 'button', class: 'btn small ghost' + (j.set ? '' : ' warn'), id: 'inj-slot', 'aria-expanded': String(j.open), title: T('inj_slot_tip'),
        onclick: () => { j.open = !j.open; render(); } }, j.set ? T('inj_slot_btn', injName()) : T('inj_slot_choose')),
      h('button', { type: 'button', class: 'btn small go', id: 'inject-btn', title: T('inj_tip', injName()), disabled: busy || !j.set, onclick: () => injectSlot(file, {}) }, T('inj_btn')));
  }
  /** Fenetre « slot de travail » : s'ouvre toute seule a la connexion de la pedale tant que le slot n'est pas confirme, avant tout preset
   *  (rien n'est ecrit sur la pedale sans cet accord) ; rouvrable par la pastille 📍 de l'en-tete ou le bouton du rack. */
  function slotDialog() {
    const j = s.inj;
    if (!j.open || !pedalFound()) return null;
    const close = () => { j.open = false; render(); };
    return h('div', { class: 'modal-veil', id: 'slot-modal', onclick: e => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal slotbox', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'slot-title' },
        h('header', { class: 'pop-head' }, h('h2', { id: 'slot-title', text: T('inj_panel_title') }),
          h('button', { type: 'button', class: 'btn small ghost x-close', id: 'slot-close', 'aria-label': T('pop_close'), onclick: close }, '✕')),
        h('div', { class: 'injpanel', id: 'inj-panel', role: 'group', 'aria-label': T('inj_panel_title') },
          h('p', { class: 'help', text: T('inj_panel_msg') }),
          h('label', { class: 'f' }, T('pedal_bank'), h('select', { id: 'inj-bank', onchange: e => { j.bank = +e.target.value; } },
            Array.from({ length: USB.SLOT_MAX }, (_, i) => h('option', { value: String(i + 1), selected: i + 1 === j.bank }, String(i + 1))))),
          h('label', { class: 'f' }, T('pedal_letter'), h('select', { id: 'inj-letter', onchange: e => { j.letter = e.target.value; } },
            ['A', 'B', 'C', 'D'].map(l => h('option', { value: l, selected: l === j.letter }, l)))),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'inj-auto', checked: j.auto, onchange: e => { j.auto = e.target.checked; } }), T('inj_auto')),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'listen-chk', checked: s.listen.want, onchange: e => { s.listen.want = e.target.checked; if (!s.listen.want) { s.listen.pc = null; s.listen.desync = false; s.listen.touched = false; liveStop(); } save(); render(); } }), T('listen_chk')),
          h('button', { type: 'button', class: 'btn small go', id: 'inj-ok', onclick: () => { j.set = true; j.open = false; save(); render(); if (j.auto) scheduleInject(); memSoon(2500); } }, 'OK'))));
  }
  function injectPanel(file) {
    const j = s.inj, u = s.usb, lines = [];
    if (!j.set && !j.open) lines.push(h('p', { class: 'note', id: 'inj-need', text: T('inj_need') }));
    listenLines(file).forEach(x => lines.push(x));
    // « Injecte et selectionne... » (tout va bien) va dans la barre d'etat ; une erreur ou un avertissement reste ici, sous les yeux
    if (j.err || j.warn) lines.push(h('p', { class: 'note ' + (j.err ? 'err' : 'ok'), id: 'inj-state', role: j.err ? 'alert' : 'status', text: j.err || (j.msg + (j.warn ? ' ' + j.warn : '')) }));
    return lines.length ? h('div', { class: 'injbox' }, lines) : null;
  }
  function paintInject(txt) {
    const b = document.getElementById('inject-btn'), st = document.getElementById('inj-state');
    if (b) b.textContent = txt;
    if (st) st.textContent = txt;
  }
  /** Ecrit le preset dans le slot d'injection puis le selectionne (= _inject_bg du Python : write_preset, 350 ms, select_preset).
   *  La pedale charge alors le patch depuis sa memoire : tous ses modules ont le modele du fichier, les reglages en direct visent les bons parametres. */
  async function injectSlot(file, opt) {
    opt = opt || {};
    const u = s.usb, j = s.inj, ed = s.ed;
    if (!file || !pedalFound() || tuneActive() || !j.set) return;
    if (u.sending || j.busy) { j.queued = { manual: !opt.auto }; return; }     // une ecriture est en cours : on rejoue le preset affiche a la fin
    j.queued = null; j.busy = true; j.msg = ''; j.err = ''; j.warn = '';
    const bank = j.bank, letter = j.letter, name = injName(), raw = Uint8Array.from(file.raw);
    await liveStop();                                    // libere les ports : l'ecriture ouvre les siens
    u.flags = {}; u.result = null; u.sending = { label: T('pedal_hs') };
    render();
    let ok = false;
    try {
      u.link.select(u.outId);
      await u.link.open();
      await u.link.pushPreset(bank, letter, raw, {
        onProgress: (step, total) => paintInject(T('inj_prog', name, Math.round(Math.min(step, total + 1) / (total + 1) * 100))),
      });
      ok = true;
    } catch (e) {
      j.err = T('inj_fail', name, usbErr(e));
    } finally {
      try { await u.link.close(); } catch (e) { /* rien */ }
      u.sending = null; j.busy = false;
    }
    if (ok) {
      j.msg = T('inj_done', name);
      if (u.flags.noAck) j.warn = T('pedal_noack');
      // la pedale vient de charger CE fichier : plus besoin d'envoyer les modeles avant le premier reglage
      markPedalHasFile(file);
      j.injected = { file, raw };
      const L = s.listen; L.pc = USB.slotToPc(bank, letter); L.desync = false; L.touched = false; L.last = '';
    }
    const q = j.queued; j.queued = null;
    const nf = curFile();
    if (q && nf && (q.manual || nf !== file || j.auto)) { render(); injectSlot(nf, { auto: !q.manual }); return; }
    render();
  }
  /** Injection automatique a la selection d'un preset (liste, generation, ouverture, affinage) : 0,5 s de calme pour ne pas suivre chaque clic. */
  function scheduleInject() {
    const j = s.inj;
    clearTimeout(j.t);
    j.t = setTimeout(() => { j.t = null; const f = curFile(); if (f && j.auto && j.set && pedalFound() && !tuneActive() && !fromPedal()) injectSlot(f, { auto: true }); }, 500);
  }

  // ------------------------------------------- ecoute de la pedale (sens pedale -> page)
  // La pedale annonce (SysEx 12/08) les modules qu'on bascule au pied, ses changements de patch et le volume du patch ; un reglage tourne en facade
  // (12/10 : module, slot, valeur) est applique au preset affiche. Le contenu d'un patch charge n'est jamais envoye : on ne peut que suivre ces annonces.
  const hexOf = m => Array.from(m, x => (x < 16 ? '0' : '') + x.toString(16)).join(' ');
  const injPc = () => (s.inj.set ? USB.slotToPc(s.inj.bank, s.inj.letter) : null);
  const fromPedal = () => !!(s.res && s.res.kind === 'pedal');            // le preset affiche vient d'etre lu sur la pedale (voir pedalFetch)
  const patchMismatch = () => { const p = injPc(), L = s.listen; return p !== null && L.pc !== null && L.pc !== p && !fromPedal(); };
  const bytesEq = (a, b) => { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  function listenLog(kind, txt, raw) {
    const L = s.listen;
    L.log.push({ t: Date.now(), kind, txt, hex: raw ? hexOf(raw) : '' });
    if (L.log.length > 60) L.log.shift();
  }
  /** Redessine sans casser un curseur en train d'etre tire, et au plus tous les 250 ms (un bouton tourne en facade envoie des rafales). */
  function listenRender() {
    const L = s.listen;
    if (L.rt) return;
    L.rt = setTimeout(function again() {
      L.rt = null;
      if (document.querySelector('input[type=range]:active')) { L.rt = setTimeout(again, 300); return; }
      render();
    }, 250);
  }
  function forgetPedalState() {
    const ed = s.ed;
    clearTimeout(ed.timer); ed.timer = null; ed.pending = new Map();
    for (const tm of ed.tails.values()) clearTimeout(tm);
    ed.tails = new Map();
    ed.sync = { file: null, set: new Set() }; ed.pm = new Map();
  }
  /** La pedale a ce fichier-la (on vient de l'ecrire, ou elle l'a recharge depuis sa memoire a l'identique) : plus rien a renvoyer avant le 1er reglage. */
  function markPedalHasFile(file) {
    const slots = G.MODULES.filter(sl => file.decoded.modules[sl] && file.decoded.modules[sl].model);
    s.ed.sync = { file, set: new Set(slots) };
    s.ed.pm = new Map(slots.map(sl => [G.MODULES.indexOf(sl), modKey(file.decoded.modules[sl])]));
  }
  const viewIsOnPedal = () => !patchMismatch();
  function onPedalEvent(e, raw) {
    if (tuneActive() || !s.listen.want) return;
    const L = s.listen;
    if (e.kind === 'patch') {
      L.pc = e.pc; L.last = T('listen_patch', USB.pcToSlotName(e.pc));
      listenLog('patch', 'patch ' + USB.pcToSlotName(e.pc));
      if (!s.inj.busy && !s.usb.sending) pedalPatchChanged(e.pc);
    } else if (e.kind === 'bypass') {
      const slot = G.MODULES[e.module];
      if (!slot) return;
      const sent = s.ed.bsent.get(e.module);
      if (sent && Date.now() - sent < 500) return;                 // echo de notre propre envoi
      L.last = T(e.on ? 'listen_byp_on' : 'listen_byp_off', slotName(slot));
      listenLog('bypass', slot + (e.on ? ' ON' : ' OFF') + ' (' + e.source + ')');
      const file = curFile(), m = file && file.decoded.modules[slot];
      if (!file || !m || !m.model || !viewIsOnPedal() || !!m.on === e.on) { listenRender(); return; }
      G.patchOn(file.raw, e.module, e.on);
      m.on = e.on;
      const sm = file.spec && file.spec.modules && file.spec.modules[slot];
      if (sm) sm.on = e.on;
      listenRender();
    } else if (e.kind === 'patchvol') {
      if (Date.now() - s.ed.vsent < 500) return;                   // echo de notre propre envoi (curseur « Volume du patch »)
      L.last = T('listen_vol', e.v);
      listenLog('patchvol', 'volume du patch ' + e.v);
      const file = curFile();
      if (file && viewIsOnPedal() && file.raw[G.OFF_PATCH_VOL] !== e.v) {
        file.raw = G.applyPatchVol(file.raw, e.v)[0];
        file.decoded.patch_vol = e.v;
      }
      listenRender();
    } else if (e.kind === 'panel') {
      onPanelParam(e, raw);
    }
  }
  /** Reglage tourne en facade (12/10 : module, slot, valeur) : applique au preset affiche, sans rien renvoyer a la pedale.
   *  On applique toujours la derniere valeur recue (la pedale saute des valeurs intermediaires quand on tourne vite). */
  function onPanelParam(e, raw) {
    const L = s.listen, slot = G.MODULES[e.module];
    const sent = s.ed.psent.get(e.module * 16 + e.param);
    if (sent && Date.now() - sent < 500) return;                       // echo eventuel de notre propre envoi
    const file = curFile(), m = file && slot ? file.decoded.modules[slot] : null;
    const p = m && m.model ? tb.paramsOf(m.model_id, m.category).find(q => q.slot === e.param && q.slot < G.N_SLOTS) : null;
    const v = Math.round(e.value * 1000) / 1000;
    const name = slot ? slot + ' / ' + (p ? p.name : 'slot ' + e.param) : '?';
    const skewed = patchMismatch() || L.desync;                         // deja signale par un bandeau plus precis
    const busy = s.inj.busy || !!s.usb.sending;
    if (!file || !m || !m.model || !p || skewed || busy) {
      listenLog('panel', name + ' = ' + v + ' (non appliqué)', raw);
      if (!skewed) { L.touched = true; L.last = T('listen_knob', name + ' = ' + v); listenRender(); }
      return;
    }
    const cur = m.params ? Number(m.params[p.name]) : NaN;
    const eps = 1e-4;
    if (!(e.value >= p.min - eps && e.value <= p.max + eps)) {          // hors plage : on n'ecrit rien dans le preset
      listenLog('panel', name + ' = ' + v + ' (hors plage ' + p.min + '..' + p.max + ')', raw);
      L.touched = true; L.last = T('listen_knob', name + ' = ' + v); listenRender();
      return;
    }
    listenLog('panel', name + ' = ' + v);
    L.last = T('listen_knob', name + ' = ' + v);
    if (cur === e.value) { listenRender(); return; }
    G.patchParam(file.raw, e.module, p.slot, e.value);
    if (m.params) m.params[p.name] = e.value;
    const sm = file.spec && file.spec.modules && file.spec.modules[slot];
    if (sm && sm.params) sm.params[p.name] = e.value;
    listenRender();
  }
  /** La pedale vient de changer de patch (au pied, ou apres notre selection). */
  function pedalPatchChanged(pc) {
    const L = s.listen, j = s.inj, file = curFile(), want = injPc();
    L.touched = false;
    if (fromPedal()) { L.desync = false; forgetPedalState(); pedalRefetchSoon(pc); listenRender(); return; }      // le rack montre la pedale : on relit le nouveau patch
    if (want === null) { forgetPedalState(); L.desync = false; }
    else if (pc === want) {
      const inj = j.injected;
      if (file && inj && inj.file === file && bytesEq(inj.raw, file.raw)) { L.desync = false; forgetPedalState(); markPedalHasFile(file); }
      else { L.desync = !!file; forgetPedalState(); }       // elle a recharge sa memoire : nos reglages non injectes n'y sont plus
    } else { L.desync = false; forgetPedalState(); }
    if (L.desync || patchMismatch()) j.msg = '';          // « injecte ... » ne decrit plus ce que la pedale a charge
    listenRender();
  }
  // ------------------------------------------- lecture du patch charge sur la pedale (sens pedale -> page, LECTURE SEULE)
  // Au branchement, ou quand la pedale annonce un changement de patch alors que le rack montre la pedale, on lui demande le patch charge (requetes de
  // l'editeur Valeton) et on l'affiche. Rien n'est ecrit sur la pedale : un preset lu n'est ni injecte ni envoye tant qu'on ne le demande pas.
  const readFailText = e => {
    const c = e && e.code;
    return c === 'timeout' ? T('pr_timeout') : c === 'noread' ? T('pr_noread') : c === 'busy' ? T('e_pedal_busy') : c === 'gone' ? T('e_pedal_gone') : String((e && e.message) || e).slice(0, 200);
  };
  /** opt : pc (numero connu), initial (lecture au branchement : n'affiche que si rien n'est affiche), replace (remplace le preset affiche s'il vient de la pedale),
   *  show (affiche le resultat), manual (bouton : ouvre le port si besoin, dit pourquoi en cas d'echec). */
  async function pedalFetch(opt) {
    opt = opt || {};
    const pr = s.pr, u = s.usb, ed = s.ed;
    if (pr.busy || !pedalFound() || !u.link || tuneActive() || u.sending || s.inj.busy || (s.run && s.run.running)) return false;
    pr.busy = true;
    if (opt.manual) { s.notice = null; render(); }
    let tmp = false, changed = false, retry = 0;
    try {
      for (let i = 0; i < 30 && (ed.busy || ed.opening); i++) await sleep(100);       // un reglage en cours d'envoi passe d'abord
      if (ed.busy) throw new USB.UsbError('busy', 'envoi en cours');
      if (!ed.live) {
        if (linkReady()) { if (!(await liveEnsure())) throw new USB.UsbError('noport', 'port MIDI non ouvert'); }
        else if (opt.manual) { u.link.select(u.outId); await u.link.open(); tmp = true; await sleep(IS_ANDROID ? 700 : 300); }
        else return false;
      }
      const link = u.link;
      const r = await link.readCurrentPatch({ pc: opt.pc, timeoutMs: IS_ANDROID ? 3000 : 1500 });
      if (!pedalFound() || u.link !== link) return false;
      const raw = G.prstFromDeviceRead(r.data, template), dec = G.decodePrst(raw, tb);
      const slot = USB.pcToSlotName(r.pc), name = String(dec.name || '').trim();
      const res = singleRes(slot + '_' + G.safeFilename(name || 'patch') + '.prst', raw, dec, null, [], 'preset', name || slot);
      const label = slot + ' · ' + (name || '?'), file = res.files[0];
      const cur = s.res, i = cur && cur.kind === 'pedal' ? s.lib.indexOf(cur) : -1;
      if (opt.replace && i >= 0) {
        res.id = cur.id; res.kind = 'pedal'; res.label = label; s.lib[i] = res;
        s.res = res; s.sel = { si: 0, vi: 0, slot: s.sel.slot || 'AMP' }; s.fresh = true; s.armed = null;
      } else {
        addRes(res, 'pedal', label, true);                                              // true = sans injection ; n'affiche que si rien n'est affiche
        if (opt.show && s.res !== res) { s.res = res; s.sel = { si: 0, vi: 0, slot: s.sel.slot || 'AMP' }; s.fresh = true; s.armed = null; }
      }
      if (s.res === res) {
        markPedalHasFile(file);                                                         // la pedale a exactement ce patch : rien a renvoyer avant le 1er reglage
        const L = s.listen; L.pc = r.pc; L.desync = false; L.touched = false; L.last = '';
        if ((opt.initial || opt.manual) && !s.notice) s.notice = { kind: 'ok', text: T('pr_done', name || '?', slot) };
      }
      pr.last = { pc: r.pc, t: Date.now() };
      if (s.mem.items.some(it => !it || it.stale)) memSoon(1200);                       // la pedale a repondu : la liste des noms peut suivre
      dg('read', 'ok ' + slot + ' via=' + r.via + ' name=' + name);
      changed = true;
    } catch (e) {
      dg('read', 'echec ' + ((e && e.code) || '') + ' ' + String((e && e.message) || e).slice(0, 160));
      if (opt.manual) { s.notice = { kind: 'err', text: T('pr_fail', readFailText(e)) }; changed = true; }
      else if (!opt.retried && e && (e.code === 'timeout' || (e.code === 'badread' && opt.pc !== undefined))) retry = e.code === 'timeout' ? 2500 : 300;
    } finally {
      if (tmp) { try { await u.link.close(); } catch (e) { /* rien */ } }
      else if (ed.live) liveTouch();
      pr.busy = false;
      if (changed || opt.manual) render();
    }
    if (retry) {
      clearTimeout(pr.t);
      pr.t = setTimeout(() => { pr.t = null; if (opt.initial ? fetchWanted() : (fromPedal() && pedalFound())) pedalFetch(Object.assign({}, opt, { retried: true })); }, retry);
    }
    return changed;
  }
  /** Lecture au branchement voulue : rien n'est affiche, ou le rack montre deja un patch lu sur la pedale (pedale debranchee puis rebranchee, peut-etre sur
   *  un autre patch : on relit et on remplace sur place). Un preset ouvert ou genere n'est jamais remplace. */
  const fetchWanted = () => (!s.res || fromPedal()) && pedalFound() && s.pr.auto;
  /** Lecture au branchement (0,7 s apres, le temps que la pedale soit prete). */
  function scheduleFetch() {
    const pr = s.pr;
    clearTimeout(pr.t);
    pr.t = setTimeout(() => { pr.t = null; if (fetchWanted()) pedalFetch({ initial: true, replace: true }); }, 700);
  }
  /** La pedale a change de patch alors que le rack montre la pedale : relit le nouveau (0,25 s de calme ; reessaie tant qu'un envoi ou une lecture est en cours). */
  function pedalRefetchSoon(pc) {
    const pr = s.pr;
    clearTimeout(pr.rt);
    if (pr.last && pr.last.pc === pc && Date.now() - pr.last.t < 2000) { pr.rt = null; return; }      // ce patch vient d'etre lu : l'annonce est son echo
    let tries = 0;
    const go = () => {
      pr.rt = null;
      if (!fromPedal() || !pedalFound()) return;
      if (pr.last && pr.last.pc === pc && Date.now() - pr.last.t < 2000) return;                          // lu entre-temps (selection depuis la memoire de la pedale, par exemple)
      if ((pr.busy || s.inj.busy || s.usb.sending || s.ed.busy) && ++tries < 20) { pr.rt = setTimeout(go, 300); return; }
      pedalFetch({ pc, replace: true });
    };
    pr.rt = setTimeout(go, 250);
  }

  // ------------------------------------------- memoire de la pedale : les 256 emplacements (colonne de gauche), LECTURE SEULE
  // Le nom de chaque emplacement est lu dans le patch enregistre (requete 11/10, comme l'editeur Valeton qui lit ses 256 patchs au demarrage : environ 6 s).
  // Un clic sur un emplacement le selectionne sur la pedale (Bank Select + Program Change, comme au pied), puis le lit et l'affiche. Rien n'est jamais ecrit.
  const memName = pc => USB.pcToSlotName(pc);
  const memTodo = () => { const r = []; s.mem.items.forEach((it, pc) => { if (!it || it.stale) r.push(pc); }); return r; };
  function memInvalidate() { s.mem.items.forEach(it => { if (it) it.stale = true; }); }
  function memStale(pc) { const m = s.mem; m.items[pc] = Object.assign({ name: '' }, m.items[pc], { stale: true }); memSoon(1500); }
  function memSoon(ms) { const m = s.mem; clearTimeout(m.t); m.t = setTimeout(() => { m.t = null; memLoad({}); }, ms); }
  /** A chaque (re)branchement : les noms deja lus sont gardes mais marques « a relire » (la pedale a pu changer entre-temps). */
  function scheduleMem() { memInvalidate(); memSoon(2500); }
  /** Lit les noms manquants ou a relire, en commencant par le patch courant ; un envoi (injection, set list, harmonisation) ou la lecture du patch courant passent avant. */
  async function memLoad(opt) {
    opt = opt || {};
    const m = s.mem, u = s.usb, ed = s.ed;
    if (m.busy || !pedalFound() || !u.link || (!m.auto && !opt.manual)) return;
    if (!opt.manual && !s.inj.set && !s.pr.last) return;                              // lecture automatique : seulement une fois la pedale connue (patch courant lu) ou le slot de travail confirme ; rien n'ouvre le port avant
    if (opt.all) memInvalidate();
    const start = s.listen.pc === null ? 0 : s.listen.pc;
    const todo = memTodo().sort((a, b) => ((a - start + 256) % 256) - ((b - start + 256) % 256));
    if (!todo.length) { if (opt.manual) render(); return; }
    m.busy = true; m.err = ''; m.done = 0; m.todo = todo.length;
    if (opt.manual) render();
    let tmp = false, bad = 0;
    try {
      const link = u.link;
      for (let k = 0; k < todo.length; k++) {
        const pc = todo[k];
        for (let i = 0; u.sending || s.inj.busy || tuneActive() || s.pr.busy; i++) {
          if (i > 150) throw new USB.UsbError('busy', 'pedale occupee');
          await sleep(200);
        }
        if (!pedalFound() || u.link !== link) throw new USB.UsbError('gone', 'pedale debranchee');
        if (!ed.live && !tmp) {                                                        // la liaison a pu etre fermee par un envoi
          if (linkReady()) { if (!(await liveEnsure())) throw new USB.UsbError('noport', 'port MIDI non ouvert'); }
          else if (opt.manual) { link.select(u.outId); await link.open(); tmp = true; await sleep(IS_ANDROID ? 700 : 300); }
          else throw new USB.UsbError('noport', 'liaison directe coupee');
        }
        let ok = false;
        for (let a = 0; a < 2 && !ok; a++) {
          try {
            const data = await link.readStoredPatch(pc, { timeoutMs: IS_ANDROID ? 3000 : 1500 });
            m.items[pc] = { name: G.deviceReadName(data) }; ok = true; bad = 0;
          } catch (e) { if (!e || (e.code !== 'timeout' && e.code !== 'badread')) throw e; }
        }
        if (!ok) {
          if (!opt.manual && m.done === 0) { m.auto = false; dg('read', 'memoire : la pedale ne repond pas, lecture automatique abandonnee'); break; }      // 1re lecture sans reponse : on n'insiste pas (le bouton ↻ reste la)
          m.items[pc] = { name: '', err: true };
          if (++bad >= 4) throw new USB.UsbError('timeout', 'plusieurs lectures sans reponse');
        }
        m.done++;
        if (m.done % 8 === 0) { listenRender(); if (!tmp && ed.live) liveTouch(); }
      }
      if (m.done) dg('read', 'memoire : ' + m.done + ' emplacements lus');
    } catch (e) {
      m.err = readFailText(e);
      dg('read', 'memoire : interrompue ' + ((e && e.code) || '') + ' ' + String((e && e.message) || e).slice(0, 120));
    } finally {
      if (tmp) { try { await u.link.close(); } catch (e) { /* rien */ } } else if (ed.live) liveTouch();
      m.busy = false;
      render();
    }
    if (!m.err && memTodo().length) memSoon(800);                                    // des emplacements ont ete reecrits pendant la lecture
  }
  /** Clic sur un emplacement : la pedale le charge (comme au pied), puis on le lit et on l'affiche (remplace le patch lu precedent, sinon s'ajoute a la liste). */
  async function memPick(pc) {
    const u = s.usb, ed = s.ed;
    if (!pedalFound() || u.sending || s.inj.busy || tuneActive() || s.pr.busy) return;
    const bank = (pc >> 2) + 1, letter = 'ABCD'[pc & 3];
    let tmp = false;
    try {
      if (!ed.live) {
        if (linkReady()) { if (!(await liveEnsure())) return; }
        else { u.link.select(u.outId); await u.link.open(); tmp = true; await sleep(IS_ANDROID ? 700 : 300); }
      }
      u.link.selectPreset(bank, letter);
      dg('read', 'selection ' + memName(pc));
      if (tmp) await sleep(100);
    } catch (e) { s.notice = { kind: 'err', text: T('pr_fail', readFailText(e)) }; render(); return; }
    finally { if (tmp) { try { await u.link.close(); } catch (e) { /* rien */ } } else if (ed.live) liveTouch(); }
    await sleep(300);                                                                // la pedale charge le patch
    pedalFetch({ pc, show: true, replace: true, manual: true });
  }
  /** Centre le patch courant dans la liste (a l'apparition de la colonne et quand la pedale change de patch). */
  function memScroll() {
    const m = s.mem;
    if (!m.follow) return;
    const l = document.getElementById('mem-list'), r = l && l.querySelector('.mem-row.on');
    if (!l || !r) return;
    m.follow = false;
    l.scrollTop = Math.max(0, r.offsetTop - (l.clientHeight - r.offsetHeight) / 2);
  }
  function memPanel() {
    if (!pedalFound()) return null;
    const m = s.mem, L = s.listen, u = s.usb, n = m.items.filter(Boolean).length;
    if (m.shownPc !== L.pc) { m.shownPc = L.pc; m.follow = true; }
    const locked = !!u.sending || s.inj.busy || s.pr.busy;
    const rows = m.items.map((it, pc) => {
      const on = L.pc === pc;
      return h('button', { type: 'button', class: 'mem-row' + (on ? ' on' : '') + (it && it.stale ? ' stale' : '') + (it ? '' : ' wait') + (pc % 4 === 3 ? ' end' : ''),
        'data-pc': String(pc), 'aria-pressed': String(on), disabled: locked, title: T('mem_pick', memName(pc)), onclick: () => memPick(pc) },
        h('span', { class: 'ms', text: memName(pc) }), h('span', { class: 'mn', text: it ? (it.name || '–') : '…' }));
    });
    return h('aside', { class: 'mem zone', 'aria-label': T('mem_title') },
      h('div', { class: 'side-h' }, h('h2', { text: T('mem_title') }),
        h('button', { type: 'button', class: 'btn small ghost x-close', id: 'mem-refresh', title: T('mem_refresh'), 'aria-label': T('mem_refresh'), disabled: m.busy || locked,
          onclick: () => memLoad({ manual: true, all: true }) }, '↻')),
      h('div', { class: 'mem-st' }, h('span', { class: 'count', title: T('mem_count'), text: n + '/256' }), m.busy ? h('span', { class: 'help', text: T('mem_loading', m.done, m.todo) }) : null),
      h('p', { class: 'help', text: T('mem_sub') }),
      m.err ? h('p', { class: 'note err', role: 'status', text: T('mem_err', m.err) }) : null,
      h('div', { class: 'mem-list', id: 'mem-list' }, rows));
  }

  /** Tient le port ouvert pour entendre la pedale (sinon il se referme apres 15 s d'inactivite) et le rouvre apres une injection. */
  function listenTick() {
    const ed = s.ed, L = s.listen;
    if (!L.want || ed.live || ed.opening || ed.busy || s.inj.busy || !linkReady()) return;
    liveEnsure().then(ok => { if (ok) render(); });
  }
  function onPedalRaw(m) {
    // journal : on garde ce que le decodage ne sait pas lire (hors 12/0C : confirmations d'effets, tres frequentes)
    if (!s.listen.want || m.length < 10 || m[8] !== 0x12 || m[9] === 0x0C) return;
    if (m[9] === 0x08) return;                                     // deja journalise par onPedalEvent
    if (m[9] === 0x10 && USB.parsePanelParam(m)) return;           // idem ; un 12/10 que le decodage refuse reste dans le journal (variante de trame ?)
    listenLog('autre', '12/' + (m[9] < 16 ? '0' : '') + m[9].toString(16) + ' (' + m.length + ' o)', m);
  }
  /** « GP-200 sur 64-D · volume du patch 57 » : information seule, affichee discretement dans la barre d'etat. */
  function listenOn() {
    const L = s.listen;
    if (!L.want || L.pc === null || patchMismatch() || L.desync) return null;
    return h('span', { class: 'pinfo', id: 'pd-on', role: 'status' }, T('listen_on', USB.pcToSlotName(L.pc)) + (L.last && L.last !== T('listen_patch', USB.pcToSlotName(L.pc)) ? ' · ' + L.last : ''));
  }
  /** Ce qui est dit en bas de l'application quand un preset est affiche et la pedale branchee : tout va bien, rien a faire. */
  function statusInfo() {
    const j = s.inj, ed = s.ed, out = [];
    if (!curFile() || (s.run && s.run.running)) return out;
    if (pedalFound()) {
      const on = listenOn();
      if (on) out.push(on);
      if (j.msg && !j.err && !j.warn) out.push(h('span', { class: 'pinfo', id: 'inj-state', role: 'status', text: j.msg }));
    }
    if (ed.msg) out.push(h('span', { class: 'pinfo', id: 'ed-msg', role: 'status', text: ed.msg }));       // « X applique sur la pedale (pas encore enregistre) » : l'erreur, elle, reste dans la fiche du module
    return out;
  }
  /** Seulement ce qui demande un geste ou signale un ecart avec la pedale (l'information « sur 64-D » est dans la barre d'etat). */
  function listenLines(file) {
    const L = s.listen, j = s.inj, out = [];
    if (!L.want || L.pc === null) return out;
    const resend = () => (j.set ? h('button', { type: 'button', class: 'btn small go', id: 'pd-resend', disabled: j.busy || !!s.usb.sending, onclick: () => { L.desync = false; L.touched = false; injectSlot(file, {}); } }, T('listen_resend')) : null);
    if (patchMismatch()) out.push(h('p', { class: 'note', id: 'pd-other', role: 'status' }, T('listen_other', USB.pcToSlotName(L.pc), injName()), ' ', resend()));
    else if (L.desync) out.push(h('p', { class: 'note', id: 'pd-reloaded', role: 'status' }, T('listen_reloaded', injName()), ' ', resend()));
    if (L.touched && !L.desync) out.push(h('p', { class: 'note', id: 'pd-knob', role: 'status' }, T('listen_panel'), ' ', resend()));
    return out;
  }
  function listenLogBlock() {
    const L = s.listen;
    const rows = L.log.slice().reverse().map(x => new Date(x.t).toLocaleTimeString(s.lang === 'fr' ? 'fr-FR' : 'en-GB') + '  ' + x.txt + (x.hex ? '  ' + x.hex : ''));
    const txt = rows.join('\n');
    const det = h('details', { class: 'plog', id: 'pd-log', ontoggle: e => { L.logOpen = e.target.open; } },
      h('summary', { text: T('listen_log') }),
      h('p', { class: 'help', text: T('listen_log_sub') }),
      L.want ? null : h('p', { class: 'note', text: T('listen_off') }),
      h('pre', { class: 'plogbox', id: 'pd-log-text', text: rows.length ? txt : T('listen_log_empty') }),
      rows.length ? h('button', { type: 'button', class: 'btn small ghost', id: 'pd-log-copy', onclick: () => { try { navigator.clipboard.writeText(txt); } catch (e) { /* rien */ } } }, T('listen_copy')) : null);
    det.open = !!L.logOpen;
    return det;
  }
  function paintLiveNote(txt) { const el = document.getElementById('live-note'); if (el) el.textContent = txt; }

  function numStr(v) { return String(Math.round(Number(v) * 1e4) / 1e4); }
  /** Valeur lue dans le fichier, pour l'affichage seul : 37.6244 -> 37.62 (au moins 2 decimales, plus si le pas du reglage en demande) ; le fichier garde sa precision. */
  function numShow(v, step) {
    const dec = String(step).indexOf('.') >= 0 ? String(step).split('.')[1].length : 0, d = Math.min(4, Math.max(2, dec)), k = Math.pow(10, d);
    return String(Math.round(Number(v) * k) / k);
  }

  /** Volume du patch : un reglage du preset (pas d'un module), donc au-dessus de la chaine du signal, quel que soit le module choisi. */
  function patchVolBlock(file) {
    const v = clampN(Math.round(Number(file.decoded.patch_vol)) || 0, 0, 100), tip = TIPS.ui[s.lang].patch_vol;
    let range = null;
    const num = h('input', { type: 'number', class: 'num', id: 'pv-num', min: '0', max: '100', step: '1', value: String(v), 'aria-label': T('pv_title') + ' (valeur)', title: tip + '\n' + TIPS.ui[s.lang].param_num,
      oninput: ev => { const x = Number(ev.target.value); if (ev.target.value === '' || isNaN(x)) return; const c = Math.round(clampN(x, 0, 100)); range.value = String(c); edPatchVol(file, c); },
      onchange: ev => { const c = Math.round(clampN(Number(ev.target.value) || 0, 0, 100)); ev.target.value = String(c); range.value = String(c); edPatchVol(file, c); } });
    range = h('input', { type: 'range', id: 'pv-range', min: '0', max: '100', step: '1', value: String(v), 'aria-label': T('pv_title'), title: tip,
      oninput: ev => { const c = Number(ev.target.value); num.value = String(c); edPatchVol(file, c); } });
    return h('div', { class: 'pvol', id: 'pvol', title: tip }, h('span', { class: 'pn', text: T('pv_title') }), range, num);
  }

  function moduleTab(file) {
    const ed = s.ed;
    const slot = file.decoded.modules[s.sel.slot] ? s.sel.slot : 'AMP';
    const e = file.decoded.modules[slot];
    const has = !!(e && e.model);
    const box = h('div', { class: 'module', id: 'module-box' });
    const list = tb.modelsForSlot(slot);
    const curIdx = has ? list.findIndex(x => x[1] === e.category && (x[1] === 10 ? x[0].model_id : x[0].id) === e.model_id) : -1;
    const groups = new Map();
    list.forEach((x, i) => { const g = x[0].category_label || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([x, i]); });
    const opts = [];
    if (curIdx < 0) opts.push(h('option', { value: '-1', selected: true }, has ? e.model : '–'));
    groups.forEach((items, g) => {
      const os = items.map(([x, i]) => h('option', { value: String(i), selected: i === curIdx }, x[0].name));
      opts.push(g && groups.size > 1 ? h('optgroup', { label: g }, os) : os);
    });
    const mid = has ? e.model_id : 0, cat = has ? e.category : 0;
    const desc = has && cat !== 10 ? tb.description(mid, cat) : '';
    const fdb = v => { const x = (Math.round(v * 10) / 10).toFixed(1); return s.lang === 'fr' ? x.replace('.', ',') : x; };
    const lvl = has && B.audit && B.audit.lv && (slot === 'AMP' || slot === 'DST') && cat !== 15 ? B.audit.lv[mid + ',' + cat] : undefined;
    const lvMed = B.audit && B.audit.med ? B.audit.med[slot] : undefined;
    const lvEl = lvl !== undefined && lvMed !== undefined ? h('p', { class: 'what lvl', id: 'mod-level', text: T('lvl_line', fdb(lvl), (lvl - lvMed >= 0 ? '+' : '') + fdb(lvl - lvMed), fdb(lvMed)) }) : null;
    box.appendChild(h('div', { class: 'mhead' },
      h('div', { class: 'mtitle' }, h('h3', { text: slotName(slot) }), desc ? h('p', { class: 'what', text: desc }) : null, lvEl),
      h('label', { class: 'f mmodel' }, T('ed_model'), h('select', { id: 'ed-model', disabled: ed.busy, onchange: ev => edModel(file, slot, +ev.target.value) }, opts)),
      has ? h('span', { class: 'mstate' + (e.on ? ' on' : ''), id: 'ed-state', title: T('slot_tip') }, h('span', { class: 'led' }), e.on ? T('active') : T('bypass')) : null));
    if (!has) { box.appendChild(h('p', { class: 'help', text: T('inspector_hint') })); return box; }

    const pst = (B.audit && B.audit.ps && B.audit.ps[mid + ',' + cat]) || {};
    const ul = h('ul', { class: 'params sliders' });
    for (const p of tb.paramsOf(mid, cat)) {
      if (p.slot >= G.N_SLOTS) continue;
      const val = e.params[p.name];
      if (val === undefined) continue;
      const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max), step = p.step > 0 ? p.step : 1;
      let range = null;
      const ptip = TIPS.paramTip(p, s.lang);
      const num = h('input', { type: 'number', class: 'num', min: String(lo), max: String(hi), step: String(step), value: numShow(val, step), 'aria-label': p.name + ' (valeur)', 'data-num': p.name, title: ptip + '\n' + TIPS.ui[s.lang].param_num,
        oninput: ev => { const v = Number(ev.target.value); if (ev.target.value === '' || isNaN(v)) return; const c = clampN(v, lo, hi); range.value = String(c); edParam(file, slot, p, c); },
        onchange: ev => { const v = clampN(Number(ev.target.value) || 0, lo, hi); ev.target.value = numStr(v); range.value = String(v); } });
      range = h('input', { type: 'range', min: String(lo), max: String(hi), step: String(step), value: String(clampN(val, lo, hi)), 'aria-label': p.name, 'data-param': p.name, title: ptip,
        oninput: ev => { const v = Number(ev.target.value); num.value = numStr(v); edParam(file, slot, p, v); } });
      const flag = pst[String(p.slot)] === 'a' ? h('span', { class: 'pflag', title: T('pflag_tip'), 'aria-label': T('pflag_tip'), text: ' ↻' }) : null;
      ul.appendChild(h('li', null, h('span', { class: 'pn', title: ptip }, p.name, flag), num, range));
    }
    box.appendChild(ul);

    const found = pedalFound();
    const status = found ? (ed.want ? T('mod_live') : T('mod_live_off')) : T('mod_offline');
    box.appendChild(h('p', { class: 'livenote' + (found && ed.want ? ' on' : ''), id: 'live-note', text: status }));
    box.appendChild(h('div', { class: 'actions' },
      found ? h('button', { type: 'button', class: 'btn small', id: 'ed-send', disabled: ed.busy || !ed.want, onclick: () => liveSendModule(file, slot, false) }, T('mod_send')) : null,
      h('button', { type: 'button', class: 'btn small ghost', id: 'ed-save', onclick: () => { s.tab = 'pedal'; render(); } }, T('mod_save'))));
    if (found && ed.want) box.appendChild(h('p', { class: 'help', text: T('mod_match') }));
    if (ed.err) box.appendChild(h('p', { class: 'note err', role: 'alert', id: 'ed-err', text: ed.err }));
    return box;
  }

  // -------------------------------------------------------- barre d'etat / modale
  function buildDate() {
    try {
      return new Date(B.build.iso).toLocaleString(s.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return B.build.iso; }
  }
  function statusbar() {
    const running = !!(s.run && s.run.running), n = s.notice;
    return h('footer', { class: 'statusbar' },
      h('span', { class: 'sdot' + (running ? ' on run' : '') }),
      h('span', { id: 'status-text', class: 'st-text', role: 'status', 'aria-live': 'polite', text: running ? s.run.status : '' }),
      statusInfo(),
      n && !running ? h('p', { class: 'note ' + (n.kind === 'err' ? 'err' : n.kind === 'ok' ? 'ok' : ''), id: 'status-note', role: n.kind === 'err' ? 'alert' : 'status', style: 'white-space:pre-line' },
        n.text, h('button', { type: 'button', class: 'x', 'aria-label': 'OK', onclick: () => { s.notice = null; render(); } }, '×')) : null,
      h('span', { class: 'st-right' },
        h('button', { type: 'button', class: 'linkbtn', id: 'diag-link', title: T('diag_link_tip'), onclick: () => diagShow(true) }, T('diag_link')),
        B.build ? h('span', { class: 'ver', id: 'build-version', title: B.build.iso, text: T('ver', B.build.version, buildDate()) }) : null));
  }
  function setupModal() {
    const open = s.setupOpen === null ? (!curKey() && !s.noAi) : s.setupOpen;
    if (!open) return null;
    return h('div', { class: 'modal-veil', id: 'setup-modal', onclick: e => { if (e.target === e.currentTarget && (curKey() || s.noAi)) { s.setupOpen = false; render(); } } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'h-setup' }, setupPanel(), h('p', { class: 'help', style: 'padding:0 18px 14px', text: T('foot_a') + ' ' + T('foot_b') })));
  }

  function setupPanel() {
    const hasKey = !!curKey();
    const p = s.provider, info = provInfo(p);
    const panel = h('section', { class: 'panel', 'aria-labelledby': 'h-setup' });
    panel.appendChild(h('header', null,
      h('span', { class: 'num' + (hasKey ? ' done' : '') }, hasKey ? '✓' : '1'),
      h('h2', { id: 'h-setup', text: hasKey ? T('s1_done') : T('s1') }),
      (hasKey || s.noAi) ? h('button', { type: 'button', class: 'btn small ghost x-close', id: 'setup-close', 'aria-label': 'OK', onclick: () => { s.setupOpen = false; render(); } }, '✕') : null));

    const list = s.modelList[p] || info.models;
    const models = list.indexOf(curModel()) >= 0 ? list : [curModel()].concat(list);
    const keyInput = h('input', { id: 'apikey', type: 'password', autocomplete: 'off', spellcheck: 'false', value: s.keys[p] || '', 'aria-label': T('key'),
      oninput: e => { s.keys[p] = e.target.value.trim(); if (curKey()) s.noAi = false; save(); checkKeyHint(); const ok = document.getElementById('setup-ok'); if (ok) ok.disabled = !curKey(); } });
    const toggle = h('button', { type: 'button', class: 'btn small ghost', onclick: e => {
      const hide = keyInput.type === 'password'; keyInput.type = hide ? 'text' : 'password'; e.target.textContent = hide ? T('hide') : T('show'); } }, T('show'));
    const hint = h('p', { class: 'note', id: 'key-hint', hidden: true });
    function checkKeyHint() {
      const v = (s.keys[p] || '').trim(), other = v.length > 8 ? foreignKeyOwner(p, v) : null;
      hint.hidden = !other; hint.textContent = other ? T('key_hint_bad', PROV_NAME[other], PROV_NAME[p]) : '';
    }
    const steps = p === 'gemini'
      ? h('ol', null, D[s.lang].h_gemini.map((x, i) => h('li', null, i === 0
        ? [x[0], h('a', { href: info.keys_url, target: '_blank', rel: 'noopener noreferrer', text: 'Google AI Studio' }), x[1]] : x)))
      : h('p', { text: D[s.lang]['h_' + p] });
    const httpOk = /^https?:$/.test(location.protocol);

    panel.appendChild(h('div', { class: 'body' },
      h('div', { class: 'row' },
        h('label', { class: 'f' }, T('provider'), h('select', { id: 'provider', onchange: e => { s.provider = e.target.value; save(); render(); } },
          PROVIDERS.map(x => h('option', { value: x, selected: x === p }, T('p_' + x))))),
        h('label', { class: 'f' }, T('model'), h('select', { id: 'model', onchange: e => { s.models[p] = e.target.value; save(); } },
          models.map(m => h('option', { value: m, selected: m === curModel() }, m))))),
      h('div', { class: 'row', style: 'align-items:center' },
        h('button', { type: 'button', class: 'btn small ghost', style: 'flex:0 0 auto', onclick: refreshModels }, T('refresh')),
        h('span', { id: 'model-msg', class: 'help', text: s.modelMsg })),
      h('div', { class: 'help' }, steps),
      p === 'openrouter' ? h('div', { class: 'row', style: 'align-items:center' },
        h('button', { type: 'button', class: 'btn go', style: 'flex:0 0 auto;min-height:44px;font-size:16px', disabled: !httpOk, onclick: orLogin }, T('or_login')),
        !httpOk ? h('p', { class: 'note', text: T('or_https') }) : null) : null,
      h('div', { class: 'row', style: 'align-items:end' },
        h('label', { class: 'f' }, T('key'), h('div', { class: 'keybox' }, keyInput, toggle)),
        h('a', { class: 'btn', style: 'flex:0 0 auto', href: info.keys_url, target: '_blank', rel: 'noopener noreferrer' }, T('get_key'))),
      hint,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.remember, onchange: e => { s.remember = e.target.checked; save(); } }), T('remember')),
      h('p', { class: 'help', text: T('privacy') }),
      h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:10px' },
        h('button', { type: 'button', class: 'btn go', id: 'setup-ok', disabled: !hasKey, onclick: () => { s.setupOpen = false; render(); } }, 'OK'),
        hasKey ? null : h('button', { type: 'button', class: 'btn', id: 'setup-skip', onclick: () => { s.noAi = true; s.setupOpen = false; s.notice = null; save(); render(); } }, T('setup_skip'))),
      hasKey ? null : h('p', { class: 'help', id: 'setup-skip-help', text: T('setup_skip_help') })));
    setTimeout(checkKeyHint, 0);
    return panel;
  }

  // ------------------------------------------------------------ pedale (USB)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const slotName2 = (bank, letter) => USB.pcToSlotName(USB.slotToPc(bank, letter));
  function usbErr(e) {
    diagErr(e, 'usb');
    const m = String((e && e.name) + ' ' + (e && e.message));
    if (e && e.code === 'busy') return T('e_pedal_busy');
    if (e && e.code === 'gone') return T('e_pedal_gone');
    if (/denied|security|not allowed|permission/i.test(m)) return T(/^https?:$/.test(location.protocol) ? 'pedal_denied' : 'pedal_denied_local');
    return T('e_pedal_generic', String((e && e.message) || e).slice(0, 300));
  }
  function pedalRefresh() {
    const u = s.usb;
    if (!u.link) return;
    u.ports = u.link.ports().outputs.filter(p => p.state !== 'disconnected');
    if (!u.ports.some(p => p.id === u.outId)) u.outId = u.link.findGp200();
  }
  async function pedalConnect() {
    const u = s.usb;
    u.state = 'asking'; u.result = null; u.error = ''; render();
    try {
      const access = await USB.MidiLink.request();
      const link = new USB.MidiLink({ loose: IS_ANDROID, chunkDelay: IS_ANDROID ? 60 : undefined, log: (kind, ...a) => { dg('midi', 'link ' + kind + ' ' + a.join(' ')); if (kind === 'no_ack') u.flags.noAck = true; if (kind === 'input_blind') u.flags.blind = true; } });
      link.attach(access);
      link.onnotify = onPedalEvent; link.onrx = onPedalRaw;
      const sendParam0 = link.sendParam.bind(link);
      link.sendParam = (mod, par, val, prst) => { s.ed.psent.set(mod * 16 + par, Date.now()); return sendParam0(mod, par, val, prst); };   // garde anti-echo des reglages tournes en facade
      const push0 = link.pushPreset.bind(link);
      link.pushPreset = async (bank, letter, prst, o) => { try { return await push0(bank, letter, prst, o); } finally { try { memStale(USB.slotToPc(bank, letter)); } catch (e) { /* rien */ } } };   // un emplacement ecrit : son nom est a relire
      link.onchange = () => { const had = !!u.outId; pedalRefresh(); diagPorts('change'); if (!had && u.outId) { scheduleInject(); scheduleFetch(); scheduleMem(); } if (s.ed.live && !u.outId) { liveStop(); s.ed.err = T('ed_live_ko', T('e_pedal_gone')); } if (!u.sending) render(); };
      u.link = link; u.state = 'ready'; pedalRefresh(); diagPorts('connect'); scheduleInject(); scheduleFetch(); scheduleMem();
    } catch (e) {
      u.state = /denied|security|not allowed|permission/i.test(String((e && e.name) + ' ' + (e && e.message))) ? 'denied' : 'error';
      u.error = usbErr(e);
    }
    render();
  }
  function setPedalProgress(pct, label) {
    const b = document.getElementById('pedal-bar'), l = document.getElementById('pedal-label');
    if (b) b.style.width = Math.max(0, Math.min(100, pct)).toFixed(0) + '%';
    if (l) l.textContent = label;
  }
  function pedalJobs(kind, gr) {
    const u = s.usb;
    return kind === 'three' ? gr.slice(0, 3).map((f, i) => ({ f, letter: 'ABCD'[i] })) : [{ f: gr[s.sel.vi], letter: u.letter }];
  }
  async function pedalSend(kind, gr) {
    const u = s.usb, jobs = pedalJobs(kind, gr), bank = u.bank;
    await liveStop();
    u.confirm = null; u.result = null; u.flags = {}; u.sending = { label: T('pedal_hs') };
    render();
    try {
      u.link.select(u.outId);
      await u.link.open();
      for (let k = 0; k < jobs.length; k++) {
        const j = jobs[k], suffix = jobs.length > 1 ? T('pedal_job', k + 1, jobs.length) : '';
        await u.link.pushPreset(bank, j.letter, j.f.raw, {
          onProgress: (step, total) => setPedalProgress(((k * (total + 2) + step) / (jobs.length * (total + 2))) * 100,
            (step === 0 ? T('pedal_hs') : step <= total ? T('pedal_chunk', step, total) : T('pedal_hs').replace(/…$/, '') + ' ✓') + suffix),
        });
      }
      if (jobs.length > 1) { await sleep(350); u.link.selectPreset(bank, jobs[0].letter); }
      u.result = { kind: 'ok', text: T('pedal_done', jobs.map(j => slotName2(bank, j.letter)).join(', ')) };
    } catch (e) {
      u.result = { kind: 'err', text: usbErr(e) };
    } finally {
      try { await u.link.close(); } catch (e) { /* rien */ }
      u.sending = null; render();
    }
  }

  function pedalBlock(gr) {
    const u = s.usb;
    const box = h('section', { class: 'pedal', 'aria-labelledby': 'h-pedal' },
      h('h3', { id: 'h-pedal', text: T('pedal_title') }), h('p', { class: 'help', text: T('pedal_sub') }));
    if (u.state === 'unsupported') { box.appendChild(h('p', { class: 'note', text: T(IS_ANDROID ? 'pedal_unsupported_android' : 'pedal_unsupported') })); return box; }
    if (tuneActive()) { box.appendChild(h('p', { class: 'note', text: T('tune_pedal_busy') })); return box; }
    if (u.state !== 'ready') {
      box.appendChild(h('ol', { class: 'help' }, (IS_ANDROID ? D[s.lang].pedal_steps_android : D[s.lang].pedal_steps).map(x => h('li', { text: x }))));
      if (u.state === 'denied' || u.state === 'error') box.appendChild(h('p', { class: 'note err', role: 'alert', text: u.error }));
      box.appendChild(h('div', null, h('button', { type: 'button', class: 'btn', id: 'pedal-connect', disabled: u.state === 'asking', onclick: pedalConnect },
        u.state === 'asking' ? T('pedal_asking') : T('pedal_connect'))));
      return box;
    }
    const busy = !!u.sending, found = !!u.outId;
    const cur = u.ports.find(p => p.id === u.outId);
    box.appendChild(h('p', { class: 'pstate' + (found ? ' ok' : ''), role: 'status' }, h('span', { class: 'pled' }),
      found ? T('pedal_found', cur ? cur.name : '') : T('pedal_none') + (IS_ANDROID ? ' ' + T('pedal_none_android') : '')));
    if ((!found && u.ports.length) || u.ports.filter(p => /gp-200/i.test(p.name)).length > 1) {
      box.appendChild(h('label', { class: 'f', style: 'max-width:340px' }, T('pedal_port'),
        h('select', { id: 'pedal-port', disabled: busy, onchange: e => { u.outId = e.target.value || null; render(); } },
          h('option', { value: '' }, '–'), u.ports.map(p => h('option', { value: p.id, selected: p.id === u.outId }, p.name || p.id)))));
    }
    if (found) box.appendChild(h('div', null,
      h('button', { type: 'button', class: 'btn small', id: 'pedal-read', title: T('pr_read_tip'), disabled: busy || s.pr.busy, onclick: () => pedalFetch({ manual: true, show: true, replace: true }) }, s.pr.busy ? T('pr_busy') : T('pr_read')),
      h('p', { class: 'help', text: T('pr_read_help') })));
    if (!found) box.appendChild(h('div', null, h('button', { type: 'button', class: 'btn small', onclick: () => { pedalRefresh(); render(); } }, T('pedal_retry'))));
    if (found && !gr.length) box.appendChild(h('p', { class: 'help', text: T('pedal_nofile') }));
    if (found && gr.length) {
      const bankStr = n => slotName2(u.bank, n);
      const n3 = Math.min(3, gr.length);
      box.appendChild(h('div', { class: 'row slotrow' },
        h('label', { class: 'f' }, T('pedal_bank'), h('select', { id: 'pedal-bank', disabled: busy, onchange: e => { u.bank = +e.target.value; u.confirm = null; save(); render(); } },
          Array.from({ length: USB.SLOT_MAX }, (_, i) => h('option', { value: String(i + 1), selected: i + 1 === u.bank }, String(i + 1))))),
        h('label', { class: 'f' }, T('pedal_letter'), h('select', { id: 'pedal-letter', disabled: busy, onchange: e => { u.letter = e.target.value; u.confirm = null; save(); render(); } },
          ['A', 'B', 'C', 'D'].map(l => h('option', { value: l, selected: l === u.letter }, l))))));
      if (u.confirm) {
        const names = u.confirm === 'three' ? Array.from({ length: n3 }, (_, i) => bankStr('ABCD'[i])).join(', ') : bankStr(u.letter);
        box.appendChild(h('div', { class: 'note', role: 'alertdialog' }, h('p', { text: T('pedal_confirm', names) }),
          h('div', { class: 'actions', style: 'margin-top:10px' },
            h('button', { type: 'button', class: 'btn go small', id: 'pedal-yes', onclick: () => pedalSend(u.confirm, gr) }, T('pedal_confirm_go')),
            h('button', { type: 'button', class: 'btn small', onclick: () => { u.confirm = null; render(); } }, T('cancel')))));
      } else {
        box.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', id: 'pedal-one', disabled: busy, onclick: () => { u.confirm = 'one'; u.result = null; render(); } }, T('pedal_send_one', bankStr(u.letter))),
          n3 > 1 ? h('button', { type: 'button', class: 'btn', id: 'pedal-three', disabled: busy, onclick: () => { u.confirm = 'three'; u.result = null; render(); } },
            T('pedal_send_three', n3, Array.from({ length: n3 }, (_, i) => bankStr('ABCD'[i])).join(', '))) : null));
      }
    }
    if (busy) box.appendChild(h('div', { class: 'prog', role: 'progressbar' }, h('div', { class: 'bar' }, h('i', { id: 'pedal-bar', style: 'width:2%' })), h('span', { id: 'pedal-label', text: u.sending.label })));
    if (u.result) {
      box.appendChild(h('p', { class: 'note ' + (u.result.kind === 'ok' ? 'ok' : 'err'), role: u.result.kind === 'ok' ? 'status' : 'alert', text: u.result.text }));
      if (u.result.kind === 'ok' && u.flags.noAck) box.appendChild(h('p', { class: 'note', text: T('pedal_noack') }));
      if (u.result.kind === 'ok' && u.flags.blind) box.appendChild(h('p', { class: 'note', text: T('pedal_blind') }));
    }
    if (u.state === 'ready') box.appendChild(listenLogBlock());
    return box;
  }

  // ------------------------------------------------------------------- set list
  // Module a part : une selection de presets de la bibliotheque (♥), un nom et un emplacement pour chacun, puis une ecriture en masse dans la pedale.
  // Les fichiers de la bibliotheque ne sont jamais modifies : le nom choisi n'existe que dans la copie envoyee (SL.renameRaw).
  const slInLib = f => s.lib.some(r => r.files.indexOf(f) >= 0);
  function slItems() {
    const sl = s.sl;
    if (sl.items.some(it => !slInLib(it.f))) sl.items = sl.items.filter(it => slInLib(it.f));      // un preset retire de la liste sort aussi de la set list
    return sl.items;
  }
  const slKept = f => slItems().some(it => it.f === f);
  function slToggle(f) {
    const sl = s.sl, i = slItems().findIndex(it => it.f === f);
    if (i >= 0) sl.items.splice(i, 1); else sl.items.push({ f, name: SL.defaultName(f), bank: '', letter: '' });
    sl.confirm = false; sl.result = null; sl.fillMsg = '';
    render();
  }
  const slPlan = () => SL.plan(slItems().map(it => ({ name: it.name, bank: it.bank, letter: it.letter })), { work: s.inj.set ? [{ bank: s.inj.bank, letter: s.inj.letter, why: 'inj' }] : [] });
  function slEdit(fn) { const sl = s.sl; fn(slItems()); sl.confirm = false; sl.result = null; render(); }
  function setSlProgress(pct, label) {
    const b = document.getElementById('sl-bar'), l = document.getElementById('sl-label');
    if (b) b.style.width = Math.max(0, Math.min(100, pct)).toFixed(0) + '%';
    if (l) l.textContent = label;
  }
  function slRepaintFoot() { const f = document.getElementById('sl-foot'); if (f) f.replaceWith(slFoot()); }

  async function slSend() {
    const sl = s.sl, u = s.usb, items = slItems(), pl = slPlan();
    if (!pl.ok || !pedalFound() || tuneActive() || u.sending || s.inj.busy) return;
    const jobs = pl.jobs.map(j => ({ ...j, raw: SL.renameRaw(items[j.i].f.raw, j.name) }));
    clearTimeout(s.inj.t); s.inj.t = null;
    await liveStop();
    sl.confirm = false; sl.result = null; u.flags = {}; u.result = null; u.sending = { label: T('pedal_hs') };
    render();
    const done = [];
    try {
      u.link.select(u.outId);
      await u.link.open();
      for (let k = 0; k < jobs.length; k++) {
        const j = jobs[k], suffix = T('pedal_job', k + 1, jobs.length);
        await u.link.pushPreset(j.bank, j.letter, j.raw, {
          onProgress: (step, total) => setSlProgress(((k * (total + 2) + step) / (jobs.length * (total + 2))) * 100,
            j.label + ' · ' + j.name + ' · ' + (step === 0 ? T('pedal_hs') : step <= total ? T('pedal_chunk', step, total) : T('pedal_hs').replace(/…$/, '') + ' ✓') + suffix),
        });
        done.push(j.label);
      }
      await sleep(350);
      u.link.selectPreset(jobs[0].bank, jobs[0].letter);
      sl.result = { kind: 'ok', text: T('sl_done', jobs.length, done.join(', '), jobs[0].label) };
    } catch (e) {
      sl.result = { kind: 'err', text: T('sl_fail', done.length, jobs.length, done.join(', ') || '–', usbErr(e)) };
    } finally {
      try { await u.link.close(); } catch (e) { /* rien */ }
      u.sending = null;
      forgetPedalState();                       // la pedale est maintenant sur un autre patch que celui affiche : plus rien n'est « deja envoye »
      render();
    }
  }
  function slZip() {
    const items = slItems();
    if (!items.length || items.some(it => !SL.cleanName(it.name))) return;
    const d = new Date(), p2 = n => (n < 10 ? '0' : '') + n;
    const zi = items.map(it => {
      const name = SL.cleanName(it.name), lab = SL.slotLabel(it.bank, it.letter);
      const fname = ((lab !== '?' ? lab + '_' : '') + name).replace(/[^A-Za-z0-9 _.()+-]/g, '_') + '.prst';
      return { f: { filename: fname, folder: '', raw: SL.renameRaw(it.f.raw, name), spec: { ...it.f.spec, name } }, res: null };
    });
    zipFiles(zi, 'setlist_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()));
  }

  function slMessages(pl, items) {
    const out = [], miss = pl.errors.filter(e => e.code === 'slot_missing').length;
    pl.errors.forEach(e => {
      if (e.code === 'slot_missing' || e.code === 'empty_list') return;
      const n = e.i + 1;
      out.push(h('li', { class: 'err', text: e.code === 'too_many' ? T('sl_e_many') : e.code === 'name_empty' ? T('sl_e_name', n) : e.code === 'slot_range' ? T('sl_e_range', n) : T('sl_e_dup', n, e.with + 1) }));
    });
    if (miss) out.push(h('li', { class: 'err', text: T('sl_e_missing', miss) }));
    pl.warnings.forEach(w => {
      const n = w.i + 1, it = items[w.i];
      out.push(h('li', { class: 'warn', text: w.code === 'name_changed' ? T('sl_w_changed', n, SL.cleanName(it.name)) : w.code === 'name_dup' ? T('sl_w_dup', n, w.with + 1) : T('sl_w_work', n, SL.slotLabel(it.bank, it.letter)) }));
    });
    return out;
  }
  function slFoot() {
    const sl = s.sl, u = s.usb, items = slItems(), pl = slPlan(), foot = h('div', { class: 'sl-foot', id: 'sl-foot' });
    const msgs = slMessages(pl, items);
    if (msgs.length) foot.appendChild(h('ul', { class: 'sl-msgs', id: 'sl-msgs' }, msgs));
    const found = pedalFound(), busy = !!u.sending, can = pl.ok && found && !busy && !s.inj.busy;
    if (!can) sl.confirm = false;
    if (sl.confirm) {
      foot.appendChild(h('div', { class: 'note', role: 'alertdialog', id: 'sl-confirm' }, h('p', { text: T('sl_confirm') }),
        h('ul', { class: 'sl-ow', id: 'sl-ow' }, pl.jobs.map(j => h('li', { text: j.label + '  ←  ' + j.name }))),
        h('div', { class: 'actions', style: 'margin-top:10px' },
          h('button', { type: 'button', class: 'btn go small', id: 'sl-yes', title: T('sl_confirm_go'), onclick: slSend }, T('sl_confirm_go')),
          h('button', { type: 'button', class: 'btn small', id: 'sl-no', title: T('cancel'), onclick: () => { sl.confirm = false; render(); } }, T('cancel')))));
    } else {
      foot.appendChild(h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn go', id: 'sl-send', disabled: !can, title: T('sl_send', items.length), onclick: () => { sl.confirm = true; sl.result = null; render(); } }, T('sl_send', items.length)),
        h('button', { type: 'button', class: 'btn', id: 'sl-zip', disabled: !items.length || items.some(it => !SL.cleanName(it.name)), title: T('sl_zip_hint'), onclick: slZip }, T('sl_zip'))));
    }
    return foot;
  }
  function setlistPanel() {
    const sl = s.sl, u = s.usb, items = slItems();
    const box = h('section', { class: 'setlist panel', id: 'setlist-panel', 'aria-labelledby': 'h-setlist' });
    box.appendChild(h('header', null, h('div', null, h('h2', { id: 'h-setlist', text: T('sl_title') }), h('p', { class: 'sub', text: T('sl_sub') }))));
    const body = h('div', { class: 'body' });
    box.appendChild(body);
    if (tuneActive()) { body.appendChild(h('p', { class: 'note', text: T('tune_pedal_busy') })); return box; }
    const busy = !!u.sending;
    if (sl.result) body.appendChild(h('p', { class: 'note ' + (sl.result.kind === 'ok' ? 'ok' : 'err'), id: 'sl-result', role: sl.result.kind === 'ok' ? 'status' : 'alert', text: sl.result.text }));
    if (!items.length) { body.appendChild(h('p', { class: 'note', id: 'sl-empty', text: T('sl_empty') })); return box; }

    const bankSel = (val, onch, id, lab, noBlank) => h('select', { id, 'aria-label': lab, title: lab, disabled: busy, onchange: onch },
      noBlank ? null : h('option', { value: '' }, '–'), Array.from({ length: USB.SLOT_MAX }, (_, i) => h('option', { value: String(i + 1), selected: String(val) === String(i + 1) }, String(i + 1))));
    const letSel = (val, onch, id, lab, noBlank) => h('select', { id, 'aria-label': lab, title: lab, disabled: busy, onchange: onch },
      noBlank ? null : h('option', { value: '' }, '–'), SL.LETTERS.map(l => h('option', { value: l, selected: val === l }, l)));
    const ib = (id, label, txt, fn, dis) => h('button', { type: 'button', class: 'btn small ghost', id, 'aria-label': label, title: label, disabled: !!dis || busy, onclick: fn }, txt);

    body.appendChild(h('div', { class: 'stepbox' },
      h('div', { class: 'sl-fillrow' },
        h('span', { class: 'help', style: 'margin:0 0 6px', text: T('sl_fill_from') }),
        h('label', { class: 'f' }, T('sl_slot_bank'), bankSel(sl.start.bank, e => { sl.start.bank = +e.target.value || 1; }, 'sl-fill-bank', T('sl_slot_bank'), true)),
        h('label', { class: 'f' }, T('sl_slot_letter'), letSel(sl.start.letter, e => { sl.start.letter = e.target.value || 'A'; }, 'sl-fill-letter', T('sl_slot_letter'), true)),
        h('button', { type: 'button', class: 'btn small', id: 'sl-fill', disabled: busy, title: T('sl_fill_title'), onclick: () => slEdit(a => {
          const fl = SL.fill(sl.start.bank, sl.start.letter, a.length);
          a.forEach((it, i) => { const sp = fl.slots[i]; it.bank = sp ? sp.bank : ''; it.letter = sp ? sp.letter : ''; });
          sl.fillMsg = fl.overflow ? T('sl_fill_over', a.length - fl.slots.length) : '';
        }) }, T('sl_fill'))),
      sl.fillMsg ? h('p', { class: 'note', id: 'sl-fill-msg', text: sl.fillMsg }) : null));

    body.appendChild(h('div', { class: 'stepbox', id: 'sl-batch' },
      h('ul', { class: 'tlist sl-list', id: 'sl-list' }, items.map((it, i) => h('li', { 'data-i': String(i) },
        h('span', { class: 'sl-num', text: String(i + 1) }),
        h('input', { type: 'text', class: 'sl-name', id: 'sl-name-' + i, value: it.name, maxlength: String(SL.MAX_NAME), autocomplete: 'off', spellcheck: 'false', 'aria-label': T('sl_name'), title: T('sl_name'), disabled: busy,
          oninput: e => { it.name = e.target.value; sl.confirm = false; sl.result = null; slRepaintFoot(); } }),
        bankSel(it.bank, e => { it.bank = e.target.value === '' ? '' : +e.target.value; sl.confirm = false; sl.result = null; render(); }, 'sl-bank-' + i, T('sl_slot_bank')),
        letSel(it.letter, e => { it.letter = e.target.value; sl.confirm = false; sl.result = null; render(); }, 'sl-letter-' + i, T('sl_slot_letter')),
        h('span', { class: 'tmv' },
          ib('sl-up-' + i, T('tune_up'), '↑', () => slEdit(a => { const x = a.splice(i, 1)[0]; a.splice(i - 1, 0, x); }), i === 0),
          ib('sl-down-' + i, T('tune_down'), '↓', () => slEdit(a => { const x = a.splice(i, 1)[0]; a.splice(i + 1, 0, x); }), i === items.length - 1),
          ib('sl-rm-' + i, T('sl_unkeep', it.f.spec.name || it.f.filename), '✕', () => slEdit(a => { a.splice(i, 1); }))),
        h('span', { class: 'sl-src', text: tuneFileLabel(it.f, tuneResOf(it.f)) })))),
      h('p', { class: 'help', id: 'sl-count', text: T('sl_count', items.length) })));

    if (u.state !== 'ready') {
      body.appendChild(h('div', { class: 'stepbox' }, h('p', { class: 'help', text: T('sl_need_pedal') }),
        u.state === 'unsupported' ? h('p', { class: 'note', text: T('pedal_unsupported') })
          : h('div', null, h('button', { type: 'button', class: 'btn', id: 'sl-pedal', disabled: u.state === 'asking', title: T('pedal_connect'), onclick: pedalConnect }, u.state === 'asking' ? T('pedal_asking') : T('pedal_connect'))),
        u.state === 'denied' || u.state === 'error' ? h('p', { class: 'note err', role: 'alert', text: u.error }) : null));
    } else if (!u.outId) {
      body.appendChild(h('p', { class: 'note', id: 'sl-nopedal', text: T('pedal_none') }));
    }
    body.appendChild(slFoot());
    if (busy) body.appendChild(h('div', { class: 'prog', role: 'progressbar' }, h('div', { class: 'bar' }, h('i', { id: 'sl-bar', style: 'width:2%' })), h('span', { id: 'sl-label', text: u.sending.label })));
    body.appendChild(h('p', { class: 'help', text: T('sl_zip_hint') }));
    return box;
  }

  // ------------------------------------------------- harmonisation du volume
  const nowS = () => performance.now() / 1000;
  const fmtLufs = v => (v === null || v === undefined) ? '   ---' : (v >= 0 ? '+' : '') + v.toFixed(1);
  /** mini printf : %d %s %.0f %+.1f (les seuls formats des textes du batch). */
  function sprintf(fmt, args) {
    let i = 0;
    return fmt.replace(/%(\+?)(?:\.(\d))?([dsf])/g, (m, plus, prec, ty) => {
      const a = args[i++];
      if (ty === 's') return String(a);
      if (ty === 'd') return String(Math.trunc(a));
      const v = Number(a), p = prec === undefined ? 6 : +prec;
      const out = p === 0 ? String(TUNE.roundHalfEven(v)) : v.toFixed(p);
      return (plus && v >= 0 ? '+' : '') + out;
    });
  }
  function hintText(hh) {
    if (!hh) return '';
    const dict = D[s.lang];
    const args = hh.args.map(a => a === 'LIMIT' ? dict.batch_hint_patch_limit : a === 'FLOOR' ? dict.batch_hint_floor : a === 'CEILING' ? dict.batch_hint_ceiling : a);
    return sprintf(dict[hh.key] || hh.key, args);
  }
  /** Ouvre le formulaire du lot (sans preset charge, il est directement la). */
  function tuneOpenForm() {
    const t = s.tune, u = s.usb;
    t.open = true; t.msg = null;
    if (!t.bank) { t.bank = s.inj.set ? s.inj.bank : u.bank; t.letter = s.inj.set ? s.inj.letter : u.letter; }
  }
  const tuneActive = () => !!(s.tune.run && !s.tune.run.finished);
  // Le lot a harmoniser : par defaut les presets du resultat affiche ; des qu'on y touche, une selection libre parmi toute la bibliotheque (ordre = ordre de mesure).
  const tuneInLib = f => s.lib.some(r => r.files.indexOf(f) >= 0);
  const tuneLibFiles = () => { const out = []; s.lib.forEach(res => res.files.forEach(f => out.push({ f, res }))); return out; };
  function tuneFiles() {
    const t = s.tune;
    if (t.sel) { if (t.sel.some(f => !tuneInLib(f))) t.sel = t.sel.filter(tuneInLib); return t.sel; }
    return s.res ? s.res.files : [];
  }
  function tuneEditSel(fn) { const t = s.tune; if (!t.sel) t.sel = s.res ? s.res.files.slice() : []; fn(t.sel); t.confirm = false; render(); }
  function tuneFileLabel(f, res) {
    return (s.lib.length > 1 ? (res.label || res.headline) + ' · ' : '') + ((f.section && f.section.nom && !res.single) ? f.section.nom + ' · ' : '') + (f.variant && f.variant.label ? f.variant.label + ' · ' : '') + (f.spec.name || f.filename);
  }
  const tuneResOf = f => s.lib.find(r => r.files.indexOf(f) >= 0) || s.res;
  const defaultPtype = f => (f.section && f.section.role === 'lead' ? 'LEAD' : 'NORMAL');
  const ptypeOf = f => f.tptype || defaultPtype(f);
  const tuneSlotName = () => slotName2(s.tune.bank || s.usb.bank, s.tune.letter || s.usb.letter);

  async function tuneAudioAsk() {
    const a = s.tune.audio;
    a.state = 'asking'; a.err = ''; render();
    try {
      const devs = await LUFS.MicSource.listInputs();
      a.devs = devs;
      const guess = devs.find(d => /gp-?200|valeton/i.test(d.label));
      const act = devs.find(d => d.active);
      a.guessed = !!guess;
      a.id = guess ? guess.id : (act ? act.id : (devs[0] ? devs[0].id : ''));
      a.state = devs.length ? 'ready' : 'error';
      if (!devs.length) a.err = T('tune_audio_none');
    } catch (e) {
      a.state = 'error';
      a.err = /denied|not allowed|permission/i.test(String((e && e.name) + ' ' + (e && e.message))) ? T('tune_audio_denied') : T('tune_err_audio', String((e && e.message) || e).slice(0, 200));
    }
    render();
  }

  function tuneFail(text) {
    const r = s.tune.run;
    tuneShutdown();
    if (r) { r.finished = true; r.error = text; r.pushing = false; }
    s.tune.msg = { kind: 'err', text };
    render();
  }
  function tuneShutdown() {
    const r = s.tune.run; if (!r) return;
    clearInterval(r.timer); r.timer = null;
    if (r.src) { try { r.src.stop(); } catch (e) { /* rien */ } r.src = null; }
    const u = s.usb;
    if (u.link) { u.link.close().catch(() => {}); }
  }

  async function tuneStart() {
    const t = s.tune, u = s.usb;
    await liveStop(); s.tab = 'tune';
    t.confirm = false; t.msg = null;
    const items = tuneFiles().map(f => {
      const entry = TUNE.makeEntry(f.spec.name || f.filename, f.raw, ptypeOf(f));
      TUNE.analyze(entry, tb);
      return { file: f, entry, tuner: new TUNE.Tuner(entry) };
    });
    const r = { items, idx: -1, cur: null, paused: false, pushing: false, finished: false, error: '', engine: null, src: null, timer: null,
      bank: t.bank || u.bank, letter: t.letter || u.letter, view: { m: null, st: null, itg: null, delta: null, hint: '', tone: 'idle' }, status: '' };
    t.run = r; render();
    try {
      u.link.select(u.outId);
      await u.link.open();
    } catch (e) { return tuneFail(T('tune_err_usb', usbErr(e))); }
    try {
      r.src = await LUFS.MicSource.start(t.audio.id, c => { if (r.engine) r.engine.push(c); });
      r.engine = new LUFS.LufsEngine(null, r.src.rate);
    } catch (e) { return tuneFail(T('tune_err_audio', String((e && e.message) || e).slice(0, 200))); }
    r.timer = setInterval(tuneTick, 150);
    await tuneGo(0);
  }

  /** = _go_next / _go_prev + _play_current_preset (+ _push_preset_bg). */
  async function tuneGo(idx) {
    const r = s.tune.run; if (!r || r.finished) return;
    if (r.cur && r.cur.entry.status === 'run') r.cur.entry.status = 'wait';
    if (idx >= r.items.length) return tuneFinish();
    r.idx = idx; r.cur = r.items[idx];
    r.paused = false;
    await tunePush(false);
  }
  async function tunePush(resend) {
    const r = s.tune.run; if (!r || r.finished) return;
    const it = r.cur, e = it.entry;
    if (resend) it.tuner.resend(nowS()); else it.tuner.load(nowS());
    r.view = { m: null, st: null, itg: null, delta: null, hint: '', tone: 'idle' };
    r.pushing = true; r.status = T('tune_pushing', slotName2(r.bank, r.letter)); render();
    try {
      await sleep(200);
      await s.usb.link.pushPreset(r.bank, r.letter, Uint8Array.from(e.data), {
        onProgress: (step, total) => { const l = document.getElementById('tune-push'); if (l) l.textContent = T('tune_pushing', step === 0 ? '…' : step + '/' + total); },
      });
    } catch (err) { return tuneFail(T('tune_err_usb', usbErr(err))); }
    if (r.finished) return;
    if (r.engine) r.engine.reset();
    r.pushing = false; r.status = T('tune_audio_on');
    it.tuner.load(nowS());          // 2,5 s de grace APRES l'envoi, pour avoir le temps de jouer
    render();
  }

  function tuneCommit(it, itg) {
    const e = it.entry;
    it.file.raw = Uint8Array.from(e.data);
    it.file.decoded = G.decodePrst(it.file.raw, tb);
    it.file.tuned = { lufs: itg, patch: e.patchVolNew, amp: e.ampVolNew, gain: e.ampGainNew, cab: e.cabVolNew, status: e.status };
  }

  function tuneTick() {
    const r = s.tune.run; if (!r || r.finished || r.paused || !r.cur) return;
    const eng = r.engine; if (!eng) return;
    if (eng.dirty) eng.measure();
    const [m, st, itg] = eng.last;
    if (r.pushing) { r.view.m = r.view.st = r.view.itg = r.view.delta = null; paintTune(); return; }
    const it = r.cur, now = nowS();
    r.view.m = m; r.view.st = st; r.view.itg = itg;
    let out;
    try { out = it.tuner.update(now, itg, { usb: true, busy: false }); } catch (e) { return tuneFail(String(e && e.message || e)); }
    r.view.delta = out.delta;
    if (out.hint !== undefined) r.view.hint = hintText(out.hint);
    if (out.tone !== undefined) r.view.tone = out.tone;
    if (out.action) {
      try {
        const a = out.action;
        if (a.type === 'patch') s.usb.link.sendPatchVol(a.value); else s.usb.link.sendParam(a.module, a.param, a.value, it.entry.data);
      } catch (e) { return tuneFail(T('tune_err_usb', usbErr(e))); }
      eng.reset(); r.view.itg = null;
    }
    if (out.applied) tuneApplied(it, itg);
    paintTune();
  }

  /** = _apply (cote navigateur) : enregistre dans la page + renvoie le preset corrige a la pedale. */
  async function tuneApplied(it, itg) {
    const r = s.tune.run;
    tuneCommit(it, itg);
    if (r.engine) r.engine.reset();
    r.pushing = true; r.status = T('tune_pushing', slotName2(r.bank, r.letter)); render();
    try {
      await sleep(50);
      await s.usb.link.pushPreset(r.bank, r.letter, Uint8Array.from(it.entry.data), {
        onProgress: (step, total) => { const l = document.getElementById('tune-push'); if (l) l.textContent = T('tune_pushing', step === 0 ? '…' : step + '/' + total); },
      });
    } catch (err) { return tuneFail(T('tune_err_usb', usbErr(err))); }
    if (r.finished) return;
    if (r.engine) r.engine.reset();
    r.pushing = false; r.status = T('tune_audio_on');
    render();
  }

  function tuneKeep() {
    const r = s.tune.run; if (!r || !r.cur || r.pushing) return;
    const itg = r.engine && r.engine.last[2];
    if (itg === null || itg === undefined) return;
    r.cur.tuner._apply(nowS(), itg);
    tuneApplied(r.cur, itg);
  }
  function tunePause() {
    const r = s.tune.run; if (!r || r.pushing) return;
    r.paused = !r.paused;
    if (r.paused) { if (r.engine) r.engine.reset(); r.view.hint = ''; r.status = T('tune_paused'); }
    else r.status = T('tune_audio_on');
    render();
  }
  function tuneFinish() {
    const r = s.tune.run; if (!r) return;
    tuneShutdown(); r.finished = true; r.pushing = false;
    const done = r.items.filter(i => i.entry.status === 'done').length;
    s.tune.msg = { kind: 'ok', text: T('tune_done_fmt', done, r.items.length) };
    render();
  }
  function tuneStop() {
    const r = s.tune.run; if (!r) return;
    tuneShutdown(); r.finished = true; r.pushing = false;
    s.tune.msg = { kind: 'ok', text: T('tune_stopped') };
    render();
  }

  /** met a jour les compteurs sans reconstruire la page */
  function paintTune() {
    const r = s.tune.run; if (!r || r.finished) return;
    const set = (id, txt) => { const el = document.getElementById(id); if (el && el.textContent !== txt) el.textContent = txt; };
    const v = r.view;
    set('t-mom', fmtLufs(v.m)); set('t-st', fmtLufs(v.st)); set('t-itg', fmtLufs(v.itg));
    set('t-delta', v.delta === null || v.delta === undefined ? '   ---' : (v.delta >= 0 ? '+' : '') + v.delta.toFixed(1));
    set('t-hint', r.paused ? T('tune_paused') : (v.hint || (r.pushing ? '' : T('tune_hint_play'))));
    const g = document.getElementById('t-gauge');
    if (g) {
      const d = v.delta === null || v.delta === undefined ? 0 : Math.max(-9, Math.min(9, v.delta));
      g.style.setProperty('--pos', (50 + d / 9 * 50).toFixed(1) + '%');
      g.className = 'gauge ' + (v.delta === null || v.delta === undefined ? 'idle' : (v.tone === 'ok' ? 'ok' : 'idle'));
    }
    const dl = document.getElementById('t-delta'); if (dl) dl.className = 'mv delta ' + (v.tone === 'ok' ? 'ok' : '');
    const keep = document.getElementById('t-keep'); if (keep) keep.disabled = r.pushing || v.itg === null || v.itg === undefined;
  }

  function tunePanel() {
    const t = s.tune, u = s.usb;
    const box = h('section', { class: 'tune panel', id: 'tune-panel', 'aria-labelledby': 'h-tune' });
    const canListen = LUFS && LUFS.MicSource.supported() && u.state !== 'unsupported';
    const run = t.run;
    box.appendChild(h('header', null, h('div', null, h('h2', { id: 'h-tune', text: T('tune_title') }), h('p', { class: 'sub', text: T('tune_sub') }))));
    const body = h('div', { class: 'body' });
    box.appendChild(body);
    if (t.msg) body.appendChild(h('p', { class: 'note ' + (t.msg.kind === 'err' ? 'err' : 'ok'), role: t.msg.kind === 'err' ? 'alert' : 'status', text: t.msg.text }));
    if (!canListen) { body.appendChild(h('p', { class: 'note', text: T('tune_unsupported') })); return box; }

    if (run && !run.finished) { tuneRunning(body, run); return box; }

    if (!t.open) {
      body.appendChild(h('p', { class: 'help', text: T('tune_what') }));
      body.appendChild(h('ol', { class: 'help' }, D[s.lang].tune_steps.map(x => h('li', { text: x }))));
      body.appendChild(h('div', null, h('button', { type: 'button', class: 'btn', id: 'tune-open', onclick: () => { tuneOpenForm(); render(); } }, T('tune_title'))));
      if (run && run.finished) body.appendChild(tuneSummary(run));
      return box;
    }

    if (run && run.finished && run.items.length) body.appendChild(tuneSummary(run));      // bilan du dernier lot (+ zip), au-dessus du formulaire pour en relancer un autre
    // ---- preparation
    const found = u.state === 'ready' && !!u.outId;
    const cur = u.ports.find(p => p.id === u.outId);
    body.appendChild(h('div', { class: 'stepbox' }, h('h3', { text: 'A · ' + T('tune_a') }),
      u.state !== 'ready'
        ? [h('p', { class: 'help', text: T('tune_pedal_need') }),
           h('div', null, h('button', { type: 'button', class: 'btn', id: 'tune-pedal', disabled: u.state === 'asking', onclick: pedalConnect }, u.state === 'asking' ? T('pedal_asking') : T('pedal_connect'))),
           u.state === 'denied' || u.state === 'error' ? h('p', { class: 'note err', role: 'alert', text: u.error }) : null]
        : h('p', { class: 'pstate' + (found ? ' ok' : ''), role: 'status' }, h('span', { class: 'pled' }), found ? T('tune_pedal_ok', cur ? cur.name : '') : T('pedal_none'))));

    const a = t.audio;
    body.appendChild(h('div', { class: 'stepbox' }, h('h3', { text: 'B · ' + T('tune_b') }),
      a.state !== 'ready'
        ? [h('div', null, h('button', { type: 'button', class: 'btn', id: 'tune-audio', disabled: a.state === 'asking', onclick: tuneAudioAsk }, a.state === 'asking' ? T('tune_audio_asking') : T('tune_audio_ask'))),
           a.err ? h('p', { class: 'note err', role: 'alert', text: a.err }) : null]
        : [h('label', { class: 'f', style: 'max-width:420px' }, T('tune_audio_pick'),
             h('select', { id: 'tune-audio-sel', onchange: e => { a.id = e.target.value; a.guessed = false; render(); } },
               a.devs.map(d => h('option', { value: d.id, selected: d.id === a.id }, d.label || d.id || '?')))),
           h('div', { class: 'row', style: 'align-items:center' },
             h('button', { type: 'button', class: 'btn small ghost', id: 'tune-audio-refresh', style: 'flex:0 0 auto', onclick: tuneAudioAsk }, T('tune_audio_refresh')),
             h('p', { class: 'help', style: 'margin:0', text: a.guessed ? T('tune_audio_found') : T('tune_audio_guess') }))]));

    body.appendChild(h('div', { class: 'stepbox' }, h('h3', { text: 'C · ' + T('tune_c') }), h('p', { class: 'help', text: T('tune_slot_help') }),
      h('div', { class: 'row slotrow' },
        h('label', { class: 'f' }, T('pedal_bank'), h('select', { id: 'tune-bank', onchange: e => { t.bank = +e.target.value; t.confirm = false; render(); } },
          Array.from({ length: USB.SLOT_MAX }, (_, i) => h('option', { value: String(i + 1), selected: i + 1 === t.bank }, String(i + 1))))),
        h('label', { class: 'f' }, T('pedal_letter'), h('select', { id: 'tune-letter', onchange: e => { t.letter = e.target.value; t.confirm = false; render(); } },
          ['A', 'B', 'C', 'D'].map(l => h('option', { value: l, selected: l === t.letter }, l)))))));

    const files = tuneFiles(), lib = tuneLibFiles(), avail = lib.filter(x => files.indexOf(x.f) < 0);
    const ib = (id, label, txt, fn, dis) => h('button', { type: 'button', class: 'btn small ghost', id, 'aria-label': label, title: label, disabled: !!dis, onclick: fn }, txt);
    body.appendChild(h('div', { class: 'stepbox', id: 'tune-batch' }, h('h3', { text: 'D · ' + T('tune_d') }),
      h('p', { class: 'help', text: T('tune_batch_hint') }),
      files.length ? h('ul', { class: 'tlist' }, files.map((f, i) => h('li', { 'data-i': String(i) },
        h('span', { class: 'tn', text: (i + 1) + '. ' + tuneFileLabel(f, tuneResOf(f)) }),
        h('select', { 'aria-label': T('tune_type'), 'data-file': f.filename, onchange: e => { f.tptype = e.target.value; render(); } },
          h('option', { value: 'NORMAL', selected: ptypeOf(f) === 'NORMAL' }, T('tune_normal')),
          h('option', { value: 'LEAD', selected: ptypeOf(f) === 'LEAD' }, T('tune_lead'))),
        h('span', { class: 'tmv' },
          ib('tune-up-' + i, T('tune_up'), '↑', () => tuneEditSel(a => { const x = a.splice(i, 1)[0]; a.splice(i - 1, 0, x); }), i === 0),
          ib('tune-down-' + i, T('tune_down'), '↓', () => tuneEditSel(a => { const x = a.splice(i, 1)[0]; a.splice(i + 1, 0, x); }), i === files.length - 1),
          ib('tune-rm-' + i, T('tune_rm'), '✕', () => tuneEditSel(a => { a.splice(i, 1); })))))) : h('p', { class: 'note', id: 'tune-sel-empty', text: T('tune_sel_empty') }),
      h('p', { class: 'help', id: 'tune-count', text: T('tune_count', files.length) }),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', { type: 'button', class: 'btn small', id: 'tune-open-files', onclick: () => { const i = document.getElementById('prst-file'); if (i) i.click(); } }, T('tune_open_files')),
        avail.length ? h('button', { type: 'button', class: 'btn small', id: 'tune-add-all', onclick: () => tuneEditSel(a => { avail.forEach(x => a.push(x.f)); }) }, T('tune_add_all')) : null,
        files.length ? h('button', { type: 'button', class: 'btn small ghost', id: 'tune-clear', onclick: () => tuneEditSel(a => { a.length = 0; }) }, T('tune_clear')) : null),
      h('details', { class: 'tavail', id: 'tune-add', open: !!t.addOpen || (!files.length && avail.length > 0), ontoggle: e => { t.addOpen = e.target.open; } },
        h('summary', { text: T('tune_add_title', avail.length) }),
        avail.length ? h('ul', { class: 'tlist' }, avail.map(x => h('li', null,
          h('span', { class: 'tn', text: tuneFileLabel(x.f, x.res) }),
          h('button', { type: 'button', class: 'btn small tune-add', 'aria-label': T('tune_add') + ' : ' + (x.f.spec.name || x.f.filename), onclick: () => tuneEditSel(a => { a.push(x.f); }) }, '＋ ' + T('tune_add')))))
          : h('p', { class: 'help', text: T('tune_none_avail') }))));

    const ready = found && a.state === 'ready' && files.length > 0;
    if (t.confirm) {
      body.appendChild(h('div', { class: 'note', role: 'alertdialog' }, h('p', { text: T('tune_confirm', tuneSlotName()) }),
        h('div', { class: 'actions', style: 'margin-top:10px' },
          h('button', { type: 'button', class: 'btn go small', id: 'tune-yes', onclick: tuneStart }, T('tune_confirm_go')),
          h('button', { type: 'button', class: 'btn small', onclick: () => { t.confirm = false; render(); } }, T('cancel')))));
    } else {
      body.appendChild(h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn go', id: 'tune-start', disabled: !ready, onclick: () => { t.confirm = true; render(); } }, T('tune_start')),
        h('button', { type: 'button', class: 'btn', onclick: () => { t.open = false; render(); } }, T('cancel'))));
      if (!ready) body.appendChild(h('p', { class: 'help', text: T('tune_start_need') }));
    }
    return box;
  }

  function tuneRunning(body, r) {
    const e = r.cur ? r.cur.entry : null;
    const last = r.idx >= r.items.length - 1;
    if (e) body.appendChild(h('p', { class: 'tcur', id: 't-cur', text: T('tune_cur', r.idx + 1, r.items.length, e.name, e.ptype, fmtLufs(TUNE.TARGETS[e.ptype]).trim()) }));
    body.appendChild(h('p', { class: 'help', id: 't-status', text: r.pushing ? '' : r.status }));
    if (r.pushing) body.appendChild(h('p', { class: 'note', id: 'tune-push', role: 'status', text: r.status }));
    body.appendChild(h('div', { class: 'meters' },
      [['t-mom', 'm_mom'], ['t-st', 'm_st'], ['t-itg', 'm_itg'], ['t-delta', 'm_delta']].map(([id, k]) =>
        h('div', { class: 'meter' }, h('span', { class: 'ml', text: T(k) }), h('span', { class: 'mv' + (id === 't-delta' ? ' delta' : ''), id, text: '   ---' })))));
    body.appendChild(h('div', { class: 'gauge idle', id: 't-gauge', 'aria-hidden': 'true' }, h('i', { class: 'zone' }), h('i', { class: 'tick' })));
    body.appendChild(h('p', { class: 'thint', id: 't-hint', role: 'status', 'aria-live': 'polite', text: '' }));
    body.appendChild(h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', id: 't-pause', disabled: r.pushing, onclick: tunePause }, r.paused ? T('tune_resume') : T('tune_pause')),
      h('button', { type: 'button', class: 'btn', id: 't-resend', disabled: r.pushing, onclick: () => { r.paused = false; tunePush(true); } }, T('tune_resend')),
      h('button', { type: 'button', class: 'btn', id: 't-prev', disabled: r.pushing || r.idx <= 0, onclick: () => tuneGo(r.idx - 1) }, T('tune_prev')),
      h('button', { type: 'button', class: 'btn go', id: 't-next', disabled: r.pushing, onclick: () => tuneGo(r.idx + 1) }, last ? T('tune_finish') : T('tune_next')),
      h('button', { type: 'button', class: 'btn', id: 't-keep', disabled: true, onclick: tuneKeep }, T('tune_keep')),
      h('button', { type: 'button', class: 'btn', id: 't-stop', onclick: tuneStop }, T('tune_stop'))));
    body.appendChild(h('p', { class: 'help', text: T('tune_focus') }));
    body.appendChild(tuneList(r));
  }

  function stLabel(en) { return en.status === 'done' ? T('tune_st_done') : en.status === 'run' ? T('tune_st_run') : (en.tweakCount || en.lufsOk !== null ? T('tune_st_skip') : T('tune_st_wait')); }
  function tuneList(r) {
    return h('ol', { class: 'tlist prog-list' }, r.items.map((it, i) => {
      const en = it.entry, done = en.status === 'done';
      return h('li', { class: (i === r.idx ? 'cur ' : '') + (done ? 'done' : '') },
        h('span', { class: 'tn', text: en.name }),
        h('span', { class: 'ts', text: stLabel(en) + (done ? ' · ' + T('tune_row', en.patchVolNew, en.ampVolNew === null ? '–' : Math.round(en.ampVolNew)) : '') }));
    }));
  }
  function tuneSummary(r) {
    return h('div', null, h('h3', { text: T('tune_done_title') }), tuneList(r),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', id: 'tune-zip', onclick: () => downloadTuned(r) }, T('tune_zip'))));
  }

  // ------------------------------------------------------ ouverture globale de .prst
  function setupGlobal() {
    const inp = h('input', { type: 'file', id: 'prst-file', accept: '.prst,application/octet-stream', multiple: true, class: 'sr', tabindex: '-1', 'aria-hidden': 'true',
      onchange: e => { const fl = Array.from(e.target.files || []); e.target.value = ''; openFiles(fl); } });
    const veil = h('div', { id: 'dropveil', 'aria-hidden': 'true' });
    document.body.appendChild(inp); document.body.appendChild(veil);
    let depth = 0;
    const hasFiles = ev => !!(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf('Files') >= 0);
    window.addEventListener('dragenter', ev => { if (!hasFiles(ev)) return; ev.preventDefault(); depth++; veil.textContent = T('drop_here'); document.body.classList.add('dragging'); });
    window.addEventListener('dragover', ev => { if (hasFiles(ev)) ev.preventDefault(); });
    window.addEventListener('dragleave', ev => { if (!hasFiles(ev)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
    window.addEventListener('drop', ev => { if (!hasFiles(ev)) return; ev.preventDefault(); depth = 0; document.body.classList.remove('dragging'); openFiles(ev.dataTransfer.files); });
    window.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (document.getElementById('setup-modal')) { if (curKey() || s.noAi) { s.setupOpen = false; render(); } return; }
      if (document.getElementById('slot-modal')) { s.inj.open = false; render(); return; }
      if (document.getElementById('pop')) { s.tab = 'module'; render(); }
    });
  }
  /** Si l'autorisation MIDI a deja ete donnee a ce site, on rebranche la pedale sans rien demander. */
  async function pedalAuto() {
    try {
      if (!USB || !USB.MidiLink.supported() || !navigator.permissions) return;
      const st = await navigator.permissions.query({ name: 'midi', sysex: true });
      if (st.state === 'granted') pedalConnect();
    } catch (e) { /* pas d'API : on attend le clic */ }
  }

  // ------------------------------------------------------------------ demarrage
  load();
  diagInit();
  if (!PROVIDERS.every(p => B.providers[p])) throw new Error('providers manquants');
  setupGlobal();
  render();
  setInterval(listenTick, 1500);
  orCallback();
  pedalAuto();
  // pour les tests automatises uniquement
  self.__gp200 = { state: s, render };
})();
