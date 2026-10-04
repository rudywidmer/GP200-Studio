# -*- coding: utf-8 -*-

"""

GP-200 Studio -- Harmonisation volume batch (Cascade Ampli -> Patch Volume).



Workflow :

  1. Charger les .prst dans l'ordre ou ils sont importes sur le GP-200

  2. Configurer Audio IN + MIDI OUT + slot de depart

  3. Cliquer LANCER

  4. Pour chaque preset :

       - L'app envoie le Program Change -> GP-200 change de preset

       - Tu joues ton accord en boucle

       - L'app mesure le LUFS en temps reel

       - Auto-tweak : ajuste l'Ampli (25-95) puis le Patch Vol si besoin

       - Reset du LUFS automatique pour mesurer la nouvelle valeur

       - Quand le volume est OK -> cliquer APPLIQUER (sauvegarde le .prst)

       - Cliquer SUIVANT -> preset suivant

  5. A la fin, tous les .prst sont corriges et prets a re-importer

"""



import os

import struct

import time

import threading

import tkinter as tk

from tkinter import ttk, messagebox, filedialog



try:

    from gp200_i18n import T

except ImportError:

    def T(key, *a, **kw): return key



try:

    from gp200_agent import save_config

except ImportError:

    def save_config(cfg): pass



# ── imports optionnels ────────────────────────────────────────────────────────



try:

    from gp200_lufs import LUFSEngine, list_input_devices, DEPS_OK, DEPS_MSG

except ImportError:

    DEPS_OK = False

    DEPS_MSG = "gp200_lufs.py introuvable."

    LUFSEngine = None

    def list_input_devices(): return []



try:

    from gp200_midi import MidiOut, list_output_devices, slot_to_pc, pc_to_slot

    _MIDI_OK = True

except ImportError:

    _MIDI_OK = False

    def list_output_devices(): return []

    def slot_to_pc(n, l): return (n - 1) * 4 + "ABCD".index(l.upper())

    def pc_to_slot(pc): return pc // 4 + 1, "ABCD"[pc % 4]



try:

    from gp200_usb import GP200USB

    _USB_OK = True

except ImportError:

    _USB_OK = False

    GP200USB = None



# ── constantes ────────────────────────────────────────────────────────────────



OFF_PATCH_VOL = 0x38

PRST_SIZE     = 1224

CS_OFFSET     = 1222

CS_DATA_LEN   = 1222

REC_MAGIC     = b'\x14\x00\x44\x00'



TARGETS = {

    "NORMAL": -16.0,

    "LEAD":   -11.0,

}

TOLERANCE_DB  = 0.4

LUFS_PER_UNIT = 0.25   # Valeur stable et cohérente pour le calcul de correction
AMP_VOL_MIN  = 25    # plancher volume ampli
AMP_VOL_MAX  = 100    # plafond volume ampli (était 90)

PATCH_VOL_MIN = 35   # plancher patch vol (symétrique avec ampli min=25)
PATCH_VOL_MAX = 100  # plafond patch vol (100 = max GP-200)
AMP_GAIN_MIN  = 20    # plancher gain ampli (fallback si pas de volume)
AMP_GAIN_MAX  = 90    # plafond gain ampli
AMP_GAIN_BOOST_MAX = 10  # points max au-delà du gain initial (last resort, évite coloration)
CAB_VOL_MIN   = 20    # plancher volume CAB (fallback tertiaire)
CAB_VOL_MAX   = 100    # plafond volume CAB



STATUS_WAIT = "⏳"

STATUS_RUN  = "🔄"

STATUS_DONE = "✅"





# ── helpers preset ────────────────────────────────────────────────────────────



def _checksum(data: bytearray) -> int:

    return sum(data[:CS_DATA_LEN]) & 0xFFFF



def _save_preset(path: str, data: bytearray):

    """Sauvegarde le binaire courant. L'auto-tweak met déjà data à jour en direct."""

    struct.pack_into(">H", data, CS_OFFSET, _checksum(data))

    with open(path, "wb") as f:

        f.write(data)





# ── modele de donnees ─────────────────────────────────────────────────────────



class PresetEntry:

    def __init__(self, path: str):

        raw           = open(path, "rb").read()

        self.path     = path

        self.name     = os.path.splitext(os.path.basename(path))[0]

        self.data     = bytearray(raw)

        

        # Patch Volume Global
        self.patch_vol_initial = raw[OFF_PATCH_VOL]  # 📌 Valeur figée de départ
        self.patch_vol_orig = raw[OFF_PATCH_VOL]
        self.patch_vol_new  = self.patch_vol_orig
        
        # Volume Ampli (détecté via _analyze_amp)
        self.amp_idx = None
        self.amp_param_idx = None
        self.amp_vol_initial = None                  # 📌 Valeur figée de départ
        self.amp_vol_orig = None
        self.amp_vol_new = None

        self.amp_name = ""
        
        # Gain AMP (utilisé si pas de volume)
        self.amp_gain_param_idx = None
        self.amp_gain_initial   = None
        self.amp_gain_orig      = None
        self.amp_gain_new       = None

        # Volume CAB (fallback tertiaire)
        self.cab_idx            = None
        self.cab_vol_param_idx  = None
        self.cab_vol_initial    = None
        self.cab_vol_orig       = None
        self.cab_vol_new        = None

        

        self.ptype    = "NORMAL"          # "NORMAL" ou "LEAD"

        self.lufs_ok  = None              # LUFS mesure apres apply

        self.status   = STATUS_WAIT

        

        # Suivi de l'auto-tweak

        self.last_tweak = 0

        self.tweak_count = 0





# ── fenetre principale ────────────────────────────────────────────────────────



