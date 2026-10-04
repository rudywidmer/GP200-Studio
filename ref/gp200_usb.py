# gp200_usb.py — Protocole USB MIDI Valeton GP-200
# Reverse-engineered le 25/07/2026 — capture USBPcap + analyse byte-for-byte
#
# PROTOCOLE VALIDÉ À 100% sur 3 presets (42-A, 42-B, 42-C)
#
# RÉSUMÉ DU PROTOCOLE :
#   - Transport : USB MIDI classe (endpoint Bulk 0x03/0x83) — mido/rtmidi suffisent
#   - Encoding  : nibble (chaque byte = 2 bytes SysEx, nibble haut en premier)
#   - Chunks    : 7 messages SysEx, 183 bytes/chunk (dernier chunk variable)
#   - Handshake : 1 SysEx avant chaque preset, contient le numéro de slot
#   - Total     : 1184 bytes de payload device (≠ .prst 1224 bytes)
#
# STRUCTURE SYSEX PAR CHUNK :
#   F0 21 25 7E 47 50 2D 32  = ID NUX GP-200
#   12 20 09                 = commande write preset
#   LL HH                    = offset 14-bit MIDI (LL = offset & 0x7F, HH = offset >> 7)
#   [nibble_data]            = données nibble-encodées (366 bytes = 183 decoded, sauf dernier)
#   F7
#
# MAPPING .prst → PAYLOAD DEVICE (1184 bytes) :
#   [0:36]    = header device construit (slot PC répété, quelques constantes, prst[56])
#   [36:1184] = prst[68:1216] avec byte[36+76]=byte[112] remplacé par dest_pc
#
# UTILISATION :
#   gp = GP200USB()
#   if gp.connect():
#       prst_data = open("mon_preset.prst", "rb").read()
#       gp.write_preset(slot=5, letter='A', prst_data=prst_data)
#       gp.select_preset(slot=5, letter='A')  # slots 1-64 (Bank Select auto)
#       gp.disconnect()

import time
import struct

# ─── Constantes protocole ────────────────────────────────────────────────────

SYSEX_NUX_ID   = bytes([0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32])  # "!%~GP-2"
SYSEX_CMD_HDR  = bytes([0xF0]) + SYSEX_NUX_ID + bytes([0x12, 0x20, 0x09])  # 11 bytes
SYSEX_HS_CMD   = bytes([0xF0]) + SYSEX_NUX_ID + bytes([0x12, 0x08])        # handshake

CHUNK_SIZE        = 183    # bytes par chunk (payload décodé)
DEVICE_PAYLOAD    = 1184   # taille totale payload device
DEV_HDR_SIZE      = 36     # taille du header device
PRST_HDR_OFFSET   = 68     # début des données utiles dans le .prst
PRST_DATA_END     = 1216   # fin des données utiles dans le .prst
PRST_PC_OFFSET    = 76     # offset du slot_pc dans la section de données (prst[144])

GP200_VID         = 0x84EF
GP200_PID         = 0x002A
GP200_MIDI_NAME   = "GP-200"   # nom dans la liste des ports MIDI

MIDI_CHANNEL      = 0          # canal MIDI (0 = canal 1)
PC_MAX_MIDI       = 127        # limite MIDI standard (slots 01-A à 32-D)
SLOT_MAX          = 64         # 64 banks x 4 = 256 patchs (PC 0-255)
SLOT_MAX_VERIFIED = 50         # selection verifiee sur materiel jusqu'a 50-D (PC 199)

# ─── Utilitaires protocole ────────────────────────────────────────────────────

def slot_to_pc(slot: int, letter) -> int:
    """Calcule le numéro PC (0-based) pour un slot GP-200.

    Args:
        slot   : numéro de bank 1-64
        letter : 'A'/'B'/'C'/'D' ou entier 0/1/2/3

    Returns:
        pc : entier 0-255 (> 127 = atteint via Bank Select CC0=1, voir
             select_preset ; 51-A..64-D = PC 200-255 non verifie)
    """
    if isinstance(letter, str):
        letter = ord(letter.upper()) - ord('A')
    if not (1 <= slot <= SLOT_MAX):
        raise ValueError(f"slot doit être 1-{SLOT_MAX}, reçu {slot}")
    if not (0 <= letter <= 3):
        raise ValueError(f"letter doit être 0-3 ou A-D, reçu {letter}")
    return (slot - 1) * 4 + letter


def nibble_encode(data: bytes) -> bytes:
    """Encode bytes → paires nibbles SysEx (nibble haut en premier).
    Chaque byte b → (b>>4)&0x0F, b&0x0F (tous dans [0x00..0x0F])
    """
    result = bytearray()
    for b in data:
        result.append((b >> 4) & 0x0F)
        result.append(b & 0x0F)
    return bytes(result)


def build_device_header(dest_pc: int, prst: bytes) -> bytes:
    """Construit le header device 36 bytes.

    Contient le slot de destination répété (4×) et quelques constantes.
    Byte[24] = prst[56] (valeur issue du header .prst).

    Structure validée byte-for-byte sur capture USBPcap 25/07/2026.
    """
    h = bytearray(36)
    # Bloc 1 (bytes 0-7)
    h[2]  = 0x04
    h[4]  = 0x01
    h[6]  = dest_pc   # slot PC × 1
    # Bloc 2 (bytes 8-15)
    h[8]  = 0x01
    h[10] = 0x04
    h[12] = dest_pc   # slot PC × 2
    h[14] = dest_pc   # slot PC × 3
    # Bloc 3 (bytes 16-23)
    h[16] = 0x02
    h[18] = 0x58      # constante (88)
    h[20] = dest_pc   # slot PC × 4
    h[22] = 0x78      # constante (120)
    # Bloc 4 (bytes 24-35)
    h[24] = prst[56]  # byte issu du header .prst
    h[28] = 0x05      # constante
    return bytes(h)


def prst_to_device_payload(prst: bytes, dest_pc: int) -> bytes:
    """Convertit un .prst (1224 bytes) en payload device (1184 bytes).

    Mapping :
      payload[0:36]    = header device (construit)
      payload[36:1184] = prst[68:1216] avec payload[112] = dest_pc

    Args:
        prst     : contenu brut du fichier .prst (1224 bytes)
        dest_pc  : numéro de slot destination (0-199, depuis slot_to_pc())

    Returns:
        payload de 1184 bytes prêt à être nibble-encodé et envoyé
    """
    if len(prst) != 1224:
        raise ValueError(f".prst doit faire 1224 bytes, reçu {len(prst)}")

    header = build_device_header(dest_pc, prst)
    body   = bytearray(prst[PRST_HDR_OFFSET:PRST_DATA_END])
    body[PRST_PC_OFFSET] = dest_pc   # écrase slot d'origine par destination
    return header + bytes(body)


def build_sysex_chunks(prst: bytes, dest_pc: int) -> list[bytes]:
    """Génère les 7 messages SysEx pour écrire un preset sur le GP-200.

    Args:
        prst    : contenu .prst (1224 bytes)
        dest_pc : slot destination (slot_to_pc())

    Returns:
        liste de 7 SysEx bytes-objects (6 × 380 bytes + 1 × 186 bytes)
    """
    payload  = prst_to_device_payload(prst, dest_pc)
    messages = []
    offset   = 0

    while offset < len(payload):
        chunk = payload[offset : offset + CHUNK_SIZE]
        lo    = offset & 0x7F
        hi    = offset >> 7
        msg   = SYSEX_CMD_HDR + bytes([lo, hi]) + nibble_encode(chunk) + bytes([0xF7])
        messages.append(msg)
        offset += len(chunk)

    return messages


def build_handshake_sysex(dest_pc: int) -> bytes:
    """Construit le SysEx de handshake envoyé avant chaque preset (30 bytes).

    Le slot est encodé en nibbles aux positions 25-26.
    """
    pc_hi = (dest_pc >> 4) & 0x0F
    pc_lo =  dest_pc       & 0x0F
    return bytes([
        0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
        0x12, 0x08, 0x00, 0x00, 0x00, 0x00, 0x08, 0x01,
        0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, pc_hi, pc_lo, 0x00, 0x00, 0xF7
    ])


