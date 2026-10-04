#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GP-200 Studio — text-to-preset pour Valeton GP-200.

Lancement :  python gp200_studio.py    (ou double-clic sur GP200_Studio.bat)
Compilation :  build_exe.bat           -> dist\\GP200_Studio.exe

La cle API se met dans config.json, a cote de l'exe. Jamais dans l'exe.
"""
import os
import subprocess
import sys
import queue
import struct
import threading
import traceback
try:
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog
    TK_ERROR = None
except ImportError as _e:  # pragma: no cover
    tk = ttk = messagebox = filedialog = None
    TK_ERROR = _e
    
    

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gp200_agent import (load_config, save_config, generate, refine, refine_live,
                         resource_path, app_dir,
                         list_models, api_key_of, model_of, load_spend,
                         reset_spend, fmt_limits, ROLES, PROVIDERS,
                         DEFAULT_PROVIDER)
from gp200lib import (Tables, decode_prst, MODULES, FILE_SIZE, checksum,
                      read_ctrl, write_ctrl, N_CTRL)
from gp200_setlist import analyze_setlist, apply_setlist
try:
    from gp200_calibration import CalibrationWindow
    _CALIB_OK = True
except ImportError:
    _CALIB_OK = False
    
try:
    from gp200_agent import resource_path
    self.iconbitmap(default=resource_path("icon.ico"))
except Exception:
    pass

try:
    from gp200_batch import BatchWindow
    _BATCH_OK = True
except ImportError:
    _BATCH_OK = False

try:
    from gp200_live import LiveControlWindow
    _LIVE_OK = True
except ImportError:
    _LIVE_OK = False

try:
    from gp200_slot_popup import SlotControlPopup
    _POPUP_OK = True
except ImportError:
    _POPUP_OK = False
    SlotControlPopup = None
try:
    from gp200_batch_live import LiveBatchWindow
    _BATCH_LIVE_OK = True
except ImportError:
    _BATCH_LIVE_OK = False
    
try:
    from gp200_usb import GP200USB, AudioWakeKeepAlive
    _USB_INJECT_OK = True
except ImportError:
    _USB_INJECT_OK = False
    GP200USB = None
    AudioWakeKeepAlive = None
try:
    from gp200_usb import GP200Listener
except ImportError:
    GP200Listener = None
import gp200_oauth
from gp200_i18n import (T, set_lang, get_lang, LANGS, DEFAULT_LANG, provider_label,
                        APP_VERSION)
from gp200_theme import (TOK, CAT, SLOT_CAT, FONT, UI_SCALE,
                         apply_theme, sil, set_ui_lang, TX)
from gp200_ui import (GradientStrip, Silk, Led, Chip, GlowButton, VMeter,
                      SignalRack, PresetList, Well, ModuleInspector)

# Raccourcis de couleur : l'ancienne interface avait ses teintes en dur, pensees
# pour un fond clair. Elles pointent maintenant vers les jetons du theme.
_DTXT = {
    "ctrl_btn":   {"fr": "CTRL / FS", "en": "CTRL / FS", "es": "CTRL / FS"},
    "ctrl_title": {"fr": "Affectations CTRL - %s", "en": "CTRL assignments - %s",
                   "es": "Asignaciones CTRL - %s"},
    "ctrl_hint":  {"fr": "Coche les modules que chaque CTRL allume/eteint. "
                         "Le footswitch qui envoie CTRL n se regle dans "
                         "Global > Footswitch.",
                   "en": "Tick the modules each CTRL toggles. The footswitch "
                         "sending CTRL n is set in Global > Footswitch.",
                   "es": "Marca los modulos que cada CTRL activa/desactiva. "
                         "El footswitch que envia CTRL n se ajusta en "
                         "Global > Footswitch."},
    "ctrl_save":  {"fr": "Enregistrer", "en": "Save", "es": "Guardar"},
    "ctrl_save_inj": {"fr": "Enregistrer + injecter", "en": "Save + inject",
                      "es": "Guardar + inyectar"},
    "ctrl_cancel": {"fr": "Annuler", "en": "Cancel", "es": "Cancelar"},
    "ctrl_saved": {"fr": "CTRL enregistres : %s", "en": "CTRL saved: %s",
                   "es": "CTRL guardados: %s"},
    "chain":      {"fr": "Chaine de signal", "en": "Signal chain",
                   "es": "Cadena de senal"},
    "gen_list":   {"fr": "Presets generes", "en": "Generated presets",
                   "es": "Presets generados"},
    "no_preset":  {"fr": "Aucun preset pour l'instant.",
                   "en": "No preset yet.", "es": "Ningun preset por ahora."},
    "modules":    {"fr": "%d modules  -  %d actifs, %d bypass",
                   "en": "%d modules  -  %d on, %d bypassed",
                   "es": "%d modulos  -  %d activos, %d en bypass"},
    "loaded":     {"fr": "charge", "en": "loaded", "es": "cargado"},
    "active":     {"fr": "actif", "en": "on", "es": "activo"},
    "bypassed":   {"fr": "bypass", "en": "bypassed", "es": "bypass"},
    "of":         {"fr": "module %d sur %d", "en": "module %d of %d",
                   "es": "modulo %d de %d"},
    "preset_load": {"fr": "PRESET CHARGE", "en": "PRESET LOADED",
                    "es": "PRESET CARGADO"},
    "chain_is":   {"fr": "chaine", "en": "chain", "es": "cadena"},
    "now_desc":   {"fr": "Decris maintenant ce que tu veux changer.",
                   "en": "Now describe what you want to change.",
                   "es": "Ahora describe lo que quieres cambiar."},
    "real_chg":   {"fr": "CHANGEMENTS REELS (calcules sur les fichiers, pas "
                         "declares par le modele)",
                   "en": "ACTUAL CHANGES (computed from the files, not "
                         "claimed by the model)",
                   "es": "CAMBIOS REALES (calculados sobre los archivos, no "
                         "declarados por el modelo)"},
    "file":       {"fr": "Fichier", "en": "File", "es": "Archivo"},
    "empty":      {"fr": "Vide", "en": "Empty", "es": "Vacio"},
    "load_first": {"fr": "Charge d'abord un fichier .prst.",
                   "en": "Load a .prst file first.",
                   "es": "Carga primero un archivo .prst."},
    "no_change":  {"fr": "  AUCUN. Le preset est identique : la demande n'a "
                         "peut-etre pas ete comprise.",
                   "en": "  NONE. The preset is unchanged: the request may "
                         "not have been understood.",
                   "es": "  NINGUNO. El preset es identico: puede que la "
                         "peticion no se haya entendido."},
    "refined":    {"fr": "preset affine (%d changement(s))",
                   "en": "preset refined (%d change(s))",
                   "es": "preset refinado (%d cambio(s))"},
    "no_text":    {"fr": "Le modele n'a renvoye aucun contenu texte "
                         "exploitable.\nReponse brute :",
                   "en": "The model returned no usable text content.\n"
                         "Raw response:",
                   "es": "El modelo no devolvio contenido de texto "
                         "utilizable.\nRespuesta bruta:"},
    "connect":    {"fr": "Se connecter", "en": "Sign in", "es": "Conectar"},
    "connecting": {"fr": "Connexion en cours...", "en": "Signing in...",
                   "es": "Conectando..."},
    "connected":  {"fr": "Connecte. La cle a ete recuperee.",
                   "en": "Signed in. The key has been retrieved.",
                   "es": "Conectado. La clave se ha recuperado."},
    "conn_hint":  {"fr": "Pas de cle a chercher : connecte-toi avec ton compte, "
                         "l'application recupere la cle toute seule.",
                   "en": "No key to hunt for: sign in with your account and the "
                         "app retrieves the key by itself.",
                   "es": "Sin clave que buscar: conectate con tu cuenta y la "
                         "aplicacion recupera la clave sola."},
    "conn_failed": {"fr": "Connexion echouee", "en": "Sign-in failed",
                    "es": "Fallo la conexion"},
    "see_log":    {"fr": "Journal detaille :", "en": "Detailed log:",
                   "es": "Registro detallado:"},
    "open_log":   {"fr": "Voir le journal", "en": "View log",
                   "es": "Ver el registro"},
    "no_log":     {"fr": "Aucun journal pour l'instant. Il sera cree au "
                         "premier essai de connexion :",
                   "en": "No log yet. It is created on the first sign-in "
                         "attempt:",
                   "es": "Aun no hay registro. Se crea en el primer intento "
                         "de conexion:"},
    "gen_failed": {"fr": "ECHEC DE LA GENERATION",
                   "en": "GENERATION FAILED", "es": "FALLO LA GENERACION"},
    "analysis":   {"fr": "ANALYSE", "en": "ANALYSIS", "es": "ANALISIS"},
    "desc_sound": {"fr": "Decris le son que tu veux.",
                   "en": "Describe the sound you want.",
                   "es": "Describe el sonido que quieres."},
}


def DT(key, *args):
    """Libelles propres au design, traduits sans toucher a gp200_i18n.py."""
    d = _DTXT.get(key) or {}
    txt = d.get(get_lang()) or d.get("fr") or key
    return (txt % args) if args else txt


C_OK = TOK["ok"]
C_ERR = TOK["err"]
C_WARN = TOK["warn"]
C_DIM = TOK["ink_dim"]
C_GHOST = TOK["ink_ghost"]
C_ACC = TOK["acc"]


def _say(msg, err=False):
    """Ecrit un message, y compris en mode --windowed ou sys.stdout vaut None.

    PyInstaller met sys.stdout/sys.stderr a None quand l'appli est compilee
    avec --windowed : tout write() direct leverait AttributeError.
    On double la sortie dans selftest.log pour que build_exe.bat puisse
    l'afficher.
    """
    stream = sys.stderr if err else sys.stdout
    try:
        if stream is not None:
            stream.write(msg)
            stream.flush()
    except Exception:
        pass
    try:
        with open(os.path.join(app_dir(), "selftest.log"), "a",
                  encoding="utf-8") as f:
            f.write(msg)
    except Exception:
        pass


def selftest():
    """Verifie que le bundle est complet : imports, tables, template, encodage.

    Lance par build_exe.bat juste apres la compilation. Sans interface, donc
    utilisable meme la ou Tkinter est absent.
    Code retour 0 = OK, 1 = probleme.
    """
    try:
        tb = Tables(resource_path("data"))
        # Un compte fige casse a chaque enrichissement du catalogue (206 -> 216
        # en ajoutant SnapTone). On verifie un PLANCHER + des invariants.
        assert len(tb.models) >= 216, "catalogue incomplet : %d" % len(tb.models)
        assert len(tb.cabs) == 90, "cabs incomplets : %d" % len(tb.cabs)
        assert len(tb.presets) == 128, "presets usine : %d" % len(tb.presets)
        tpl = resource_path("template.prst")
        assert os.path.isfile(tpl), "template.prst absent du bundle"
        # Garde anti-regression encodage. Sous Windows, open() sans encoding
        # utilise cp1252 : un octet UTF-8 dans un .json fait exploser json.load
        # (UnicodeDecodeError 0x9d). gp200lib passe encoding="utf-8" partout,
        # mais on exige EN PLUS que les donnees restent de l'ASCII pur, pour
        # qu'aucun code tiers ne puisse retomber dedans.
        # -> make_descriptions.py doit garder ensure_ascii=True.
        import glob
        for f in glob.glob(os.path.join(resource_path("data"), "*.json")):
            try:
                open(f, "rb").read().decode("ascii")
            except UnicodeDecodeError as e:
                raise AssertionError(
                    "%s n'est pas de l'ASCII pur (octet %d) : il cassera sous "
                    "une locale non-UTF8. Regenerer avec ensure_ascii=True."
                    % (os.path.basename(f), e.start))
        from gp200lib import encode_prst, decode_prst
        # Noms corriges d'apres algorithm.xml : regression si on les reperd.
        for slot, name in (("EQ", "Guitar EQ 1"), ("AMP", "SnapTone 1"),
                           ("DLY", "Ping Pong")):
            tb.find(slot, name)
        # Invariants catalogue firmware V1.8.0 (champ slots dans le JSON)
        slot_counts = {"WAH": 6, "DST": 43, "AMP": 76, "NR": 4,
                       "EQ": 6, "MOD": 28, "DLY": 22, "RVB": 15, "VOL": 1}
        for _s, _exp in slot_counts.items():
            _got = len(tb.models_for_slot(_s))
            assert _got == _exp, \
                "catalogue slot %s: %d modeles, attendu %d" % (_s, _got, _exp)
        raw, _ = encode_prst({"name": "selftest", "modules": {
            "AMP": {"model": "EV 51", "on": True}}}, tb, template=tpl)
        assert len(raw) == 1224, "encodage KO : %d octets" % len(raw)
        # round-trip : le Gain doit survivre au cycle encode -> decode
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".prst", delete=False) as fh:
            fh.write(encode_prst({"name": "rt", "modules": {
                "AMP": {"model": "EV 51", "on": True,
                        "params": {"Gain": 78}}}}, tb, template=tpl)[0])
            rt = fh.name
        d = decode_prst(rt, tb)
        os.unlink(rt)
        assert d["checksum"]["valid"], "checksum invalide apres encodage"
        assert abs(d["modules"]["AMP"]["params"]["Gain"] - 78) < 0.01, \
            "round-trip KO : Gain = %r" % d["modules"]["AMP"]["params"]["Gain"]
        _say("SELFTEST OK : %d modeles, %d cabs, encodage 1224 o\n"
             % (len(tb.models), len(tb.cabs)))
        return 0
    except Exception as e:
        _say("SELFTEST ECHEC : %s: %s\n%s\n"
             % (type(e).__name__, e, traceback.format_exc()), err=True)
        return 1


# Le selftest doit pouvoir tourner sans interface : il s'execute avant que la
# classe App (qui derive de tk.Tk) ne soit evaluee.
if __name__ == "__main__" and "--selftest" in sys.argv:
    raise SystemExit(selftest())


def EXEMPLES_L():
    """Exemples de demandes, traduits selon la langue courante."""
    return [T("ex_1"), T("ex_2"), T("ex_3"), T("ex_4"),
            T("ex_5"), T("ex_6"), T("ex_7"), T("ex_8")]


def EXEMPLES_AFFINE_L():
    return [T("exa_1"), T("exa_2"), T("exa_3"), T("exa_4"),
            T("exa_5"), T("exa_6"), T("exa_7")]


# tk vaut None si Tkinter est absent : la classe doit rester definissable pour
# que --selftest et le message d'erreur du __main__ soient atteignables.
def scrolled_text(parent, readonly=False, **kw):
    """Zone de texte avec ascenseur vertical et molette.

    readonly=True : lecture seule MAIS selectionnable/copiable. On n'utilise pas
    state="disabled" (qui bloque la selection souris) : a la place un binding
    avale les frappes tant que widget._readonly est vrai. Copier, selectionner,
    naviguer restent possibles.
    """
    kw.pop("state", None)
    f = ttk.Frame(parent)
    t = tk.Text(f, wrap="word", **kw)
    vs = ttk.Scrollbar(f, orient="vertical", command=t.yview)
    hs = ttk.Scrollbar(f, orient="horizontal", command=t.xview)
    t.configure(yscrollcommand=vs.set, xscrollcommand=hs.set)
    vs.grid(row=0, column=1, sticky="ns")
    hs.grid(row=1, column=0, sticky="ew")
    t.grid(row=0, column=0, sticky="nsew")
    f.rowconfigure(0, weight=1)
    f.columnconfigure(0, weight=1)

    if readonly:
        t._readonly = True

        def guard(e):
            # laisser passer : navigation, Ctrl-C, Ctrl-A, molette
            if e.state & 0x4 and e.keysym.lower() in ("c", "a"):   # Ctrl+C / Ctrl+A
                return
            if e.keysym in ("Left", "Right", "Up", "Down", "Home", "End",
                            "Prior", "Next", "Shift_L", "Shift_R",
                            "Control_L", "Control_R"):
                return
            if getattr(t, "_readonly", False):
                return "break"
        t.bind("<Key>", guard)

    def wheel(e):
        if e.num == 4 or e.delta > 0:
            t.yview_scroll(-3, "units")
        elif e.num == 5 or e.delta < 0:
            t.yview_scroll(3, "units")
        return "break"

    for w in (t, f):
        w.bind("<MouseWheel>", wheel)      # Windows / macOS
        w.bind("<Button-4>", wheel)        # Linux
        w.bind("<Button-5>", wheel)
    return f, t


def attach_copy_menu(widget, root):
    """Menu contextuel (clic droit) Copier / Tout copier / Tout selectionner,
    + Ctrl+C, sur un widget Text meme en lecture seule."""
    menu = tk.Menu(widget, tearoff=0)

    def do_copy():
        try:
            sel = widget.get("sel.first", "sel.last")
        except tk.TclError:
            sel = ""
        if not sel:
            sel = widget.get("1.0", "end-1c")     # rien de selectionne -> tout
        root.clipboard_clear()
        root.clipboard_append(sel)

    def do_copy_all():
        root.clipboard_clear()
        root.clipboard_append(widget.get("1.0", "end-1c"))

    def do_select_all():
        widget.tag_add("sel", "1.0", "end-1c")
        return "break"

    def relabel():
        menu.delete(0, "end")
        menu.add_command(label=T("copy"), command=do_copy)
        menu.add_command(label=T("copy_all"), command=do_copy_all)
        menu.add_separator()
        menu.add_command(label=T("select_all"), command=do_select_all)

    def popup(e):
        relabel()
        try:
            menu.tk_popup(e.x_root, e.y_root)
        finally:
            menu.grab_release()

    widget.bind("<Button-3>", popup)               # clic droit Win/Linux
    widget.bind("<Button-2>", popup)               # clic droit macOS
    widget.bind("<Control-c>", lambda e: (do_copy(), "break")[1])
    widget.bind("<Control-a>", lambda e: do_select_all())
    widget._relabel_copy_menu = relabel            # pour re-traduire a la volee
    return menu


class LangDialog(tk.Toplevel if tk is not None else object):
    """Premier lancement : choix de la langue. Modale, retourne le code choisi."""
    def __init__(self, parent, current=DEFAULT_LANG):
        super().__init__(parent)
        self.result = None
        self.configure(bg=TOK["bg_top"])
        self.title(T("welcome_lang_title"))
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        frm = ttk.Frame(self, padding=16)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text=T("welcome_lang_prompt"), wraplength=360).pack(
            anchor="w", pady=(0, 12))
        self.var = tk.StringVar(value=current)
        for code, label in LANGS.items():
            ttk.Radiobutton(frm, text=label, value=code, variable=self.var,
                            command=self._preview).pack(anchor="w", pady=2)
        self.btn = ttk.Button(frm, text=T("ok"), command=self._ok)
        self.btn.pack(anchor="e", pady=(14, 0))
        self.bind("<Return>", lambda e: self._ok())
        self._center(parent)

    def _preview(self):
        # traduit le titre/bouton en direct pour un retour immediat
        set_lang(self.var.get())
        self.title(T("welcome_lang_title"))
        self.btn.config(text=T("ok"))

    def _center(self, parent):
        self.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - self.winfo_width()) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - self.winfo_height()) // 2
        self.geometry("+%d+%d" % (max(x, 0), max(y, 0)))

    def _ok(self):
        self.result = self.var.get()
        self.destroy()


class ApiKeysDialog(tk.Toplevel if tk is not None else object):
    """Saisie/modification des cles API (Claude, Gemini, Perplexity, OpenAI).
    Retourne dict {anthropic, gemini, perplexity, openai} ou None."""
    def __init__(self, parent, claude="", gemini="", perplexity="",
                 openai="", openrouter=""):
        super().__init__(parent)
        self.result = None
        self.configure(bg=TOK["bg_top"])
        self.title(T("keys_title"))
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        frm = ttk.Frame(self, padding=16)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text=T("keys_intro"), wraplength=470,
                  foreground=C_DIM).grid(row=0, column=0, columnspan=3,
                                          sticky="w", pady=(0, 4))
        ttk.Label(frm, text=T("keys_help_intro"), wraplength=470,
                  foreground=C_GHOST).grid(row=1, column=0, columnspan=3,
                                          sticky="w", pady=(0, 12))

        self.vars = {}
        rows = [("anthropic", T("keys_claude")),
                ("gemini", T("keys_gemini")),
                ("perplexity", T("keys_perplexity")),
                ("openai", T("keys_openai")),
                ("openrouter", "OpenRouter")]
        preset = {"anthropic": claude, "gemini": gemini,
                  "perplexity": perplexity, "openai": openai,
                  "openrouter": openrouter}
        r = 2
        for prov, label in rows:
            ttk.Label(frm, text=label).grid(row=r, column=0, sticky="w")
            # Fournisseur acceptant la connexion par compte : on propose le
            # bouton plutot que le lien "obtenir une cle".
            if PROVIDERS.get(prov, {}).get("oauth"):
                b = ttk.Button(frm, text="\u26a1  " + DT("connect"),
                               style="Accent.TButton",
                               command=lambda pv=prov: self._oauth(pv))
                b.grid(row=r, column=1, sticky="e", padx=(8, 0))
                setattr(self, "_btn_" + prov, b)
            else:
                link = tk.Label(frm, text=T("keys_get"), fg=C_ACC, cursor="hand2")
                link.grid(row=r, column=1, sticky="e", padx=(8, 0))
                link.bind("<Button-1>",
                          lambda e, u=PROVIDERS[prov]["keys_url"]: self._open(u))
            v = tk.StringVar(value=preset.get(prov, ""))
            self.vars[prov] = v
            e = ttk.Entry(frm, textvariable=v, width=54, show="\u2022")
            e.grid(row=r + 1, column=0, columnspan=3, sticky="ew", pady=(2, 8))
            setattr(self, "_entry_" + prov, e)
            r += 2

        self.show = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text=T("keys_show"), variable=self.show,
                        command=self._toggle).grid(row=r, column=0, sticky="w")
        bar = ttk.Frame(frm)
        bar.grid(row=r + 1, column=0, columnspan=3, sticky="e", pady=(14, 0))
        # Acces direct au journal : sans console (exe --windowed), c'est le
        # seul moyen de savoir ce qui s'est passe.
        ttk.Button(bar, text=DT("open_log"), style="Ghost.TButton",
                   command=self._show_log).pack(side="left")
        ttk.Button(bar, text=T("keys_cancel"),
                   command=self.destroy).pack(side="right", padx=(6, 0))
        ttk.Button(bar, text=T("keys_save"),
                   command=self._save).pack(side="right")
        self._center(parent)

    def _oauth(self, prov):
        """Connexion par compte.

        Le flux reseau tourne dans un thread pour que la fenetre reste vivante
        pendant que l'utilisateur autorise dans son navigateur.

        ATTENTION : Tkinter n'est PAS sur en multi-thread. Appeler self.after()
        depuis le thread de travail marche souvent... et echoue parfois, sans
        rien dire. Le thread depose donc son resultat dans une file, et c'est
        le thread principal qui la releve. C'est le seul schema fiable.
        """
        btn = getattr(self, "_btn_" + prov, None)
        if btn is not None:
            btn.configure(state="disabled", text=DT("connecting"))
        self._oauth_url = None
        self._oauth_q = queue.Queue()
        gp200_oauth.diag("[UI] bouton clique, demarrage du thread (%s)" % prov)

        def work():
            try:
                key = gp200_oauth.connect(
                    provider=PROVIDERS[prov]["oauth"],
                    on_url=lambda u: setattr(self, "_oauth_url", u))
                self._oauth_q.put((prov, key, None))
                gp200_oauth.diag("[UI] resultat depose dans la file : succes")
            except Exception as e:
                self._oauth_q.put((prov, None, str(e)))
                gp200_oauth.diag("[UI] resultat depose dans la file : echec")
            except BaseException as e:      # ne jamais perdre un thread
                self._oauth_q.put((prov, None, T("x_unexpected", e)))

        t = threading.Thread(target=work)
        t.daemon = True
        t.start()
        self.after(150, self._oauth_poll)

    def _oauth_poll(self):
        """Releve la file depuis le thread principal, seul endroit ou l'on a
        le droit de toucher aux widgets."""
        try:
            prov, key, err = self._oauth_q.get_nowait()
        except queue.Empty:
            self.after(150, self._oauth_poll)
            return
        gp200_oauth.diag("[UI] resultat releve : %s"
                         % ("cle recue" if key else "echec"))
        try:
            self._oauth_done(prov, key, err)
        except Exception:
            import traceback as _tb
            gp200_oauth.diag("[UI] _oauth_done a leve :\n" + _tb.format_exc())

    def _oauth_done(self, prov, key, err):
        btn = getattr(self, "_btn_" + prov, None)
        if btn is not None:
            btn.configure(state="normal", text="\u26a1  " + DT("connect"))
        if key:
            self.vars[prov].set(key)
            gp200_oauth.diag("[UI] champ '%s' rempli, longueur %d"
                             % (prov, len(key)))
            # On enregistre TOUT DE SUITE : si l'utilisateur ferme la fenetre
            # sans cliquer Enregistrer, la cle serait perdue.
            self.result = {p: self.vars[p].get().strip() for p in self.vars}
            messagebox.showinfo("OpenRouter", DT("connected"), parent=self)
            return
        extra = "\n\n" + DT("see_log") + " " + gp200_oauth.log_path()
        if getattr(self, "_oauth_url", None):
            extra = "\n\n" + self._oauth_url + extra
        messagebox.showerror(DT("conn_failed"), (err or "?") + extra,
                             parent=self)

    def _show_log(self):
        """Ouvre le journal de connexion dans l'editeur du systeme."""
        path = gp200_oauth.log_path()
        if not os.path.isfile(path):
            messagebox.showinfo(DT("open_log"), DT("no_log") + "\n" + path,
                                parent=self)
            return
        try:
            if sys.platform.startswith("win"):
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception:
            messagebox.showinfo(DT("open_log"), path, parent=self)

    def _open(self, url):
        import webbrowser
        try:
            webbrowser.open(url)
        except Exception:
            pass

    def _toggle(self):
        ch = "" if self.show.get() else "\u2022"
        for prov in self.vars:
            getattr(self, "_entry_" + prov).config(show=ch)

    def _center(self, parent):
        self.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - self.winfo_width()) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - self.winfo_height()) // 2
        self.geometry("+%d+%d" % (max(x, 0), max(y, 0)))

    def _save(self):
        vals = {p: self.vars[p].get().strip() for p in self.vars}
        if not any(vals.values()):
            messagebox.showwarning(T("keys_title"), T("keys_at_least_one"),
                                   parent=self)
            return
        self.result = vals
        self.destroy()