class BatchWindow(tk.Toplevel):



    POLL_MS = 150



    def __init__(self, parent, cfg=None):

        super().__init__(parent)

        self.title(f"GP-200 Studio  —  {T('batch_title')}")

        self.resizable(True, True)

        self.minsize(820, 620)

        self.columnconfigure(0, weight=1)

        self.transient(parent)   # reste devant la fenetre principale

        self.lift()              # passe au premier plan au lancement



        self._cfg      = cfg or {}

        self._presets  = []

        self._cur_idx  = -1

        self._engine   = None

        self._midi     = None

        self._usb_dev  = None    # GP200USB — None si non connecté

        self._usb_mode = False   # True = push USB actif

        self._running  = False

        self._paused   = False

        self._usb_busy = False   # Verrou anti-collision USB robuste
        self._last     = (None, None, None)   # (momentary, short, integrated)
        self._smoothed_delta = None  # 📉 Stocke la valeur lissée du delta pour calmer la nervosité



        # Variables Tkinter

        self._v_slot_n  = tk.IntVar(value=1)

        self._v_slot_l  = tk.StringVar(value="A")

        self._v_pc_info = tk.StringVar(value="→ PC 0")

        self._v_mom     = tk.StringVar(value="   ---")

        self._v_st      = tk.StringVar(value="   ---")

        self._v_itg     = tk.StringVar(value="   ---")

        self._v_delta   = tk.StringVar(value="   ---")

        self._v_hint    = tk.StringVar(value="")

        self._v_current = tk.StringVar(value=T("batch_no_preset"))

        self._v_status  = tk.StringVar(value=T("batch_status_ready"))



        self._build_ui()

        self._refresh_audio_devs()

        self.update_idletasks()

        sw = self.winfo_screenwidth(); sh = self.winfo_screenheight()

        w = self.winfo_reqwidth() or 860; h = self.winfo_reqheight() or 660

        self.geometry(f"+{(sw-w)//2}+{(sh-h)//2}")

        self._refresh_midi_devs()

        self._update_pc_info()

        self._poll()

        self.protocol("WM_DELETE_WINDOW", self._on_close)



        # Statut USB initial (avant tout lancement)

        self._check_usb_initial()



    # ── construction UI ────────────────────────────────────────────────────────



    def _build_ui(self):

        P = 9

        self.rowconfigure(0, weight=1)



        # ── 1. Liste des presets ─────────────────────────────────────────────

        g1 = ttk.LabelFrame(self, text=f" {T('batch_group_presets')} ", padding=P)

        g1.grid(row=0, column=0, sticky="nsew", padx=P, pady=(P, 4))

        g1.columnconfigure(0, weight=1)

        g1.rowconfigure(1, weight=1)



        tb = ttk.Frame(g1)

        tb.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 6))

        ttk.Button(tb, text=T("batch_add"),     command=self._add).pack(side="left", padx=2)

        ttk.Button(tb, text=T("batch_remove"),       command=self._remove).pack(side="left", padx=2)

        ttk.Button(tb, text="↑",   width=3,     command=self._move_up).pack(side="left", padx=2)

        ttk.Button(tb, text="↓",   width=3,     command=self._move_down).pack(side="left", padx=2)

        ttk.Separator(tb, orient="vertical").pack(side="left", fill="y", padx=8)

        ttk.Button(tb, text=T("batch_toggle_lead"),   command=self._toggle_lead).pack(side="left", padx=2)

        ttk.Label(tb, text=T("batch_dblclick"),

                  font=("Arial", 8, "italic"),

                  foreground="gray50").pack(side="left", padx=4)



        cols = ("nom", "type", "slot", "lufs", "vol_av", "vol_ap", "statut")

        self._tree = ttk.Treeview(g1, columns=cols, show="headings", height=9,

                                   selectmode="browse")

        hdefs = [

            ("nom",    T("batch_col_preset"),  220, "w"),

            ("type",   T("batch_col_type"),    70, "center"),

            ("slot",   T("batch_col_slot"),    90, "center"),

            ("lufs",   T("batch_col_lufs"),    70, "center"),

            ("vol_av", T("batch_col_volav"),   85, "center"),

            ("vol_ap", T("batch_col_volap"),   95, "center"),

            ("statut", T("batch_col_status"), 55, "center"),

        ]

        for col, lbl, w, anchor in hdefs:

            self._tree.heading(col, text=lbl)

            self._tree.column(col, width=w, anchor=anchor, minwidth=40)

        vsb = ttk.Scrollbar(g1, orient="vertical", command=self._tree.yview)

        self._tree.configure(yscrollcommand=vsb.set)

        self._tree.grid(row=1, column=0, sticky="nsew")

        vsb.grid(row=1, column=1, sticky="ns")

        self._tree.bind("<Double-1>", lambda _: self._toggle_lead())

        self._tree.tag_configure("lead",    foreground="#1565C0", font=("Arial", 9, "bold"))

        self._tree.tag_configure("current", background="#E3F2FD")

        self._tree.tag_configure("done",    foreground="#2E7D32")



        # ── 2. Audio & MIDI ─────────────────────────────────────────────────

        g2 = ttk.LabelFrame(self, text=f" {T('batch_group_audio')} ", padding=P)

        g2.grid(row=1, column=0, sticky="ew", padx=P, pady=4)

        g2.columnconfigure(1, weight=1)



        ttk.Label(g2, text=T("batch_audio_in")).grid(row=0, column=0, sticky="w", pady=3)

        self._cb_audio = ttk.Combobox(g2, state="readonly", width=38)

        self._cb_audio.grid(row=0, column=1, sticky="ew", padx=(6, 0))

        ttk.Button(g2, text="↺", width=3,

                   command=self._refresh_audio_devs).grid(row=0, column=2, padx=(4, 0))



        ttk.Label(g2, text=T("batch_midi_out")).grid(row=1, column=0, sticky="w", pady=3)

        self._cb_midi = ttk.Combobox(g2, state="readonly", width=38)

        self._cb_midi.grid(row=1, column=1, sticky="ew", padx=(6, 0))

        ttk.Button(g2, text="↺", width=3,

                   command=self._refresh_midi_devs).grid(row=1, column=2, padx=(4, 0))



        ttk.Label(g2, text=T("batch_first_slot")).grid(row=2, column=0, sticky="w", pady=3)

        sf = ttk.Frame(g2)

        sf.grid(row=2, column=1, sticky="w", padx=(6, 0))

        ttk.Spinbox(sf, from_=1, to=50, width=5,

                    textvariable=self._v_slot_n,

                    command=self._update_pc_info).pack(side="left")

        cb_l = ttk.Combobox(sf, values=["A", "B", "C", "D"],

                             textvariable=self._v_slot_l,

                             state="readonly", width=4)

        cb_l.pack(side="left", padx=(4, 0))

        cb_l.bind("<<ComboboxSelected>>", lambda _: self._update_pc_info())

        ttk.Label(sf, textvariable=self._v_pc_info,

                  foreground="#003399",

                  font=("Courier", 10, "bold")).pack(side="left", padx=(14, 0))

        ttk.Label(g2, text=T("batch_out_dir")).grid(row=3, column=0, sticky="w", pady=3)

        sf2 = ttk.Frame(g2)

        sf2.grid(row=3, column=1, sticky="ew", padx=(6, 0), columnspan=2)

        sf2.columnconfigure(0, weight=1)

        self._v_outdir = tk.StringVar(value=T("batch_out_default"))

        self._outdir   = None   # None = sous-dossier out/ des sources

        ttk.Entry(sf2, textvariable=self._v_outdir,

                  state="readonly").grid(row=0, column=0, sticky="ew")

        ttk.Button(sf2, text=T("batch_out_pick"),

                   command=self._pick_outdir).grid(row=0, column=1, padx=(4, 0))

        ttk.Button(sf2, text=T("batch_out_source"),

                   command=self._reset_outdir).grid(row=0, column=2, padx=(4, 0))

        ttk.Button(sf2, text="📂", width=3,

                   command=self._open_outdir).grid(row=0, column=3, padx=(4, 0))



        # Indicateur mode USB

        self._v_usb_status = tk.StringVar(value="")

        ttk.Label(g2, textvariable=self._v_usb_status,

                  font=("Arial", 9, "bold"),

                  foreground="#1B5E20").grid(

            row=4, column=0, columnspan=3, sticky="w", pady=(4, 0))



        # Mise à jour automatique de l'info PC quand slot change

        self._v_slot_n.trace_add("write", lambda *_: self._update_pc_info())



        # ── 3. Mesure en cours ───────────────────────────────────────────────

        g3 = ttk.LabelFrame(self, text=f" {T('batch_group_measure')} ", padding=P)

        g3.grid(row=2, column=0, sticky="ew", padx=P, pady=4)



        ttk.Label(g3, textvariable=self._v_current,

                  font=("Arial", 11, "bold")).grid(row=0, column=0, columnspan=11,

                                                    sticky="w", pady=(0, 8))



        # Barre de progression push USB (visible uniquement pendant l'envoi)

        self._push_frame = ttk.Frame(g3)

        self._push_frame.grid(row=1, column=0, columnspan=11, sticky="ew", pady=(0, 6))

        self._push_frame.grid_remove()   # cachée par défaut



        self._v_push_label = tk.StringVar(value="")

        ttk.Label(self._push_frame, textvariable=self._v_push_label,

                  font=("Courier", 9, "bold"),

                  foreground="#1565C0").pack(side="left", padx=(0, 8))

        self._push_bar = ttk.Progressbar(self._push_frame, mode="determinate",

                                          length=300, maximum=8)

        self._push_bar.pack(side="left", fill="x", expand=True)



        meters = [

            (T("batch_momentary"), self._v_mom, "gray50"),

            (T("batch_shortterm"), self._v_st,  "gray30"),

            (T("batch_integrated"),  self._v_itg, "#003399"),

        ]

        for col_off, (lbl, var, color) in enumerate(meters):

            ttk.Label(g3, text=lbl, width=11,

                      anchor="e").grid(row=2, column=col_off*2, sticky="e", padx=(8, 0))

            ttk.Label(g3, textvariable=var,

                      font=("Courier", 15, "bold"),

                      foreground=color, width=8,

                      anchor="e").grid(row=2, column=col_off*2+1, sticky="e")



        ttk.Separator(g3, orient="vertical").grid(row=2, column=6, padx=12, sticky="ns")

        ttk.Label(g3, text=T("batch_delta"), anchor="e").grid(row=2, column=7, sticky="e")

        self._lbl_delta = ttk.Label(g3, textvariable=self._v_delta,

                                     font=("Courier", 15, "bold"), width=8, anchor="e")

        self._lbl_delta.grid(row=2, column=8, sticky="e")

        ttk.Label(g3, text="dB").grid(row=2, column=9, sticky="w", padx=(2, 0))



        self._lbl_hint = ttk.Label(g3, textvariable=self._v_hint,

                                    font=("Arial", 9, "italic"),

                                    wraplength=760, justify="center")

        self._lbl_hint.grid(row=3, column=0, columnspan=11, pady=(8, 2))



        # ── 4. Controles ─────────────────────────────────────────────────────

        g4 = ttk.Frame(self, padding=(P, 6))

        g4.grid(row=3, column=0, pady=4)



        self._btn_launch = ttk.Button(g4, text=T("batch_launch"),    width=14, command=self._launch)

        self._btn_pause  = ttk.Button(g4, text=T("batch_pause"),     width=14, command=self._toggle_pause, state="disabled")

        self._btn_prev   = ttk.Button(g4, text=T("batch_prev"),       width=14, command=self._go_prev,      state="disabled")

        self._btn_next   = ttk.Button(g4, text=T("batch_next"),   width=14, command=self._go_next,      state="disabled")

        self._btn_resend = ttk.Button(g4, text=T("batch_resend"),        width=14, command=self._resend_current, state="disabled")

        self._btn_apply  = ttk.Button(g4, text=T("batch_apply"), width=14, command=self._apply,        state="disabled")



        for i, btn in enumerate((self._btn_launch, self._btn_pause,

                                  self._btn_prev, self._btn_next, self._btn_resend, self._btn_apply)):

            btn.grid(row=0, column=i, padx=6)



        ttk.Label(self, textvariable=self._v_status,

                  font=("Arial", 9, "italic"),

                  foreground="gray50").grid(row=4, column=0, padx=P, pady=(2, P), sticky="w")





    # ── initialisations & devices ─────────────────────────────────────────────



    def _check_usb_initial(self):

        """Vérifie USB SysEx + Audio au démarrage via probes réels."""

        if not _USB_OK:

            self._v_usb_status.set(T("batch_usb_unavail"))

            return

        self._v_usb_status.set(T("batch_usb_detecting"))

        self.update_idletasks()

        try:

            midi_ok, audio_ok = GP200USB.probe_full()

        except Exception:

            midi_ok = audio_ok = False



        if midi_ok and audio_ok:

            self._v_usb_status.set(

                T("batch_usb_ready"))

        elif midi_ok:

            self._v_usb_status.set(T("batch_usb_partial_midi"))

        elif audio_ok:

            self._v_usb_status.set(T("batch_usb_partial_audio"))

        else:

            self._v_usb_status.set(

                T("batch_usb_not_found"))



    def _open_outdir(self):

        """Ouvre le dossier de sortie dans l'explorateur."""

        import subprocess, sys



        if self._outdir and os.path.isdir(self._outdir):

            target = self._outdir

        elif self._presets:

            target = os.path.join(

                os.path.dirname(os.path.abspath(self._presets[0].path)), "out")

        else:

            messagebox.showinfo(T("batch_outdir_title"),

                T("batch_outdir_empty"), parent=self)

            return



        if not os.path.isdir(target):

            messagebox.showinfo(T("batch_outdir_title"),

                T("batch_outdir_missing") % target, parent=self)

            return



        if sys.platform == "win32":

            os.startfile(target)

        elif sys.platform == "darwin":

            subprocess.Popen(["open", target])

        else:

            subprocess.Popen(["xdg-open", target])



    def _pick_outdir(self):

        d = filedialog.askdirectory(title=T("batch_filedialog_out"))

        if d:

            self._outdir = d

            self._v_outdir.set(d)



    def _reset_outdir(self):

        self._outdir = None

        self._v_outdir.set(T("batch_out_default"))



    def _refresh_audio_devs(self):

        self._audio_devs = list_input_devices()

        self._cb_audio["values"] = [f"[{i}]  {n}" for i, n in self._audio_devs]

        saved = self._cfg.get("batch_audio_device", "")

        for idx, (_, name) in enumerate(self._audio_devs):

            if name == saved:

                self._cb_audio.current(idx)

                return

        if self._audio_devs:

            self._cb_audio.current(0)



    def _refresh_midi_devs(self):

        self._midi_devs = list_output_devices()

        self._cb_midi["values"] = [f"[{i}]  {n}" for i, n in self._midi_devs]

        saved = self._cfg.get("batch_midi_device", "")

        for idx, (_, name) in enumerate(self._midi_devs):

            if name == saved:

                self._cb_midi.current(idx)

                return

        if self._midi_devs:

            self._cb_midi.current(0)



    def _update_pc_info(self):

        try:

            n  = int(self._v_slot_n.get())

            l  = self._v_slot_l.get()

            pc = slot_to_pc(n, l)

            self._v_pc_info.set(f"→ PC {pc}  (slot de test {n:02d}-{l})")

            self._refresh_tree_slots()

        except Exception:

            pass



    # ── gestion de la liste ───────────────────────────────────────────────────



    def _add(self):

        paths = filedialog.askopenfilenames(

            title=T("batch_filedialog_add"),

            filetypes=[("GP-200 preset", "*.prst"), ("Tous", "*.*")],

        )

        for path in sorted(paths):

            try:

                raw = open(path, "rb").read()

                if len(raw) != PRST_SIZE:

                    messagebox.showwarning(

                        T("batch_invalid_file"),

                        T("batch_invalid_size", os.path.basename(path), len(raw), PRST_SIZE),

                        parent=self)

                    continue

                self._presets.append(PresetEntry(path))

            except Exception as e:

                messagebox.showerror(T("batch_err_write_title"), str(e), parent=self)

        self._rebuild_tree()



    def _remove(self):

        sel = self._tree.selection()

        if not sel:

            return

        idx = self._tree.index(sel[0])

        self._presets.pop(idx)

        self._rebuild_tree()



    def _move_up(self):

        sel = self._tree.selection()

        if not sel:

            return

        idx = self._tree.index(sel[0])

        if idx > 0:

            self._presets.insert(idx - 1, self._presets.pop(idx))

            self._rebuild_tree()

            self._tree.selection_set(self._tree.get_children()[idx - 1])



    def _move_down(self):

        sel = self._tree.selection()

        if not sel:

            return

        idx = self._tree.index(sel[0])

        if idx < len(self._presets) - 1:

            self._presets.insert(idx + 1, self._presets.pop(idx))

            self._rebuild_tree()

            self._tree.selection_set(self._tree.get_children()[idx + 1])



    def _toggle_lead(self):

        sel = self._tree.selection()

        if not sel:

            return

        idx = self._tree.index(sel[0])

        e = self._presets[idx]

        e.ptype = "LEAD" if e.ptype == "NORMAL" else "NORMAL"

        self._rebuild_tree()

        children = self._tree.get_children()

        if idx < len(children):

            self._tree.selection_set(children[idx])



    def _rebuild_tree(self):

        sel_idx = None

        sel = self._tree.selection()

        if sel:

            sel_idx = self._tree.index(sel[0])

        self._tree.delete(*self._tree.get_children())



        try:

            base_pc = slot_to_pc(int(self._v_slot_n.get()), self._v_slot_l.get())

        except Exception:

            base_pc = 0



        test_sn, test_sl = pc_to_slot(base_pc)



        for i, e in enumerate(self._presets):

            lufs_str = f"{e.lufs_ok:+.1f}" if e.lufs_ok is not None else "---"

            

            # Affichage clair du avant/après : (Patch Volume | Ampli Volume) en comparant à l'initial
            str_orig = f"{e.patch_vol_initial}|{e.amp_vol_initial:.0f}" if e.amp_vol_initial is not None else str(e.patch_vol_initial)
            str_new  = f"{e.patch_vol_new}|{e.amp_vol_new:.0f}" if e.amp_vol_new is not None else str(e.patch_vol_new)



            tags = []

            if e.ptype == "LEAD":

                tags.append("lead")

            if e.status == STATUS_DONE:

                tags.append("done")

            if i == self._cur_idx:

                tags.append("current")



            self._tree.insert("", "end", tags=tuple(tags), values=(

                e.name,

                "● LEAD" if e.ptype == "LEAD" else "○ NORM",

                f"{test_sn:02d}-{test_sl}",

                lufs_str,

                str_orig,

                str_new if str_new != str_orig else "---",

                e.status,

            ))



        if sel_idx is not None:

            children = self._tree.get_children()

            if sel_idx < len(children):

                self._tree.selection_set(children[sel_idx])



    def _refresh_tree_slots(self):

        try:

            base_pc = slot_to_pc(int(self._v_slot_n.get()), self._v_slot_l.get())

            sn, sl  = pc_to_slot(base_pc)

            slot_str = f"{sn:02d}-{sl}"

        except Exception:

            return

        for iid in self._tree.get_children():

            vals = list(self._tree.item(iid, "values"))

            vals[2] = slot_str

            self._tree.item(iid, values=vals)





    # ── analyse silencieuse de l'ampli ───────────────────────────────────────



    def _analyze_params(self, entry: PresetEntry):
        """Détecte les paramètres de volume/gain AMP et volume CAB pour l'auto-tweak."""
        try:
            from gp200lib import decode_prst, MODULES, Tables
            if not getattr(self, "_tables", None):
                from gp200_agent import resource_path
                self._tables = Tables(resource_path("data"))

            entry.amp_idx = MODULES.index("AMP")
            entry.cab_idx = MODULES.index("CAB")

            d = decode_prst(entry.path, self._tables)
            amp_dict = d["modules"].get("AMP", {})
            cab_dict = d["modules"].get("CAB", {})
            entry.amp_name = amp_dict.get("model", "")

            # ── AMP : cherche volume, puis gain ───────────────────────────
            if entry.amp_name:
                mid, m_cat = None, None
                for (m_id, cat), m in self._tables.by_key.items():
                    if m.get("name") == entry.amp_name:
                        mid, m_cat = m_id, cat
                        break

                if mid is not None:
                    params_meta = self._tables.params_of(mid, m_cat)
                    vol_names  = ["volume", "level", "master", "out"]
                    gain_names = ["gain", "drive", "input", "input gain"]

                    for i, p in enumerate(params_meta):
                        if p["name"].lower() in vol_names:
                            entry.amp_param_idx   = i
                            entry.amp_vol_orig    = amp_dict["params"].get(p["name"], 50)
                            entry.amp_vol_initial = entry.amp_vol_orig
                            entry.amp_vol_new     = entry.amp_vol_orig
                            break

                    # Si pas de volume → cherche le gain
                    if entry.amp_param_idx is None:
                        for i, p in enumerate(params_meta):
                            if p["name"].lower() in gain_names:
                                entry.amp_gain_param_idx   = i
                                entry.amp_gain_orig        = amp_dict["params"].get(p["name"], 50)
                                entry.amp_gain_initial     = entry.amp_gain_orig
                                entry.amp_gain_new         = entry.amp_gain_orig
                                break

            # APRÈS (params_of direct, comme gp200_slot_popup)
            # CAB IR est le seul modèle physique — model_id=0, cat=10
            # Volume = enumerate index 0 (identique à la logique du slot_popup)
            if hasattr(self._tables, 'cabs') and self._tables.cabs:
                try:
                    cab_pm = self._tables.params_of(0, 10)
                    cab_params_dict = cab_dict.get("params", {})
                    for i, p in enumerate(cab_pm):
                        if p["name"].lower() in ["volume", "level", "out"]:
                            entry.cab_vol_param_idx = i
                            entry.cab_vol_orig      = float(cab_params_dict.get(p["name"], 75.0))
                            entry.cab_vol_initial   = entry.cab_vol_orig
                            entry.cab_vol_new       = entry.cab_vol_orig
                            break
                except Exception:
                    pass

        except Exception as ex:
            print("Erreur analyse params silencieuse:", ex)



    # ── workflow batch ────────────────────────────────────────────────────────



    def _launch(self):

        if not self._presets:

            messagebox.showwarning(T("batch_warn_empty_title"),

                T("batch_warn_empty_msg"), parent=self)

            return

        if not DEPS_OK:

            messagebox.showerror(T("x_deps_missing"),

                f"{DEPS_MSG}\n\npip install sounddevice pyloudnorm", parent=self)

            return



        try:

            base_pc  = slot_to_pc(int(self._v_slot_n.get()), self._v_slot_l.get())

            last_pc  = base_pc + len(self._presets) - 1

        except Exception:

            base_pc = last_pc = 0



        if base_pc > 127:

            messagebox.showerror(

                T("batch_oor_title2"),

                T("batch_oor_msg2") % (self._v_slot_n.get(), self._v_slot_l.get(), base_pc),

                parent=self)

            return

        if last_pc > 127:

            if not messagebox.askyesno(

                T("batch_partial_title2"),

                T("batch_partial_msg2") % (len(self._presets), base_pc, last_pc, 128 - base_pc),

                parent=self):

                return



        audio_sel = self._cb_audio.current()

        if audio_sel < 0 or audio_sel >= len(self._audio_devs):

            messagebox.showerror(T("x_error"), T("batch_err_audio_select"), parent=self)

            return

        audio_idx = self._audio_devs[audio_sel][0]

        self._cfg["batch_audio_device"] = self._audio_devs[audio_sel][1]

        midi_sel = self._cb_midi.current()

        if 0 <= midi_sel < len(self._midi_devs):

            self._cfg["batch_midi_device"] = self._midi_devs[midi_sel][1]

        save_config(self._cfg)



        self._usb_mode = False

        self._usb_dev  = None

        if _USB_OK:

            dev = GP200USB(verbose=False)

            if dev.connect():

                self._usb_dev  = dev

                self._usb_mode = True

                self._v_usb_status.set(T("batch_usb_active"))



        self._midi = None

        if not self._usb_mode:

            midi_sel = self._cb_midi.current()

            if _MIDI_OK and 0 <= midi_sel < len(self._midi_devs):

                midi_idx = self._midi_devs[midi_sel][0]

                self._midi = MidiOut(midi_idx)

                if not self._midi.ok:

                    self._midi = None

            if self._midi:

                self._v_usb_status.set(T("batch_usb_midi_only"))

            else:

                self._v_usb_status.set(T("batch_usb_none"))



        try:

            self._engine = LUFSEngine(callback=self._on_lufs)

            self._engine.start(device=audio_idx)

        except Exception as e:

            messagebox.showerror(T("batch_err_audio_title"), str(e), parent=self)

            return



        self._running = True

        self._paused  = False

        self._cur_idx = -1

        for e in self._presets:
            e.status        = STATUS_WAIT
            e.patch_vol_new = e.patch_vol_orig
            if e.amp_vol_orig   is not None: e.amp_vol_new   = e.amp_vol_orig
            if e.amp_gain_orig  is not None: e.amp_gain_new  = e.amp_gain_orig  # NEW
            if e.cab_vol_orig   is not None: e.cab_vol_new   = e.cab_vol_orig   # NEW
            e.lufs_ok = None



        self._btn_launch.config(state="disabled")

        self._btn_pause.config(state="normal", text=T("batch_pause"))

        self._btn_prev.config(state="disabled")

        self._btn_next.config(state="normal")

        self._btn_apply.config(state="disabled")



        self._rebuild_tree()

        self._go_next()



    def _go_prev(self):

        """Bouton Précédent : recule d'un preset."""

        if self._cur_idx <= 0:

            return

        if 0 <= self._cur_idx < len(self._presets):

            if self._presets[self._cur_idx].status == STATUS_RUN:

                self._presets[self._cur_idx].status = STATUS_WAIT

        self._cur_idx -= 1

        self._play_current_preset()



    def _go_next(self):

        """Bouton Suivant : avance d'un preset ou termine."""

        if 0 <= self._cur_idx < len(self._presets):

            if self._presets[self._cur_idx].status == STATUS_RUN:

                self._presets[self._cur_idx].status = STATUS_WAIT



        if self._cur_idx + 1 >= len(self._presets):

            self._finish()

            return



        self._cur_idx += 1

        self._play_current_preset()



    def _play_current_preset(self):

        """Moteur commun pour préparer l'UI et charger le preset actuel (Suivant et Précédent)."""

        e = self._presets[self._cur_idx]

        

        # Analyse du preset pour trouver l'ampli (exécuté une seule fois par preset)

        if e.amp_idx is None:

            self._analyze_params(e)

            

        # 2.5s de grâce au chargement du preset pour laisser le son s'établir

        e.settle_until = time.time() + 2.5

        e.last_tweak = time.time() + 2.5

        

        if e.status != STATUS_DONE:

            e.status = STATUS_RUN

            

        # ── SÉCURITÉ : On réinitialise la compensation mathématique à chaque chargement de preset

        e.math_done = False



        if self._cur_idx == len(self._presets) - 1:

            self._btn_next.config(text=T("batch_finish"))

        else:

            self._btn_next.config(text=T("batch_next"))

        

        if self._cur_idx == 0:

            self._btn_prev.config(state="disabled")

        else:

            self._btn_prev.config(state="normal")



        try:

            base_pc = slot_to_pc(int(self._v_slot_n.get()), self._v_slot_l.get())

        except Exception:

            base_pc = 0

        pc     = base_pc

        sn, sl = pc_to_slot(pc)



        if self._engine:
            self._engine.reset()
        self._last = (None, None, None)
        self._smoothed_delta = None  # 🔄 Reset du lissage delta
        self._v_delta.set("   ---")

        self._v_hint.set("")

        self._btn_apply.config(state="disabled")



        target = TARGETS[e.ptype]

        self._v_current.set(

            T("batch_current_fmt", self._cur_idx+1, len(self._presets),

              e.name, e.ptype, target))

        self._rebuild_tree()

        children = self._tree.get_children()

        if self._cur_idx < len(children):

            self._tree.see(children[self._cur_idx])

            self._tree.selection_set(children[self._cur_idx])



        if pc > 127:

            self._status(T("batch_status_oor", pc, self._cur_idx+1))

        elif self._usb_mode and self._usb_dev:

            self._status(T("batch_sending") % (self._cur_idx+1, len(self._presets), f"{sn:02d}-{sl}"))

            for _b in (self._btn_launch, self._btn_pause, self._btn_prev, self._btn_next, self._btn_resend, self._btn_apply):

                _b.config(state="disabled")

            threading.Thread(

                target=self._push_preset_bg,

                args=(sn, sl, bytes(e.data), pc),

                daemon=True

            ).start()

        elif self._midi and self._midi.ok:

            self._midi.send_pc(pc)

            self._status(T("batch_status_play_midi", pc, f"{sn:02d}-{sl}"))

        else:

            self._status(T("batch_status_play", self._cur_idx+1, len(self._presets)))



    def _push_preset_bg(self, sn: int, sl: str, data: bytes, pc: int):

        """Thread background : push USB + PC sans bloquer l'UI."""

        self._usb_busy = True

        if hasattr(self.master, "_usb_busy"):
            self.master._usb_busy = True

        _w = getattr(self.master, "_audio_wake", None)
        _wp = (_w is not None and hasattr(_w, "stop") and hasattr(_w, "start"))
        if _wp: _w.stop()

        time.sleep(0.2)

        def progress(step, total, label):
            self.after(0, lambda s=step, t=total, l=label:
                       self._update_push_progress(s, t, l))

        try:
            self._usb_dev.write_preset(sn, sl, data, progress_cb=progress)
            time.sleep(0.35)
            self._usb_dev.select_preset(sn, sl)
            if self._engine:
                self._engine.reset()
            self._last = (None, None, None)
            self.after(0, lambda: self._on_push_done(pc, sn, sl))
        except Exception as ex:
            err = str(ex)
            self.after(0, lambda: self._on_push_error(err))
        finally:
            self._usb_busy = False
            if hasattr(self.master, "_usb_busy"):
                self.master._usb_busy = False
            if _wp: _w.start()



    def _update_push_progress(self, step: int, total: int, label: str):

        if step == 0:

            self._push_frame.grid()

            self._push_bar["maximum"] = total + 1

            self._push_bar["value"]   = 0

            self._v_push_label.set("📡 HS")

        elif step <= total:

            self._push_bar["value"] = step

            self._v_push_label.set(f"📤 {step}/{total}")

        else:

            self._push_bar["value"] = total + 1

            self._push_frame.grid_remove()



    def _apply_push_bg(self, sn: int, sl: str, data: bytes,
                        pc: int, filename: str):

        """Thread background : repush de la version corrigée sur le hardware."""

        self._usb_busy = True

        

        if hasattr(self.master, "_usb_busy"):

            self.master._usb_busy = True



        def progress(step, total, label):

            self.after(0, lambda s=step, t=total, l=label:

                       self._update_push_progress(s, t, l))



        _w = getattr(self.master, "_audio_wake", None)

        _wp = (_w is not None and hasattr(_w, "stop") and hasattr(_w, "start"))

        if _wp:

            _w.stop()

            time.sleep(0.05)

            
        try:

            self._usb_dev.write_preset(sn, sl, data, progress_cb=progress)

            time.sleep(0.35)

            self._usb_dev.select_preset(sn, sl)

            self.after(0, lambda: self._status(

                T("x_saved_updated", filename, f"{sn:02d}-{sl}")))

        except Exception as ex:

            self.after(0, lambda: self._status(

                T("x_saved_repush_fail", filename, ex)))

        finally:

            self._usb_busy = False

            

            if hasattr(self.master, "_usb_busy"):

                self.master._usb_busy = False

                

            if _wp: _w.start()



    def _on_push_done(self, pc: int, sn: int, sl: str):

        self._btn_next.config(state="normal")

        if self._cur_idx > 0:

            self._btn_prev.config(state="normal")

        self._btn_resend.config(state="normal")

        self._btn_apply.config(state="disabled")

        self._btn_launch.config(state="disabled")

        self._btn_pause.config(state="normal")

        self._push_frame.grid_remove()

        self._status(T("batch_status_play", self._cur_idx+1, len(self._presets)))



        # Attendre 800ms que le driver USB audio du Valeton récupère du transfert SysEx, puis relancer

        self.after(800, self._restart_audio_engine)



        try:

            if hasattr(self.master, "_start_audio_wake"):

                self.after(1000, self.master._start_audio_wake)

        except Exception:

            pass



    def _on_push_error(self, err: str):

        self._status(T("x_push_fail", err))

        self._btn_next.config(state="normal")

        if self._cur_idx > 0:

            self._btn_prev.config(state="normal")

        self._btn_resend.config(state="normal")

        self._btn_apply.config(state="normal")



    def _toggle_pause(self):

        if not self._running:

            return

        self._paused = not self._paused

        if self._paused:

            if self._engine:

                self._engine.reset()

            self._btn_pause.config(text=T("batch_resume"))

            self._v_hint.set("")

            self._status(T("batch_status_paused"))

        else:

            self._btn_pause.config(text=T("batch_pause"))

            self._status(T("batch_status_resumed"))



    def _resend_current(self):

        """Renvoie le preset en cours vers le Valeton sans passer au suivant."""

        if not self._running or not (0 <= self._cur_idx < len(self._presets)):

            return

            

        e = self._presets[self._cur_idx]

        # ← AJOUTER CES 4 LIGNES :
        # Déverrouille le preset validé pour permettre une deuxième passe d'ajustement
        if e.status == STATUS_DONE:
            e.status = STATUS_RUN
            e.tolerance_start_time = None   # repart de zéro pour les 3s de stabilité
            e.settle_until = time.time() + 2.5  # période de gel au rechargement
        # ← FIN AJOUT

        try:

            base_pc = slot_to_pc(int(self._v_slot_n.get()), self._v_slot_l.get())

        except Exception:

            base_pc = 0

        pc     = base_pc

        sn, sl = pc_to_slot(pc)



        if self._engine:
            self._engine.reset()
        self._last = (None, None, None)
        self._smoothed_delta = None  # 🔄 Reset du lissage delta
        self._v_delta.set("   ---")

        self._v_hint.set("")

        self._btn_apply.config(state="disabled")



        if pc > 127:

            self._status(T("batch_status_oor", pc, self._cur_idx+1))

        elif self._usb_mode and self._usb_dev:

            self._status(T("batch_resending") % (self._cur_idx+1, len(self._presets), f"{sn:02d}-{sl}"))

            for _b in (self._btn_launch, self._btn_pause, self._btn_prev, self._btn_next, self._btn_resend, self._btn_apply):

                _b.config(state="disabled")

            threading.Thread(

                target=self._push_preset_bg,

                args=(sn, sl, bytes(e.data), pc),

                daemon=True

            ).start()

        elif self._midi and self._midi.ok:

            self._midi.send_pc(pc)

            self._status(T("batch_status_play_midi", pc, f"{sn:02d}-{sl}"))

        else:

            self._status(T("batch_status_play", self._cur_idx+1, len(self._presets)))

    

    def _apply(self):

        if not (0 <= self._cur_idx < len(self._presets)):

            return

        e   = self._presets[self._cur_idx]

        m, st, itg = self._last

        if itg is None:

            messagebox.showwarning(T("batch_no_measure_title"),

                T("batch_no_measure_msg"), parent=self)

            return



        if self._outdir:

            out_path = os.path.join(self._outdir, os.path.basename(e.path))

        else:

            out_dir = os.path.join(os.path.dirname(os.path.abspath(e.path)), "out")

            os.makedirs(out_dir, exist_ok=True)

            out_path = os.path.join(out_dir, os.path.basename(e.path))



        try:

            # Appliquer physiquement le Patch Volume calculé dans les données binaires

            e.data[OFF_PATCH_VOL] = int(e.patch_vol_new)

            

            # L'auto-tweak maintient e.data (Ampli) parfaitement à jour en temps réel

            _save_preset(out_path, e.data)

            

            e.lufs_ok = itg

            

            # --- MODIFICATION INTELLIGENTE DU STATUT ---

            # On ne passe en STATUS_DONE (vert) que si la cible LUFS est réellement atteinte !

            # Sinon, on le laisse en STATUS_RUN pour que l'ajustement continue.

            target = TARGETS[e.ptype]

            if itg is not None and abs(itg - target) <= TOLERANCE_DB:

                e.status = STATUS_DONE

            else:

                e.status = STATUS_RUN

            # -------------------------------------------

            

            # 1. Le volume qu'on vient d'appliquer devient la nouvelle référence mathématique

            e.patch_vol_orig = e.patch_vol_new

            if e.amp_vol_new is not None:

                e.amp_vol_orig = e.amp_vol_new

            if e.amp_gain_new is not None: e.amp_gain_orig = e.amp_gain_new
            if e.cab_vol_new  is not None: e.cab_vol_orig  = e.cab_vol_new   

            # 2. On vide l'historique LUFS pour que la prochaine mesure ne soit pas polluée par l'ancien volume !

            if self._engine:

                self._engine.reset()

            self._last = (None, None, None)

                

            # 3. On gèle les calculs pendant 3 secondes : le temps que le push USB se fasse et que tu joues le nouvel accord.

            e.settle_until = time.time() + 3.0

            

            self._rebuild_tree()

            short = os.path.basename(out_path)

            

            vol_str = f"Patch:{e.patch_vol_new:.0f}"

            if e.amp_vol_new is not None:

                vol_str += f" Ampli:{e.amp_vol_new:.0f}"

                

            self._status(T("x_saved_vol", short, vol_str, itg))

            self._btn_apply.config(state="disabled")



            if self._usb_mode and self._usb_dev:

                try:

                    base_pc = slot_to_pc(int(self._v_slot_n.get()), self._v_slot_l.get())

                    pc      = base_pc

                    sn, sl  = pc_to_slot(pc)

                    data_copy = bytes(e.data)

                    threading.Thread(

                        target=self._apply_push_bg,

                        args=(sn, sl, data_copy, pc, short),

                        daemon=True

                    ).start()

                except Exception:

                    pass



            if self._outdir:

                self.after(100, lambda p=out_path: self._flash_path(p))

        except OSError as ex:

            messagebox.showerror(T("batch_err_write_title"), str(ex), parent=self)



    def _flash_path(self, path):

        self._status(T("batch_status_path", path))



    def _finish(self):

        self._stop_engine()

        self._running = False

        self._btn_launch.config(state="normal")

        self._btn_pause.config(state="disabled", text=T("batch_pause"))

        self._btn_prev.config(state="disabled")

        self._btn_next.config(state="disabled")

        self._btn_resend.config(state="disabled")

        self._btn_apply.config(state="disabled")

        done = sum(1 for e in self._presets if e.status == STATUS_DONE)

        self._v_current.set(T("batch_done_fmt", done, len(self._presets)))

        self._status(T("batch_status_final"))

        messagebox.showinfo(T("batch_done_title"),

            T("batch_done_msg", done, len(self._presets)), parent=self)



    # ── LUFS callback + boucle affichage ─────────────────────────────────────



    def _on_lufs(self, m, st, itg):

        self._last = (m, st, itg)



    def _poll(self):

        if self._running and not self._paused:

            m, st, itg = self._last

            self._update_meters(m, st, itg)

        self.after(self.POLL_MS, self._poll)



    def _update_meters(self, m, st, itg):

        # 🛡️ SÉCURITÉ ABSOLUE : Si un transfert USB est en cours, on ignore totalement les mesures

        if getattr(self, "_usb_busy", False):

            self._v_mom.set("   ---")

            self._v_st.set("   ---")

            self._v_itg.set("   ---")

            self._v_delta.set("   ---")

            return



        if 0 <= self._cur_idx < len(self._presets):

            e = self._presets[self._cur_idx]

            if getattr(e, "patch_applying", False):

                return



        def fmt(v): return f"{v:+6.1f}" if v is not None else "   ---"

        self._v_mom.set(fmt(m))

        self._v_st.set(fmt(st))

        self._v_itg.set(fmt(itg))



        if itg is not None and 0 <= self._cur_idx < len(self._presets):
            e      = self._presets[self._cur_idx]
            target = TARGETS[e.ptype]
            raw_delta = itg - target
            
            # 📉 LISSAGE EXPONENTIEL DU DELTA (Anti-nerveux)
            # alpha = 0.2 garde 80% de l'ancienne valeur et prend 20% de la nouvelle.
            alpha = 0.2
            if self._smoothed_delta is None:
                self._smoothed_delta = raw_delta
            else:
                self._smoothed_delta = alpha * raw_delta + (1 - alpha) * self._smoothed_delta
            
            delta = self._smoothed_delta
            self._v_delta.set(f"{delta:+6.1f}")

            # 🛡️ VERROUILLAGE ANTI-YOYO : Une fois validé, on ne redéverrouille plus bêtement !
            if e.status == STATUS_DONE:
                self._lbl_delta.config(foreground="#1B5E20")
                self._v_hint.set(T("batch_hint_validated") % (e.patch_vol_new, str(round(e.amp_vol_new)) if e.amp_vol_new is not None else "N/A"))
                self._btn_apply.config(state="disabled")
                return

            now = time.time()
            
            # ── 1. PÉRIODE DE GEL / STABILISATION ──
            settle_until = getattr(e, "settle_until", 0)
            if settle_until > now:
                remaining = int(settle_until - now) + 1
                self._lbl_delta.config(foreground="gray50")
                self._v_hint.set(T("batch_hint_settling") % remaining)
                self._btn_apply.config(state="disabled")
                return

            # ── 2. SÉCURITÉ SILENCE (> 20 dB) ──
            if abs(delta) > 30.0:
                self._lbl_delta.config(foreground="gray50")
                self._v_hint.set(T("batch_hint_silence"))
                self._btn_apply.config(state="disabled")
                return
                
            # ── 3. LA RÈGLE DES 3 SECONDES DE STABILITÉ DANS LA TOLÉRANCE ──
            if abs(delta) <= TOLERANCE_DB:
                self._lbl_delta.config(foreground="#1B5E20")
                
                # Initialisation ou suivi du chrono de stabilité continue
                if not hasattr(e, "tolerance_start_time") or e.tolerance_start_time is None:
                    e.tolerance_start_time = now
                
                elapsed_stable = now - e.tolerance_start_time
                
                if elapsed_stable >= 3.0:
                    # 🚀 VICTOIRE AUTOMATIQUE : On sauvegarde et on valide direct !
                    self._v_hint.set(T("batch_hint_stable_ok"))
                    self._apply()
                    return
                else:
                    # En cours de validation des 3 secondes
                    rem_stable = int(3.0 - elapsed_stable) + 1
                    self._v_hint.set(T("batch_hint_stable_wait") % rem_stable)
                    self._btn_apply.config(state="disabled")
            else:
                # Si on sort de la tolérance, on annule le chrono de stabilité des 3s
                e.tolerance_start_time = None
                
                # ── 4. AUTO-TWEAK CASCADE ─────────────────────────────────
                if self._usb_mode and self._usb_dev and not getattr(self, "_usb_busy", False):

                    if now - getattr(e, "last_amp_tweak", 0) < 2.0:
                        return

                    diff_units = -int(round(delta / LUFS_PER_UNIT))
                    if diff_units == 0:
                        diff_units = -1 if delta > 0 else 1

                    # Helpers cascade ──────────────────────────────────────
                    def _tweak_patch(fallback=None):
                        is_min = (e.patch_vol_new <= PATCH_VOL_MIN and diff_units < 0)
                        is_max = (e.patch_vol_new >= PATCH_VOL_MAX and diff_units > 0)
                        e.patch_vol_new = max(PATCH_VOL_MIN, min(PATCH_VOL_MAX, e.patch_vol_new + diff_units))
                        e.tweak_count = getattr(e, "tweak_count", 0) + 1
                        if (is_min or is_max) and fallback:
                            self._v_hint.set(T("batch_hint_patch_ceil"))
                            fallback()
                            return
                        limit = T("batch_hint_patch_limit") if is_min or is_max else ""
                        self._v_hint.set(T("batch_hint_patch_adj") % (e.tweak_count, e.patch_vol_new, limit))
                        e.last_amp_tweak = now
                        if self._engine: self._engine.reset()
                        threading.Thread(target=self._send_patch_tweak_bg,
                                         args=(e, e.patch_vol_new), daemon=True).start()

                    def _tweak_cab(fallback=None):
                        if e.cab_vol_param_idx is not None and e.cab_vol_new is not None:
                            is_min = (e.cab_vol_new <= CAB_VOL_MIN and diff_units < 0)
                            is_max = (e.cab_vol_new >= CAB_VOL_MAX and diff_units > 0)
                            if not is_min and not is_max:
                                e.cab_vol_new = max(CAB_VOL_MIN, min(CAB_VOL_MAX, e.cab_vol_new + diff_units))
                                e.tweak_count = getattr(e, "tweak_count", 0) + 1
                                self._v_hint.set(T("batch_hint_cab_adj") % (e.tweak_count, e.cab_vol_new))
                                e.last_amp_tweak = now
                                if self._engine: self._engine.reset()
                                threading.Thread(target=self._send_cab_tweak_bg,
                                                 args=(e, e.cab_vol_new), daemon=True).start()
                            else:
                                lim = T("batch_hint_floor") if is_min else T("batch_hint_ceiling")
                                self._v_hint.set(T("batch_hint_cab_limit") % lim)
                                _tweak_patch(fallback=fallback)
                        else:
                            _tweak_patch(fallback=fallback)

                    # CAS 1 : AMP a un volume ──────────────────────────────
                    if e.amp_param_idx is not None and e.amp_vol_new is not None:
                        is_min = (e.amp_vol_new <= AMP_VOL_MIN and diff_units < 0)
                        is_max = (e.amp_vol_new >= AMP_VOL_MAX and diff_units > 0)
                        if not is_min and not is_max:
                            e.amp_vol_new = max(AMP_VOL_MIN, min(AMP_VOL_MAX, e.amp_vol_new + diff_units))
                            e.patch_vol_new = e.patch_vol_orig
                            e.tweak_count = getattr(e, "tweak_count", 0) + 1
                            self._v_hint.set(T("batch_hint_amp_adj") % (e.tweak_count, e.amp_vol_new))
                            e.last_amp_tweak = now
                            if self._engine: self._engine.reset()
                            threading.Thread(target=self._send_amp_tweak_bg,
                                             args=(e, e.amp_vol_new), daemon=True).start()
                        else:
                            lim = T("batch_hint_floor") if is_min else T("batch_hint_ceiling")
                            self._v_hint.set(T("batch_hint_amp_limit") % lim)
                            _tweak_cab()  # pas de gain last resort pour CAS 1

                    # CAS 2 : AMP gain seul → CAB → Patch → Gain last resort (+10 max)
                    elif e.amp_gain_param_idx is not None and e.amp_gain_new is not None:
                        def _tweak_gain_lastresort():
                            gain_ceil = min(AMP_GAIN_MAX, e.amp_gain_initial + AMP_GAIN_BOOST_MAX)
                            is_max_g = (e.amp_gain_new >= gain_ceil and diff_units > 0)
                            is_min_g = (e.amp_gain_new <= AMP_GAIN_MIN and diff_units < 0)
                            if not is_max_g and not is_min_g:
                                e.amp_gain_new = max(AMP_GAIN_MIN, min(gain_ceil, e.amp_gain_new + diff_units))
                                e.tweak_count = getattr(e, "tweak_count", 0) + 1
                                self._v_hint.set(T("batch_hint_gain_adj") % (e.amp_gain_new, gain_ceil))
                                e.last_amp_tweak = now
                                if self._engine: self._engine.reset()
                                threading.Thread(target=self._send_gain_tweak_bg,
                                                 args=(e, e.amp_gain_new), daemon=True).start()
                            else:
                                self._v_hint.set(T("batch_hint_gain_limit") % (gain_ceil, TARGETS[e.ptype]))
                        _tweak_cab(fallback=_tweak_gain_lastresort)

                    # CAS 3 : Ni volume ni gain ────────────────────────────
                    else:
                        _tweak_cab()

                else:
                    if not self._usb_mode:
                        self._btn_apply.config(state="normal")
                        self._v_hint.set(T("batch_hint_no_usb") % delta)
        else:
            self._v_delta.set("   ---")
            self._btn_apply.config(state="disabled")


    def _send_gain_tweak_bg(self, e, new_gain_val):
        """Envoie le tweak de gain AMP en arrière-plan (fallback si pas de volume)."""
        try:
            rec0 = e.data.find(REC_MAGIC)
            if rec0 < 0: rec0 = 72
            blk = rec0 + e.amp_idx * 72
            struct.pack_into("<f", e.data, blk + 12 + e.amp_gain_param_idx * 4, float(new_gain_val))
            struct.pack_into(">H", e.data, CS_OFFSET, _checksum(e.data))
            if self._usb_dev:
                self._usb_dev.send_param_update(
                    e.amp_idx, e.amp_gain_param_idx, float(new_gain_val),
                    prst_data=e.data, rec0=rec0)
        except Exception as ex:
            print("Erreur tweak gain bg:", ex)

    def _send_cab_tweak_bg(self, e, new_cab_val):
        """Envoie le tweak de volume CAB en arrière-plan (fallback tertiaire)."""
        try:
            rec0 = e.data.find(REC_MAGIC)
            if rec0 < 0: rec0 = 72
            blk = rec0 + e.cab_idx * 72
            struct.pack_into("<f", e.data, blk + 12 + e.cab_vol_param_idx * 4, float(new_cab_val))
            struct.pack_into(">H", e.data, CS_OFFSET, _checksum(e.data))
            if self._usb_dev:
                self._usb_dev.send_param_update(
                    e.cab_idx, e.cab_vol_param_idx, float(new_cab_val),
                    prst_data=e.data, rec0=rec0)
        except Exception as ex:
            print("Erreur tweak CAB bg:", ex)
    

    def _stop_engine(self):

        if self._engine:

            try:

                self._engine.stop()

            except Exception:

                pass

            self._engine = None

        if self._midi:

            try:

                self._midi.close()

            except Exception:

                pass

            self._midi = None

        if self._usb_dev:

            try:

                self._usb_dev.disconnect()

            except Exception:

                pass

            self._usb_dev  = None

            self._usb_mode = False

            self._v_usb_status.set("")

            

    def _send_amp_tweak_bg(self, e, new_amp_val):

        """Envoie le tweak d'ampli en arrière-plan via param_update (instantané, sans couper l'audio)."""

        # 💡 On ne touche plus à self._usb_busy ici pour que les mesures restent actives en direct live !

        try:

            rec0 = e.data.find(REC_MAGIC)

            if rec0 < 0: 

                rec0 = 72

            

            blk = rec0 + e.amp_idx * 72

            struct.pack_into("<f", e.data, blk + 12 + e.amp_param_idx * 4, float(new_amp_val))

            struct.pack_into(">H", e.data, CS_OFFSET, _checksum(e.data))

            

            if self._usb_dev:

                self._usb_dev.send_param_update(

                    e.amp_idx, e.amp_param_idx, float(new_amp_val),

                    prst_data=e.data, rec0=rec0

                )

        except Exception as ex:

            print("Erreur tweak ampli bg:", ex)

    def _send_patch_tweak_bg(self, e, new_patch_val):
        """Envoie le tweak de patch volume en arrière-plan via SysEx (instantané)."""
        try:
            # 1. Mise à jour discrète du binaire en mémoire pour la future sauvegarde
            e.data[OFF_PATCH_VOL] = int(new_patch_val)
            struct.pack_into(">H", e.data, CS_OFFSET, _checksum(e.data))
            
            # 2. Push matériel sans coupure audio
            if self._usb_dev:
                self._usb_dev.send_patch_vol_update(int(new_patch_val))
        except Exception as ex:
            print("Erreur tweak patch bg:", ex)        

    def _restart_audio_engine(self):

        """Relance proprement le flux audio sounddevice avec sécurité de réessai."""

        try:

            if self._engine:

                try:

                    self._engine.stop()

                except Exception:

                    pass

                self._engine = None

            

            audio_sel = self._cb_audio.current()

            if 0 <= audio_sel < len(self._audio_devs):

                audio_idx = self._audio_devs[audio_sel][0]

                self._engine = LUFSEngine(callback=self._on_lufs)

                self._engine.start(device=audio_idx)

                self._status(T("batch_audio_active") % (self._cur_idx+1,))

        except Exception as e:

            self._status(T("batch_audio_wait"))

            self.after(1000, self._restart_audio_engine)



    def _status(self, msg: str):

        self._v_status.set(msg)



    def _on_close(self):

        self._stop_engine()

        self.destroy() 