# ─── Classe principale GP200USB ───────────────────────────────────────────────

class GP200USB:
    """Interface USB MIDI vers le Valeton GP-200.

    Utilise mido + python-rtmidi (le device apparaît en MIDI natif,
    pas besoin de Zadig ni de pyusb).

    Usage:
        gp = GP200USB()
        if gp.connect():
            gp.write_preset(slot=5, letter='A', prst_data=data)
            gp.select_preset(slot=5, letter='A')
            gp.disconnect()

        # ou en context manager :
        with GP200USB() as gp:
            gp.write_preset(...)
    """

    def __init__(self, port_name_hint: str = GP200_MIDI_NAME, verbose: bool = True):
        self.port_name_hint = port_name_hint
        self.verbose        = verbose
        self._outport       = None
        self._inport        = None
        self.connected      = False

    # ── Connexion ──────────────────────────────────────────────────────────────

    def connect(self) -> bool:
        """Ouvre le port MIDI du GP-200.

        Tente mido d'abord, puis fallback WinMM ctypes (Python 3.14, zéro dépendance).

        Returns:
            True si connexion réussie, False sinon.
        """
        # L'entree MIDI est exclusive : liberer l'ecoute pedalier (ACK handshake).
        # Drapeau PAR INSTANCE (WeakSet) : si la connexion echoue ou si l'objet
        # disparait sans disconnect(), l'ecoute se rouvre toute seule.
        _dev_busy(self, True)
        ok = False
        try:
            ok = self._connect_impl()
        finally:
            if not ok:
                _dev_busy(self, False)
        return ok

    def _connect_impl(self) -> bool:
        # ── Essai mido ──────────────────────────────────────────────────────
        try:
            import mido
            out_names = mido.get_output_names()
            in_names  = mido.get_input_names()
            out_port  = next((n for n in out_names if self.port_name_hint in n), None)
            in_port   = next((n for n in in_names  if self.port_name_hint in n), None)
            if out_port:
                self._outport  = mido.open_output(out_port)
                self._inport   = mido.open_input(in_port) if in_port else None
                self._backend  = "mido"
                self.connected = True
                self._log(f"✅ Connecté (mido) : {out_port}")
                return True
        except ImportError:
            self._log("mido absent → fallback WinMM ctypes")
        except Exception as e:
            self._log(f"mido erreur ({e}) → fallback WinMM ctypes")

        # ── Fallback WinMM ctypes ────────────────────────────────────────────
        return self._connect_winmm()

    def _connect_winmm(self) -> bool:
        """Connexion via WinMM ctypes — zéro dépendance, Python 3.14 compatible."""
        import sys
        if sys.platform != "win32":
            self._log("❌ WinMM : Windows uniquement")
            return False

        import ctypes
        import ctypes.wintypes

        winmm = ctypes.windll.winmm

        class _MIDIOUTCAPS(ctypes.Structure):
            _fields_ = [
                ("wMid",           ctypes.c_ushort),
                ("wPid",           ctypes.c_ushort),
                ("vDriverVersion", ctypes.c_uint),
                ("szPname",        ctypes.c_wchar * 32),
                ("wTechnology",    ctypes.c_ushort),
                ("wVoices",        ctypes.c_ushort),
                ("wNotes",         ctypes.c_ushort),
                ("wChannelMask",   ctypes.c_ushort),
                ("dwSupport",      ctypes.c_ulong),
            ]

        num  = winmm.midiOutGetNumDevs()
        caps = _MIDIOUTCAPS()
        port_idx = -1
        for i in range(num):
            winmm.midiOutGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
            if self.port_name_hint in caps.szPname:
                port_idx = i
                break

        if port_idx < 0:
            self._log(f"❌ WinMM : port '{self.port_name_hint}' introuvable")
            return False

        handle = ctypes.wintypes.HANDLE()
        if winmm.midiOutOpen(ctypes.byref(handle), port_idx, 0, 0, 0) != 0:
            self._log("❌ WinMM : impossible d'ouvrir le port")
            return False

        self._winmm        = winmm
        self._winmm_handle = handle
        self._backend      = "winmm"
        self.connected     = True
        self._log(f"✅ Connecté (WinMM) : port [{port_idx}] {caps.szPname}")
        return True

    def disconnect(self):
        """Ferme le port MIDI (mido ou WinMM)."""
        if getattr(self, "_backend", None) == "mido":
            if self._outport:
                self._outport.close()
                self._outport = None
            if self._inport:
                self._inport.close()
                self._inport = None
        elif getattr(self, "_backend", None) == "winmm":
            if getattr(self, "_winmm_handle", None):
                self._winmm.midiOutClose(self._winmm_handle)
                self._winmm_handle = None
        self.connected = False
        self._log("Port MIDI fermé.")
        _dev_busy(self, False)

    # ── Écriture preset ────────────────────────────────────────────────────────

    def write_preset(self, slot: int, letter, prst_data: bytes,
                     progress_cb=None,
                     inter_chunk_delay: float = 0.01,
                     handshake_delay:   float = 0.15) -> bool:
        """Écrit un preset .prst sur le GP-200 via USB MIDI SysEx.

        Args:
            slot              : bank 1-50
            letter            : 'A'/'B'/'C'/'D' ou 0/1/2/3
            prst_data         : contenu brut du .prst (1224 bytes)
            progress_cb       : callable(step, total, label) appelé à chaque étape
                                step=0 = handshake, step=1..N = chunks, step=N+1 = done
            inter_chunk_delay : délai entre les chunks
            handshake_delay   : conservé pour compatibilité (non utilisé)

        Returns:
            True si envoi complet, False si erreur
        """
        if not self.connected:
            self._log("❌ Non connecté. Appelez connect() d'abord.")
            return False

        dest_pc    = slot_to_pc(slot, letter)
        letter_str = ('ABCD')[dest_pc % 4] if isinstance(letter, int) else letter.upper()
        self._log(f"\n── Write preset → slot {slot:02d}-{letter_str} (PC={dest_pc}) ──")

        chunks = build_sysex_chunks(prst_data, dest_pc)
        total  = len(chunks)   # 7 chunks

        if progress_cb:
            progress_cb(0, total, "handshake")

        # ── Handshake avec vérification ACK device ────────────────────────
        # Le Valeton répond soit ACK SysEx 40b (prêt) soit bare F7 (pas prêt).
        # On boucle jusqu'à obtenir l'ACK — comme le double-clic manuel.
        # Bornée à 5 tentatives max (500ms max) — jamais de boucle infinie.
        #
        # Ouvrir un port MIDI IN temporaire si nécessaire (WinMM n'en a pas).
        _tmp_inport = None
        in_port = self._inport
        if in_port is None:
            try:
                import mido
                in_names = mido.get_input_names()
                in_name  = next((n for n in in_names
                                 if self.port_name_hint in n), None)
                if in_name:
                    _tmp_inport = mido.open_input(in_name)
                    in_port = _tmp_inport
                    self._log(f"  [HS] Port IN temporaire ouvert : {in_name}")
            except Exception as e:
                self._log(f"  [HS] Port IN indisponible ({e}) — mode aveugle")

        hs_ok = False
        try:
            for attempt in range(5):
                hs = build_handshake_sysex(dest_pc)
                self._send_sysex(hs)
                self._log(f"  [HS] Handshake #{attempt+1}/5")
                time.sleep(0.10)

                if in_port is not None:
                    for msg in in_port.iter_pending():
                        if (getattr(msg, 'type', '') == 'sysex'
                                and len(getattr(msg, 'data', ())) >= 20):
                            self._log(f"  [HS] ✅ ACK device (tentative #{attempt+1})")
                            hs_ok = True
                            break
                else:
                    # Aucun MIDI IN → 2 envois minimum puis on tente
                    if attempt >= 1:
                        hs_ok = True

                if hs_ok:
                    break

        finally:
            if _tmp_inport is not None:
                try:
                    _tmp_inport.close()
                except Exception:
                    pass

        if not hs_ok:
            self._log("  [HS] ⚠️ Pas d'ACK après 5 tentatives — envoi quand même")

        time.sleep(0.05)  # stabilisation finale avant chunks

        # ── Chunks de données ─────────────────────────────────────────────
        # timeBeginPeriod(1) : résolution timer Windows → 1ms
        # Sans ça, sleep(10ms) peut glisser à 100ms+ (jitter scheduler OS).
        _tmr = False
        try:
            import ctypes
            ctypes.windll.winmm.timeBeginPeriod(1)
            _tmr = True
        except Exception:
            pass
        try:
            for i, chunk in enumerate(chunks):
                if progress_cb:
                    progress_cb(i + 1, total, f"chunk {i+1}/{total}")
                self._send_sysex(chunk)
                self._log(f"  [{i+1}/{total}] Chunk {len(chunk)} bytes envoyé")
                if i < total - 1 and inter_chunk_delay > 0:
                    time.sleep(inter_chunk_delay)
        finally:
            if _tmr:
                ctypes.windll.winmm.timeEndPeriod(1)

        # ── Fin ───────────────────────────────────────────────────────────
        if getattr(self, "_backend", None) == "mido":
            self._flush_input(timeout=0.1)

        if progress_cb:
            progress_cb(total + 1, total, "done")

        self._log(f"✅ Preset écrit sur slot {slot:02d}-{letter_str}")
        return True


    def send_effect_change(self, module_idx: int, mid: int, cat: int) -> bool:
        """Change l'effet d'un slot et ouvre son contexte d'édition (54 bytes).

        À appeler AVANT tout push_preset lors d'un changement de modèle.
        Le device a besoin de cet appel pour "ouvrir" le bloc (Bug #80).
        Attendre ~400ms après l'envoi avant push_preset / send_param_update.

        Args:
            module_idx : 0=PRE … 10=VOL
            mid        : model_id (0-255)
            cat        : catégorie (0-15)
        """
        if not self.connected:
            return False
        try:
            self._send_sysex(build_effect_change_msg(module_idx, mid, cat))
            return True
        except Exception:
            return False


    def send_bypass(self, module_idx: int, active: bool) -> bool:
        """Active ou met en bypass un slot de la chaîne (30 bytes).

        Protocole decouvert par reverse engineering USB — latence < 10ms.
        module_idx : 0=PRE 1=WAH 2=DST 3=AMP 4=NR 5=CAB 6=EQ 7=MOD 8=DLY 9=RVB 10=VOL
        active     : True=actif, False=bypass
        """
        if not self.connected:
            return False
        try:
            self._send_sysex(build_bypass_msg(module_idx, active))
            return True
        except Exception:
            return False

    def send_param_update(self, module_idx: int, param_idx: int,
                           value: float,
                           prst_data: bytes = None,
                           rec0: int = None) -> bool:
        """Met à jour un paramètre en temps réel (62 bytes, < 20ms).

        Args:
            module_idx : 0=PRE … 10=VOL
            param_idx  : index du paramètre (= slot gp200lib)
            value      : nouvelle valeur float
            prst_data  : bytes du .prst courant (recommandé pour b8 correct)
            rec0       : offset REC_MAGIC (calculé si None)
        """
        if not self.connected:
            return False
        try:
            msg = build_param_update_msg(module_idx, param_idx, value,
                                          prst_data=prst_data, rec0=rec0)
            self._send_sysex(msg)
            return True
        except Exception:
            return False
            
    def send_patch_vol_update(self, patch_vol: int) -> bool:
        """
        Modifie le patch volume du preset actif en temps réel (cmd=0x12/0x10).
        Pas de handshake requis. Le device répond avec cmd=0x08 (écho du volume).
        """
        if not self.connected:
            return False
        try:
            vol = max(0, min(100, int(patch_vol)))
            hi  = (vol >> 4) & 0x0F
            lo  = vol & 0x0F
            msg = bytes([
                0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
                0x12, 0x10,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x00, 0x00,
                0x06, 0x00, 0x00, 0x00,
                0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                hi, lo,
                0x00, 0x00,
                0xF7,
            ])
            self._send_sysex(msg)
            return True
        except Exception:
            return False

    def _send_short(self, status: int, d1: int, d2: int = 0):
        """Envoie un message MIDI court (CC / PC) sur le port de sortie."""
        if getattr(self, "_backend", None) == "winmm":
            msg = (status & 0xFF) | ((d1 & 0x7F) << 8) | ((d2 & 0x7F) << 16)
            self._winmm.midiOutShortMsg(self._winmm_handle, msg)
        else:
            import mido
            ch = status & 0x0F
            if (status & 0xF0) == 0xC0:
                self._outport.send(mido.Message('program_change', channel=ch, program=d1))
            else:
                self._outport.send(mido.Message('control_change', channel=ch,
                                                control=d1, value=d2))

    def select_preset(self, slot: int, letter, channel: int = MIDI_CHANNEL) -> bool:
        """Active un preset (slots 01-A a 64-D).

        PC 0-127 (01-A..32-D)  : Bank Select CC0=0 + Program Change PC.
        PC 128-255 (33-A..64-D): Bank Select CC0=1 + Program Change PC-128.
        CC0=0 puis PC et CC0=1 puis PC valides sur materiel (CC32 ignore) ;
        PC 200-255 (51-A..64-D) non encore verifie (cf. gp200_explore.py E).
        """
        if not self.connected:
            self._log("❌ Non connecté.")
            return False

        dest_pc = slot_to_pc(slot, letter)
        letter_str = ('ABCD')[dest_pc % 4]
        bank, prog = (1, dest_pc - 128) if dest_pc > PC_MAX_MIDI else (0, dest_pc)

        self._send_short(0xB0 | (channel & 0x0F), 0, bank)
        self._send_short(0xC0 | (channel & 0x0F), prog)

        self._log(f"🎸 Bank {bank} + Program Change {prog} (PC={dest_pc}) "
                  f"→ slot {slot:02d}-{letter_str}")
        return True

    # ── Workflow complet : write + select ──────────────────────────────────────

    def push_preset(self, slot: int, letter, prst_data: bytes,
                    activate: bool = True, channel: int = MIDI_CHANNEL,
                    delay_after_write: float = 0.3) -> bool:
        """Écrit un preset et l'active (si slot <= 32).

        Args:
            slot              : bank 1-50
            letter            : 'A'/'B'/'C'/'D' ou 0/1/2/3
            prst_data         : contenu .prst (1224 bytes)
            activate          : envoyer le Program Change après l'écriture
            channel           : canal MIDI pour le PC
            delay_after_write : délai avant l'activation (laisse le device digérer)

        Returns:
            True si tout s'est bien passé
        """
        ok = self.write_preset(slot, letter, prst_data)
        if not ok:
            return False

        if activate:
            time.sleep(delay_after_write)
            self.select_preset(slot, letter, channel)

        return True

    # ── Utilitaires internes ───────────────────────────────────────────────────

    def _send_sysex(self, raw: bytes):
        """Envoie un SysEx brut via mido ou WinMM selon le backend actif."""
        if getattr(self, "_backend", None) == "mido":
            import mido
            self._outport.send(mido.Message('sysex', data=tuple(raw[1:-1])))
        elif getattr(self, "_backend", None) == "winmm":
            self._send_sysex_winmm(raw)

    def _send_sysex_winmm(self, raw: bytes):
        """Envoie un SysEx via WinMM midiOutLongMsg."""
        import ctypes
        import time

        class _MIDIHDR(ctypes.Structure):
            _fields_ = [
                ("lpData",          ctypes.c_char_p),
                ("dwBufferLength",  ctypes.c_ulong),
                ("dwBytesRecorded", ctypes.c_ulong),
                ("dwUser",          ctypes.c_size_t),   # DWORD_PTR, 8b sur 64-bit
                ("dwFlags",         ctypes.c_ulong),
                ("lpNext",          ctypes.c_void_p),
                ("reserved",        ctypes.c_size_t),   # DWORD_PTR, 8b sur 64-bit
                ("dwOffset",        ctypes.c_ulong),
                ("dwReserved",      ctypes.c_size_t * 8),  # DWORD_PTR[8]
            ]

        buf = ctypes.create_string_buffer(bytes(raw), len(raw))
        hdr = _MIDIHDR()
        hdr.lpData          = ctypes.cast(buf, ctypes.c_char_p)
        hdr.dwBufferLength  = len(raw)
        hdr.dwBytesRecorded = len(raw)
        hdr.dwFlags         = 0

        w = self._winmm
        if w.midiOutPrepareHeader(self._winmm_handle, ctypes.byref(hdr), ctypes.sizeof(_MIDIHDR)) != 0:
            self._log("❌ midiOutPrepareHeader failed")
            return
        w.midiOutLongMsg(self._winmm_handle, ctypes.byref(hdr), ctypes.sizeof(_MIDIHDR))
        # Attendre MHDR_DONE
        MHDR_DONE = 0x00000001
        deadline  = time.time() + 2.0
        while not (hdr.dwFlags & MHDR_DONE) and time.time() < deadline:
            time.sleep(0.005)
        # ← AJOUTER ICI :
        time.sleep(0.020)  # Garantir que l'ACK USB device est reçu avant de rendre la main.
                           # MHDR_DONE peut firer AVANT l'ACK USB (~16ms worst case).
                           # Sans ce délai : chunk suivant envoyé trop tôt → split → bare F7 → KO.
        w.midiOutUnprepareHeader(self._winmm_handle, ctypes.byref(hdr), ctypes.sizeof(_MIDIHDR))

    def _flush_input(self, timeout: float = 0.2):
        """Draine le port MIDI IN (mido uniquement, no-op en WinMM)."""
        if getattr(self, "_backend", None) != "mido" or self._inport is None:
            import time
            time.sleep(timeout)
            return
        import time
        deadline = time.time() + timeout
        while time.time() < deadline:
            for _ in self._inport.iter_pending():
                pass
            time.sleep(0.01)

    def _log(self, msg: str):
        if self.verbose:
            print(msg)

    # ── Probe (détection sans mido) ───────────────────────────────────────────

    @staticmethod
    def probe_winmm() -> bool:
        """Vérifie si le GP-200 MIDI est réellement accessible.

        Tente d'ouvrir le port (pas juste le lister) — Windows garde les noms
        de ports enregistrés même après débranchement, ce qui rendrait une
        simple liste non fiable.

        Returns:
            True si le port s'ouvre réellement (device physiquement connecté).
        """
        import sys
        if sys.platform != "win32":
            return False
        import ctypes, ctypes.wintypes

        winmm = ctypes.windll.winmm

        class _MIDIOUTCAPS(ctypes.Structure):
            _fields_ = [
                ("wMid",           ctypes.c_ushort),
                ("wPid",           ctypes.c_ushort),
                ("vDriverVersion", ctypes.c_uint),
                ("szPname",        ctypes.c_wchar * 32),
                ("wTechnology",    ctypes.c_ushort),
                ("wVoices",        ctypes.c_ushort),
                ("wNotes",         ctypes.c_ushort),
                ("wChannelMask",   ctypes.c_ushort),
                ("dwSupport",      ctypes.c_ulong),
            ]

        num  = winmm.midiOutGetNumDevs()
        caps = _MIDIOUTCAPS()
        port_idx = -1
        for i in range(num):
            winmm.midiOutGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
            if "GP-200" in caps.szPname:
                port_idx = i
                break

        if port_idx < 0:
            return False

        # Essayer d'ouvrir le port — si ça échoue = device pas vraiment connecté
        handle = ctypes.wintypes.HANDLE()
        ret = winmm.midiOutOpen(ctypes.byref(handle), port_idx, 0, 0, 0)
        if ret != 0:
            return False
        winmm.midiOutClose(handle)
        return True

    @staticmethod
    def probe_audio() -> bool:
        """Vérifie si l'interface audio GP-200 est disponible.

        Force le refresh de PortAudio pour détecter les devices branchés à chaud
        (sounddevice met en cache la liste des devices à l'initialisation).

        Returns:
            True si 'GP-200' apparaît dans les devices d'entrée audio.
        """
        try:
            import sounddevice as sd
            for d in sd.query_devices():
                if "GP-200" in d.get("name", "") and d.get("max_input_channels", 0) > 0:
                    return True
            return False
        except Exception:
            return False

    @staticmethod
    def probe_full() -> tuple:
        """Probe complet : MIDI/SysEx + Audio.

        Returns:
            (midi_ok: bool, audio_ok: bool)
        """
        midi_ok  = GP200USB.probe_winmm()
        audio_ok = GP200USB.probe_audio()
        return midi_ok, audio_ok

    # ── Context manager ────────────────────────────────────────────────────────

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *_):
        self.disconnect()