class SetlistDialog(tk.Toplevel if tk is not None else object):
    """Dialogue d'harmonisation de volume pour une setlist de presets.

    Flow :
      1. L'utilisateur ajoute des .prst via un file dialog multi-selection
         (peut revenir plusieurs fois pour naviguer dans differents dossiers)
      2. Bouton Analyser : decode chaque preset, calcule le patch_vol suggere
      3. Affiche le resultat avec un slider par preset pour ajuster
      4. Bouton Appliquer : ecrit les presets harmonises dans un dossier unique
    """

    def __init__(self, parent, tables, cfg):
        super().__init__(parent)
        self._parent = parent
        self._tables = tables
        self._cfg = cfg
        self._files = []       # chemins des .prst charges
        self._analysis = None  # resultat de analyze_setlist
        self._sliders = {}     # path -> Scale widget

        self.configure(bg=TOK["bg_top"])
        self.title(T("setlist_title"))
        self.geometry("760x560")
        self.minsize(600, 400)
        self.transient(parent)
        self.grab_set()

        # -- barre de boutons haut
        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")
        ttk.Button(top, text=T("setlist_add"),
                   command=self._add_files).pack(side="left")
        ttk.Button(top, text=T("setlist_remove"),
                   command=self._remove_selected).pack(side="left", padx=6)
        ttk.Button(top, text=T("setlist_clear"),
                   command=self._clear).pack(side="left")
        self.btn_analyze = ttk.Button(top, text=T("setlist_analyze"),
                                      command=self._analyze)
        self.btn_analyze.pack(side="right")

        # -- zone de stockage (liste des fichiers charges)
        mid = ttk.LabelFrame(self, text=T("setlist_loaded"), padding=6)
        mid.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        # tk.Listbox est un widget Tk CLASSIQUE : ttk.Style ne l'atteint pas.
        # Sans ces couleurs explicites il reste blanc sur fond sombre.
        self.listbox = tk.Listbox(mid, selectmode="extended",
                                  font=FONT["mono"],
                                  bg=TOK["bg_field"], fg=TOK["ink"],
                                  selectbackground=TOK["acc_lo"],
                                  selectforeground=TOK["ink"],
                                  highlightthickness=0, bd=0, relief="flat",
                                  activestyle="none")
        sb = ttk.Scrollbar(mid, orient="vertical", command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=sb.set)
        self.listbox.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        # -- zone de resultats (apres analyse) avec sliders
        self.frm_results = ttk.LabelFrame(self, text=T("setlist_results"),
                                           padding=6)
        # pas pack() tout de suite : apparait apres l'analyse

        # -- barre de boutons bas
        bot = ttk.Frame(self, padding=8)
        bot.pack(fill="x", side="bottom")
        ttk.Button(bot, text=T("setlist_close"),
                   command=self.destroy).pack(side="right")
        self.btn_apply = ttk.Button(bot, text=T("setlist_apply"),
                                    command=self._apply, state="disabled")
        self.btn_apply.pack(side="right", padx=6)
        self.lbl_status = ttk.Label(bot, text="", foreground=C_DIM)
        self.lbl_status.pack(side="left")

        self._center(parent)

    def _center(self, parent):
        self.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - self.winfo_width()) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - self.winfo_height()) // 2
        self.geometry("+%d+%d" % (max(x, 0), max(y, 0)))

    # -- gestion de la liste de fichiers
    def _add_files(self):
        paths = filedialog.askopenfilenames(
            title=T("setlist_select"),
            initialdir=self._cfg.get("_last_outdir") or self._cfg.get("output_dir") or "",
            filetypes=[("Preset GP-200", "*.prst"), (T("x_all_files"), "*.*")])
        if not paths:
            return
        for p in paths:
            if p not in self._files:
                self._files.append(p)
                self.listbox.insert("end", os.path.basename(p))
        self.lbl_status.configure(text=T("setlist_count", len(self._files)))
        # Reinitialiser l'analyse si on ajoute des fichiers apres
        if self._analysis is not None:
            self._analysis = None
            self.btn_apply.configure(state="disabled")
            self.frm_results.pack_forget()

    def _remove_selected(self):
        sel = list(self.listbox.curselection())
        if not sel:
            return
        for i in reversed(sel):
            self._files.pop(i)
            self.listbox.delete(i)
        self.lbl_status.configure(text=T("setlist_count", len(self._files)))
        if self._analysis is not None:
            self._analysis = None
            self.btn_apply.configure(state="disabled")
            self.frm_results.pack_forget()

    def _clear(self):
        self._files.clear()
        self.listbox.delete(0, "end")
        self.lbl_status.configure(text="")
        self._analysis = None
        self.btn_apply.configure(state="disabled")
        self.frm_results.pack_forget()

    # -- analyse
    def _analyze(self):
        if not self._files:
            messagebox.showwarning(T("setlist_title"), T("setlist_empty"))
            return
        try:
            self._analysis = analyze_setlist(self._files, self._tables)
        except Exception as e:
            messagebox.showerror(T("setlist_title"),
                                 T("setlist_error", str(e)))
            return

        # Afficher les resultats avec sliders
        self.frm_results.pack_forget()
        for w in self.frm_results.winfo_children():
            w.destroy()
        self._sliders.clear()

        # Canvas scrollable. tk.Canvas est un widget CLASSIQUE : sans bg
        # explicite il reste blanc, et il se voit partout ou le contenu ne
        # le recouvre pas.
        canvas = tk.Canvas(self.frm_results, height=220,
                           bg=TOK["bg_top"], highlightthickness=0, bd=0)
        vsb = ttk.Scrollbar(self.frm_results, orient="vertical",
                             command=canvas.yview)
        inner = ttk.Frame(canvas)
        inner.bind("<Configure>",
                   lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        win = canvas.create_window((0, 0), window=inner, anchor="nw")
        # le contenu suit la largeur du canvas : sinon le fond depasse a droite
        canvas.bind("<Configure>",
                    lambda e: canvas.itemconfigure(win, width=e.width))
        canvas.configure(yscrollcommand=vsb.set)
        canvas.grid(row=0, column=0, sticky="nsew", pady=4)
        vsb.grid(row=0, column=1, sticky="ns", pady=4)
        self.frm_results.rowconfigure(0, weight=1)
        self.frm_results.columnconfigure(0, weight=1)

        # En-tete DANS la meme grille que les lignes. Avant, elle vivait dans
        # frm_results et les lignes dans inner : deux grilles independantes,
        # donc des colonnes qui ne tombaient jamais en face.
        # PAS de sil() ici : l'interlettrage double la largeur du texte, les
        # libelles debordaient de leur colonne et se chevauchaient. Les
        # largeurs et le sticky sont copies a l'identique sur les lignes de
        # donnees, sinon les colonnes ne tombent pas en face.
        for col, key, w, stick in ((0, "setlist_col_name", 20, "w"),
                                   (1, "setlist_col_amp", 16, "w"),
                                   (2, "setlist_col_current", 8, "ew"),
                                   (3, "setlist_col_suggested", 22, "ew")):
            ttk.Label(inner, text=T(key).upper(), style="Sil.TLabel",
                      width=w, anchor="w" if stick == "w" else "center"
                      ).grid(row=0, column=col, sticky=stick, padx=4,
                             pady=(0, 6))
        ttk.Separator(inner, orient="horizontal").grid(
            row=1, column=0, columnspan=5, sticky="ew", pady=(0, 4))
        for col, weight in ((0, 0), (1, 0), (2, 0), (3, 1), (4, 0)):
            inner.columnconfigure(col, weight=weight)

        for i, entry in enumerate(self._analysis):
            r = i + 2          # 0 = en-tete, 1 = separateur
            # Nom du preset
            ttk.Label(inner, text=entry["name"], width=20, anchor="w"
                      ).grid(row=r, column=0, sticky="w", padx=4, pady=2)
            # Ampli + gain
            amp_info = entry["amp_model"]
            if entry["dst_on"]:
                amp_info += " +DST"
            ttk.Label(inner, text=amp_info, width=16, foreground=C_DIM
                      ).grid(row=r, column=1, sticky="w", padx=4, pady=2)
            # Volume actuel
            cur = entry["current_pv"]
            sug = entry["suggested_pv"]
            delta = sug - cur
            color = C_OK if abs(delta) <= 3 else (C_WARN if abs(delta) <= 10 else C_ERR)
            ttk.Label(inner, text=str(cur), width=8, anchor="center"
                      ).grid(row=r, column=2, sticky="ew", padx=4, pady=2)
            # Slider pour ajuster le volume suggere
            var = tk.IntVar(value=sug)
            # tk.Scale (et non ttk.Scale) parce qu'il affiche sa valeur.
            # Widget classique lui aussi : couleurs a poser a la main.
            sc = tk.Scale(inner, from_=2, to=100, orient="horizontal",
                          variable=var, length=180, showvalue=True,
                          font=FONT["micro_mono"],
                          bg=TOK["bg_top"], fg=TOK["ink"],
                          troughcolor=TOK["bg_field"],
                          activebackground=TOK["acc_hi"],
                          highlightthickness=0, bd=0, relief="flat",
                          sliderrelief="flat")
            sc.grid(row=r, column=3, sticky="ew", padx=4, pady=2)
            # Indicateur delta
            sign = "+" if delta > 0 else ""
            lbl_d = ttk.Label(inner, text="(%s%d)" % (sign, delta),
                              foreground=color, width=6)
            lbl_d.grid(row=r, column=4, pady=2)
            self._sliders[entry["path"]] = var

        self.frm_results.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        self.btn_apply.configure(state="normal")
        self.lbl_status.configure(text=T("setlist_analyzed", len(self._analysis)))

    # -- application
    def _apply(self):
        if not self._analysis:
            return
        import datetime
        now = datetime.datetime.now()
        outdir = os.path.join(
            self._cfg.get("output_dir") or os.path.dirname(self._files[0]),
            "setlist_harmonisee_%s" % now.strftime("%Y%m%d_%H%M%S"))

        entries = []
        for entry in self._analysis:
            var = self._sliders.get(entry["path"])
            final_pv = var.get() if var else entry["suggested_pv"]
            entries.append({"path": entry["path"], "final_pv": final_pv})

        try:
            written = apply_setlist(entries, outdir)
        except Exception as e:
            messagebox.showerror(T("setlist_title"),
                                 T("setlist_error", str(e)))
            return

        self.lbl_status.configure(text=T("setlist_done", len(written), outdir))
        messagebox.showinfo(T("setlist_title"),
                            T("setlist_done", len(written), outdir))
        self._cfg["_last_outdir"] = outdir


class CtrlDialog(tk.Toplevel if tk is not None else object):
    """Grille CTRL 1..8 x 11 modules pour le preset selectionne.

    Ecrit la table CTRL du .prst en place (0x460, masque = index de module,
    format confirme par export de l'editeur officiel) et recalcule le checksum.
    """

    def __init__(self, parent, path, name, on_saved=None):
        super().__init__(parent)
        self._path = path
        self._on_saved = on_saved
        self._data = bytearray(open(path, "rb").read())
        if len(self._data) != FILE_SIZE:
            self.destroy()
            raise ValueError("Taille invalide : %d" % len(self._data))
        cur = read_ctrl(self._data)

        self.configure(bg=TOK["bg_top"])
        self.title(DT("ctrl_title", name))
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        frm = ttk.Frame(self, padding=10)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text=DT("ctrl_hint"), style="Dim.TLabel",
                  wraplength=560).grid(row=0, column=0, columnspan=len(MODULES) + 1,
                                       sticky="w", pady=(0, 8))
        for j, m in enumerate(MODULES):
            ttk.Label(frm, text=m).grid(row=1, column=j + 1, padx=3)
        self._vars = []
        for n in range(N_CTRL):
            ttk.Label(frm, text="CTRL %d" % (n + 1)).grid(
                row=n + 2, column=0, sticky="w", padx=(0, 8), pady=1)
            row = {}
            for j, m in enumerate(MODULES):
                v = tk.BooleanVar(value=m in cur[n])
                ttk.Checkbutton(frm, variable=v).grid(row=n + 2, column=j + 1)
                row[m] = v
            self._vars.append(row)

        bot = ttk.Frame(self, padding=(10, 0, 10, 10))
        bot.pack(fill="x")
        ttk.Button(bot, text=DT("ctrl_cancel"), style="Ghost.TButton",
                   command=self.destroy).pack(side="right")
        ttk.Button(bot, text=DT("ctrl_save"),
                   command=lambda: self._save(False)).pack(side="right", padx=6)
        if _USB_INJECT_OK:
            ttk.Button(bot, text=DT("ctrl_save_inj"),
                       command=lambda: self._save(True)).pack(side="right")

        self.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - self.winfo_width()) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - self.winfo_height()) // 2
        self.geometry("+%d+%d" % (max(x, 0), max(y, 0)))

    def _save(self, inject):
        spec = {n + 1: [m for m, v in row.items() if v.get()]
                for n, row in enumerate(self._vars)}
        write_ctrl(self._data, spec)
        struct.pack_into(">H", self._data, len(self._data) - 2,
                         checksum(self._data))
        with open(self._path, "wb") as fh:
            fh.write(self._data)
        summary = ", ".join("CTRL%d=%s" % (n, "+".join(ms))
                            for n, ms in spec.items() if ms) or "-"
        self.destroy()
        if self._on_saved:
            self._on_saved(summary, inject)


