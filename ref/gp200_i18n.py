# -*- coding: utf-8 -*-
"""Traductions de l'interface GP-200 Studio (FR / EN / ES).

Toutes les chaines ASCII-safe (\\uXXXX) pour rester lisibles quelle que soit la
locale du systeme, comme le reste des donnees du projet.

Usage :
    from gp200_i18n import T, set_lang, LANGS
    set_lang("fr")
    T("generate_button")        -> "Generer les presets"
    T("count_sections", n=3)    -> "3 sections"
"""

LANGS = {"fr": "Francais", "en": "English", "es": "Espanol"}
DEFAULT_LANG = "fr"

# Version de l'application. Apparait dans le titre et le nom de l'exe.
APP_VERSION = "0.91"

# Contact et lien de don. Adresse email de secours si le message Ko-fi
# Lien Ko-fi de l'auteur (item Shop a prix libre). Stripe connecte en plus de
# PayPal cote Ko-fi : les acheteurs peuvent payer par carte sans compte PayPal.
_STRINGS = {
    # -- mode (radio haut de fenetre)
    "mode_new": {
        "fr": "Nouveau morceau",
        "en": "New song",
        "es": "Nuevo tema"},
    "mode_refine": {
        "fr": "Affiner un preset existant",
        "en": "Refine an existing preset",
        "es": "Refinar un preset existente"},

    # -- champ de saisie selon le mode
    "refine_title": {
        "fr": "Que veux-tu changer sur ce preset ?",
        "en": "What do you want to change on this preset?",
        "es": "\u00bfQue quieres cambiar en este preset?"},
    "refine_sub": {
        "fr": "En clair : \"trop de reverb, il manque un flanger, ampli plus sature\".",
        "en": "In plain words: \"too much reverb, add a flanger, more amp gain\".",
        "es": "En claro: \"demasiada reverb, falta un flanger, mas ganancia de amp\"."},

    # -- web search + structure
    "web_search": {
        "fr": "Recherche web (identifier le vrai rig)",
        "en": "Web search (identify the real rig)",
        "es": "Busqueda web (identificar el equipo real)"},
    "auto_detect": {
        "fr": "Detection automatique (le modele decide combien de sons distincts "
              "a le morceau)",
        "en": "Auto-detect (the model decides how many distinct sounds the song has)",
        "es": "Deteccion automatica (el modelo decide cuantos sonidos distintos "
              "tiene el tema)"},
    "structure_hint_auto": {
        "fr": "Le modele determine la structure : 1 son = 3 presets, 2 sons = 6, "
              "3 sons = 9.",
        "en": "The model determines the structure: 1 sound = 3 presets, 2 = 6, 3 = 9.",
        "es": "El modelo determina la estructura: 1 sonido = 3 presets, 2 = 6, 3 = 9."},
    "structure_hint_pick": {
        "fr": "Coche au moins un role, ou remets la detection automatique.",
        "en": "Tick at least one role, or switch auto-detect back on.",
        "es": "Marca al menos un rol, o vuelve a la deteccion automatica."},
    "structure_forced": {
        "fr": "%d section(s) imposee(s) : %s  ->  %d presets",
        "en": "%d forced section(s): %s  ->  %d presets",
        "es": "%d seccion(es) impuesta(s): %s  ->  %d presets"},

    # -- fichier charge
    "loaded_fmt": {"fr": "%s  -  %r%s", "en": "%s  -  %r%s", "es": "%s  -  %r%s"},

    # -- usage / cout
    "usage_gemini": {
        "fr": "Gemini : pas de suivi de cout (tarification cote Google).",
        "en": "Gemini: no cost tracking (pricing handled by Google).",
        "es": "Gemini: sin seguimiento de coste (tarifas gestionadas por Google)."},
    "usage_budget": {
        "fr": "Budget $%.2f   depense $%.3f   reste $%.2f (%.0f%%)   %d appels",
        "en": "Budget $%.2f   spent $%.3f   left $%.2f (%.0f%%)   %d calls",
        "es": "Presupuesto $%.2f   gastado $%.3f   queda $%.2f (%.0f%%)   %d llamadas"},
    "usage_cumul": {
        "fr": "Depense cumulee $%.3f sur %d appels",
        "en": "Cumulative spend $%.3f over %d calls",
        "es": "Gasto acumulado $%.3f en %d llamadas"},
    "usage_session": {
        "fr": "session $%.4f",
        "en": "session $%.4f",
        "es": "sesion $%.4f"},
    "usage_quota": {
        "fr": "   |   quota minute : ",
        "en": "   |   per-minute quota: ",
        "es": "   |   cuota por minuto: "},

    # -- statuts
    "status_models_query": {
        "fr": "Interrogation des modeles...",
        "en": "Querying models...",
        "es": "Consultando modelos..."},
    "status_models_avail": {
        "fr": "%d modeles disponibles",
        "en": "%d models available",
        "es": "%d modelos disponibles"},
    "status_refined": {
        "fr": "preset affine (%d changement(s))   |   %s",
        "en": "preset refined (%d change(s))   |   %s",
        "es": "preset refinado (%d cambio(s))   |   %s"},
    "status_generated": {
        "fr": "%d presets / %d section(s)   |   %s",
        "en": "%d presets / %d section(s)   |   %s",
        "es": "%d presets / %d seccion(es)   |   %s"},

    # -- onglet journal
    "log_tab": {"fr": "Journal", "en": "Log", "es": "Registro"},"keys_get": {
        "fr": "Obtenir une cle \u2192",
        "en": "Get a key \u2192",
        "es": "Obtener una clave \u2192"},
    "keys_perplexity": {"fr": "Cle Perplexity :",
                        "en": "Perplexity key:",
                        "es": "Clave Perplexity:"},
    "keys_openai": {"fr": "Cle OpenAI :",
                    "en": "OpenAI key:",
                    "es": "Clave OpenAI:"},
    "keys_help_intro": {
        "fr": "Pas de cle ? Clique sur \u00ab Obtenir une cle \u00bb : chaque lien "
              "ouvre la page ou creer la tienne.",
        "en": "No key? Click \u00ab Get a key \u00bb: each link opens the page to "
              "create yours.",
        "es": "\u00bfSin clave? Haz clic en \u00ab Obtener una clave \u00bb: cada "
              "enlace abre la pagina para crear la tuya."},

    "prov_gemini": {
        "fr": "Google Gemini (offre gratuite, sans CB)",
        "en": "Google Gemini (free tier, no card)",
        "es": "Google Gemini (plan gratuito, sin tarjeta)"},
    "prov_anthropic": {
        "fr": "Anthropic Claude (payant a l'usage)",
        "en": "Anthropic Claude (pay as you go)",
        "es": "Anthropic Claude (pago por uso)"},
    "prov_perplexity": {
        "fr": "Perplexity (payant, recherche web incluse)",
        "en": "Perplexity (paid, web search included)",
        "es": "Perplexity (de pago, busqueda web incluida)"},
    "prov_openai": {
        "fr": "OpenAI (ChatGPT - payant a l'usage)",
        "en": "OpenAI (ChatGPT - pay as you go)",
        "es": "OpenAI (ChatGPT - pago por uso)"},

    "pickup_label": {"fr": "Micro guitare :", "en": "Guitar pickup:",
                     "es": "Pastilla guitarra:"},
    "pickup_auto": {"fr": "Non precise (le modele decide)",
                    "en": "Unspecified (model decides)",
                    "es": "Sin especificar (decide el modelo)"},
    "pickup_humbucker": {"fr": "Humbucker (double bobinage)",
                         "en": "Humbucker",
                         "es": "Humbucker (doble bobina)"},
    "pickup_single": {"fr": "Simple bobinage",
                      "en": "Single-coil",
                      "es": "Bobina simple"},
    "pickup_p90": {"fr": "P90", "en": "P90", "es": "P90"},
    "pickup_active": {"fr": "Actif (EMG, etc.)",
                      "en": "Active (EMG, etc.)",
                      "es": "Activa (EMG, etc.)"},

    "res_rig": {"fr": "RIG IDENTIFIE", "en": "IDENTIFIED RIG",
                "es": "EQUIPO IDENTIFICADO"},
    "res_structure": {"fr": "STRUCTURE", "en": "STRUCTURE", "es": "ESTRUCTURA"},
    "res_section": {"fr": "SECTION", "en": "SECTION", "es": "SECCION"},
    "res_axe": {"fr": "axe", "en": "angle", "es": "enfoque"},
    "res_ecoute": {"fr": "ecoute", "en": "listen", "es": "escucha"},
    "res_file": {"fr": "fichier", "en": "file", "es": "archivo"},

    "ex_1": {
        "fr": "Master of Puppets - Metallica, son rythmique album",
        "en": "Master of Puppets - Metallica, album rhythm tone",
        "es": "Master of Puppets - Metallica, sonido ritmico del album"},
    "ex_2": {
        "fr": "Nothing Else Matters - Metallica, du clean d'intro au solo",
        "en": "Nothing Else Matters - Metallica, from intro clean to solo",
        "es": "Nothing Else Matters - Metallica, del limpio de intro al solo"},
    "ex_3": {
        "fr": "Comfortably Numb - Pink Floyd, couplet clean et solo final",
        "en": "Comfortably Numb - Pink Floyd, clean verse and final solo",
        "es": "Comfortably Numb - Pink Floyd, estrofa limpia y solo final"},
    "ex_4": {
        "fr": "Sultans of Swing - Dire Straits, son clean Strat",
        "en": "Sultans of Swing - Dire Straits, clean Strat tone",
        "es": "Sultans of Swing - Dire Straits, sonido limpio de Strat"},
    "ex_5": {
        "fr": "Panama - Van Halen",
        "en": "Panama - Van Halen",
        "es": "Panama - Van Halen"},
    "ex_6": {
        "fr": "Bulls on Parade - Rage Against the Machine",
        "en": "Bulls on Parade - Rage Against the Machine",
        "es": "Bulls on Parade - Rage Against the Machine"},
    "ex_7": {
        "fr": "Sweet Child O' Mine - Guns N' Roses, riff intro, couplet et solo",
        "en": "Sweet Child O' Mine - Guns N' Roses, intro riff, verse and solo",
        "es": "Sweet Child O' Mine - Guns N' Roses, riff de intro, estrofa y solo"},
    "ex_8": {
        "fr": "Un clean chaud type jazz manouche pour une intro",
        "en": "A warm gypsy-jazz clean for an intro",
        "es": "Un limpio calido tipo jazz manouche para una intro"},
    "exa_1": {
        "fr": "Il y a trop de reverb, et il manque un flanger",
        "en": "Too much reverb, and a flanger is missing",
        "es": "Hay demasiada reverb, y falta un flanger"},
    "exa_2": {
        "fr": "Pas assez de gain, et le son est trop sourd dans les aigus",
        "en": "Not enough gain, and the tone is too dull on the highs",
        "es": "No hay suficiente ganancia, y el sonido es muy apagado en agudos"},
    "exa_3": {
        "fr": "Ajoute un delay en croche pointee, mix discret",
        "en": "Add a dotted-eighth delay, subtle mix",
        "es": "Anade un delay en corchea con puntillo, mezcla discreta"},
    "exa_4": {
        "fr": "Enleve le chorus, mets un phaser a la place",
        "en": "Remove the chorus, put a phaser instead",
        "es": "Quita el chorus, pon un phaser en su lugar"},
    "exa_5": {
        "fr": "Trop de basses, ca bave en groupe : resserre le bas",
        "en": "Too much bass, it gets muddy with the band: tighten the low end",
        "es": "Demasiados graves, se emborrona en grupo: ajusta los bajos"},
    "exa_6": {
        "fr": "Coupe tous les effets temps, je veux le son brut",
        "en": "Cut all time-based effects, I want the raw tone",
        "es": "Corta todos los efectos de tiempo, quiero el sonido crudo"},
    "exa_7": {
        "fr": "Rends-le utilisable en clean : baisse le gain de l'ampli",
        "en": "Make it usable clean: lower the amp gain",
        "es": "Hazlo utilizable en limpio: baja la ganancia del amp"},

    "gen_cost": {
        "fr": "Cout de cette generation : $%.4f",
        "en": "Cost of this generation: $%.4f",
        "es": "Coste de esta generacion: $%.4f"},

    # -- journal / logs
    "log_tokens": {
        "fr": "    tokens : entree=%s cache_ecrit=%s cache_lu=%s sortie=%s | %d recherche(s)",
        "en": "    tokens: in=%s cache_write=%s cache_read=%s out=%s | %d search(es)",
        "es": "    tokens: entrada=%s cache_escrito=%s cache_leido=%s salida=%s | %d busqueda(s)"},
    "log_tokens_simple": {
        "fr": "    tokens : entree=%s sortie=%s",
        "en": "    tokens: in=%s out=%s",
        "es": "    tokens: entrada=%s salida=%s"},
    "log_cost": {
        "fr": "    cout appel : $%.4f  |  total session : $%.4f",
        "en": "    call cost: $%.4f  |  session total: $%.4f",
        "es": "    coste llamada: $%.4f  |  total sesion: $%.4f"},
    "log_quota": {
        "fr": "    quota minute : %s",
        "en": "    per-minute quota: %s",
        "es": "    cuota por minuto: %s"},
    "log_truncated": {
        "fr": "    ! REPONSE TRONQUEE : max_tokens=%d atteint (sortie %s tokens).",
        "en": "    ! RESPONSE TRUNCATED: max_tokens=%d reached (output %s tokens).",
        "es": "    ! RESPUESTA TRUNCADA: max_tokens=%d alcanzado (salida %s tokens)."},
    "log_truncated_simple": {
        "fr": "    ! REPONSE TRONQUEE : limite de tokens atteinte.",
        "en": "    ! RESPONSE TRUNCATED: token limit reached.",
        "es": "    ! RESPUESTA TRUNCADA: limite de tokens alcanzado."},
    "log_api_attempt": {
        "fr": "  appel API (tentative %d)...",
        "en": "  API call (attempt %d)...",
        "es": "  llamada API (intento %d)..."},
    "log_json_cut": {
        "fr": "  ! JSON coupe par la limite de tokens : on repart en demandant "
              "plus court (reponse cassee non renvoyee)",
        "en": "  ! JSON cut by token limit: retrying with a shorter request "
              "(broken response not resent)",
        "es": "  ! JSON cortado por el limite de tokens: reintentando mas corto "
              "(respuesta rota no reenviada)"},
    "log_unreadable": {
        "fr": "  ! reponse illisible : %s",
        "en": "  ! unreadable response: %s",
        "es": "  ! respuesta ilegible: %s"},
    "log_errors_fix": {
        "fr": "  ! %d erreur(s), correction demandee :",
        "en": "  ! %d error(s), correction requested:",
        "es": "  ! %d error(es), correccion solicitada:"},
    "log_bullet": {
        "fr": "      - %s", "en": "      - %s", "es": "      - %s"},
    "log_section": {
        "fr": "  section %d/%d : %s (%s)",
        "en": "  section %d/%d: %s (%s)",
        "es": "  seccion %d/%d: %s (%s)"},
    "log_checksum_bad": {
        "fr": "    ! checksum invalide sur %s (fichier conserve)",
        "en": "    ! invalid checksum on %s (file kept)",
        "es": "    ! checksum invalido en %s (archivo conservado)"},
    "log_warn": {
        "fr": "    ! %s", "en": "    ! %s", "es": "    ! %s"},
    "log_written": {
        "fr": "      ecrit : %s",
        "en": "      written: %s",
        "es": "      escrito: %s"},
    "log_written2": {
        "fr": "    ecrit : %s",
        "en": "    written: %s",
        "es": "    escrito: %s"},
    "log_variant_skip": {
        "fr": "    ! variante %s ignoree : %s",
        "en": "    ! variant %s skipped: %s",
        "es": "    ! variante %s omitida: %s"},
    "log_src_checksum": {
        "fr": "  ! le preset source a un checksum invalide, on continue quand meme",
        "en": "  ! source preset has an invalid checksum, continuing anyway",
        "es": "  ! el preset original tiene checksum invalido, se continua igual"},
    "log_demande": {
        "fr": "demande : %s", "en": "request: %s", "es": "peticion: %s"},
    "log_provider_line": {
        "fr": "fournisseur : %s | modele : %s | recherche web : %s",
        "en": "provider: %s | model: %s | web search: %s",
        "es": "proveedor: %s | modelo: %s | busqueda web: %s"},
    "log_mode": {
        "fr": "mode : %s", "en": "mode: %s", "es": "modo: %s"},
    "log_calling": {
        "fr": "--- appel en cours, patiente... ---",
        "en": "--- calling, please wait... ---",
        "es": "--- llamando, espera... ---"},
    "log_structure": {
        "fr": "structure : %s", "en": "structure: %s", "es": "estructura: %s"},
    "log_struct_auto": {
        "fr": "detection auto", "en": "auto-detect", "es": "deteccion auto"},
    "log_struct_forced": {
        "fr": "imposee -> %s", "en": "forced -> %s", "es": "impuesta -> %s"},
    "log_response_recv": {
        "fr": "--- reponse recue, affichage... ---",
        "en": "--- response received, displaying... ---",
        "es": "--- respuesta recibida, mostrando... ---"},
    "log_error": {
        "fr": "\nERREUR : %s", "en": "\nERROR: %s", "es": "\nERROR: %s"},
    "log_config_unreadable": {
        "fr": "! config illisible : %s",
        "en": "! config unreadable: %s",
        "es": "! config ilegible: %s"},
    "log_refine_mode": {
        "fr": "mode : affinage de %s",
        "en": "mode: refining %s",
        "es": "modo: refinando %s"},

    "log_ws_off": {
        "fr": "! Recherche web coupee : le modele va deviner le rig de memoire.\n"
              "  Sans recherche, sur un morceau connu il se trompe souvent de rig.\n"
              "  A ne couper que si TU connais deja le rig et le decris toi-meme.",
        "en": "! Web search off: the model will guess the rig from memory.\n"
              "  Without search, it often gets the rig wrong on known songs.\n"
              "  Only turn off if YOU already know the rig and describe it yourself.",
        "es": "! Busqueda web desactivada: el modelo adivinara el equipo de memoria.\n"
              "  Sin busqueda, suele equivocarse de equipo en temas conocidos.\n"
              "  Desactivala solo si YA conoces el equipo y lo describes tu mismo."},

    # -- fenetre principale
    "app_title": {
        "fr": "GP-200 Studio \u2014 texte vers preset",
        "en": "GP-200 Studio \u2014 text-to-preset",
        "es": "GP-200 Studio \u2014 texto a preset"},
    "describe_title": {
        "fr": "Decris le son que tu veux",
        "en": "Describe the sound you want",
        "es": "Describe el sonido que quieres"},
    "describe_sub": {
        "fr": "Une chanson, un artiste, une ambiance. L'appli identifie le rig et "
              "genere 3 variantes par section.",
        "en": "A song, an artist, a mood. The app identifies the rig and generates "
              "3 variants per section.",
        "es": "Una cancion, un artista, un ambiente. La app identifica el equipo y "
              "genera 3 variantes por seccion."},
    "examples": {"fr": "Exemples :", "en": "Examples:", "es": "Ejemplos:"},
    "load_prst": {
        "fr": "Charger un .prst...",
        "en": "Load a .prst...",
        "es": "Cargar un .prst..."},
    "no_file": {"fr": "aucun fichier", "en": "no file", "es": "ningun archivo"},
    "loaded_file": {"fr": "charge : %s", "en": "loaded: %s", "es": "cargado: %s"},

    # -- options
    "options": {"fr": "Options", "en": "Options", "es": "Opciones"},
    "provider": {"fr": "Fournisseur :", "en": "Provider:", "es": "Proveedor:"},
    "model": {"fr": "Modele :", "en": "Model:", "es": "Modelo:"},
    "refresh": {"fr": "Actualiser", "en": "Refresh", "es": "Actualizar"},
    "output_dir_btn": {
        "fr": "Dossier de sortie",
        "en": "Output folder",
        "es": "Carpeta de salida"},
    "api_keys_btn": {
        "fr": "Cles API...",
        "en": "API keys...",
        "es": "Claves API..."},
    "language_label": {"fr": "Langue :", "en": "Language:", "es": "Idioma:"},
    "theme_toggle": {"fr": "\u263e/\u2600", "en": "\u263e/\u2600", "es": "\u263e/\u2600"},

    # -- structure
    "structure": {
        "fr": "Structure du morceau",
        "en": "Song structure",
        "es": "Estructura del tema"},
    "force": {"fr": "Forcer :", "en": "Force:", "es": "Forzar:"},
    "role_clean": {"fr": "clean", "en": "clean", "es": "limpio"},
    "role_crunch": {"fr": "crunch", "en": "crunch", "es": "crunch"},
    "role_disto": {"fr": "disto", "en": "dist", "es": "disto"},
    "role_lead": {"fr": "lead", "en": "lead", "es": "lead"},

    # -- actions
    "generate_button": {
        "fr": "Generer les presets",
        "en": "Generate presets",
        "es": "Generar presets"},
    "refine_button": {
        "fr": "Affiner le preset",
        "en": "Refine preset",
        "es": "Refinar preset"},
    "live_ready_button": {
        "fr": "\U0001f3a4 Optimiser pour concert",
        "en": "\U0001f3a4 Optimize for live",
        "es": "\U0001f3a4 Optimizar para directo"},
    "live_no_preset": {
        "fr": "Charge d'abord un fichier .prst a optimiser pour le live.",
        "en": "Load a .prst file first to optimize for live.",
        "es": "Primero carga un archivo .prst para optimizar para directo."},

    # -- harmonisation setlist
    "setlist_button": {
        "fr": "\U0001f3b5 Harmoniser setlist",
        "en": "\U0001f3b5 Harmonize setlist",
        "es": "\U0001f3b5 Armonizar setlist"},
    "setlist_title": {
        "fr": "Harmonisation de setlist",
        "en": "Setlist harmonization",
        "es": "Armonizacion de setlist"},
    "setlist_add": {
        "fr": "Ajouter des presets",
        "en": "Add presets",
        "es": "Anadir presets"},
    "setlist_remove": {
        "fr": "Retirer",
        "en": "Remove",
        "es": "Quitar"},
    "setlist_clear": {
        "fr": "Tout vider",
        "en": "Clear all",
        "es": "Vaciar todo"},
    "setlist_analyze": {
        "fr": "Analyser",
        "en": "Analyze",
        "es": "Analizar"},
    "setlist_apply": {
        "fr": "Appliquer",
        "en": "Apply",
        "es": "Aplicar"},
    "setlist_close": {
        "fr": "Fermer",
        "en": "Close",
        "es": "Cerrar"},
    "setlist_select": {
        "fr": "Selectionner les presets (.prst)",
        "en": "Select presets (.prst)",
        "es": "Seleccionar presets (.prst)"},
    "setlist_loaded": {
        "fr": "Presets charges",
        "en": "Loaded presets",
        "es": "Presets cargados"},
    "setlist_results": {
        "fr": "Volumes suggeres (ajustables)",
        "en": "Suggested volumes (adjustable)",
        "es": "Volumenes sugeridos (ajustables)"},
    "setlist_col_name": {
        "fr": "Preset", "en": "Preset", "es": "Preset"},
    "setlist_col_amp": {
        "fr": "Ampli", "en": "Amp", "es": "Ampli"},
    "setlist_col_current": {
        "fr": "Actuel", "en": "Current", "es": "Actual"},
    "setlist_col_suggested": {
        "fr": "Suggere (slider)", "en": "Suggested (slider)", "es": "Sugerido (slider)"},
    "setlist_count": {
        "fr": "%d preset(s) charge(s)",
        "en": "%d preset(s) loaded",
        "es": "%d preset(s) cargado(s)"},
    "setlist_empty": {
        "fr": "Ajoute d'abord des presets a analyser.",
        "en": "Add presets to analyze first.",
        "es": "Primero anade presets para analizar."},
    "setlist_error": {
        "fr": "Erreur : %s", "en": "Error: %s", "es": "Error: %s"},
    "setlist_analyzed": {
        "fr": "%d preset(s) analyse(s) - ajuste les sliders puis clique Appliquer",
        "en": "%d preset(s) analyzed - adjust sliders then click Apply",
        "es": "%d preset(s) analizado(s) - ajusta los sliders y haz clic en Aplicar"},
    "setlist_done": {
        "fr": "%d preset(s) harmonise(s) dans :\n%s",
        "en": "%d preset(s) harmonized to:\n%s",
        "es": "%d preset(s) armonizado(s) en:\n%s"},

    "working": {"fr": "Travail en cours...", "en": "Working...", "es": "Procesando..."},

    # -- usage
    "usage": {"fr": "Usage API", "en": "API usage", "es": "Uso de API"},
    "reset_usage": {
        "fr": "Remettre a zero",
        "en": "Reset",
        "es": "Reiniciar"},
    "open_folder": {
        "fr": "Ouvrir le dossier",
        "en": "Open folder",
        "es": "Abrir carpeta"},

    # -- resultat + menu contextuel
    "result": {"fr": "Resultat", "en": "Result", "es": "Resultado"},
    "copy": {"fr": "Copier", "en": "Copy", "es": "Copiar"},
    "copy_all": {
        "fr": "Tout copier",
        "en": "Copy all",
        "es": "Copiar todo"},
    "select_all": {
        "fr": "Tout selectionner",
        "en": "Select all",
        "es": "Seleccionar todo"},

    # -- messages
    "msg_empty_title": {"fr": "Vide", "en": "Empty", "es": "Vacio"},
    "msg_empty": {
        "fr": "Decris le son que tu veux.",
        "en": "Describe the sound you want.",
        "es": "Describe el sonido que quieres."},
    "msg_no_preset_title": {"fr": "Preset", "en": "Preset", "es": "Preset"},
    "msg_no_preset": {
        "fr": "Charge d'abord un fichier .prst.",
        "en": "Load a .prst file first.",
        "es": "Carga primero un archivo .prst."},
    "msg_no_key_title": {"fr": "Cle API", "en": "API key", "es": "Clave API"},
    "msg_no_key": {
        "fr": "Configure d'abord la cle API de ce fournisseur (bouton \u00ab Cles API \u00bb).",
        "en": "Set this provider's API key first (\u00ab API keys \u00bb button).",
        "es": "Configura primero la clave API de este proveedor (boton \u00ab Claves API \u00bb)."},
    "msg_done_title": {"fr": "Termine", "en": "Done", "es": "Terminado"},
    "msg_fail_title": {"fr": "Echec", "en": "Failed", "es": "Error"},
    "msg_read_fail": {
        "fr": "Lecture impossible",
        "en": "Cannot read",
        "es": "No se puede leer"},

    # -- dialogue cles API
    "keys_title": {
        "fr": "Configuration des cles API",
        "en": "API keys setup",
        "es": "Configuracion de claves API"},
    "keys_intro": {
        "fr": "Colle tes cles API. Elles sont chiffrees et liees a ta session "
              "Windows : illisibles depuis un autre compte ou un autre PC.",
        "en": "Paste your API keys. They are encrypted and tied to your Windows "
              "session: unreadable from another account or PC.",
        "es": "Pega tus claves API. Se cifran y se vinculan a tu sesion de Windows: "
              "ilegibles desde otra cuenta u otro PC."},
    "keys_claude": {"fr": "Cle Claude (Anthropic) :",
                    "en": "Claude (Anthropic) key:",
                    "es": "Clave Claude (Anthropic):"},
    "keys_gemini": {"fr": "Cle Gemini (Google) :",
                    "en": "Gemini (Google) key:",
                    "es": "Clave Gemini (Google):"},
    "keys_show": {"fr": "Afficher", "en": "Show", "es": "Mostrar"},
    "keys_save": {"fr": "Enregistrer", "en": "Save", "es": "Guardar"},
    "keys_cancel": {"fr": "Annuler", "en": "Cancel", "es": "Cancelar"},
    "keys_saved": {
        "fr": "Cles enregistrees.",
        "en": "Keys saved.",
        "es": "Claves guardadas."},
    "keys_at_least_one": {
        "fr": "Renseigne au moins une cle pour continuer.",
        "en": "Enter at least one key to continue.",
        "es": "Introduce al menos una clave para continuar."},

    # -- premier lancement : langue
    "welcome_lang_title": {
        "fr": "Bienvenue \u2014 choix de la langue",
        "en": "Welcome \u2014 language",
        "es": "Bienvenido \u2014 idioma"},
    "welcome_lang_prompt": {
        "fr": "Choisis la langue de l'interface (modifiable ensuite dans les options) :",
        "en": "Choose the interface language (changeable later in options):",
        "es": "Elige el idioma de la interfaz (modificable luego en opciones):"},
    "ok": {"fr": "OK", "en": "OK", "es": "OK"},

    # -- batch harmonisation volume
    "batch_button": {
        "fr": "\U0001f39b Batch Vol.",
        "en": "\U0001f39b Batch Vol.",
        "es": "\U0001f39b Batch Vol."},
    "batch_title": {
        "fr": "Harmonisation Volume Batch",
        "en": "Batch Volume Harmonization",
        "es": "Armonizacion de Volumen Batch"},
    "batch_group_presets": {
        "fr": "1. Presets \u00e0 harmoniser",
        "en": "1. Presets to harmonize",
        "es": "1. Presets a armonizar"},
    "batch_add": {
        "fr": "\U0001f4c2  Ajouter\u2026",
        "en": "\U0001f4c2  Add\u2026",
        "es": "\U0001f4c2  A\u00f1adir\u2026"},
    "batch_remove": {
        "fr": "\u2716  Retirer",
        "en": "\u2716  Remove",
        "es": "\u2716  Quitar"},
    "batch_toggle_lead": {
        "fr": "\U0001f3b8  Toggle Lead",
        "en": "\U0001f3b8  Toggle Lead",
        "es": "\U0001f3b8  Toggle Lead"},
    "batch_dblclick": {
        "fr": "(double-clic aussi)",
        "en": "(double-click too)",
        "es": "(doble clic tambi\u00e9n)"},
    "batch_col_preset": {"fr": "Preset",     "en": "Preset",    "es": "Preset"},
    "batch_col_type":   {"fr": "Type",       "en": "Type",      "es": "Tipo"},
    "batch_col_slot":   {"fr": "Slot GP-200","en": "GP-200 Slot","es": "Slot GP-200"},
    "batch_col_lufs":   {"fr": "LUFS",       "en": "LUFS",      "es": "LUFS"},
    "batch_col_volav":  {"fr": "vol avant",  "en": "vol before","es": "vol antes"},
    "batch_col_volap":  {"fr": "vol apr\u00e8s", "en": "vol after", "es": "vol despu\u00e9s"},
    "batch_col_status": {"fr": "Statut",     "en": "Status",    "es": "Estado"},
    "batch_group_audio": {
        "fr": "2. Audio & MIDI",
        "en": "2. Audio & MIDI",
        "es": "2. Audio & MIDI"},
    "batch_audio_in":   {"fr": "Audio IN :", "en": "Audio IN:", "es": "Audio IN:"},
    "batch_midi_out":   {"fr": "MIDI OUT :", "en": "MIDI OUT:", "es": "MIDI OUT:"},
    "batch_first_slot": {"fr": "Slot de test :", "en": "Test slot:", "es": "Slot de prueba:"},
    "batch_out_dir":    {"fr": "Dossier sortie :", "en": "Output folder:", "es": "Carpeta salida:"},
    "batch_out_pick":   {"fr": "\U0001f4c1 Choisir\u2026", "en": "\U0001f4c1 Choose\u2026", "es": "\U0001f4c1 Elegir\u2026"},
    "batch_out_source": {"fr": "\u2716 Source", "en": "\u2716 Source", "es": "\u2716 Fuente"},
    "batch_out_default":{"fr": "(sous-dossier out/ des sources)", "en": "(out/ subfolder of sources)", "es": "(subcarpeta out/ de las fuentes)"},
    "batch_group_measure": {
        "fr": "3. Mesure en cours",
        "en": "3. Live measurement",
        "es": "3. Medici\u00f3n en curso"},
    "batch_no_preset":  {"fr": "(aucun preset en cours)", "en": "(no preset active)", "es": "(ning\u00fan preset activo)"},
    "batch_momentary":  {"fr": "Momentary",  "en": "Momentary",  "es": "Momentary"},
    "batch_shortterm":  {"fr": "Short-term", "en": "Short-term", "es": "Short-term"},
    "batch_integrated": {"fr": "Int\u00e9gr\u00e9",    "en": "Integrated",  "es": "Integrado"},
    "batch_delta":      {"fr": "\u00c9cart cible :", "en": "Target gap:", "es": "Dif. objetivo:"},
    "batch_launch":     {"fr": "\u25b6  Lancer",    "en": "\u25b6  Launch",   "es": "\u25b6  Lanzar"},
    "batch_pause":      {"fr": "\u23f8  Pause",     "en": "\u23f8  Pause",    "es": "\u23f8  Pausa"},
    "batch_resume":     {"fr": "\u25b6  Reprendre", "en": "\u25b6  Resume",   "es": "\u25b6  Reanudar"},
    "batch_next":       {"fr": "\u23ed  Suivant",   "en": "\u23ed  Next",     "es": "\u23ed  Siguiente"},
    "batch_apply":      {"fr": "\u2714  Appliquer", "en": "\u2714  Apply",    "es": "\u2714  Aplicar"},
    "batch_done_msg": {
        "fr": "%d preset(s) sur %d sauvegard\u00e9(s).\n\nRe-importe les .prst corrig\u00e9s dans le GP-200.",
        "en": "%d preset(s) out of %d saved.\n\nRe-import the corrected .prst files into the GP-200.",
        "es": "%d preset(s) de %d guardado(s).\n\nRe-importa los .prst corregidos en el GP-200."},
    "batch_done_title": {"fr": "Termin\u00e9", "en": "Done", "es": "Completado"},
    "batch_status_ready":    {"fr": "Pret.", "en": "Ready.", "es": "Listo."},
    "batch_filedialog_out":  {
        "fr": "Choisir le dossier de sortie des .prst corrig\u00e9s",
        "en": "Choose output folder for corrected .prst files",
        "es": "Elegir carpeta de salida para .prst corregidos"},
    "batch_filedialog_add":  {"fr": "Ajouter des presets GP-200", "en": "Add GP-200 presets", "es": "A\u00f1adir presets GP-200"},
    "batch_invalid_file":    {"fr": "Fichier invalide",   "en": "Invalid file",    "es": "Archivo inv\u00e1lido"},
    "batch_invalid_size":    {"fr": "%s : %d bytes (attendu %d)", "en": "%s: %d bytes (expected %d)", "es": "%s: %d bytes (esperado %d)"},
    "batch_warn_empty_title":{"fr": "Liste vide",         "en": "Empty list",      "es": "Lista vac\u00eda"},
    "batch_warn_empty_msg":  {"fr": "Ajoute des presets avant de lancer.", "en": "Add presets before launching.", "es": "A\u00f1ade presets antes de lanzar."},
    "batch_err_audio_select":{"fr": "S\u00e9lectionne une entr\u00e9e audio.", "en": "Select an audio input.", "es": "Selecciona una entrada de audio."},
    "batch_warn_midi_title": {"fr": "MIDI", "en": "MIDI", "es": "MIDI"},
    "batch_warn_midi_msg":   {
        "fr": "Impossible d'ouvrir le port MIDI.\nOn continue sans synchro automatique.",
        "en": "Cannot open MIDI port.\nContinuing without auto-sync.",
        "es": "No se puede abrir el puerto MIDI.\nContinuando sin sincronizaci\u00f3n autom\u00e1tica."},
    "batch_err_audio_title": {"fr": "Erreur audio",       "en": "Audio error",     "es": "Error de audio"},
    "batch_no_measure_title":{"fr": "Pas de mesure",      "en": "No measurement",  "es": "Sin medida"},
    "batch_no_measure_msg":  {"fr": "Joue quelques secondes avant d'appliquer.", "en": "Play for a few seconds before applying.", "es": "Toca unos segundos antes de aplicar."},
    "batch_err_write_title": {"fr": "Erreur \u00e9criture","en": "Write error",     "es": "Error de escritura"},
    "batch_oor_title":       {"fr": "Slot hors port\u00e9e MIDI", "en": "Slot out of MIDI range", "es": "Slot fuera de rango MIDI"},
    "batch_oor_msg":         {
        "fr": "Le slot %s correspond au PC %d, hors de la plage MIDI (0-127).\n\u2192 Importe tes presets dans les slots 1 \u00e0 32 et recommence.",
        "en": "Slot %s maps to PC %d, outside MIDI range (0-127).\n\u2192 Import your presets in slots 1 to 32 and retry.",
        "es": "El slot %s corresponde al PC %d, fuera del rango MIDI (0-127).\n\u2192 Importa tus presets en los slots 1 a 32 e int\u00e9ntalo de nuevo."},
    "batch_partial_title":   {"fr": "Plage partielle",    "en": "Partial range",   "es": "Rango parcial"},
    "batch_partial_msg":     {
        "fr": "%d presets couvrent les PC %d \u00e0 %d.\nSeuls les %d premiers seront atteignables.\nContinuer quand m\u00eame ?",
        "en": "%d presets cover PC %d to %d.\nOnly the first %d will be reachable.\nContinue anyway?",
        "es": "%d presets cubren PC %d a %d.\nSolo los primeros %d ser\u00e1n alcanzables.\n\u00bfContinuar de todas formas?"},
    "batch_status_play_midi":{
        "fr": "PC %d \u2192 slot %s  |  Joue ton accord en boucle !",
        "en": "PC %d \u2192 slot %s  |  Play your chord in loop!",
        "es": "PC %d \u2192 slot %s  |  \u00a1Toca tu acorde en bucle!"},
    "batch_status_play":     {"fr": "Preset %d/%d  |  Joue ton accord en boucle !", "en": "Preset %d/%d  |  Play your chord in loop!", "es": "Preset %d/%d  |  \u00a1Toca tu acorde en bucle!"},
    "batch_status_oor":      {"fr": "\u26a0\ufe0f PC %d hors plage \u2014 preset %d non chang\u00e9.", "en": "\u26a0\ufe0f PC %d out of range \u2014 preset %d not changed.", "es": "\u26a0\ufe0f PC %d fuera de rango \u2014 preset %d no cambiado."},
    "batch_status_paused":   {"fr": "Pause \u2014 change de preset sur le GP-200, puis reprends.", "en": "Pause \u2014 switch preset on the GP-200, then resume.", "es": "Pausa \u2014 cambia el preset en el GP-200, luego reanuda."},
    "batch_status_resumed":  {"fr": "Mesure reprise \u2014 joue ton accord !", "en": "Measurement resumed \u2014 play your chord!", "es": "Medici\u00f3n reanudada \u2014 \u00a1toca tu acorde!"},
    "batch_hint_ok":         {"fr": "\u2705  Volume OK \u2014 clique Appliquer !", "en": "\u2705  Volume OK \u2014 click Apply!", "es": "\u2705  Volumen OK \u2014 \u00a1haz clic en Aplicar!"},
    "batch_hint_lower":      {"fr": "\u2193 Baisser", "en": "\u2193 Lower",  "es": "\u2193 Bajar"},
    "batch_hint_raise":      {"fr": "\u2191 Monter",  "en": "\u2191 Raise",   "es": "\u2191 Subir"},
    "batch_hint_detail":     {
        "fr": "patch_vol %d \u2192 %d  (\u00e9cart %+.1f dB, ratio %.1f dB/unit\u00e9) \u2014 clique Appliquer",
        "en": "patch_vol %d \u2192 %d  (gap %+.1f dB, ratio %.1f dB/unit) \u2014 click Apply",
        "es": "patch_vol %d \u2192 %d  (dif. %+.1f dB, ratio %.1f dB/unidad) \u2014 haz clic en Aplicar"},
    "batch_status_saved":    {"fr": "\u2705 Sauvegard\u00e9 : %s  |  patch_vol %d \u2192 %d  |  LUFS %+.1f", "en": "\u2705 Saved: %s  |  patch_vol %d \u2192 %d  |  LUFS %+.1f", "es": "\u2705 Guardado: %s  |  patch_vol %d \u2192 %d  |  LUFS %+.1f"},
    "batch_status_path":     {"fr": "\U0001f4c1 Sauvegard\u00e9 dans : %s", "en": "\U0001f4c1 Saved in: %s", "es": "\U0001f4c1 Guardado en: %s"},
    "batch_done_fmt":        {"fr": "Batch termin\u00e9 \u2014 %d/%d presets sauvegard\u00e9s", "en": "Batch done \u2014 %d/%d presets saved", "es": "Batch completado \u2014 %d/%d presets guardados"},
    "batch_status_final":    {"fr": "\u2705 Batch termin\u00e9.", "en": "\u2705 Batch done.", "es": "\u2705 Batch completado."},
    "batch_current_fmt":     {"fr": "Preset %d/%d :  %s  |  %s  |  Cible %+.1f LUFS", "en": "Preset %d/%d:  %s  |  %s  |  Target %+.1f LUFS", "es": "Preset %d/%d:  %s  |  %s  |  Objetivo %+.1f LUFS"},

    # -- boutons hardcodés (nouvelle version batch)
    "batch_prev":            {"fr": "\u23ee Pr\u00e9c\u00e9dent",  "en": "\u23ee Previous",  "es": "\u23ee Anterior"},
    "batch_resend":          {"fr": "\U0001f501 Renvoyer",        "en": "\U0001f501 Resend",   "es": "\U0001f501 Reenviar"},
    "batch_finish":          {"fr": "\u23f9 Terminer",            "en": "\u23f9 Finish",      "es": "\u23f9 Finalizar"},

    # -- statuts USB hardcodés
    "batch_usb_unavail":     {"fr": "\u26ab gp200_usb.py indisponible \u2014 mode MIDI-only",
                              "en": "\u26ab gp200_usb.py unavailable \u2014 MIDI-only mode",
                              "es": "\u26ab gp200_usb.py no disponible \u2014 modo solo MIDI"},
    "batch_usb_detecting":   {"fr": "\U0001f504 D\u00e9tection GP-200 en cours\u2026",
                              "en": "\U0001f504 Detecting GP-200\u2026",
                              "es": "\U0001f504 Detectando GP-200\u2026"},
    "batch_usb_ready":       {"fr": "\U0001f7e2 GP-200 pr\u00eat \u2014 USB SysEx \u2713  Audio \u2713  (push + LUFS actifs)",
                              "en": "\U0001f7e2 GP-200 ready \u2014 USB SysEx \u2713  Audio \u2713  (push + LUFS active)",
                              "es": "\U0001f7e2 GP-200 listo \u2014 USB SysEx \u2713  Audio \u2713  (push + LUFS activos)"},
    "batch_usb_partial_midi": {"fr": "\U0001f7e1 GP-200 partiel \u2014 USB SysEx \u2713  Audio \u2717  (push actif, mais interface audio introuvable \u2192 v\u00e9rifiez le driver USB Audio)",
                               "en": "\U0001f7e1 GP-200 partial \u2014 USB SysEx \u2713  Audio \u2717  (push active, but audio interface not found \u2192 check USB Audio driver)",
                               "es": "\U0001f7e1 GP-200 parcial \u2014 USB SysEx \u2713  Audio \u2717  (push activo, pero interfaz de audio no encontrada \u2192 verifique el driver USB Audio)"},
    "batch_usb_partial_audio": {"fr": "\U0001f7e1 GP-200 partiel \u2014 USB SysEx \u2717  Audio \u2713  (LUFS OK, mais push USB indisponible \u2192 mode MIDI-only)",
                                "en": "\U0001f7e1 GP-200 partial \u2014 USB SysEx \u2717  Audio \u2713  (LUFS OK, but USB push unavailable \u2192 MIDI-only mode)",
                                "es": "\U0001f7e1 GP-200 parcial \u2014 USB SysEx \u2717  Audio \u2713  (LUFS OK, pero push USB no disponible \u2192 modo solo MIDI)"},
    "batch_usb_not_found":   {"fr": "\U0001f534 GP-200 non d\u00e9tect\u00e9 \u2014 v\u00e9rifiez la connexion USB",
                              "en": "\U0001f534 GP-200 not detected \u2014 check USB connection",
                              "es": "\U0001f534 GP-200 no detectado \u2014 verifique la conexi\u00f3n USB"},
    "batch_usb_active":      {"fr": "\U0001f535 Mode USB actif \u2014 push + PC automatiques",
                              "en": "\U0001f535 USB mode active \u2014 automatic push + PC",
                              "es": "\U0001f535 Modo USB activo \u2014 push + PC autom\u00e1ticos"},
    "batch_usb_midi_only":   {"fr": "\U0001f7e1 Mode MIDI-only \u2014 PC uniquement, pas de push USB",
                              "en": "\U0001f7e1 MIDI-only mode \u2014 PC only, no USB push",
                              "es": "\U0001f7e1 Modo solo MIDI \u2014 solo PC, sin push USB"},
    "batch_usb_none":        {"fr": "\u26ab Aucune connexion GP-200 \u2014 mesure sans synchro",
                              "en": "\u26ab No GP-200 connection \u2014 measurement without sync",
                              "es": "\u26ab Sin conexi\u00f3n GP-200 \u2014 medici\u00f3n sin sincronizaci\u00f3n"},

    # -- dossier sortie
    "batch_outdir_title":    {"fr": "Dossier sortie", "en": "Output folder", "es": "Carpeta de salida"},
    "batch_outdir_empty":    {"fr": "Aucun preset charg\u00e9.", "en": "No preset loaded.", "es": "Ning\u00fan preset cargado."},
    "batch_outdir_missing":  {"fr": "Le dossier n'existe pas encore :\n%s\n\nIl sera cr\u00e9\u00e9 lors du premier Apply.",
                              "en": "The folder does not exist yet:\n%s\n\nIt will be created on the first Apply.",
                              "es": "La carpeta a\u00fan no existe:\n%s\n\nSe crear\u00e1 en el primer Apply."},

    # -- messagebox slot hors portée
    "batch_oor_title2":      {"fr": "Slot hors port\u00e9e MIDI", "en": "Slot out of MIDI range", "es": "Slot fuera del rango MIDI"},
    "batch_oor_msg2":        {"fr": "Le slot de d\u00e9part %s-%s correspond au PC %d, hors de la plage MIDI (0-127).\n\nLe standard MIDI Program Change ne permet d'acc\u00e9der\nqu'aux slots 01-A \u00e0 32-D (PC 0 \u00e0 127).\n\n\u2192 Importe tes presets dans les slots 1 \u00e0 32 et recommence.",
                              "en": "The start slot %s-%s maps to PC %d, outside the MIDI range (0-127).\n\nThe MIDI Program Change standard only reaches\nslots 01-A to 32-D (PC 0 to 127).\n\n\u2192 Import your presets into slots 1 to 32 and try again.",
                              "es": "El slot inicial %s-%s corresponde al PC %d, fuera del rango MIDI (0-127).\n\nEl est\u00e1ndar MIDI Program Change solo accede\na los slots 01-A a 32-D (PC 0 a 127).\n\n\u2192 Importa tus presets en los slots 1 a 32 y vuelve a intentarlo."},
    "batch_partial_title2":  {"fr": "Plage partielle", "en": "Partial range", "es": "Rango parcial"},
    "batch_partial_msg2":    {"fr": "Les %d presets couvrent les PC %d \u00e0 %d.\nSeuls les %d premiers (PC \u2264 127) seront atteignables.\n\nContinuer quand m\u00eame ?",
                              "en": "The %d presets cover PCs %d to %d.\nOnly the first %d (PC \u2264 127) will be reachable.\n\nContinue anyway?",
                              "es": "Los %d presets cubren los PC %d a %d.\nSolo los primeros %d (PC \u2264 127) ser\u00e1n accesibles.\n\n\u00bfContinuar de todos modos?"},

    # -- statuts envoi preset
    "batch_sending":         {"fr": "\u23f3 Envoi preset %d/%d \u2192 %s\u2026",
                              "en": "\u23f3 Sending preset %d/%d \u2192 %s\u2026",
                              "es": "\u23f3 Enviando preset %d/%d \u2192 %s\u2026"},
    "batch_resending":       {"fr": "\u23f3 Renvoi preset %d/%d \u2192 %s\u2026",
                              "en": "\u23f3 Resending preset %d/%d \u2192 %s\u2026",
                              "es": "\u23f3 Reenviando preset %d/%d \u2192 %s\u2026"},
    "batch_audio_active":    {"fr": "\U0001f7e2 Flux audio actif (Preset %d)",
                              "en": "\U0001f7e2 Audio stream active (Preset %d)",
                              "es": "\U0001f7e2 Flujo de audio activo (Preset %d)"},
    "batch_audio_wait":      {"fr": "\u23f3 En attente de lib\u00e9ration du flux audio USB...",
                              "en": "\u23f3 Waiting for USB audio stream to be released...",
                              "es": "\u23f3 Esperando la liberaci\u00f3n del flujo de audio USB..."},

    # -- hints auto-tweak cascade
    "batch_hint_validated":  {"fr": "\u2705 Valid\u00e9 (Patch: %.0f, Ampli: %s)",
                              "en": "\u2705 Validated (Patch: %.0f, Amp: %s)",
                              "es": "\u2705 Validado (Patch: %.0f, Amp\u00edfico: %s)"},
    "batch_hint_settling":   {"fr": "\u23f3 Stabilisation en cours (%ds)... Laisse sonner l'accord.",
                              "en": "\u23f3 Settling (%ds)... Let the chord ring.",
                              "es": "\u23f3 Estabilizando (%ds)... Deja sonar el acorde."},
    "batch_hint_silence":    {"fr": "\u23f8\ufe0f En attente de signal... Jouez un accord pour lancer l'ajustement.",
                              "en": "\u23f8\ufe0f Waiting for signal... Play a chord to start adjustment.",
                              "es": "\u23f8\ufe0f Esperando se\u00f1al... Toca un acorde para iniciar el ajuste."},
    "batch_hint_stable_ok":  {"fr": "\u2705 Volume stable depuis 3s ! Sauvegarde automatique...",
                              "en": "\u2705 Volume stable for 3s! Auto-saving...",
                              "es": "\u2705 Volumen estable durante 3s! Guardando autom\u00e1ticamente..."},
    "batch_hint_stable_wait": {"fr": "\U0001f3af Cible atteinte, stabilisation en cours (%ds)... Ne bougez plus.",
                               "en": "\U0001f3af Target reached, stabilising (%ds)... Hold steady.",
                               "es": "\U0001f3af Objetivo alcanzado, estabilizando (%ds)... No se mueva."},
    "batch_hint_patch_ceil": {"fr": "\u26a0\ufe0f Patch en but\u00e9e \u2192 recours gain...",
                              "en": "\u26a0\ufe0f Patch at ceiling \u2192 falling back to gain...",
                              "es": "\u26a0\ufe0f Patch en tope \u2192 recurriendo al gain..."},
    "batch_hint_patch_adj":  {"fr": "\u26a0\ufe0f Patch vol. Correction #%d : Patch \u2192 %.0f%s",
                              "en": "\u26a0\ufe0f Patch vol. Correction #%d: Patch \u2192 %.0f%s",
                              "es": "\u26a0\ufe0f Vol. Patch. Correcci\u00f3n #%d: Patch \u2192 %.0f%s"},
    "batch_hint_patch_limit": {"fr": " [Patch en but\u00e9e]", "en": " [Patch at limit]", "es": " [Patch en tope]"},
    "batch_hint_cab_adj":    {"fr": "\u2699\ufe0f Correction #%d : CAB vol \u2192 %.0f",
                              "en": "\u2699\ufe0f Correction #%d: CAB vol \u2192 %.0f",
                              "es": "\u2699\ufe0f Correcci\u00f3n #%d: CAB vol \u2192 %.0f"},
    "batch_hint_cab_limit":  {"fr": "\u26a0\ufe0f CAB %s \u2192 Patch vol...",
                              "en": "\u26a0\ufe0f CAB %s \u2192 Patch vol...",
                              "es": "\u26a0\ufe0f CAB %s \u2192 Vol. Patch..."},
    "batch_hint_amp_adj":    {"fr": "\u2699\ufe0f Correction #%d : Ampli \u2192 %.0f",
                              "en": "\u2699\ufe0f Correction #%d: Amp \u2192 %.0f",
                              "es": "\u2699\ufe0f Correcci\u00f3n #%d: Amp\u00edfico \u2192 %.0f"},
    "batch_hint_amp_limit":  {"fr": "\u26a0\ufe0f Ampli %s \u2192 CAB...",
                              "en": "\u26a0\ufe0f Amp %s \u2192 CAB...",
                              "es": "\u26a0\ufe0f Amp\u00edfico %s \u2192 CAB..."},
    "batch_hint_gain_adj":   {"fr": "\u26a0\ufe0f [Last resort] Gain \u2192 %.0f (max %.0f)",
                              "en": "\u26a0\ufe0f [Last resort] Gain \u2192 %.0f (max %.0f)",
                              "es": "\u26a0\ufe0f [Last resort] Gain \u2192 %.0f (m\u00e1x %.0f)"},
    "batch_hint_gain_limit": {"fr": "\U0001f534 Gain en but\u00e9e (%.0f) \u2014 volume insuffisant pour atteindre %.0f dB",
                              "en": "\U0001f534 Gain at ceiling (%.0f) \u2014 volume insufficient to reach %.0f dB",
                              "es": "\U0001f534 Gain en tope (%.0f) \u2014 volumen insuficiente para alcanzar %.0f dB"},
    "batch_hint_floor":      {"fr": "au plancher", "en": "at floor",   "es": "en m\u00ednimo"},
    "batch_hint_ceiling":    {"fr": "en but\u00e9e",   "en": "at ceiling", "es": "en tope"},
    "batch_hint_no_usb":     {"fr": "\u26a0\ufe0f \u00c9cart de %+.1f dB (Auto-tweak d\u00e9sactiv\u00e9 sans USB)",
                              "en": "\u26a0\ufe0f Gap of %+.1f dB (Auto-tweak disabled without USB)",
                              "es": "\u26a0\ufe0f Diferencia de %+.1f dB (Auto-ajuste desactivado sin USB)"},

    # -- inject preset GP-200
    "inject_button":       {"fr": "Injecter",         "en": "Inject",           "es": "Inyectar"},
    "inject_no_preset":    {"fr": "Aucun preset s\u00e9lectionn\u00e9 dans la liste.",
                            "en": "No preset selected in the list.",
                            "es": "Ning\u00fan preset seleccionado en la lista."},
    "inject_file_missing": {"fr": "Fichier .prst introuvable.",
                            "en": ".prst file not found.",
                            "es": "Archivo .prst no encontrado."},
    "inject_connecting":   {"fr": "🔌 Connexion au GP-200…",
                            "en": "🔌 Connecting to GP-200…",
                            "es": "🔌 Conectando al GP-200…"},
    "inject_handshake":    {"fr": "📡 Handshake…",
                            "en": "📡 Handshake…",
                            "es": "📡 Handshake…"},
    "inject_chunk":        {"fr": "📤 Chunk %d/%d…",
                            "en": "📤 Chunk %d/%d…",
                            "es": "📤 Chunk %d/%d…"},
    "inject_done":         {"fr": "\u2705 Preset inject\u00e9 sur 01-A !",
                            "en": "\u2705 Preset injected to 01-A!",
                            "es": "\u2705 Preset inyectado en 01-A!"},
    "inject_connect_fail": {"fr": "GP-200 non d\u00e9tect\u00e9. V\u00e9rifiez la connexion USB.",
                            "en": "GP-200 not detected. Check USB connection.",
                            "es": "GP-200 no detectado. Verifique la conexi\u00f3n USB."},

    # -- menus header Config + Fonctionnalités
    "menu_config":       {"fr": "\u2699 Config",           "en": "\u2699 Config",          "es": "\u2699 Config"},
    "menu_features":     {"fr": "\u2605 Fonctionnalit\u00e9s", "en": "\u2605 Features",    "es": "\u2605 Funciones"},
    "menu_calib_single": {"fr": "\U0001f39a Calibration Volume Unique",   "en": "\U0001f39a Single Volume Calibration", "es": "\U0001f39a Calibraci\u00f3n de Volumen \u00danica"},
    "menu_calib_batch":  {"fr": "\U0001f39b Calibration Volume par Batch","en": "\U0001f39b Batch Volume Calibration",  "es": "\U0001f39b Calibraci\u00f3n de Volumen Batch"},

    # -- slot d'injection
    "inject_slot_title":  {"fr": "Slot d'injection GP-200", "en": "GP-200 Injection Slot", "es": "Slot de Inyecci\u00f3n GP-200"},
    "inject_slot_msg":    {"fr": "Sur quel slot injecter les presets g\u00e9n\u00e9r\u00e9s ?",
                           "en": "Which slot should generated presets be injected to?",
                           "es": "\u00bfEn qu\u00e9 slot inyectar los presets generados?"},
    "inject_slot_num":    {"fr": "Num\u00e9ro (1-64) :", "en": "Number (1-64):", "es": "N\u00famero (1-64):"},
    "inject_slot_letter": {"fr": "Lettre :", "en": "Letter:", "es": "Letra:"},
    "inject_auto_label":  {"fr": "Auto-inject \u00e0 la s\u00e9lection", "en": "Auto-inject on selection", "es": "Auto-inyectar al seleccionar"},
    "inject_slot_saved":  {"fr": "\u2705 Slot enregistr\u00e9 : %s", "en": "\u2705 Slot saved: %s", "es": "\u2705 Slot guardado: %s"},
}