# ─── Ecoute pedalier -> PC ────────────────────────────────────────────────────
#
# Protocole VALIDE par 4 captures (gp200_sniff x2, gp200_explore ABCD + D,
# 03/10/2026). Le GP-200 notifie le PC en SysEx NUX, cmd 12/08, 30 octets,
# [18] = 04 :
#
#  MODULE ON/OFF   [13..14] = 01 05 | [22] = module 0-10 | [24] = 01 actif / 00 bypass
#     queue [25..28] = 03 0D 08 00 : bascule au footswitch (CTRL assigne)
#     queue [25..28] = 00 00 00 00 : appui LONG sur le bouton de la facade
#     == build_bypass_msg(). Le GP-200 renvoie aussi en ECHO chaque bypass que
#     le PC lui envoie (22/22) : l'etat recu est donc l'etat confirme.
#     Pas de bouton VOL en facade : VOL ne se bascule que par un CTRL / le PC.
#
#  CHANGEMENT DE PATCH   [13..15] = 00 08 01 | numero en nibbles [25]<<4 | [26]
#     01-A=00 00 | 01-B=00 01 | 05-A=01 00 | 32-D=07 0F | 33-A=08 00 ...
#     17/17 mesures exactes (0-127 par PC ; 128+ via Bank Select CC0=1 + PC,
#     CC32 est ignore). Fonctionne aussi pour les patchs choisis au pied.
#     Bank+/Bank- (FS1/FS2) n'envoient RIEN : seul le patch charge ensuite
#     est annonce, avec son numero ABSOLU. Aucun etat de module n'est envoye
#     au chargement : le contenu du patch n'est pas connu du PC.
#
#  VOLUME DU PATCH      [13..15] = 00 06 00 | valeur 0-100 en nibbles [25]<<4 | [26]
#     Le GP-200 renvoie cet echo quand le PC envoie un 12/10 (patch volume).
#
#  Non exploites (decodes a moitie, ignores ici) :
#   - 12/08 [13..15]=01 01 01, [26]=1/0 : drapeau "patch modifie" (1 a la 1re
#     modif, 0 au rechargement ; envoye seulement sur transition).
#   - 12/0C (38 o) : etat du CTRL ([22] = CTRL-1 : 02=CTRL3, 07=CTRL8 ; [24]
#     = 01/00), emis a chaque appui FS, AVANT/AVEC le bypass du module cible.
#     L'etat du CTRL n'est PAS l'etat du module (CTRL3=1 <-> PRE off observe).
#   - 12/08 [13..15]=00 01 01, [25..26]=06 03 : FS3 appui long (Drum Play).
#   - 12/10 (46 o, GP-200 -> PC) : reglage tourne en facade. C'est un 12/18 ampute
#     de 16 octets (confirme sur la pedale, 4/10/2026 : 112 trames, 16 series, 0 discordance) :
#       [14]=05  [18]=0C  [22]=MODULE (0 PRE ... 10 VOL)  [23]=00
#       [24]=SLOT du parametre (meme numerotation que le [40] du 12/18 et que gp200lib)
#       [25..28]=residus de tampon, VARIABLES : ne rien verifier dessus
#       [29..36]=00   [37..44]=VALEUR float32 LE en nibbles (hi d'abord), valeur de l'ecran
#     Debit ~10 trames/s : des valeurs intermediaires sont sautees, seule la derniere compte.
#     Au chargement d'un patch, un 12/10 VOL slot 0 = 100.0 arrive parfois (pas systematique).
#     -> voir parse_panel_param().
#   - 12/18 (62 o, PC -> GP-200, reglage d'un parametre) : AUCUN echo (0/16).