class App(tk.Tk if tk is not None else object):
    def __init__(self):
        super().__init__()
        
        # Charger l'icône proprement pour le haut ET le bas
        try:
            from gp200_agent import resource_path
            ico_path = resource_path("icon.ico")
            
            # 1. Appliquer immédiatement pour la barre de titre (en haut)
            self.iconbitmap(ico_path)
            
            # 2. Forcer le rafraîchissement 100ms plus tard pour la barre des tâches (en bas)
            self.after(100, lambda: self.iconbitmap(ico_path))
        except Exception:
            pass

        self.cfg = load_config()

        
        # Theme Retro-Future Hardware. Purement cosmetique : s'il echoue,
        # l'appli doit continuer a tourner avec le theme ttk par defaut.
        try:
            apply_theme(self)
            self._themed = True
        except Exception:
            self._themed = False
        # langue : config, sinon defaut. Le premier lancement la demandera.
        set_lang(self.cfg.get("lang") or DEFAULT_LANG)
        self.title("%s  v%s" % (T("app_title"), APP_VERSION))
        # taille deduite de l'ecran : 90 % de la surface, bornee, centree.
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        w = max(940, min(int(sw * 0.90), 1720))
        h = max(620, min(int(sh * 0.88), 1060))
        self.geometry("%dx%d+%d+%d" % (w, h, max(0, (sw - w) // 2),
                                       max(0, (sh - h) // 2 - 16)))
        self.minsize(940, 620)
        self.configure(bg=TOK["bg_deep"])

        try:
            self.tb = Tables(resource_path("data"))
        except Exception as e:
            messagebox.showerror(T("x_tables_title"),
                                 T("x_tables_fail", e))
            raise SystemExit(1)

        self._first_run_setup()      # langue + cles au tout premier lancement
        self._build()
        self._check_config()

    # ------------------------------------------------------ premier lancement
    def _first_run_setup(self):
        """Au tout premier lancement (config jamais validee), demande la langue
        puis les cles API, et ecrit config.json."""
        if self.cfg.get("configured"):
            return
        self.update_idletasks()
        # 1. langue
        dlg = LangDialog(self, current=self.cfg.get("lang") or DEFAULT_LANG)
        self.wait_window(dlg)
        if dlg.result:
            set_lang(dlg.result)
            self.cfg["lang"] = dlg.result
            self.title("%s  v%s" % (T("app_title"), APP_VERSION))
        # 2. cles API
        kd = ApiKeysDialog(self, self.cfg.get("api_key_anthropic", ""),
                           self.cfg.get("api_key_gemini", ""),
                           self.cfg.get("api_key_perplexity", ""),
                           self.cfg.get("api_key_openai", ""),
                           self.cfg.get("api_key_openrouter", ""))
        self.wait_window(kd)
        if kd.result:
            # Recopie generique : le dialogue renvoie {fournisseur: cle}.
            # Enumerer les cles a la main ici a deja fait perdre une cle
            # ajoutee plus tard -- on ne recommence pas.
            for prov, val in kd.result.items():
                self.cfg["api_key_" + prov] = val
        self.cfg["configured"] = True
        save_config(self.cfg)

    # ---------------------------------------------------------------- UI
    #
    #  Disposition Retro-Future Hardware.
    #
    #      +--------------------------------------------------------------+
    #      |  en-tete : marque | Nouveau/Affiner | langue, cles, dossier   |
    #      +----------------+---------------------------------------------+
    #      | REGLAGES       |  DEMANDE (zone de saisie + exemples)         |
    #      |  fournisseur   |  CHAINE DE SIGNAL (SignalRack)               |
    #      |  modele        |  Resultat / Journal (Notebook)               |
    #      |  micro         |                                             |
    #      |  structure     |                                             |
    #      |  depense       |                                             |
    #      +----------------+---------------------------------------------+
    #      |  pied : LED + statut          Setlist | Concert | GENERER     |
    #      +--------------------------------------------------------------+
    #
    #  _build() doit rester RE-ENTRANT : _retranslate() detruit tous les
    #  enfants et le rappelle. Aucun etat ne doit vivre ailleurs que dans
    #  self.cfg ou dans des variables recreees ici.
    #
    def _build(self):
        # les libelles de la couche graphique (noms de slots, etats du rack,
        # inspecteur) suivent la langue courante. _retranslate() rappelle
        # _build(), donc ce seul point suffit.
        set_ui_lang(get_lang())
        self._build_header()
        # ORDRE CRITIQUE : le pied doit etre packe AVANT le corps. pack() sert
        # les enfants dans l'ordre de declaration ; un corps en expand=True
        # pose avant un pied en side="bottom" absorbe toute la cavite et le
        # pied se retrouve sans hauteur. C'est ce qui faisait disparaitre le
        # bouton Generer.
        self._build_footer()
        self._build_body()
        # en dernier : ces methodes manipulent des widgets crees ci-dessus
        self._switch_mode()
        self._refresh_usage()
        if getattr(self, "_gen", None):
            self._set_presets(self._gen)

    # ------------------------------------------------------------- en-tete
    def _build_header(self):
        hd = GradientStrip(self, top=TOK["bg_panel"], bot=TOK["bg_panel"],
                           height=int(62 * UI_SCALE[0]),
                           line=TOK["line_soft"])
        hd.pack(fill="x", side="top")
        self._top_anchor = hd        # la banniere maj se packe au-dessus
        self.update_bar = None

        left = ttk.Frame(hd, style="Panel.TFrame")
        left.place(x=TOK["pad_lg"], rely=0.5, anchor="w")
        mark = tk.Canvas(left, width=30, height=30, bg=TOK["bg_panel"],
                         highlightthickness=0, bd=0)
        mark.pack(side="left", padx=(0, 12))
        from gp200_ui import fill_round_rect, stroke_round_rect
        from gp200_theme import mix
        fill_round_rect(mark, 1, 1, 29, 29, 8,
                        mix(TOK["acc_hi"], "#ffffff", 0.2), TOK["acc_lo"])
        stroke_round_rect(mark, 1, 1, 29, 29, 8,
                          mix(TOK["acc_hi"], "#ffffff", 0.4))
        mark.create_text(15, 15, text="GP", fill=TOK["acc_ink"],
                         font=(FONT["family_display"], 12, "bold"))
        tt = ttk.Frame(left, style="Panel.TFrame")
        tt.pack(side="left")
        ttk.Label(tt, text=sil("GP-200 STUDIO"),
                  style="H1.TLabel").pack(anchor="w")
        ttk.Label(tt, text="v%s   -   Valeton GP-200" % APP_VERSION,
                  style="PanelDim.TLabel").pack(anchor="w")

        # selecteur de mode
        mid = ttk.Frame(hd, style="Panel.TFrame")
        mid.place(relx=0.46, rely=0.5, anchor="center")
        self.var_mode = tk.StringVar(value="new")
        ttk.Radiobutton(mid, text=T("mode_new"), value="new",
                        variable=self.var_mode,
                        command=self._switch_mode).pack(side="left")
        ttk.Radiobutton(mid, text=T("mode_refine"), value="refine",
                        variable=self.var_mode,
                        command=self._switch_mode).pack(side="left", padx=18)

        right = ttk.Frame(hd, style="Panel.TFrame")
        right.place(relx=1.0, x=-TOK["pad_lg"], rely=0.5, anchor="e")
        self.cb_lang = ttk.Combobox(right, state="readonly", width=11,
                                    values=[LANGS[c] for c in LANGS])
        self._langs = list(LANGS)
        cur_l = get_lang()
        self.cb_lang.current(self._langs.index(cur_l)
                             if cur_l in self._langs else 0)
        self.cb_lang.pack(side="left", padx=(0, 8))
        self.cb_lang.bind("<<ComboboxSelected>>", self._switch_lang)

        # ── Bouton ⚙ Config (menu déroulant) ──
        btn_cfg = ttk.Button(right, text=T("menu_config"),
                             style="Ghost.TButton",
                             command=lambda b=None: self._show_config_menu())
        btn_cfg.pack(side="left", padx=2)
        self._btn_cfg = btn_cfg

        # ── Bouton ★ Fonctionnalités (menu déroulant) ──
        btn_feat = ttk.Button(right, text=T("menu_features"),
                              style="Ghost.TButton",
                              command=lambda: self._show_features_menu())
        btn_feat.pack(side="left", padx=2)
        self._btn_feat = btn_feat

	# ← AJOUTE CES 3 LIGNES ICI :
        # Bouton Live Control — caché pour l'instant (accessible via clic sur rack)
        # ttk.Button(right, text="🎸 Live Control",
        #            style="Ghost.TButton",
        #            command=self._open_live).pack(side="left", padx=2)

        # LED GP-200 — pastille colorée (● + texte avec foreground)
        self._lbl_usb_led = tk.Label(right, text="● GP-200",
                                      font=("Arial", 9, "bold"),
                                      foreground="#757575",
                                      background=TOK["bg_panel"])
        self._lbl_usb_led.pack(side="left", padx=(8, 2))

        # Bouton slot d'injection 📍
        self._v_inject_slot_lbl = tk.StringVar(value="")
        self._btn_slot = ttk.Button(right, textvariable=self._v_inject_slot_lbl,
                                     style="Ghost.TButton",
                                     command=self._ask_inject_slot)
        self._btn_slot.pack(side="left", padx=(0, 4))

        self.after(500, self._refresh_usb_led)
        self.after(600, self._check_first_launch_slot)
        # Démarrer le keep-alive audio USB (remplace l'éditeur Valeton)
        self._audio_wake = None
        if AudioWakeKeepAlive:
            self.after(800, self._start_audio_wake)
        # Ecoute pedalier : un module bascule au pied s'allume/s'eteint ici.
        # (_build_header est rejoue au changement de langue : une seule fois)
        if GP200Listener and not getattr(self, "_listener", None):
            self._fs_q = queue.Queue()
            self._listener = GP200Listener(self._fs_q.put)  # thread WinMM -> file
            self._listener.start()
            self._listener_next_open = 0.0
            self.after(1200, self._listener_tick)
        # Bouton theme conserve pour compatibilite i18n, desormais inerte :
        # le systeme Retro-Future n'a qu'un mode sombre.
        self.btn_theme = None

        # Barre de progression : reduite a un filet de 3 px sous l'en-tete.
        # Le vrai indicateur d'activite est la trace du rack ; celle-ci ne
        # sert que pendant les phases sans chaine affichee.
        self.pb = ttk.Progressbar(self, mode="indeterminate",
                                  style="Thin.Horizontal.TProgressbar")
        self.pb.pack(fill="x", side="top")

    # ---------------------------------------------------------------- corps
    def _build_body(self):
        body = ttk.Frame(self, style="Deep.TFrame")
        body.pack(fill="both", expand=True)

        # ============================ colonne gauche : reglages ============
        side = ttk.Frame(body, style="Panel.TFrame",
                         width=int(TOK["sidebar_w"] * 1.28))
        side.pack(side="left", fill="y")
        side.pack_propagate(False)
        pad = TOK["pad_md"]

        ttk.Label(side, text=sil(T("options")),
                  style="SilPanel.TLabel").pack(anchor="w", padx=pad,
                                                pady=(pad, 6))

        ttk.Label(side, text=T("provider"),
                  style="PanelDim.TLabel").pack(anchor="w", padx=pad)
        self.cb_prov = ttk.Combobox(
            side, state="readonly", width=26,
            values=[provider_label(p) for p in PROVIDERS])
        self._provs = list(PROVIDERS)
        cur = self.cfg.get("provider", DEFAULT_PROVIDER)
        self.cb_prov.current(self._provs.index(cur) if cur in self._provs else 0)
        self.cb_prov.pack(fill="x", padx=pad, pady=(2, 8))
        self.cb_prov.bind("<<ComboboxSelected>>", self._switch_provider)

        ttk.Label(side, text=T("model"),
                  style="PanelDim.TLabel").pack(anchor="w", padx=pad)
        mrow = ttk.Frame(side, style="Panel.TFrame")
        mrow.pack(fill="x", padx=pad, pady=(2, 8))
        self.cb_model = ttk.Combobox(mrow, width=18)
        self.cb_model.pack(side="left", fill="x", expand=True)
        self.cb_model.bind("<<ComboboxSelected>>", self._switch_model)
        ttk.Button(mrow, text=T("refresh"), width=8, style="Ghost.TButton",
                   command=self._refresh_models).pack(side="left", padx=(4, 0))

        ttk.Label(side, text=T("pickup_label"),
                  style="PanelDim.TLabel").pack(anchor="w", padx=pad)
        self._pickup_keys = ["auto", "humbucker", "single", "p90", "active"]
        self.cb_pickup = ttk.Combobox(
            side, state="readonly", width=26,
            values=[T("pickup_" + k) for k in self._pickup_keys])
        cur_pk = self.cfg.get("pickup", "auto")
        self.cb_pickup.current(self._pickup_keys.index(cur_pk)
                               if cur_pk in self._pickup_keys else 0)
        self.cb_pickup.pack(fill="x", padx=pad, pady=(2, 8))
        self.cb_pickup.bind("<<ComboboxSelected>>", self._switch_pickup)

        self.var_ws = tk.BooleanVar(value=bool(self.cfg.get("web_search", True)))
        ttk.Checkbutton(side, text=T("web_search"), variable=self.var_ws,
                        command=self._ws_hint).pack(anchor="w", padx=pad,
                                                    pady=(0, 10))
        self._fill_models()

        ttk.Separator(side, orient="horizontal").pack(fill="x", padx=pad,
                                                      pady=6)

        # (API USAGE masqué — coûts gérés en interne)

        ttk.Separator(side, orient="horizontal").pack(fill="x", padx=pad,
                                                      pady=(2, 6))
        ttk.Label(side, text=sil(DT("gen_list")),
                  style="SilPanel.TLabel").pack(anchor="w", padx=pad,
                                                pady=(0, 4))
        # Une generation ecrit 3 variantes par section : sans cette liste on
        # ne voyait que la derniere, sans savoir laquelle. On peut desormais
        # passer de l'une a l'autre et voir la chaine se recomposer.
        self.presets = PresetList(side, on_select=self._on_preset_pick,
                                  width=int(TOK["sidebar_w"] * 1.10))
        self.presets.pack(fill="both", expand=True, padx=(6, 2),
                          pady=(0, TOK["pad_sm"]))
        # _retranslate() detruit l'interface et rappelle _build() : la liste
        # deja generee doit survivre au changement de langue.
        self._gen = getattr(self, "_gen", [])

        ttk.Frame(body, style="TFrame", width=1).pack(side="left", fill="y")

        # ============================ colonne principale ===================
        main = ttk.Frame(body, style="TFrame")
        main.pack(side="left", fill="both", expand=True)
        px = TOK["pad_lg"]

        # ---- chargement d'un .prst (mode Affiner uniquement)
        self.frm_load = ttk.Frame(main, style="TFrame")
        ttk.Button(self.frm_load, text=T("load_prst"),
                   command=self._load_prst).pack(side="left")
        self.lbl_loaded = ttk.Label(self.frm_load, text=T("no_file"),
                                    foreground=C_ERR)
        self.lbl_loaded.pack(side="left", padx=10)
        self.loaded = None

        # ---- demande
        self.frm_ask = ttk.Frame(main, style="TFrame")
        self.frm_ask.pack(fill="x", padx=px, pady=(int(9 * UI_SCALE[0]), 0))
        hrow = ttk.Frame(self.frm_ask, style="TFrame")
        hrow.pack(fill="x")
        self.lbl_title = ttk.Label(hrow, text=sil(T("describe_title")),
                                   style="Sil.TLabel")
        self.lbl_title.pack(side="left")
        self.lbl_sub = ttk.Label(hrow, text=T("describe_sub"),
                                 style="Dim.TLabel")
        self.lbl_sub.pack(side="left", padx=10)

        well = Well(self.frm_ask, bg=TOK["bg_top"],
                    height=int(58 * UI_SCALE[0]))
        well.pack(fill="x", pady=(5, 5))
        self.txt = tk.Text(well, height=2, wrap="word", bd=0,
                           highlightthickness=0, bg=TOK["bg_field"],
                           fg=TOK["ink"], insertbackground=TOK["acc"],
                           font=FONT["body"])
        well.mount(self.txt)
        self.txt.insert("1.0", EXEMPLES_L()[0])

        ex = ttk.Frame(self.frm_ask, style="TFrame")
        ex.pack(fill="x")
        ttk.Label(ex, text=sil(T("examples")),
                  style="Sil.TLabel").pack(side="left", padx=(0, 8))
        self.cb_ex = ttk.Combobox(ex, values=EXEMPLES_L(), state="readonly")
        self.cb_ex.pack(side="left", fill="x", expand=True)
        self.cb_ex.bind("<<ComboboxSelected>>", self._use_example)

        # ---- structure du morceau (mode Nouveau uniquement)
        #  ATTENTION : _toggle_auto() retrouve les cases par
        #  self.lbl_count.master.grid_slaves(row=1). Les 4 roles doivent
        #  rester en ligne 1 et lbl_count dans le meme parent.
        self.st = ttk.Frame(main, style="TFrame")
        ttk.Label(self.st, text=sil(T("structure")),
                  style="Sil.TLabel").grid(row=0, column=0, columnspan=6,
                                           sticky="w", pady=(0, 4))
        ttk.Label(self.st, text=T("force"),
                  style="Dim.TLabel").grid(row=1, column=0, sticky="w",
                                           padx=(0, 10))
        self.var_roles = {}
        for i, r in enumerate(ROLES):
            v = tk.BooleanVar(value=False)
            self.var_roles[r] = v
            ttk.Checkbutton(self.st, text=T("role_" + r), variable=v,
                            command=self._count_hint).grid(
                                row=1, column=1 + i, sticky="w", padx=(0, 14))
        self.var_auto = tk.BooleanVar(value=True)
        ttk.Checkbutton(self.st, text=T("auto_detect"), variable=self.var_auto,
                        command=self._toggle_auto).grid(
                            row=2, column=0, columnspan=6, sticky="w",
                            pady=(4, 0))
        self.lbl_count = ttk.Label(self.st, text="", style="Dim.TLabel")
        self.lbl_count.grid(row=3, column=0, columnspan=6, sticky="w",
                            pady=(4, 0))
        self._toggle_auto()

        # ---- chaine de signal
        crow = ttk.Frame(main, style="TFrame")
        crow.pack(fill="x", padx=px, pady=(int(9 * UI_SCALE[0]), 3))
        self.lbl_chain_t = ttk.Label(crow, text=sil(DT("chain")),
                                     style="Sil.TLabel")
        self.lbl_chain_t.pack(side="left")
        self.lbl_chain = ttk.Label(crow, text="", style="Dim.TLabel")
        self.lbl_chain.pack(side="left", padx=10)

        # PAS de Panedwindow ici, et c'est delibere.
        #
        #   Un ttk.Panedwindow pose son separateur d'apres la taille que les
        #   volets ANNONCENT au premier calcul de geometrie. A cet instant le
        #   rack et l'inspecteur n'ont pas encore dessine leur contenu : un
        #   Canvas Tk annonce sa valeur par defaut, 7 cm (~265 px). Le volet
        #   du haut reclamait donc ~445 px, le separateur se figeait la, et
        #   la reduction ulterieure a la vraie hauteur ne le ramenait pas.
        #   Resultat : un grand vide sous l'inspecteur et les onglets ecrases.
        #
        #   Un simple empilage n'a pas ce defaut : le rack et l'inspecteur
        #   prennent exactement la hauteur qu'ils demandent A CHAQUE calcul,
        #   et le bloc Resultat/Journal, seul en expand, absorbe tout le
        #   reste. Aucun etat fige, rien a re-synchroniser.
        rackbox = tk.Frame(main, bg=TOK["bg_rail"], highlightthickness=1,
                           highlightbackground=TOK["line_soft"])
        rackbox.pack(fill="x", expand=False, padx=px, pady=(0, TOK["pad_sm"]))
        # Les cartes disent le TRAJET du signal, l'inspecteur dit les VALEURS
        # du module choisi. Chacun son travail, chacun sa hauteur.
        self.rack = SignalRack(rackbox, on_click=self._on_slot_click,
                               height=int(150 * UI_SCALE[0]))
        self.rack.pack(fill="x", expand=False)
        # hauteur initiale explicite : sans elle le Canvas annoncerait 265 px
        # et ferait sursauter la fenetre au premier affichage.
        self.insp = ModuleInspector(rackbox, bg=TOK["bg_rail"],
                                    height=int(70 * UI_SCALE[0]))
        self.insp.pack(fill="x", expand=False)

        # ---- resultat / journal : recupere TOUT l'espace restant
        nb = ttk.Notebook(main)
        nb.pack(fill="both", expand=True, padx=px, pady=(0, TOK["pad_md"]))
        fres, self.res = scrolled_text(nb, font=FONT["mono"], readonly=True,
                                       height=10)
        flog, self.log = scrolled_text(nb, font=FONT["mono"], readonly=True,
                                       height=10)
        nb.add(fres, text=T("result"))
        nb.add(flog, text=T("log_tab"))
        self.nb = nb
        attach_copy_menu(self.res, self)
        attach_copy_menu(self.log, self)

    # ------------------------------------------------------------------ pied
    def _build_footer(self):
        ft = GradientStrip(self, top=TOK["bg_panel"], bot=TOK["bg_panel"],
                           height=int(66 * UI_SCALE[0]))
        ft.pack(fill="x", side="bottom")
        ft.create_line(0, 0, 4000, 0, fill=TOK["line_soft"])

        left = ttk.Frame(ft, style="Panel.TFrame")
        left.place(x=TOK["pad_lg"], rely=0.5, anchor="w")
        self.led = Led(left, on=True, size=9)
        self.led.pack(side="left", padx=(0, 8))
        # self.status conserve son API (.configure(text=, foreground=)) :
        # une trentaine d'appels ailleurs en dependent.
        self.status = ttk.Label(left, text="", style="PanelDim.TLabel",
                                anchor="w")
        self.status.pack(side="left")

        right = ttk.Frame(ft, style="Panel.TFrame")
        right.place(relx=1.0, x=-TOK["pad_lg"], rely=0.5, anchor="e")
        # self.btn est un GlowButton : il expose configure(text=, state=)
        # pour rester compatible avec _go / _after_work / _switch_mode.
        self.btn = GlowButton(right, text=T("generate_button"), icon="\u26a1",
                              bg=TOK["bg_panel"], command=self._go)
        self.btn.pack(side="right")
        self.btn_live = ttk.Button(right, text=T("live_ready_button"),
                                   command=self._go_live)
        self.btn_setlist = ttk.Button(right, text=T("setlist_button"),
                                      style="Ghost.TButton",
                                      command=self._open_setlist)
        # les deux ne sont packes qu'en mode Affiner (_switch_mode)

        # Bouton Inject GP-200 — toujours visible
        self.btn_inject = ttk.Button(right, text="🔌 " + T("inject_button"),
                                     style="Ghost.TButton",
                                     command=self._inject_preset)
        self.btn_inject.pack(side="right", padx=(0, 6))

        # Affectations CTRL (footswitches) du preset selectionne
        self.btn_ctrl = ttk.Button(right, text="\U0001f39b " + DT("ctrl_btn"),
                                   style="Ghost.TButton",
                                   command=self._edit_ctrl)
        self.btn_ctrl.pack(side="right", padx=(0, 6))

        # Progress bar inject — cachée par défaut
        self._inject_bar = ttk.Progressbar(left, mode="determinate",
                                            length=180, maximum=8)
        self._inject_bar_visible = False

    # --------------------------------------------------------------- modes
    def _switch_mode(self):
        refining = self.var_mode.get() == "refine"
        if refining:
            # le bandeau de chargement se glisse au-dessus de la zone demande
            self.frm_load.pack(fill="x", padx=TOK["pad_lg"],
                               pady=(TOK["pad_md"], 0), before=self.frm_ask)
            self.lbl_title.configure(text=sil(T("refine_title")))
            self.lbl_sub.configure(text=T("refine_sub"))
            self.st.pack_forget()
            self.cb_ex.configure(values=EXEMPLES_AFFINE_L())
            self.btn.configure(text=T("refine_button"))
            self.btn_live.pack(side="right", padx=(0, 14))
            # btn_setlist supprimé du footer → dans menu ★ Fonctionnalités
        else:
            self.frm_load.pack_forget()
            self.lbl_title.configure(text=sil(T("describe_title")))
            self.lbl_sub.configure(text=T("describe_sub"))
            self.st.pack(fill="x", padx=TOK["pad_lg"], pady=(2, 6),
                         after=self.frm_ask)
            self.cb_ex.configure(values=EXEMPLES_L())
            self.btn.configure(text=T("generate_button"))
            self.btn_live.pack_forget()
            self.btn_setlist.pack_forget()
        self._refresh_usage()

    # ------------------------------------------------------- rack de signal
    def _show_chain(self, modules, progress=None, title=None, select_idx=None):
        """Alimente le rack a partir d'un dict de modules."""
        if not hasattr(self, "rack"):
            return
        slots = []
        for sl in MODULES:
            e = (modules or {}).get(sl) or {}
            slots.append({"slot": sl,
                          "model": e.get("model") or "",
                          "on": bool(e.get("on", True)) and bool(e.get("model")),
                          "params": e.get("params") or {}})
        self.rack.set_slots(slots)
        n_on = sum(1 for s in slots if s["on"])
        info = DT("modules", len(slots), n_on, len(slots) - n_on)
        self.lbl_chain.configure(
            text=("%s   -   %s" % (title, info)) if title else info,
            foreground=TOK["ink"] if title else TOK["ink_ghost"])
        if progress is not None:
            self.rack.set_progress(progress)
            
        # Respecter l'index demandé s'il est fourni, sinon comportement par défaut
        if select_idx is not None and 0 <= select_idx < len(slots):
            pick = select_idx
        else:
            pick = next((k for k, x in enumerate(slots)
                         if x["slot"] == "AMP" and x["on"]), None)
            if pick is None:
                pick = next((k for k, x in enumerate(slots) if x["on"]), None)
                
        if pick is None:
            self.insp.set_module(None)
        else:
            self.rack.select(pick)
            self.insp.set_module(slots[pick], pos=(pick, len(slots)))

    def _sweep_chain(self, k=0):
        """Allume la trace module par module apres une ecriture reussie."""
        if not hasattr(self, "rack"):
            return
        if k > len(MODULES):
            return
        self.rack.set_progress(k)
        self.after(55, lambda: self._sweep_chain(k + 1))

    def _collect_presets(self, written, secs):
        """Construit la liste navigable a partir du resultat de _work().

        written : liste de (chemin, section, variante) telle que la produit
        deja le moteur -- on ne lui demande rien de plus.
        """
        fams = ("GEN", "CAB", "FX")
        items = []
        for path, sec, v in written:
            spec = v.get("spec") or {}
            try:
                si = secs.index(sec)
            except (ValueError, AttributeError):
                si = 0
            meta = "%s - %s" % (sec.get("nom", "?"), v.get("label", "?")) \
                if isinstance(sec, dict) else v.get("label", "?")
            items.append({
                "name": spec.get("name") or os.path.basename(path),
                "meta": meta,
                "cat": fams[si % len(fams)],
                "modules": spec.get("modules"),
                "path": path})
        self._set_presets(items)
        if items:
            self.rack.set_progress(-1)
            self._sweep_chain(0)

    def _on_preset_pick(self, i, item):
        """Un preset choisi dans la colonne : on recompose sa chaine."""
        if getattr(self, "_usb_busy", False):
            return
        if not (0 <= i < len(self._gen)):
            return
        e = self._gen[i]
        self._show_chain(e.get("modules"), progress=len(MODULES),
                         title=e.get("name"))
        self.status.configure(text=e.get("path") or e.get("name", ""),
                              foreground=C_DIM)
        # Auto-inject si activé et GP-200 connecté
        if self.cfg.get("auto_inject", True) and _USB_INJECT_OK:
            path = e.get("path")
            if path and os.path.isfile(path):
                try:
                    prst_data = open(path, "rb").read()
                    if len(prst_data) == 1224:
                        self.btn_inject.configure(state="disabled")
                        self.status.configure(text=T("inject_connecting"), foreground=C_DIM)
                        self._inject_bar["value"] = 0
                        self._inject_bar.pack(side="left", padx=(12, 0))
                        self._inject_bar_visible = True
                        self.update_idletasks()   # forcer rendu avant thread
                        threading.Thread(target=self._inject_bg,
                                         args=(prst_data,), daemon=True).start()
                except Exception:
                    pass

    def _set_presets(self, items):
        """items : liste de dicts {'name','meta','cat','modules','path'}."""
        self._gen = list(items or [])
        self.presets.set_items(
            [{"name": e.get("name", "?"), "meta": e.get("meta", ""),
              "cat": e.get("cat", "GEN")} for e in self._gen])
        if self._gen:
            self.presets._sel = 0
            self.presets._render()
            self._on_preset_pick(0, None)

    def _on_slot_click(self, i, s):
        if getattr(self, "_usb_busy", False):
            return
        self.insp.set_module(s, pos=(i, len(self.rack._slots)))
        self.status.configure(
            text="%s  -  %s  (%s)" % (s["slot"], s.get("model") or "-",
                                      TX("active") if s.get("on")
                                      else TX("bypass")),
            foreground=C_DIM)
        # Popup live control si un preset est chargé et que le module a un modèle
        if s.get("model") and s.get("params"):
            self._open_slot_popup(i, s)

    def _open_slot_popup(self, module_pos: int, slot_data: dict):
        """Ouvre (ou remplace) la popup live control du slot cliqué."""
        if getattr(self, "_usb_busy", False):
            return
        if not _POPUP_OK:
            return
        # Fermer l'ancienne popup
        old = getattr(self, "_slot_popup", None)
        if old:
            try:
                old._on_destroy()
            except Exception:
                pass
        self._slot_popup = None

        # Vérifier qu'un preset est chargé/généré
        gen = getattr(self, "_gen", [])
        sel = getattr(self.presets, "_sel", -1)
        if not gen or not (0 <= sel < len(gen)):
            return

        # Lire le .prst pour b8 dynamique
        prst_data = None
        rec0      = None
        path = gen[sel].get("path")
        if path and os.path.isfile(path):
            try:
                from gp200lib import REC_MAGIC
                prst_data = open(path, "rb").read()
                rec0 = prst_data.find(REC_MAGIC)
            except Exception:
                pass

        module_idx = MODULES.index(slot_data["slot"]) \
            if slot_data.get("slot") in MODULES else module_pos

        def _cleanup():
            self._slot_popup = None

        popup = SlotControlPopup(
            self, slot_data, module_idx,
            prst_data=prst_data, rec0=rec0,
            on_close_cb=_cleanup,
            tables=self.tb,
            prst_path=path)
        self._slot_popup = popup

    def _toggle_theme(self):
        """Conserve pour compatibilite : le systeme Retro-Future n'a qu'un
        mode sombre. Ne fait plus rien."""
        return

    def _load_prst(self):
        p = filedialog.askopenfilename(
            title=T("x_pick_preset"),
            initialdir=self.cfg.get("_last_outdir") or self.cfg["output_dir"],
            filetypes=[("Preset GP-200", "*.prst"), (T("x_all_files"), "*.*")])
        if not p:
            return
        try:
            d = decode_prst(p, self.tb)
        except Exception as e:
            messagebox.showerror(T("x_read_fail"), str(e))
            return
        self.loaded = p
        warn = "" if d["checksum"]["valid"] else "  [checksum invalide !]"
        self.lbl_loaded.configure(text="%s  -  %r%s"
                                       % (os.path.basename(p), d["name"], warn),
                                  foreground=C_OK if d["checksum"]["valid"]
                                  else C_ERR)
        # apercu du preset charge
        w = self.res
        w._readonly = False
        w.delete("1.0", "end")
        w.insert("end", "%s : %s\n%s\n\n" % (DT("preset_load"), d["name"], p))
        w.insert("end", "  %s : %s\n\n" % (DT("chain_is"),
                                            " > ".join(d["chain_readable"] or [])))
        for sl in MODULES:
            e = d["modules"][sl]
            ps = ", ".join("%s=%d" % (k, int(round(float(v)))) for k, v in (e.get("params") or {}).items())
            w.insert("end", "  %-4s %-3s %-16s %s\n"
                     % (sl, "ON" if e["on"] else "off", e.get("model"), ps))
        w.insert("end", "\n%s\n" % DT("now_desc"))
        w._readonly = True
        # le rack montre la chaine reelle du preset charge
        self._set_presets([{
            "name": d.get("name") or os.path.basename(p),
            "meta": "%s - %s" % (DT("loaded"), os.path.basename(p)),
            "cat": "GEN", "modules": d["modules"], "path": p}])
        self.nb.select(0)

    def _reset_spend(self):
        if messagebox.askyesno(T("x_reset_title"), T("x_reset_msg")):
            reset_spend()
            self._refresh_usage()

    def _refresh_usage(self):
        """API USAGE masque de l'interface — no-op."""
        pass

    def _roles(self):
        if self.var_auto.get():
            return []
        return [r for r in ROLES if self.var_roles[r].get()]

    def _toggle_auto(self):
        state = "disabled" if self.var_auto.get() else "normal"
        for w in self.lbl_count.master.grid_slaves(row=1):
            if isinstance(w, ttk.Checkbutton):
                w.configure(state=state)
        self._count_hint()

    def _count_hint(self):
        if self.var_auto.get():
            self.lbl_count.configure(text=T("structure_hint_auto"),
                                     foreground=C_DIM)
            return
        r = self._roles()
        if not r:
            self.lbl_count.configure(text=T("structure_hint_pick"),
                                     foreground=C_ERR)
        else:
            self.lbl_count.configure(
                text=T("structure_forced", len(r), ", ".join(r), len(r) * 3),
                foreground=C_OK)

    def _ws_hint(self):
        """La recherche web est le poste le plus cher, mais c'est elle qui
        identifie le vrai rig. Sans elle le modele devine, et il se trompe."""
        if not self.var_ws.get():
            self._write(self.log, T("log_ws_off"))
            self.nb.select(1)

    def _status_text(self):
        meta = PROVIDERS[self.cfg["provider"]]
        bits = ["%s · cle OK" % provider_label(self.cfg["provider"])]
        if self.cfg["provider"] == "anthropic":
            spent = load_spend().get("total_usd", 0.0)
            budget = float(self.cfg.get("budget_usd") or 0)
            if budget > 0:
                bits.append("budget $%.2f · depense $%.3f · reste $%.2f"
                            % (budget, spent, max(0.0, budget - spent)))
            else:
                bits.append("depense cumulee $%.3f" % spent)
        bits.append("sortie : %s" % self.cfg["output_dir"])
        return "   |   ".join(bits)

    def _provider(self):
        return self._provs[self.cb_prov.current()]

    def _fill_models(self, values=None):
        prov = self._provider()
        vals = values or PROVIDERS[prov]["models"]
        self.cb_model.configure(values=vals)
        want = (self.cfg.get("model") or "").strip()
        self.cb_model.set(want if want in vals
                          else PROVIDERS[prov]["default_model"])

    def _switch_provider(self, _=None):
        self.cfg["provider"] = self._provider()
        self.cfg["model"] = ""
        self._fill_models()
        self._check_config()

    def _edit_keys(self):
        """Ouvre le dialogue des cles API et persiste (chiffre) le resultat."""
        dlg = ApiKeysDialog(self, self.cfg.get("api_key_anthropic", ""),
                            self.cfg.get("api_key_gemini", ""),
                            self.cfg.get("api_key_perplexity", ""),
                            self.cfg.get("api_key_openai", ""),
                            self.cfg.get("api_key_openrouter", ""))
        self.wait_window(dlg)
        if dlg.result:
            for prov, val in dlg.result.items():
                self.cfg["api_key_" + prov] = val
            save_config(self.cfg)
            self.status.configure(text=T("keys_saved"), foreground=C_OK)
            self._check_config()

    def _switch_model(self, _=None):
        self.cfg["model"] = self.cb_model.get()
        save_config(self.cfg)

    def _switch_pickup(self, _=None):
        self.cfg["pickup"] = self._pickup_keys[self.cb_pickup.current()]
        save_config(self.cfg)

    def _switch_lang(self, _=None):
        """Change la langue de l'interface a la volee et persiste le choix."""
        code = self._langs[self.cb_lang.current()]
        if code == get_lang():
            return
        set_lang(code)
        self.cfg["lang"] = code
        save_config(self.cfg)
        self._retranslate()

    def _retranslate(self):
        """Reconstruit l'interface dans la nouvelle langue en conservant l'etat."""
        # sauvegarder l'etat courant que l'utilisateur aurait saisi
        demande = self.txt.get("1.0", "end-1c") if hasattr(self, "txt") else ""
        for w in list(self.children.values()):
            w.destroy()
        self.title("%s  v%s" % (T("app_title"), APP_VERSION))
        self._build()
        self._check_config()
        if demande.strip():
            self.txt.delete("1.0", "end")
            self.txt.insert("1.0", demande)

    def _refresh_models(self):
        """Demande au fournisseur sa liste reelle de modeles."""
        self.cfg["provider"] = self._provider()
        if not api_key_of(self.cfg):
            messagebox.showinfo(T("x_models_title"), T("x_models_need_key"))
            return
        self.status.configure(text=T("x_models_query"),
                              foreground=C_DIM)

        def work():
            vals = list_models(self.cfg)
            self.after(0, lambda: (self._fill_models(vals),
                                   self.status.configure(
                                       text="%d modeles disponibles" % len(vals),
                                       foreground=C_OK)))
        threading.Thread(target=work, daemon=True).start()

    def _use_example(self, _):
        self.txt.delete("1.0", "end")
        self.txt.insert("1.0", self.cb_ex.get())

    def _write(self, widget, s):
        # Les zones resultat/journal sont en lecture seule via un binding qui
        # bloque les frappes (readonly=True) et NON via state="disabled", qui
        # empecherait la selection a la souris et donc la copie. On insere donc
        # sans changer d'etat.
        ro = getattr(widget, "_readonly", False)
        if ro:
            widget._readonly = False
        widget.insert("end", s + "\n")
        widget.see("end")
        if ro:
            widget._readonly = True

    def _logline(self, s):
        self.after(0, lambda: self._write(self.log, s))

    def _open_out(self):
        """Choisir le dossier de sortie puis l'ouvrir dans l'explorateur."""
        current = self.cfg.get("output_dir", "")
        if not os.path.isdir(current):
            current = os.path.expanduser("~")

        d = filedialog.askdirectory(
            title=T("output_dir_btn"),
            initialdir=current,
        )
        if not d:
            return   # annulé par l'utilisateur

        self.cfg["output_dir"] = d
        save_config(self.cfg)
        os.makedirs(d, exist_ok=True)

        try:
            if sys.platform == "win32":
                os.startfile(d)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", d])
            else:
                subprocess.Popen(["xdg-open", d])
        except Exception as e:
            messagebox.showinfo(T("output_dir_btn"), "%s\n\n(%s)" % (d, e))

    def _check_config(self):
        self.cfg["provider"] = self._provider()
        prov = self.cfg["provider"]
        meta = PROVIDERS[prov]
        if self.cfg.get("_error"):
            self._write(self.log, T("log_config_unreadable", self.cfg["_error"]))
        if not api_key_of(self.cfg):
            self.status.configure(text=T("msg_no_key"), foreground=C_ERR)
            # Vider d'abord : sans ca, chaque changement de fournisseur EMPILE
            # son message de cle manquante dans le resultat.
            self.res._readonly = False
            self.res.delete("1.0", "end")
            self.res.insert("end",
                            "%s : %s\n\n1. %s\n   %s\n2. %s\n"
                            % (T("msg_no_key_title"),
                               provider_label(self.cfg["provider"]),
                               T("keys_intro").split(".")[0], meta["keys_url"],
                               T("msg_no_key")))
            self.res._readonly = True
        else:
            self.status.configure(text=self._status_text(), foreground=C_OK)

    # ----------------------------------------------------------- traitement
    def _open_setlist(self):
        """Ouvre le dialogue d'harmonisation de setlist."""
        SetlistDialog(self, self.tb, self.cfg)

    # ── Menus déroulants header ───────────────────────────────────────────────

    def _show_config_menu(self):
        """Menu ⚙ Config : Clés API + Dossier de sortie."""
        m = tk.Menu(self, tearoff=0)
        m.add_command(label=T("api_keys_btn"),   command=self._edit_keys)
        m.add_command(label=T("output_dir_btn"), command=self._open_out)
        btn = self._btn_cfg
        m.post(btn.winfo_rootx(),
               btn.winfo_rooty() + btn.winfo_height())

    def _show_features_menu(self):
        """Menu ★ Fonctionnalités : Calibration Batch + Optimiser concert (Batch)"""
        m = tk.Menu(self, tearoff=0)
        # m.add_command(label=T("menu_calib_single"), command=self._open_calibration)
        m.add_command(label=T("menu_calib_batch"),  command=self._open_batch)
        
        # --- Ligne à rajouter ---
        m.add_command(label="🎸 Optimisation Concert (Batch)", command=self._open_batch_live)
        
        #m.add_separator()
        #m.add_command(label="🎸 " + T("live_ready_button"), command=self._go_live)
        btn = self._btn_feat
        m.post(btn.winfo_rootx(),
               btn.winfo_rooty() + btn.winfo_height())

    # ── Slot d'injection ──────────────────────────────────────────────────────

    def _update_slot_btn(self):
        """Met à jour le label du bouton 📍 slot."""
        n = self.cfg.get("inject_slot",  1)
        l = self.cfg.get("inject_letter", "A")
        self._v_inject_slot_lbl.set(f"📍 {n:02d}-{l}")

    def _ask_inject_slot(self, first_launch=False):
        """Dialogue de sélection du slot d'injection."""
        dlg = tk.Toplevel(self)
        dlg.title(T("inject_slot_title"))
        dlg.resizable(False, False)
        dlg.transient(self)
        dlg.grab_set()
        # Centrage
        dlg.update_idletasks()
        sw, sh = dlg.winfo_screenwidth(), dlg.winfo_screenheight()
        dlg.geometry(f"+{(sw-350)//2}+{(sh-240)//2}")

        P = 12
        ttk.Label(dlg, text=T("inject_slot_msg"),
                  wraplength=320, justify="left").pack(padx=P, pady=(P, 8))

        frm = ttk.Frame(dlg, padding=(P, 0))
        frm.pack(fill="x")

        ttk.Label(frm, text=T("inject_slot_num")).grid(row=0, column=0, sticky="w", pady=4)
        v_num = tk.IntVar(value=self.cfg.get("inject_slot", 1))
        ttk.Spinbox(frm, from_=1, to=64, width=6, textvariable=v_num).grid(
            row=0, column=1, sticky="w", padx=(6, 0))
        ttk.Label(frm, text="(1-64 : Bank Select auto > 32)",
                  font=("Arial", 8), foreground="gray50").grid(
            row=0, column=2, sticky="w", padx=(6, 0))

        ttk.Label(frm, text=T("inject_slot_letter")).grid(row=1, column=0, sticky="w", pady=4)
        v_let = tk.StringVar(value=self.cfg.get("inject_letter", "A"))
        ttk.Combobox(frm, values=["A","B","C","D"], textvariable=v_let,
                     state="readonly", width=5).grid(row=1, column=1, sticky="w", padx=(6, 0))

        # Toggle auto-inject
        v_auto = tk.BooleanVar(value=self.cfg.get("auto_inject", True))
        ttk.Checkbutton(frm, text=T("inject_auto_label"),
                        variable=v_auto).grid(row=2, column=0, columnspan=3,
                                              sticky="w", pady=(8, 0))

        def _ok():
            self.cfg["inject_slot"]   = max(1, min(64, int(v_num.get())))
            self.cfg["inject_letter"] = v_let.get().upper()
            self.cfg["auto_inject"]   = v_auto.get()
            save_config(self.cfg)
            self._update_slot_btn()
            slot_str = f"{self.cfg['inject_slot']:02d}-{self.cfg['inject_letter']}"
            self.status.configure(text=T("inject_slot_saved", slot_str), foreground=C_OK)
            dlg.destroy()

        ttk.Button(dlg, text="OK", command=_ok).pack(pady=P)
        dlg.wait_window()

    def _set_ui_busy(self, busy: bool):
        """Active ou désactive les éléments interactifs de l'UI pendant une action USB."""
        state = "disabled" if busy else "normal"
        
        # Boutons principaux du footer
        for btn in (getattr(self, "btn", None), 
                    getattr(self, "btn_live", None), 
                    getattr(self, "btn_setlist", None), 
                    getattr(self, "btn_inject", None)):
            if btn:
                try:
                    btn.configure(state=state)
                except Exception:
                    pass
                    
        # Listes et champs de saisie principaux
        for widget in (getattr(self, "presets", None), 
                       getattr(self, "txt", None), 
                       getattr(self, "cb_prov", None), 
                       getattr(self, "cb_model", None)):
            if widget:
                try:
                    widget.configure(state=state)
                except Exception:
                    pass

    def _check_first_launch_slot(self):
        """Au premier lancement, demander le slot si non configuré."""
        if "inject_slot" not in self.cfg:
            self.after(800, lambda: self._ask_inject_slot(first_launch=True))
        self._update_slot_btn()

    def _start_audio_wake(self, retries=3):
        """Démarre (ou redémarre) le keep-alive audio USB. Réessaie si besoin."""
        # Si l'USB est verrouillé par un envoi, on refuse de démarrer
        if getattr(self, "_usb_busy", False):
            return
            
        if not AudioWakeKeepAlive:
            return
            
        try:
            if self._audio_wake:
                self._audio_wake.stop()
                self._audio_wake = None
            wake = AudioWakeKeepAlive(verbose=False)
            if wake.start():
                self._audio_wake = wake
                self.after(500, self._refresh_usb_led)
            elif retries > 0:
                # Port pas encore dispo (ré-énumération USB) → réessayer dans 1s
                self.after(1000, lambda r=retries-1: self._start_audio_wake(r))
        except Exception:
            if retries > 0:
                self.after(1000, lambda r=retries-1: self._start_audio_wake(r))

    def _open_calibration(self):
        """Ouvre la fenetre de calibration volume LUFS."""
        if not _CALIB_OK:
            messagebox.showerror(
                T("x_mod_missing_title"),
                T("x_mod_missing_msg", "gp200_calibration.py"))
            return
        CalibrationWindow(self, self.cfg)

    def _open_batch(self):
        """Ouvre la fenetre d'harmonisation volume batch."""
        if not _BATCH_OK:
            messagebox.showerror(
                T("x_mod_missing_title"),
                T("x_mod_missing_msg", "gp200_batch.py"))
            return
        BatchWindow(self, self.cfg)
    
    def _open_batch_live(self):
        """Ouvre la fenetre de traitement par lot Live Ready."""
        if not _BATCH_LIVE_OK:
            messagebox.showerror(
                T("x_mod_missing_title"),
                T("x_mod_missing_msg", "gp200_batch_live.py"))
            return
        LiveBatchWindow(self, self.tb, self.cfg)

    def _open_live(self):
        """Ouvre le panel de controle live des parametres."""
        if not _LIVE_OK:
            messagebox.showerror(
                T("x_mod_missing_title"),
                T("x_mod_missing_msg", "gp200_live.py"))
            return
        # Récupérer le preset sélectionné directement via _gen + _sel
        gen  = getattr(self, "_gen", [])
        sel  = getattr(self.presets, "_sel", -1)
        if not gen or not (0 <= sel < len(gen)):
            messagebox.showwarning(T("x_live_title"),
                T("x_live_need_preset"))
            return
        prst_path = gen[sel].get("path")
        if not prst_path or not os.path.isfile(prst_path):
            messagebox.showwarning(T("x_live_title"),
                T("x_live_no_file"))
            return
        LiveControlWindow(self, prst_path, self.tb)

    def _edit_ctrl(self):
        """Ouvre la grille CTRL pour le preset selectionne."""
        if getattr(self, "_usb_busy", False):
            return
        sel = getattr(self.presets, "_sel", -1)
        if not (0 <= sel < len(self._gen)):
            messagebox.showwarning(DT("ctrl_btn"), T("inject_no_preset"), parent=self)
            return
        e = self._gen[sel]
        path = e.get("path")
        if not path or not os.path.isfile(path):
            messagebox.showerror(DT("ctrl_btn"), T("inject_file_missing"), parent=self)
            return

        def saved(summary, inject):
            self.status.configure(text=DT("ctrl_saved", summary), foreground=C_OK)
            if inject:
                self._inject_preset()
        try:
            CtrlDialog(self, path, e.get("name") or os.path.basename(path),
                       on_saved=saved)
        except Exception as ex:
            messagebox.showerror(DT("ctrl_btn"), str(ex), parent=self)

    def _inject_preset(self):
        """Injecte le preset sélectionné sur le slot 01-A du GP-200."""
        sel = getattr(self.presets, "_sel", -1)
        if not (0 <= sel < len(self._gen)):
            messagebox.showwarning(T("inject_button"), T("inject_no_preset"), parent=self)
            return
        path = self._gen[sel].get("path")
        if not path or not os.path.isfile(path):
            messagebox.showerror(T("inject_button"), T("inject_file_missing"), parent=self)
            return
        if not _USB_INJECT_OK:
            messagebox.showerror(T("inject_button"), "gp200_usb.py introuvable.", parent=self)
            return
        prst_data = open(path, "rb").read()
        if len(prst_data) != 1224:
            messagebox.showerror(T("inject_button"),
                                  f"Taille invalide : {len(prst_data)} bytes.", parent=self)
            return
        self.btn_inject.configure(state="disabled")
        self.status.configure(text=T("inject_connecting"), foreground=C_DIM)
        self._inject_bar["value"] = 0
        self._inject_bar.pack(side="left", padx=(12, 0))
        self._inject_bar_visible = True
        threading.Thread(target=self._inject_bg, args=(prst_data,), daemon=True).start()

    def _inject_bg(self, prst_data: bytes):
        # --- AJOUT : On pose le verrou et on désactive l'UI ---
        self._usb_busy = True
        self.after(0, lambda: self._set_ui_busy(True))
        
        slot_n = self.cfg.get("inject_slot",  1)
        slot_l = self.cfg.get("inject_letter", "A")
        def progress(step, total, label):
            self.after(0, lambda s=step, t=total: self._on_inject_progress(s, t))
        # Stopper AudioWakeKeepAlive pendant l'injection :
        # les deux utilisent WinMM et un keepalive toutes les 100 ms
        # peut s'intercaler entre les chunks SysEx -> preset corrompu.
        wake = getattr(self, "_audio_wake", None)
        if wake and getattr(wake, "_running", False):
            wake.stop()
            self._audio_wake = None
            import time; time.sleep(0.35)  # laisser toute keepalive en vol se terminer
        try:
            dev = GP200USB(verbose=False)
            if not dev.connect():
                self.after(0, lambda: self._on_inject_error(T("inject_connect_fail")))
                return
            dev.write_preset(slot_n, slot_l, prst_data, progress_cb=progress)
            import time; time.sleep(0.35)
            dev.select_preset(slot_n, slot_l)
            dev.disconnect()
            slot_str = f"{slot_n:02d}-{slot_l}"
            self.after(0, lambda s=slot_str: self._on_inject_done_slot(s))
        except Exception as ex:
            self.after(0, lambda e=str(ex): self._on_inject_error(e))
        finally:
            # --- AJOUT : On retire le verrou et on réactive l'UI ---
            self._usb_busy = False
            self.after(0, lambda: self._set_ui_busy(False))
            # Reprendre AudioWakeKeepAlive apres l'injection
            self.after(500, self._start_audio_wake)

    def _on_inject_done_slot(self, slot_str: str):
        self._device_pc = None      # patch courant inconnu : on suppose le preset injecte
        self._device_note()
        self._inject_bar["value"] = self._inject_bar["maximum"]
        self.after(400, self._inject_cleanup)
        self.status.configure(text=T("inject_slot_saved", slot_str), foreground=C_OK)

    def _on_inject_progress(self, step: int, total: int):
        """Met à jour la barre de progression chunk par chunk."""
        if step == 0:
            self._inject_bar["maximum"] = total + 1
            self._inject_bar["value"]   = 0
            self.status.configure(text=T("inject_handshake"), foreground=C_DIM)
        elif step <= total:
            self._inject_bar["value"] = step
            self.status.configure(text=T("inject_chunk", step, total), foreground=C_DIM)
        self.update_idletasks()   # forcer repaint à chaque chunk

    def _on_inject_error(self, msg: str):
        self._inject_cleanup()
        self.status.configure(text=f"❌ {msg}", foreground=C_ERR)

    def _inject_cleanup(self):
        if self._inject_bar_visible:
            self._inject_bar.pack_forget()
            self._inject_bar_visible = False
        self.btn_inject.configure(state="normal")

    def _listener_tick(self):
        """Vide la file des notifications pedalier (thread Tk) ; rouvre
        l'ecoute si elle est tombee (debranchement, fin d'injection...)."""
        import time as _t
        lst = getattr(self, "_listener", None)
        if lst is None:
            return
        try:
            while True:
                evt = self._fs_q.get_nowait()
                if evt[0] == "bypass":
                    self._on_pedal_bypass(evt[1], evt[2], evt[3])
                elif evt[0] == "patch":
                    self._on_pedal_patch(evt[1])
        except queue.Empty:
            pass
        if not lst.active and _t.time() >= self._listener_next_open:
            self._listener_next_open = _t.time() + 2.0
            lst._open()
        self.after(40, self._listener_tick)

    def _inject_pc(self):
        """PC du slot d'injection configure (celui qui porte le preset affiche)."""
        from gp200_usb import slot_to_pc
        return slot_to_pc(int(self.cfg.get("inject_slot", 1)),
                          self.cfg.get("inject_letter", "A"))

    def _device_matches_view(self):
        """Le GP-200 est-il sur le patch dont le rack montre le contenu ?
        Inconnu (None, ex. juste apres une injection) -> on suppose que oui."""
        pc = getattr(self, "_device_pc", None)
        return pc is None or pc == self._inject_pc()

    def _device_note(self):
        """Suffixe 'GP-200 sur xx-X' sur la ligne de la chaine."""
        from gp200_usb import pc_to_slot_name
        pc = getattr(self, "_device_pc", None)
        try:
            base = self.lbl_chain.cget("text").split("   -   GP-200 ")[0]
            if pc is None:
                self.lbl_chain.configure(text=base)
            else:
                self.lbl_chain.configure(text=T("x_chain_dev", base, pc_to_slot_name(pc),
                    "" if self._device_matches_view() else T("x_other_patch")))
        except Exception:
            pass

    def _on_pedal_patch(self, pc):
        """Le GP-200 a change de patch au pied. Le contenu n'est pas relu
        (non fourni par le GP-200) : on ne montre que ce qu'on sait."""
        from gp200_usb import pc_to_slot_name
        self._device_pc = pc
        name = pc_to_slot_name(pc)
        if self._device_matches_view():
            # patch recharge depuis la memoire du GP-200 : les bascules faites
            # au pied sont annulees -> on re-affiche l'etat enregistre
            sel = getattr(self.presets, "_sel", -1)
            if 0 <= sel < len(self._gen):
                e = self._gen[sel]
                self._show_chain(e.get("modules"), progress=len(MODULES),
                                 title=e.get("name"))
            self.status.configure(text="\U0001f9b6 GP-200 : patch %s" % name,
                                  foreground=C_OK)
        else:
            self.status.configure(
                text=T("x_dev_patch_differs", name), foreground=C_WARN)
        self._device_note()

    def _on_pedal_bypass(self, m, on, source="fs"):
        """Le GP-200 signale un module bascule (footswitch / CTRL / facade)."""
        from gp200_usb import pc_to_slot_name
        if not (0 <= m < len(MODULES)):
            return
        slot = MODULES[m]
        etat = TX("active") if on else TX("bypass")
        if not self._device_matches_view():
            # le rack montre un autre patch : ne rien y modifier
            self.status.configure(
                text="\U0001f9b6 %s  %s  (patch %s, non affiche)"
                     % (slot, etat, pc_to_slot_name(self._device_pc)),
                foreground=C_DIM)
            return
        rack = getattr(self, "rack", None)
        if rack is not None:
            for k, sd in enumerate(rack._slots):
                if sd.get("slot") == slot:
                    sd["on"] = bool(on) and bool(sd.get("model"))
                    rack._render()
                    insp = getattr(self, "insp", None)
                    if insp is not None and (insp._mod or {}).get("slot") == slot:
                        insp.set_module(sd, pos=(k, len(rack._slots)))
                    break
        # etat deliberement NON memorise dans _gen : un rechargement du patch
        # par le GP-200 le remettrait a l'etat enregistre (cf. _on_pedal_patch)
        self.status.configure(text="\U0001f9b6 %s  %s" % (slot, etat),
                              foreground=C_OK if on else C_DIM)

    def _refresh_usb_led(self):
        """Vérifie MIDI + Audio GP-200 toutes les 3s."""
        # --- AJOUT : Si une injection est en cours, on skip pour ne pas géner ---
        if getattr(self, "_usb_busy", False):
            self.after(3000, self._refresh_usb_led)
            return

        import time as _time
        try:
            from gp200_usb import GP200USB
            midi_ok, audio_ok = GP200USB.probe_full()

            if midi_ok and audio_ok:
                self._lbl_usb_led.configure(text="● GP-200", foreground="#4CAF50")
            elif midi_ok:
                self._lbl_usb_led.configure(text="● GP-200", foreground="#FF9800")
                last = getattr(self, "_last_wake_attempt", 0)
                if _time.time() - last > 10.0:
                    self._last_wake_attempt = _time.time()
                    self.after(300, self._start_audio_wake)
            else:
                self._lbl_usb_led.configure(text="● GP-200", foreground="#757575")
                lst = getattr(self, "_listener", None)
                if lst is not None and lst.active:
                    lst._close()      # debranche : handle mort, rouvrir au retour

        except Exception:
            self._lbl_usb_led.configure(text="● GP-200", foreground="#757575")
        
        self.after(3000, self._refresh_usb_led)

    def _go_live(self):
        """Bouton 'Optimiser pour concert' : adapte le preset charge pour le
        live a fort volume. Pas besoin de description — le prompt est pre-cable."""
        if not self.loaded:
            messagebox.showwarning("Preset", T("live_no_preset"))
            return
        self.cfg["provider"] = self._provider()
        if not api_key_of(self.cfg):
            messagebox.showerror(T("msg_no_key_title"), T("msg_no_key"))
            return
        self.cfg["model"] = self.cb_model.get().strip()

        self.btn.configure(state="disabled")
        self.btn_live.configure(state="disabled")
        self.btn.set_busy(True)
        self.rack.set_progress(-1)
        self.rack.start_flow()
        self.led.set(False)
        self.pb.start(12)
        for w in (self.res, self.log):
            w._readonly = False
            w.delete("1.0", "end")
            w._readonly = True
        self.nb.select(1)
        self._write(self.log, T("log_demande", T("live_ready_button")))
        self._write(self.log, T("log_provider_line",
                    self.cfg["provider"], model_of(self.cfg),
                    self.cfg["web_search"]))
        self._write(self.log, T("log_mode", "live"))
        self._write(self.log, T("log_calling"))
        self.update_idletasks()
        threading.Thread(target=self._work,
                         args=("", [], "live"),
                         daemon=True).start()

    def _go(self):
        demande = self.txt.get("1.0", "end").strip()
        if not demande:
            messagebox.showwarning(DT("empty"), DT("desc_sound"))
            return
        if self.var_mode.get() == "refine" and not self.loaded:
            messagebox.showwarning("Preset", DT("load_first"))
            return
        if self.var_mode.get() == "new" and not self.var_auto.get() \
                and not self._roles():
            messagebox.showwarning(T("x_struct_title"), T("x_struct_need_role"))
            return
        self.cfg["provider"] = self._provider()
        if not api_key_of(self.cfg):
            messagebox.showerror(
                T("msg_no_key_title"), T("msg_no_key"))
            return
        self.cfg["model"] = self.cb_model.get().strip()
        self.cfg["web_search"] = self.var_ws.get()

        self.btn.configure(state="disabled")
        self.btn.set_busy(True)
        self.rack.set_progress(-1)
        self.rack.start_flow()
        self.led.set(False)
        self.pb.start(12)
        for w in (self.res, self.log):
            w._readonly = False
            w.delete("1.0", "end")
            w._readonly = True
        self.nb.select(1)
        # Logs initiaux emis ICI, sur le fil principal (avant le thread), pour
        # qu'ils s'affichent a coup sur meme si l'appel reseau se comporte mal.
        self._write(self.log, T("log_demande", demande))
        self._write(self.log, T("log_provider_line",
                    self.cfg["provider"], model_of(self.cfg),
                    self.cfg["web_search"]))
        self._write(self.log, T("log_mode", self.var_mode.get()))
        self._write(self.log, T("log_calling"))
        self.update_idletasks()
        threading.Thread(target=self._work,
                         args=(demande, self._roles(), self.var_mode.get()),
                         daemon=True).start()

    def _work(self, demande, roles, mode):
        try:
            if mode == "live":
                payload, path, diff = refine_live(self.cfg, self.tb, self.loaded,
                                                  self._logline)
                self.after(0, self._show_refine, payload, path, diff)
            elif mode == "refine":
                payload, path, diff = refine(self.cfg, self.tb, self.loaded,
                                             demande, self._logline)
                self.after(0, self._show_refine, payload, path, diff)
            else:
                self._logline(T("log_structure",
                              T("log_struct_auto") if not roles
                              else T("log_struct_forced", ", ".join(roles))))
                payload, written = generate(self.cfg, self.tb, demande,
                                            self._logline, roles=roles)
                self._logline(T("log_response_recv"))
                # after avec arguments positionnels (pas de closure sur des
                # variables de boucle) : plus fiable que after(0, lambda).
                self.after(0, self._show, payload, written)
        except Exception as e:
            tb = traceback.format_exc()
            self._logline(T("log_error", e))
            self._logline(tb)
            # afficher aussi l'erreur dans le RESULTAT, pas seulement le journal
            self.after(0, self._show_error, str(e), tb)
        finally:
            self.after(0, self._after_work)

    def _after_work(self):
        self.pb.stop()
        self.rack.stop_flow()
        self.btn.set_busy(False)
        self.btn.configure(state="normal")
        self.btn_live.configure(state="normal")
        self.led.set(True)
        self._refresh_usage()

    def _show_error(self, msg, tb):
        w = self.res
        w._readonly = False
        w.delete("1.0", "end")
        w.insert("end", "%s\n\n%s\n\n%s" % (DT("gen_failed"), msg, tb))
        w._readonly = True
        self.nb.select(0)

    def _show_refine(self, payload, path, diff):
        self.nb.select(0)
        w = self.res
        try:
            w._readonly = False
            w.delete("1.0", "end")
            if payload.get("analyse"):
                w.insert("end", "%s\n%s\n\n" % (DT("analysis"), payload["analyse"]))
            w.insert("end", "%s\n" % DT("real_chg"))
            if diff:
                for d in diff:
                    w.insert("end", "  * %s\n" % d)
            else:
                w.insert("end", "%s\n" % DT("no_change"))
            if payload.get("changements"):
                w.insert("end", T("x_model_did"))
                for c in payload["changements"]:
                    w.insert("end", "  - %s\n" % c)
            if payload.get("avertissements"):
                w.insert("end", "\nAVERTISSEMENTS\n%s\n" % payload["avertissements"])

            spec = payload["spec"]
            w.insert("end", "\nPRESET RESULTANT : %s\n" % spec.get("name"))
            for sl in MODULES:
                ms = (spec.get("modules") or {}).get(sl)
                if not ms or not ms.get("model"):
                    continue
                ps = ", ".join("%s=%d" % (k, int(round(float(v)))) for k, v in (ms.get("params") or {}).items())
                w.insert("end", "  %-4s %-3s %-16s %s\n"
                         % (sl, "ON" if ms.get("on", True) else "off",
                            ms["model"], ps))
            w.insert("end", "\n%s : %s\n" % (DT("file"), path))
            self._set_presets([{
                "name": spec.get("name") or os.path.basename(path),
                "meta": os.path.basename(path), "cat": "GEN",
                "modules": spec.get("modules"), "path": path}])
            self.rack.set_progress(-1)
            self._sweep_chain(0)
        except Exception as e:
            import traceback
            w.insert("end", "\n" + T("x_display_err", e) + "\n%s\n"
                     % traceback.format_exc())
        finally:
            w._readonly = True
        self.status.configure(text="%s   |   %s"
                                   % (DT("refined", len(diff)),
                                      self._status_text()),
                              foreground=C_OK)

    def _show(self, payload, written):
        # _show est appele via after(), donc HORS du try/except de _go : une
        # exception ici disparaitrait sans trace et laisserait un ecran vide.
        # On l'enveloppe pour toujours donner un retour a l'utilisateur.
        try:
            self._show_inner(payload, written)
        except Exception as e:
            import traceback
            w = self.res
            w._readonly = False
            w.delete("1.0", "end")
            w.insert("end", T("x_display_err", e) + "\n\n")
            w.insert("end", traceback.format_exc() + "\n\n")
            w.insert("end", T("x_raw_reply"))
            try:
                import json as _j
                w.insert("end", _j.dumps(payload, indent=1, ensure_ascii=False))
            except Exception:
                w.insert("end", repr(payload))
            w._readonly = True
            self.nb.select(0)

    def _show_inner(self, payload, written):
        self.nb.select(0)
        w = self.res
        w._readonly = False
        w.delete("1.0", "end")
        # Diagnostic : si le modele n'a rempli aucun texte, on le dit et on montre
        # le JSON brut plutot que d'afficher une page vide.
        has_text = any(payload.get(k) for k in ("recherche", "structure"))
        has_sections = bool(payload.get("sections"))
        if not has_text and not has_sections:
            w.insert("end", "%s\n\n" % DT("no_text"))
            import json as _j
            w.insert("end", _j.dumps(payload, indent=1, ensure_ascii=False))
            w._readonly = True
            return
        if payload.get("recherche"):
            w.insert("end", "%s\n%s\n\n" % (T("res_rig"), payload["recherche"]))
        if payload.get("structure"):
            w.insert("end", "%s\n%s\n\n" % (T("res_structure"), payload["structure"]))

        secs = payload.get("sections", [])
        for si, sec in enumerate(secs, 1):
            w.insert("end", "#" * 72 + "\n")
            w.insert("end", "%s %d/%d : %s   [%s]\n"
                     % (T("res_section"), si, len(secs), sec.get("nom", "?"),
                        sec.get("role", "?")))
            if sec.get("raison"):
                w.insert("end", "  %s\n" % sec["raison"])
            w.insert("end", "\n")
            for path, s2, v in written:
                if s2 is not sec:
                    continue
                spec = v["spec"]
                w.insert("end", "  " + "-" * 68 + "\n")
                w.insert("end", "  %s - %s\n" % (v.get("label", "?"),
                                                 spec.get("name")))
                w.insert("end", "    %s : %s\n" % (T("res_axe"), v.get("axe", "")))
                w.insert("end", "    %s : %s\n" % (T("res_ecoute"), v.get("ecoute", "")))
                w.insert("end", "    %s: %s\n\n" % (T("res_file"), os.path.basename(path)))
                for sl in MODULES:
                    ms = (spec.get("modules") or {}).get(sl)
                    if not ms or not ms.get("model"):
                        continue
                    ps = ", ".join("%s=%d" % (k, int(round(float(val)))) for k, val in (ms.get("params") or {}).items())
                    w.insert("end", "      %-4s %-3s %-16s %s\n"
                             % (sl, "ON" if ms.get("on", True) else "off",
                                ms["model"], ps))
                w.insert("end", "\n")

        if payload.get("notes"):
            w.insert("end", "#" * 72 + "\nNOTES\n%s\n" % payload["notes"])
        w.insert("end", T("x_n_presets_in", len(written),
                          self.cfg.get("_last_outdir", self.cfg["output_dir"])))
        gen_cost = payload.get("_gen_cost")
        if self.cfg.get("provider") == "anthropic" and gen_cost is not None:
            w.insert("end", "\n" + T("gen_cost", gen_cost) + "\n")
        w._readonly = True
        try:
            self._collect_presets(written, secs)
        except Exception:
            pass
        self.status.configure(
            text=T("status_generated", len(written), len(secs),
                   self._status_text()),
            foreground=C_OK)


if __name__ == "__main__":
    if TK_ERROR is not None:
        sys.stderr.write(
            "Tkinter introuvable (%s).\n"
            "  Windows : reinstaller Python depuis python.org en cochant\n"
            "            'tcl/tk and IDLE'.\n"
            "  Linux   : sudo apt install python3-tk\n" % TK_ERROR)
        raise SystemExit(1)
    app = App()

    # Arrêter le wake audio à la fermeture
    original_destroy = app.destroy
    def _on_close():
        if getattr(app, "_listener", None):
            app._listener.stop()
        if getattr(app, "_audio_wake", None):
            app._audio_wake.stop()
        original_destroy()
    app.protocol("WM_DELETE_WINDOW", _on_close)

    app.mainloop()