_current = {"lang": DEFAULT_LANG}


# -- textes ajoutes (audit des traductions) : dialogues, statuts, calibration, live, popup slot
_STRINGS.update({
    "x_error": {"fr": "Erreur",
               "en": "Error",
               "es": "Error"},
    "x_all_files": {"fr": "Tous",
                   "en": "All",
                   "es": "Todos"},
    "x_deps_missing": {"fr": "D\u00e9pendances manquantes",
                      "en": "Missing dependencies",
                      "es": "Dependencias faltantes"},
    "x_install_with": {"fr": "%s\n\nInstalle avec :\npip install sounddevice pyloudnorm",
                      "en": "%s\n\nInstall with:\npip install sounddevice pyloudnorm",
                      "es": "%s\n\nInstala con:\npip install sounddevice pyloudnorm"},
    "x_pick_preset": {"fr": "Choisir un preset GP-200",
                     "en": "Choose a GP-200 preset",
                     "es": "Elegir un preset GP-200"},
    "x_read_fail": {"fr": "Lecture impossible",
                   "en": "Cannot read file",
                   "es": "No se puede leer el archivo"},
    "x_reset_title": {"fr": "Remettre \u00e0 z\u00e9ro",
                     "en": "Reset",
                     "es": "Poner a cero"},
    "x_reset_msg": {"fr": "Effacer le compteur de d\u00e9pense cumul\u00e9e ?\n\n(cela n'affecte pas ton solde r\u00e9el chez Anthropic, seulement l'estimation locale)",
                   "en": "Clear the cumulative spend counter?\n\n(this does not affect your real balance with Anthropic, only the local estimate)",
                   "es": "\u00bfBorrar el contador de gasto acumulado?\n\n(no afecta a tu saldo real en Anthropic, solo a la estimaci\u00f3n local)"},
    "x_models_title": {"fr": "Mod\u00e8les",
                      "en": "Models",
                      "es": "Modelos"},
    "x_models_need_key": {"fr": "Configure d'abord la cl\u00e9 API de ce fournisseur dans config.json.",
                         "en": "First set this provider's API key in config.json.",
                         "es": "Configura primero la clave API de este proveedor en config.json."},
    "x_models_query": {"fr": "Interrogation des mod\u00e8les...",
                      "en": "Querying models...",
                      "es": "Consultando los modelos..."},
    "x_mod_missing_title": {"fr": "Module manquant",
                           "en": "Missing module",
                           "es": "M\u00f3dulo faltante"},
    "x_mod_missing_msg": {"fr": "%s introuvable.\nPlace-le dans le m\u00eame dossier que gp200_studio.py.",
                         "en": "%s not found.\nPut it in the same folder as gp200_studio.py.",
                         "es": "No se encuentra %s.\nCol\u00f3calo en la misma carpeta que gp200_studio.py."},
    "x_live_need_preset": {"fr": "G\u00e9n\u00e8re ou charge un preset d'abord, puis s\u00e9lectionne-le dans la liste.",
                          "en": "Generate or load a preset first, then select it in the list.",
                          "es": "Genera o carga primero un preset y selecci\u00f3nalo en la lista."},
    "x_live_no_file": {"fr": "Fichier .prst introuvable.\nLe preset doit avoir \u00e9t\u00e9 sauvegard\u00e9 dans le dossier de sortie.",
                      "en": ".prst file not found.\nThe preset must have been saved in the output folder.",
                      "es": "Archivo .prst no encontrado.\nEl preset debe haberse guardado en la carpeta de salida."},
    "x_struct_title": {"fr": "Structure",
                      "en": "Structure",
                      "es": "Estructura"},
    "x_struct_need_role": {"fr": "Coche au moins un r\u00f4le \u00e0 forcer, ou remets la d\u00e9tection automatique.",
                          "en": "Tick at least one role to force, or switch auto-detection back on.",
                          "es": "Marca al menos un rol a forzar, o vuelve a activar la detecci\u00f3n autom\u00e1tica."},
    "x_n_presets_in": {"fr": "\n%d presets dans : %s\n",
                      "en": "\n%d presets in: %s\n",
                      "es": "\n%d presets en: %s\n"},
    "x_tables_title": {"fr": "Tables introuvables",
                      "en": "Tables not found",
                      "es": "Tablas no encontradas"},
    "x_tables_fail": {"fr": "Impossible de charger data/ :\n%s",
                     "en": "Cannot load data/:\n%s",
                     "es": "No se puede cargar data/:\n%s"},
    "x_chain_dev": {"fr": "%s   -   GP-200 sur %s%s",
                   "en": "%s   -   GP-200 on %s%s",
                   "es": "%s   -   GP-200 en %s%s"},
    "x_other_patch": {"fr": " (autre patch)",
                     "en": " (other patch)",
                     "es": " (otro patch)"},
    "x_dev_patch_differs": {"fr": "\U0001f9b6 GP-200 : patch %s (diff\u00e9rent du preset affich\u00e9)",
                           "en": "\U0001f9b6 GP-200: patch %s (different from the displayed preset)",
                           "es": "\U0001f9b6 GP-200: patch %s (distinto del preset mostrado)"},
    "x_model_did": {"fr": "\nCE QUE LE MODELE DIT AVOIR FAIT\n",
                   "en": "\nWHAT THE MODEL SAYS IT DID\n",
                   "es": "\nLO QUE EL MODELO DICE HABER HECHO\n"},
    "x_display_err": {"fr": "ERREUR D'AFFICHAGE : %s",
                     "en": "DISPLAY ERROR: %s",
                     "es": "ERROR DE VISUALIZACI\u00d3N: %s"},
    "x_raw_reply": {"fr": "REPONSE BRUTE DU MODELE :\n",
                   "en": "RAW MODEL RESPONSE:\n",
                   "es": "RESPUESTA BRUTA DEL MODELO:\n"},
    "x_unexpected": {"fr": "Erreur inattendue : %r",
                    "en": "Unexpected error: %r",
                    "es": "Error inesperado: %r"},
    "x_saved_updated": {"fr": "\u2705 %s sauvegard\u00e9 & mis \u00e0 jour sur %s \U0001f50c",
                       "en": "\u2705 %s saved & updated on %s \U0001f50c",
                       "es": "\u2705 %s guardado y actualizado en %s \U0001f50c"},
    "x_saved_repush_fail": {"fr": "\u2705 %s sauvegard\u00e9 \u2014 \u26a0\ufe0f USB re-push \u00e9chou\u00e9 : %s",
                           "en": "\u2705 %s saved \u2014 \u26a0\ufe0f USB re-push failed: %s",
                           "es": "\u2705 %s guardado \u2014 \u26a0\ufe0f fall\u00f3 el reenv\u00edo USB: %s"},
    "x_push_fail": {"fr": "\u26a0\ufe0f USB push \u00e9chou\u00e9 : %s",
                   "en": "\u26a0\ufe0f USB push failed: %s",
                   "es": "\u26a0\ufe0f Fall\u00f3 el env\u00edo USB: %s"},
    "x_saved_vol": {"fr": "\u2705 %s sauvegard\u00e9 (%s | LUFS %+.1f)",
                   "en": "\u2705 %s saved (%s | LUFS %+.1f)",
                   "es": "\u2705 %s guardado (%s | LUFS %+.1f)"},
    "x_cal_title": {"fr": "Calibration Volume LUFS",
                   "en": "LUFS Volume Calibration",
                   "es": "Calibraci\u00f3n de volumen LUFS"},
    "x_cal_none": {"fr": "(aucun fichier charg\u00e9)",
                  "en": "(no file loaded)",
                  "es": "(ning\u00fan archivo cargado)"},
    "x_cal_ready": {"fr": "Pr\u00eat.",
                   "en": "Ready.",
                   "es": "Listo."},
    "x_cal_g1": {"fr": " 1. Preset .prst ",
                "en": " 1. Preset .prst ",
                "es": " 1. Preset .prst "},
    "x_cal_open": {"fr": "\U0001f4c2  Ouvrir\u2026",
                  "en": "\U0001f4c2  Open\u2026",
                  "es": "\U0001f4c2  Abrir\u2026"},
    "x_cal_cur_vol": {"fr": "patch_vol actuel :",
                     "en": "Current patch_vol:",
                     "es": "patch_vol actual:"},
    "x_cal_g2": {"fr": " 2. Entr\u00e9e audio ",
                "en": " 2. Audio input ",
                "es": " 2. Entrada de audio "},
    "x_cal_g3": {"fr": " 3. Cible LUFS ",
                "en": " 3. LUFS target ",
                "es": " 3. Objetivo LUFS "},
    "x_cal_g4": {"fr": " 4. Mesure LUFS (EBU R128) ",
                "en": " 4. LUFS measurement (EBU R128) ",
                "es": " 4. Medici\u00f3n LUFS (EBU R128) "},
    "x_cal_integrated": {"fr": "Int\u00e9gr\u00e9   (total)",
                        "en": "Integrated (total)",
                        "es": "Integrado  (total)"},
    "x_cal_delta": {"fr": "\u00c9cart vs cible",
                   "en": "Gap vs target",
                   "es": "Diferencia vs objetivo"},
    "x_cal_measure": {"fr": "\u25b6  Mesurer",
                     "en": "\u25b6  Measure",
                     "es": "\u25b6  Medir"},
    "x_cal_apply": {"fr": "\u2714  Appliquer",
                   "en": "\u2714  Apply",
                   "es": "\u2714  Aplicar"},
    "x_cal_open_title": {"fr": "Ouvrir preset GP-200",
                        "en": "Open GP-200 preset",
                        "es": "Abrir preset GP-200"},
    "x_cal_err_read": {"fr": "Erreur lecture",
                      "en": "Read error",
                      "es": "Error de lectura"},
    "x_cal_bad_file": {"fr": "Fichier invalide",
                      "en": "Invalid file",
                      "es": "Archivo no v\u00e1lido"},
    "x_cal_bad_size": {"fr": "Taille inattendue : %d bytes (attendu %d).",
                      "en": "Unexpected size: %d bytes (expected %d).",
                      "es": "Tama\u00f1o inesperado: %d bytes (esperado %d)."},
    "x_cal_loaded": {"fr": "Charg\u00e9 : %s  |  patch_vol = %d",
                    "en": "Loaded: %s  |  patch_vol = %d",
                    "es": "Cargado: %s  |  patch_vol = %d"},
    "x_cal_pick_dev": {"fr": "S\u00e9lectionne un p\u00e9riph\u00e9rique audio.",
                      "en": "Select an audio device.",
                      "es": "Selecciona un dispositivo de audio."},
    "x_cal_measuring": {"fr": "Mesure en cours \u2014 joue quelques secondes\u2026",
                       "en": "Measuring \u2014 play for a few seconds\u2026",
                       "es": "Midiendo \u2014 toca unos segundos\u2026"},
    "x_cal_audio_err": {"fr": "Erreur audio",
                       "en": "Audio error",
                       "es": "Error de audio"},
    "x_cal_stopped": {"fr": "Mesure arr\u00eat\u00e9e.",
                     "en": "Measurement stopped.",
                     "es": "Medici\u00f3n detenida."},
    "x_cal_reset": {"fr": "Reset \u2014 pr\u00eat pour une nouvelle mesure.",
                   "en": "Reset \u2014 ready for a new measurement.",
                   "es": "Reinicio \u2014 listo para una nueva medici\u00f3n."},
    "x_cal_ok_hint": {"fr": "\u2705  Volume OK \u2014 tu peux cliquer Appliquer.",
                     "en": "\u2705  Volume OK \u2014 you can click Apply.",
                     "es": "\u2705  Volumen OK \u2014 puedes pulsar Aplicar."},
    "x_cal_down": {"fr": "\u2193 Baisser",
                  "en": "\u2193 Lower",
                  "es": "\u2193 Bajar"},
    "x_cal_up": {"fr": "\u2191 Monter",
                "en": "\u2191 Raise",
                "es": "\u2191 Subir"},
    "x_cal_suggest": {"fr": "%s patch_vol d'environ %d unit\u00e9(s)  \u2192  essaie %d\n(ratio %s dB/unit\u00e9 \u2014 estimation initiale, \u00e0 affiner)",
                     "en": "%s patch_vol by about %d unit(s)  \u2192  try %d\n(ratio %s dB/unit \u2014 initial estimate, to be refined)",
                     "es": "%s patch_vol unas %d unidad(es)  \u2192  prueba %d\n(ratio %s dB/unidad \u2014 estimaci\u00f3n inicial, por afinar)"},
    "x_cal_no_preset": {"fr": "Aucun preset charg\u00e9.",
                       "en": "No preset loaded.",
                       "es": "Ning\u00fan preset cargado."},
    "x_cal_err_write": {"fr": "Erreur \u00e9criture",
                       "en": "Write error",
                       "es": "Error de escritura"},
    "x_cal_saved_status": {"fr": "\u2705  patch_vol %d \u2192 %d  sauvegard\u00e9 dans %s",
                          "en": "\u2705  patch_vol %d \u2192 %d  saved to %s",
                          "es": "\u2705  patch_vol %d \u2192 %d  guardado en %s"},
    "x_cal_save_ok": {"fr": "Sauvegarde OK",
                     "en": "Saved",
                     "es": "Guardado"},
    "x_cal_save_msg": {"fr": "patch_vol = %d \u00e9crit dans :\n%s\n\nRecharge le preset sur ton GP-200 et re-mesure pour confirmer.",
                      "en": "patch_vol = %d written to:\n%s\n\nReload the preset on your GP-200 and measure again to confirm.",
                      "es": "patch_vol = %d escrito en:\n%s\n\nRecarga el preset en tu GP-200 y vuelve a medir para confirmar."},
    "x_live_title": {"fr": "Live Control",
                    "en": "Live Control",
                    "es": "Live Control"},
    "x_live_cant_decode": {"fr": "Impossible de d\u00e9coder le preset.",
                          "en": "Cannot decode the preset.",
                          "es": "No se puede decodificar el preset."},
    "x_dev_ready": {"fr": "\U0001f535 GP-200 pr\u00eat",
                   "en": "\U0001f535 GP-200 ready",
                   "es": "\U0001f535 GP-200 listo"},
    "x_dev_not_found": {"fr": "\u26ab GP-200 non d\u00e9tect\u00e9",
                       "en": "\u26ab GP-200 not detected",
                       "es": "\u26ab GP-200 no detectado"},
    "x_reloaded": {"fr": "\u21bb Recharg\u00e9",
                  "en": "\u21bb Reloaded",
                  "es": "\u21bb Recargado"},
    "x_sp_save": {"fr": "\U0001f4be Sauvegarder dans slot 1-A",
                 "en": "\U0001f4be Save to slot 1-A",
                 "es": "\U0001f4be Guardar en slot 1-A"},
    "x_sp_no_params": {"fr": "(aucun param\u00e8tre)",
                      "en": "(no parameters)",
                      "es": "(sin par\u00e1metros)"},
    "x_dev_not_conn": {"fr": "\u26ab GP-200 non connect\u00e9",
                      "en": "\u26ab GP-200 not connected",
                      "es": "\u26ab GP-200 no conectado"},
    "x_dev_conn": {"fr": "\U0001f535 GP-200 connect\u00e9",
                  "en": "\U0001f535 GP-200 connected",
                  "es": "\U0001f535 GP-200 conectado"},
    "x_sp_sec_unavail": {"fr": "\u26ab send_effect_change indisponible (mettre \u00e0 jour gp200_usb.py)",
                        "en": "\u26ab send_effect_change unavailable (update gp200_usb.py)",
                        "es": "\u26ab send_effect_change no disponible (actualiza gp200_usb.py)"},
    "x_sp_applied": {"fr": "\u2705 %s  (\U0001f4be non sauvegard\u00e9)",
                    "en": "\u2705 %s  (\U0001f4be not saved)",
                    "es": "\u2705 %s  (\U0001f4be sin guardar)"},
    "x_sp_no_preset_usb": {"fr": "\u26ab Pas de preset ou USB",
                          "en": "\u26ab No preset or USB",
                          "es": "\u26ab Sin preset o USB"},
    "x_sp_path_missing": {"fr": "Chemin du preset ou tables manquantes",
                         "en": "Preset path or tables missing",
                         "es": "Falta la ruta del preset o las tablas"},
    "x_sp_file_updated": {"fr": " & %s (+ json) mis \u00e0 jour",
                         "en": " & %s (+ json) updated",
                         "es": " y %s (+ json) actualizados"},
    "x_sp_save_err": {"fr": " (\u26a0\ufe0f Erreur sauvegarde : %s)",
                     "en": " (\u26a0\ufe0f Save error: %s)",
                     "es": " (\u26a0\ufe0f Error al guardar: %s)"},
    "x_sp_saved": {"fr": "\u2705 Sauvegard\u00e9 \u2192 slot 1-A%s",
                  "en": "\u2705 Saved \u2192 slot 1-A%s",
                  "es": "\u2705 Guardado \u2192 slot 1-A%s"},
    "x_sp_active": {"fr": "Actif",
                   "en": "On",
                   "es": "Activo"},
    "x_sp_bypass": {"fr": "Bypass",
                   "en": "Bypass",
                   "es": "Bypass"},
    "x_usb_unavail": {"fr": "\u26ab gp200_usb indisponible",
                     "en": "\u26ab gp200_usb unavailable",
                     "es": "\u26ab gp200_usb no disponible"},
})


def set_lang(lang):
    _current["lang"] = lang if lang in LANGS else DEFAULT_LANG


def get_lang():
    return _current["lang"]


def provider_label(prov):
    """Label traduit d'un fournisseur (gemini/anthropic/perplexity)."""
    return T("prov_" + prov)


def T(key, *args, **kwargs):
    """Traduit une clef. args/kwargs sont passes a % ou .format selon le besoin."""
    entry = _STRINGS.get(key)
    if entry is None:
        return key
    s = entry.get(_current["lang"]) or entry.get(DEFAULT_LANG) or key
    if args:
        try:
            return s % args
        except (TypeError, ValueError):
            return s
    if kwargs:
        try:
            return s.format(**kwargs)
        except (KeyError, IndexError, ValueError):
            return s
    return s