import weakref as _weakref

_LISTENERS = []
_LISTEN_LOCK = __import__("threading").Lock()
_BUSY_DEVS = _weakref.WeakSet()      # GP200USB en cours d'usage de l'entree MIDI

_TAIL_FS    = b"\x03\x0D\x08\x00"
_TAIL_PANEL = b"\x00\x00\x00\x00"


def parse_notify(b):
    """Decode une notification du GP-200.

    -> ("bypass", module_idx, actif, source)  source = "fs" | "panel"
    -> ("patch", pc)                          pc 0-255 (01-A = 0, 33-A = 128 ; > 199 non verifie)
    -> ("patchvol", v)                        volume du patch 0-100 (echo du PC ou molette)
    -> ("param", module, slot, valeur)        reglage tourne en facade (12/10, 46 octets)
    -> None si message inconnu / non pertinent
    """
    b = bytes(b)
    if len(b) == 46:
        return parse_panel_param(b)
    if (len(b) != 30 or b[0] != 0xF0 or b[1:8] != SYSEX_NUX_ID
            or b[8:10] != b"\x12\x08" or b[18] != 0x04):
        return None
    if (b[13] == 0x01 and b[14] == 0x05 and 0 <= b[22] <= 10
            and b[24] in (0, 1) and b[25:29] in (_TAIL_FS, _TAIL_PANEL)):
        return ("bypass", b[22], b[24] == 1,
                "fs" if b[25:29] == _TAIL_FS else "panel")
    if (b[13] == 0x00 and b[14] == 0x06 and b[15] == 0x00
            and b[25] <= 0x0F and b[26] <= 0x0F
            and ((b[25] << 4) | b[26]) <= 100):
        # VOLUME DU PATCH (valide 5/5 : 40,50,60,70,50 -> 0x28,0x32,0x3C,0x46,0x32)
        return ("patchvol", (b[25] << 4) | b[26])
    if b[13] == 0x00 and b[14] == 0x08 and b[15] == 0x01 \
            and b[25] <= 0x0F and b[26] <= 0x0F:
        pc = (b[25] << 4) | b[26]
        if pc <= 255:
            return ("patch", pc)
    return None


def parse_panel_param(b):
    """Reglage tourne en facade (12/10, 46 octets) -> ("param", module, slot, valeur) ou None.

    Memes regles que parsePanelParam (JS) : [14]=05, [18]=0C, module <= 10, slot <= 14,
    8 nibbles [37..44] <= 0x0F, valeur finie. [25..28] et [29..36] ne sont JAMAIS verifies."""
    import math
    import struct
    b = bytes(b)
    if (len(b) != 46 or b[0] != 0xF0 or b[1:8] != SYSEX_NUX_ID
            or b[8:10] != b"\x12\x10" or b[14] != 0x05 or b[18] != 0x0C
            or b[22] > 10 or b[24] > 14):
        return None
    raw = bytearray(4)
    for i in range(4):
        hi, lo = b[37 + 2 * i], b[38 + 2 * i]
        if hi > 0x0F or lo > 0x0F:
            return None
        raw[i] = (hi << 4) | lo
    v = struct.unpack("<f", bytes(raw))[0]
    if not math.isfinite(v):
        return None
    return ("param", b[22], b[24], v)


def parse_bypass_notify(b):
    """-> (module_idx, actif) si b est une notification module on/off, sinon None."""
    r = parse_notify(b)
    return (r[1], r[2]) if r and r[0] == "bypass" else None


def pc_to_slot_name(pc: int) -> str:
    return "%02d-%s" % (pc // 4 + 1, "ABCD"[pc % 4])


def _any_dev_busy() -> bool:
    return any(getattr(d, "_busy", False) for d in list(_BUSY_DEVS))


def _dev_busy(dev, busy: bool):
    """Marque une connexion GP200USB comme occupant l'entree MIDI."""
    dev._busy = busy
    with _LISTEN_LOCK:
        ls = list(_LISTENERS)
    if busy:
        _BUSY_DEVS.add(dev)
        for l in ls:
            l._close()
    else:
        for l in ls:            # no-op si une autre connexion est encore active
            l._open()


class GP200Listener:
    """Ecoute l'entree MIDI du GP-200 et signale ce qui change au pied.

        lst = GP200Listener(lambda evt: ...)   # evt = tuple parse_notify(),
                                               # appele HORS thread Tk
        lst.start() ; ... ; lst.stop()

    Se met en pause automatiquement pendant toute connexion GP200USB
    (injection, live control, batch) qui a besoin du port d'entree.
    """

    NB_BUF, BUF_SZ = 16, 4096

    def __init__(self, on_event, port_name_hint: str = GP200_MIDI_NAME):
        import threading
        self._cb = on_event
        self._hint = port_name_hint
        self._lock = threading.Lock()
        self._h = None          # WinMM
        self._port = None       # mido
        self._run = False

    @property
    def active(self) -> bool:
        return self._h is not None or self._port is not None

    def start(self) -> bool:
        with _LISTEN_LOCK:
            if self not in _LISTENERS:
                _LISTENERS.append(self)
        self._run = True
        return True if _any_dev_busy() else self._open()

    def stop(self):
        self._run = False
        with _LISTEN_LOCK:
            if self in _LISTENERS:
                _LISTENERS.remove(self)
        self._close()

    def _emit(self, raw):
        r = parse_notify(raw)
        if r:
            try:
                self._cb(r)
            except Exception:
                pass

    # -- ouverture / fermeture ------------------------------------------------
    def _open(self) -> bool:
        import sys
        with self._lock:
            if not self._run or self.active or _any_dev_busy():
                return self.active
            try:
                return (self._open_winmm() if sys.platform == "win32"
                        else self._open_mido())
            except Exception:
                return False

    def _close(self):
        with self._lock:
            if self._port is not None:
                try:
                    self._port.close()
                except Exception:
                    pass
                self._port = None
            if self._h is not None:
                self._close_winmm()

    def _open_mido(self) -> bool:
        import mido
        name = next((n for n in mido.get_input_names() if self._hint in n), None)
        if not name:
            return False

        def cb(m):
            if m.type == "sysex":
                self._emit(bytes([0xF0, *m.data, 0xF7]))
        self._port = mido.open_input(name, callback=cb)
        return True

    def _open_winmm(self) -> bool:
        import ctypes
        import threading
        w = ctypes.windll.winmm

        class MIDIINCAPSW(ctypes.Structure):
            _fields_ = [("wMid", ctypes.c_ushort), ("wPid", ctypes.c_ushort),
                        ("vDriverVersion", ctypes.c_uint),
                        ("szPname", ctypes.c_wchar * 32),
                        ("dwSupport", ctypes.c_ulong)]

        class MIDIHDR(ctypes.Structure):
            _fields_ = [("lpData", ctypes.c_void_p),
                        ("dwBufferLength", ctypes.c_ulong),
                        ("dwBytesRecorded", ctypes.c_ulong),
                        ("dwUser", ctypes.c_size_t), ("dwFlags", ctypes.c_ulong),
                        ("lpNext", ctypes.c_void_p), ("reserved", ctypes.c_size_t),
                        ("dwOffset", ctypes.c_ulong),
                        ("dwReserved", ctypes.c_size_t * 8)]

        dev, caps = None, MIDIINCAPSW()
        for i in range(w.midiInGetNumDevs()):
            w.midiInGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
            if self._hint in caps.szPname:
                dev = i
                break
        if dev is None:
            return False

        MIM_LONGDATA = 0x3C4
        done, dlock = [], threading.Lock()
        PROC = ctypes.WINFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint,
                                  ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t)

        def cb(h, msg, inst, p1, p2):
            if msg != MIM_LONGDATA:
                return
            try:
                hd = ctypes.cast(p1, ctypes.POINTER(MIDIHDR)).contents
                if hd.dwBytesRecorded:
                    self._emit(ctypes.string_at(hd.lpData, hd.dwBytesRecorded))
                with dlock:
                    done.append(hd.dwUser)
            except Exception:
                pass

        proc = PROC(cb)
        h = ctypes.c_void_p()
        if w.midiInOpen(ctypes.byref(h), dev, ctypes.cast(proc, ctypes.c_void_p),
                        0, 0x30000) != 0:          # CALLBACK_FUNCTION
            return False

        bufs = [ctypes.create_string_buffer(self.BUF_SZ) for _ in range(self.NB_BUF)]
        hdrs = [MIDIHDR() for _ in range(self.NB_BUF)]
        SZ = ctypes.sizeof(MIDIHDR)

        def arm(i):
            hd = hdrs[i]
            w.midiInUnprepareHeader(h, ctypes.byref(hd), SZ)
            hd.lpData = ctypes.cast(bufs[i], ctypes.c_void_p)
            hd.dwBufferLength, hd.dwBytesRecorded = self.BUF_SZ, 0
            hd.dwFlags, hd.dwUser = 0, i
            w.midiInPrepareHeader(h, ctypes.byref(hd), SZ)
            w.midiInAddBuffer(h, ctypes.byref(hd), SZ)

        for i in range(self.NB_BUF):
            arm(i)
        w.midiInStart(h)

        stop_evt = threading.Event()

        def recycle():          # midiInAddBuffer interdit dans le callback
            while not stop_evt.wait(0.02):
                with dlock:
                    todo, done[:] = list(done), []
                for i in todo:
                    arm(i)

        th = threading.Thread(target=recycle, daemon=True)
        th.start()
        # tout garder en vie : proc/bufs/hdrs referencees par le driver
        self._w = (w, h, proc, bufs, hdrs, SZ, stop_evt, th)
        self._h = h
        return True

    def _close_winmm(self):
        w, h, proc, bufs, hdrs, SZ, stop_evt, th = self._w
        stop_evt.set()
        th.join(timeout=0.5)
        try:
            w.midiInStop(h)
            w.midiInReset(h)        # rend tous les buffers
            for hd in hdrs:
                w.midiInUnprepareHeader(h, ctypes_byref(hd), SZ)
            w.midiInClose(h)
        except Exception:
            pass
        self._h = None
        self._w = None


def ctypes_byref(x):
    import ctypes
    return ctypes.byref(x)


# ─── Keep-alive audio interface ───────────────────────────────────────────────

#: Messages capturés depuis l'éditeur Valeton au démarrage (30 et 34 bytes)
_AUDIO_INIT_1 = bytes([
    0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
    0x12, 0x08, 0x00, 0x6E, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x01, 0x00,
    0xB0, 0xB5, 0xB7, 0x5F, 0xFE, 0x7F,
])

_AUDIO_INIT_2 = bytes([
    0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
    0x12, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x01, 0x00,
    0xB0, 0xB5, 0xB7, 0x5F, 0xFE, 0x7F, 0x00, 0x00,
    0x05, 0x00,
])

#: Keep-alive : handshake standard toutes les 100ms
_AUDIO_KEEPALIVE = bytes([
    0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,
    0x12, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0xF7,
])


class AudioWakeKeepAlive:
    """
    Réveille l'interface audio USB du GP-200 et la maintient active.

    L'éditeur Valeton n'est plus nécessaire — ce thread envoie en continu
    les SysEx nécessaires pour que Windows expose l'interface audio.

    Usage :
        wake = AudioWakeKeepAlive()
        wake.start()          # démarre dans un thread background
        # ...
        wake.stop()           # à l'arrêt de l'appli

    Ou avec context manager :
        with AudioWakeKeepAlive() as wake:
            ...
    """

    KEEPALIVE_INTERVAL = 0.1   # secondes entre chaque keep-alive

    def __init__(self, verbose: bool = False):
        self._verbose  = verbose
        self._thread   = None
        self._stop_evt = None
        self._handle   = None
        self._winmm    = None
        self._running  = False
        self._paused   = False   # True = suspend sends without closing handle

    def start(self) -> bool:
        """Démarre le thread keep-alive. Retourne True si GP-200 trouvé."""
        import sys
        if sys.platform != "win32":
            return False

        import ctypes, ctypes.wintypes, threading

        winmm = ctypes.windll.winmm
        self._winmm = winmm

        # Trouver le port MIDI GP-200
        class _CAPS(ctypes.Structure):
            _fields_ = [("wMid", ctypes.c_ushort), ("wPid", ctypes.c_ushort),
                        ("ver", ctypes.c_uint), ("szPname", ctypes.c_wchar*32),
                        ("wTech", ctypes.c_ushort), ("wVoices", ctypes.c_ushort),
                        ("wNotes", ctypes.c_ushort), ("wMask", ctypes.c_ushort),
                        ("dwSupport", ctypes.c_ulong)]

        num   = winmm.midiOutGetNumDevs()
        caps  = _CAPS()
        port  = -1
        for i in range(num):
            winmm.midiOutGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
            if "GP-200" in caps.szPname:
                port = i
                break

        if port < 0:
            if self._verbose:
                print("AudioWake: port GP-200 non trouvé")
            return False

        handle = ctypes.wintypes.HANDLE()
        if winmm.midiOutOpen(ctypes.byref(handle), port, 0, 0, 0) != 0:
            if self._verbose:
                print("AudioWake: impossible d'ouvrir le port")
            return False

        self._handle   = handle
        self._stop_evt = threading.Event()
        self._thread   = threading.Thread(target=self._loop, daemon=True)
        self._running  = True
        self._thread.start()

        if self._verbose:
            print(f"AudioWake: démarré sur port [{port}]")
        return True

    def stop(self):
        """Arrête le thread keep-alive."""
        if self._stop_evt:
            self._stop_evt.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self._handle and self._winmm:
            try:
                self._winmm.midiOutClose(self._handle)
            except Exception:
                pass
        self._running = False

    def pause(self):
        """Suspend les envois keepalive SANS fermer le handle WinMM.

        Contrairement a stop(), le handle reste ouvert : l'interface audio
        GP-200 reste active. A utiliser dans les threads qui envoient leurs
        propres SysEx (write_preset dans le batch) pour eviter l'interleaving
        tout en preservant le flux audio du LUFSEngine.
        """
        self._paused = True

    def resume(self):
        """Reprend les envois keepalive et envoie un keepalive immediat.

        Le keepalive immediat reveille l'interface audio si elle s'est
        assoupie pendant la pause (timeout GP-200 > 200ms en pratique).
        """
        self._paused = False
        try:
            if self._running and self._handle and self._winmm:
                self._send(_AUDIO_KEEPALIVE)
        except Exception:
            pass

    def _loop(self):
        """Thread background : init puis keep-alive avec re-init périodique."""
        import time

        REINIT_EVERY = 5.0   # renvoyer l'init toutes les 5s
        last_init    = 0.0

        while not self._stop_evt.is_set():
            # Pause : suspendre les envois sans fermer le handle
            if self._paused:
                self._stop_evt.wait(0.05)
                continue

            now = time.time()
            if now - last_init >= REINIT_EVERY:
                # (Re-)init : réveille l'audio même si le driver a chargé tard
                self._send(_AUDIO_INIT_1)
                time.sleep(0.05)
                self._send(_AUDIO_INIT_2)
                last_init = now
                time.sleep(0.5)

            self._send(_AUDIO_KEEPALIVE)
            self._stop_evt.wait(self.KEEPALIVE_INTERVAL)

    def _send(self, data: bytes):
        """Envoie un SysEx via WinMM (sans validation données)."""
        import ctypes, time

        class _MIDIHDR(ctypes.Structure):
            _fields_ = [
                ("lpData",          ctypes.c_char_p),
                ("dwBufferLength",  ctypes.c_ulong),
                ("dwBytesRecorded", ctypes.c_ulong),
                ("dwUser",          ctypes.c_size_t),   # DWORD_PTR, 8b sur 64-bit
                ("dwFlags",         ctypes.c_ulong),
                ("lpNext",          ctypes.c_void_p),
                ("reserved",        ctypes.c_size_t),   # DWORD_PTR, 8b sur 64-bit
                ("dwOffset",        ctypes.c_ulong),
                ("dwReserved",      ctypes.c_size_t * 8),  # DWORD_PTR[8]
            ]

        MHDR_DONE = 0x00000001
        buf = ctypes.create_string_buffer(data, len(data))
        hdr = _MIDIHDR()
        hdr.lpData          = ctypes.cast(buf, ctypes.c_char_p)
        hdr.dwBufferLength  = len(data)
        hdr.dwBytesRecorded = len(data)
        hdr.dwFlags         = 0

        w = self._winmm
        if w.midiOutPrepareHeader(self._handle, ctypes.byref(hdr),
                                   ctypes.sizeof(_MIDIHDR)) != 0:
            return
        w.midiOutLongMsg(self._handle, ctypes.byref(hdr), ctypes.sizeof(_MIDIHDR))
        deadline = time.time() + 1.0
        while not (hdr.dwFlags & MHDR_DONE) and time.time() < deadline:
            time.sleep(0.003)
        w.midiOutUnprepareHeader(self._handle, ctypes.byref(hdr),
                                  ctypes.sizeof(_MIDIHDR))

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *_):
        self.stop()


# ─── Protocole Live Control ───────────────────────────────────────────────────
#
# Reverse-engineered par analyse des captures USB Wireshark (USBPcap2 + GP-200)
# Session du 2026-07-28 — 14 captures couvrant les 11 slots de la chaîne.
#
# Deux messages USB MIDI découverts :
#
#   1. BYPASS ON/OFF (30 bytes)
#      F0 21 25 7E 47 50 2D 32 12 08 00 00 00 01 05 00 00 00
#      04 00 00 00 [MODULE] 00 [STATE] 03 0D 08 00 F7
#      MODULE = index 0-10 (PRE…VOL), STATE = 01=actif / 00=bypass
#
#   2. PARAM UPDATE (62 bytes, cmd=0x18)
#      Header fixe (bytes 0-37) + MODULE[38] + 00 + PARAM[40]
#      + META[41-52] (12 bytes, constant par module×param×modèle)
#      + FLOAT_NIBBLE[53-60] (float32 nibble-encodé LE)
#      + F7
#      PARAM = slot index gp200lib (identique au param_idx USB)
#      FLOAT_NIBBLE : chaque nibble de float32 LE devient un byte (high nibble first)

# ── Table des métadonnées bytes[41-52] ──────────────────────────────────────
# Extraites par reverse engineering — 17 entrées confirmées.
# Clé : (module_idx, param_idx) — identique au slot gp200lib.

_PARAM_META = {
    # PRE (Compresseur)
    (0, 0):  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),  # Sustain
    (0, 1):  bytes([0x03,0x0C,0x00,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),  # Volume
    # WAH
    (1, 0):  bytes([0x07,0x06,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x05]),  # Range
    # DST
    (2, 0):  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x03]),  # Gain/Drive
    # AMP (6 params capturés)
    (3, 0):  bytes([0x03,0x0C,0x00,0x02,0x07,0x0B,0x00,0x00,0x00,0x00,0x00,0x07]),  # Gain
    (3, 1):  bytes([0x07,0x06,0x00,0x00,0x02,0x02,0x00,0x00,0x00,0x00,0x00,0x07]),  # Presence
    (3, 2):  bytes([0x07,0x06,0x00,0x00,0x03,0x0B,0x00,0x00,0x00,0x00,0x00,0x07]),  # Volume
    (3, 3):  bytes([0x07,0x06,0x00,0x00,0x03,0x0B,0x00,0x00,0x00,0x00,0x00,0x07]),  # Bass
    (3, 4):  bytes([0x07,0x06,0x00,0x00,0x03,0x0B,0x00,0x00,0x00,0x00,0x00,0x07]),  # Middle
    (3, 5):  bytes([0x07,0x06,0x00,0x00,0x03,0x0B,0x00,0x00,0x00,0x00,0x00,0x07]),  # Treble
    # NR
    (4, 0):  bytes([0x07,0x06,0x00,0x00,0x01,0x0B,0x00,0x00,0x00,0x00,0x00,0x00]),  # Threshold
    # CAB
    (5, 1):  bytes([0x03,0x0E,0x04,0x00,0x02,0x04,0x00,0x00,0x00,0x00,0x00,0x0A]),  # Volume
    # EQ
    (6, 0):  bytes([0x03,0x00,0x04,0x00,0x03,0x05,0x00,0x00,0x00,0x00,0x00,0x01]),  # Band 1
    # MOD
    (7, 3):  bytes([0x07,0x06,0x00,0x00,0x00,0x0F,0x00,0x00,0x00,0x00,0x00,0x04]),  # Depth
    # DLY
    (8, 0):  bytes([0x07,0x06,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x0B]),  # Mix
    # RVB
    (9, 0):  bytes([0x07,0x06,0x00,0x00,0x00,0x06,0x00,0x00,0x00,0x00,0x00,0x0C]),  # Mix
    # VOL
    (10, 0): bytes([0x07,0x06,0x00,0x00,0x00,0x03,0x00,0x00,0x00,0x00,0x00,0x06]),  # Volume
}

# Fallback par module quand (module, param) absent de la table
# Byte 11 = module routing ID extrait des captures
_MODULE_FALLBACK_META = {
    0:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),  # PRE
    1:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x05]),  # WAH
    2:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x03]),  # DST
    3:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x07]),  # AMP
    4:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),  # NR
    5:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0A]),  # CAB
    6:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01]),  # EQ
    7:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x04]),  # MOD
    8:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0B]),  # DLY
    9:  bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0C]),  # RVB
    10: bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x06]),  # VOL
}

# Header fixe bytes[10-37] du message param update (identique dans toutes les captures)
_PARAM_UPDATE_HEADER = bytes([
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,   # 10-17
    0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,   # 18-25
    0x00,0x00,0x00,0x00,                         # 26-29
    0x05,0x00,0x00,0x00,                         # 30-33
    0x0C,0x00,0x00,0x00,                         # 34-37
])


def _nibble_encode_float(value: float) -> bytes:
    """Encode un float32 en 8 nibble bytes (little-endian, high nibble first)."""
    raw = struct.pack('<f', float(value))
    nibs = bytearray(8)
    for i, b in enumerate(raw):
        nibs[i*2]   = (b >> 4) & 0x0F
        nibs[i*2+1] =  b       & 0x0F
    return bytes(nibs)


def build_effect_change_msg(block_idx: int, mid: int, cat: int) -> bytes:
    """SysEx sub=0x14 : change l'effet d'un slot et ouvre son contexte d'édition.

    OBLIGATOIRE avant tout send_param_update sur un nouveau modèle.
    Sans cet appel le device garde l'ancien algorithme (Bug #80 phash/gp200editor) :
    les param updates arrivent sur le mauvais effet et sont silencieusement ignorés.

    Format confirmé par captures USB (phash) : COMP→COMP4→AC Boost, AMP→SnapTone.
    54 bytes, raw SysEx (pas nibble-encodé).

    Args:
        block_idx : 0=PRE … 10=VOL (slotIndex fixe, pas l'ordre du signal)
        mid       : model_id (0-255)
        cat       : catégorie (0-15)  — module_type dans les captures
    """
    variant = mid & 0xFF
    return bytes([
        0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32,  # [0-7]  header NUX GP-200
        0x12, 0x14,                                          # [8-9]  CMD=SET sub=EFFECT_CHANGE
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,    # [10-17] padding
        0x04, 0x00, 0x00, 0x00,                              # [18-21] constant
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,           # [22-28] padding
        0x01, 0x06,                                          # [29-30] constant
        0x00, 0x00, 0x00,                                    # [31-33] padding
        0x08,                                                # [34]    constant
        0x00, 0x00, 0x00,                                    # [35-37] padding
        block_idx & 0x0F,                                    # [38]    block index (0-10)
        0x00, 0x00,                                          # [39-40] padding
        0x07, 0x06, 0x00, 0x02,                              # [41-44] constant
        (variant >> 4) & 0x0F,                               # [45]    variant high nibble
        variant & 0x0F,                                      # [46]    variant low nibble
        0x00, 0x00, 0x00, 0x00, 0x00,                       # [47-51] padding
        cat & 0xFF,                                          # [52]    module type (= cat)
        0xF7,                                                # [53]    EOX
    ])



def build_bypass_msg(module_idx: int, active: bool) -> bytes:
    """Construit le message USB MIDI de bypass ON/OFF (30 bytes).

    Args:
        module_idx : index du slot (0=PRE, 1=WAH, 2=DST, 3=AMP,
                                    4=NR, 5=CAB, 6=EQ, 7=MOD,
                                    8=DLY, 9=RVB, 10=VOL)
        active     : True=actif, False=bypass
    """
    return bytes([
        0xF0,0x21,0x25,0x7E,0x47,0x50,0x2D,0x32,
        0x12,0x08,0x00,0x00,0x00,0x01,0x05,0x00,
        0x00,0x00,0x04,0x00,0x00,0x00,
        module_idx & 0xFF,
        0x00,
        0x01 if active else 0x00,
        0x03,0x0D,0x08,0x00,0xF7,
    ])


def build_param_update_msg(module_idx: int, param_idx: int,
                            value: float,
                            prst_data: bytes = None,
                            rec0: int = None) -> bytes:
    """Construit le message USB MIDI de mise à jour d'un paramètre (62 bytes).

    Protocole découvert par reverse engineering USB — latence < 20ms.

    Le champ b8 (bytes 45-52) est nibble-encodé depuis prst[blk+8:blk+12],
    ce qui le rend spécifique au modèle actif dans chaque slot. Si prst_data
    est fourni, b8 est extrait dynamiquement (recommandé). Sinon, la table
    statique _PARAM_META est utilisée (fonctionne pour les modèles capturés).

    Args:
        module_idx  : index du slot (0=PRE … 10=VOL)
        param_idx   : index du paramètre (= slot gp200lib)
        value       : nouvelle valeur (float)
        prst_data   : bytes du .prst courant pour extraction b8 dynamique
        rec0        : offset REC_MAGIC dans prst_data (calculé si None)
    """
    # ── Type meta (bytes 41-44) — 3 valeurs selon le type de slot ──────────
    if module_idx == 5:    # CAB
        type_meta = bytes([0x03, 0x0E, 0x04, 0x00])
    elif module_idx == 6:  # EQ
        type_meta = bytes([0x03, 0x00, 0x04, 0x00])
    else:
        type_meta = bytes([0x07, 0x06, 0x00, 0x00])

    # ── b8 (bytes 45-52) — extrait dynamiquement ou depuis la table ────────
    if prst_data is not None:
        # Calcul dynamique : prst[blk+8:blk+12] nibble-encodé
        if rec0 is None:
            _REC_MAGIC = b'\x14\x00\x44\x00'
            rec0 = prst_data.find(_REC_MAGIC)
        blk  = rec0 + module_idx * 72  # RECORD_SIZE = 72
        b812 = prst_data[blk+8:blk+12] if len(prst_data) > blk+12 else b'\x00\x00\x00\x00'
        nibs_b8 = bytearray(8)
        for i, b in enumerate(b812):
            nibs_b8[i*2]   = (b >> 4) & 0x0F
            nibs_b8[i*2+1] =  b & 0x0F
        b8_bytes = bytes(nibs_b8)
    else:
        # Fallback table statique (modèles capturés lors du RE)
        meta_full = _PARAM_META.get(
            (module_idx, param_idx),
            _MODULE_FALLBACK_META.get(module_idx,
                bytes([0x07,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]))
        )
        type_meta = meta_full[:4]  # bytes 41-44 depuis la table
        b8_bytes  = meta_full[4:]  # bytes 45-52 depuis la table

    nibs_val = _nibble_encode_float(value)

    msg = bytearray()
    msg += b'\xF0\x21\x25\x7E\x47\x50\x2D\x32\x12\x18'  # bytes 0-9
    msg += _PARAM_UPDATE_HEADER                             # bytes 10-37
    msg.append(module_idx & 0xFF)                          # byte 38
    msg.append(0x00)                                       # byte 39
    msg.append(param_idx & 0xFF)                           # byte 40
    msg += type_meta                                       # bytes 41-44
    msg += b8_bytes                                        # bytes 45-52
    msg += nibs_val                                        # bytes 53-60
    msg.append(0xF7)                                       # byte 61
    assert len(msg) == 62, f"Taille invalide: {len(msg)}"
    return bytes(msg)


# ─── Fonctions standalone (sans device physique) ──────────────────────────────



def prst_to_sysex(prst_path: str, slot: int, letter, output_path: str = None) -> list[bytes]:
    """Convertit un fichier .prst en liste de messages SysEx (sans device).

    Utile pour tester la construction sans connexion USB.

    Args:
        prst_path   : chemin vers le .prst
        slot        : bank 1-50
        letter      : 'A'/'B'/'C'/'D' ou 0/1/2/3
        output_path : si fourni, sauvegarde les SysEx concaténés en binaire

    Returns:
        liste de SysEx bytes-objects
    """
    with open(prst_path, 'rb') as f:
        prst = f.read()

    dest_pc = slot_to_pc(slot, letter)
    msgs    = build_sysex_chunks(prst, dest_pc)

    if output_path:
        with open(output_path, 'wb') as f:
            for m in msgs:
                f.write(m)
        print(f"SysEx sauvegardés → {output_path} ({sum(len(m) for m in msgs)} bytes)")

    return msgs


def list_midi_ports():
    """Affiche les ports MIDI disponibles (utile pour diagnostique)."""
    try:
        import mido
        print("Ports MIDI OUT :", mido.get_output_names())
        print("Ports MIDI IN  :", mido.get_input_names())
    except ImportError:
        print("mido non installé. pip install mido python-rtmidi")


# ─── Exemple d'utilisation ────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    print("GP-200 USB Module — Test")
    print("=" * 40)

    if len(sys.argv) < 4:
        print("Usage: python gp200_usb.py <fichier.prst> <slot> <lettre>")
        print("Ex:    python gp200_usb.py mon_preset.prst 5 A")
        print()
        list_midi_ports()
        sys.exit(0)

    prst_path = sys.argv[1]
    slot      = int(sys.argv[2])
    letter    = sys.argv[3]

    prst_data = open(prst_path, 'rb').read()
    pc        = slot_to_pc(slot, letter)
    print(f"Preset   : {prst_path} ({len(prst_data)} bytes)")
    print(f"Slot cible : {slot:02d}-{letter.upper()} → PC {pc} (0x{pc:02X})")
    print()

    with GP200USB() as gp:
        if gp.connected:
            gp.push_preset(slot, letter, prst_data, activate=True)