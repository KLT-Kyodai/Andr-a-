"""Synthèse vocale d'Andréa : elle lit ses réponses à voix haute, phrase par phrase.

Par défaut, la voix est celle du système, hors ligne :
- macOS   : commande `say` (rien à installer) ;
- Linux   : `espeak-ng` (`sudo apt install espeak-ng`) ;
- Windows : SAPI5 via `pyttsx3` (installé automatiquement avec Andréa).

Une voix en ligne plus naturelle existe aussi : voir `voice_online.py`.
"""

from __future__ import annotations

import queue
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib.parse import urlparse

DEFAULT_RATE = 175  # mots par minute

# --------------------------------------------------------------------------- #
# Préparation du texte : ce qui s'écrit n'est pas toujours ce qui se dit
# --------------------------------------------------------------------------- #
_FENCE = "```"
_CODE_NOTICE = " Le code est affiché à l'écran. "
_LINK = re.compile(r"\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)")  # adresse avec parenthèses comprises
_URL = re.compile(r"https?://[^\s)\]>]+")
_LINE_PREFIX = re.compile(r"^\s*(?:[-•–—]\s+|#{1,6}\s+|>\s?)")  # puce, titre, citation
_MARKDOWN = re.compile(r"\*+|_+|`+|~~+|\|")
# Fin de phrase : ponctuation forte suivie d'un espace (sauf initiale du type « M. »),
# ou retour à la ligne.
_BOUNDARY = re.compile(r"(?:(?<!\b[A-ZÀ-Ý])\.|[!?…])+[\"»”)\]]*\s+|\n+")
_SYMBOL_RANGES = (
    (0x2190, 0x21FF),  # flèches
    (0x2300, 0x23FF),  # ⏰ ⌚ …
    (0x2460, 0x27BF),  # chiffres cerclés, cadres, formes, symboles, dingbats
    (0x2B00, 0x2BFF),  # ⭐ …
    (0x1F000, 0x10FFFF),  # émojis
)


def _is_symbol(char: str) -> bool:
    code = ord(char)
    return code in (0xFE0F, 0x200D) or any(lo <= code <= hi for lo, hi in _SYMBOL_RANGES)


def clean_for_speech(text: str) -> str:
    """Retire ce qui ne se prononce pas : markdown, liens, émojis…"""
    text = _LINK.sub(r"\1", text)
    text = _URL.sub(lambda m: (urlparse(m.group()).hostname or "").removeprefix("www."), text)
    text = _LINE_PREFIX.sub("", text)
    text = _MARKDOWN.sub(" ", text)
    text = "".join(" " if _is_symbol(c) else c for c in text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r" ([.,])", r"\1", text)  # espace laissé par un symbole retiré
    return text if any(c.isalnum() for c in text) else ""


class SentenceSplitter:
    """Découpe un texte reçu par morceaux (streaming) en phrases prêtes à être dites."""

    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, chunk: str) -> list[str]:
        self._buffer += chunk
        return self._take(final=False)

    def flush(self) -> list[str]:
        return self._take(final=True)

    def _take(self, final: bool) -> list[str]:
        text, held = self._buffer, ""
        # Un bloc de code ne se lit pas à voix haute : on attend qu'il soit complet,
        # puis on le remplace par une courte phrase.
        parts = text.split(_FENCE)  # indices pairs : texte ; impairs : code
        if len(parts) > 1:
            block_open = len(parts) % 2 == 0
            text = _CODE_NOTICE.join((parts[:-1] if block_open else parts)[::2])
            if block_open and final:
                text += _CODE_NOTICE
            elif block_open:
                held = _FENCE + parts[-1]

        if held or final:  # tout ce qui précède un bloc de code (ou la fin) peut être dit
            ready, rest = text, ""
        else:  # sinon, seulement les phrases terminées
            cut = max((m.end() for m in _BOUNDARY.finditer(text)), default=0)
            ready, rest = text[:cut], text[cut:]
        self._buffer = rest + held
        return _sentences(ready)


def _sentences(text: str) -> list[str]:
    pieces, last = [], 0
    for match in _BOUNDARY.finditer(text):
        pieces.append(text[last:match.end()])
        last = match.end()
    pieces.append(text[last:])
    return [cleaned for piece in pieces if (cleaned := clean_for_speech(piece))]


def split_for_speech(text: str) -> list[str]:
    """Découpe un texte complet en phrases prêtes à être dites."""
    splitter = SentenceSplitter()
    return splitter.feed(text) + splitter.flush()


# --------------------------------------------------------------------------- #
# Voix disponibles et choix d'une voix française
# --------------------------------------------------------------------------- #
class SpeechUnavailable(RuntimeError):
    """La synthèse vocale ne peut pas démarrer (le message explique comment corriger)."""


@dataclass(frozen=True)
class VoiceInfo:
    ident: str  # identifiant à donner au moteur
    name: str  # nom lisible
    lang: str  # ex. « fr-fr »
    female: bool = False


# Voix macOS de bonne qualité, par ordre de préférence.
_PREFERRED = ("audrey", "aurélie", "marie", "amélie", "hortense", "julie", "thomas")


def _score(voice: VoiceInfo) -> tuple:
    name = voice.name.lower()
    rank = next((len(_PREFERRED) - i for i, p in enumerate(_PREFERRED) if p in name), 0)
    quality = any(word in name for word in ("premium", "enhanced", "premier", "amélior"))
    return (rank, voice.lang == "fr-fr", voice.female, quality)


def pick_voice(voices: list[VoiceInfo], wanted: str = "") -> VoiceInfo | None:
    """Choisit la voix demandée, sinon la meilleure voix française (None s'il n'y en a pas)."""
    if wanted:
        needle = wanted.lower()
        exact = [v for v in voices if needle in (v.ident.lower(), v.name.lower())]
        partial = [v for v in voices if needle in v.name.lower() or needle in v.ident.lower()]
        found = exact or partial
        if not found:
            raise SpeechUnavailable(
                f"voix « {wanted} » introuvable — lancez `andrea --liste-voix` pour voir les voix"
            )
        return found[0]
    french = [v for v in voices if v.lang.startswith("fr")]
    return max(french, key=_score, default=None)


def _norm_lang(lang: object) -> str:
    return str(lang or "").lower().replace("_", "-")


def parse_say_voices(output: str) -> list[VoiceInfo]:
    """Analyse la sortie de `say -v ?` (macOS)."""
    voices = []
    for line in output.splitlines():
        match = re.match(r"(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#", line)
        if match:
            name = match.group(1).strip()
            female = name.lower().split(" ")[0] in ("audrey", "aurélie", "marie", "amélie")
            voices.append(VoiceInfo(name, name, _norm_lang(match.group(2)), female))
    return voices


def parse_espeak_voices(output: str) -> list[VoiceInfo]:
    """Analyse la sortie de `espeak-ng --voices` (Linux)."""
    voices = []
    for line in output.splitlines()[1:]:
        cols = line.split()
        if len(cols) < 5 or cols[4].startswith("mb/"):  # voix MBROLA : paquet à part
            continue
        ident = cols[4].rsplit("/", 1)[-1]
        name = f"{ident} — {cols[3].replace('_', ' ')}"
        voices.append(VoiceInfo(ident, name, _norm_lang(cols[1]), "/F" in cols[2]))
    return voices


def _run(*argv: str) -> str:
    return subprocess.run(argv, capture_output=True, text=True, check=True).stdout


def _espeak_command() -> str:
    command = shutil.which("espeak-ng") or shutil.which("espeak")
    if not command:
        raise SpeechUnavailable("espeak-ng est introuvable — installez-le : sudo apt install espeak-ng")
    return command


def _pyttsx3_engine():
    try:
        if sys.platform == "win32":
            import pythoncom  # noqa: PLC0415

            pythoncom.CoInitialize()  # obligatoire hors du fil principal
        import pyttsx3  # noqa: PLC0415

        return pyttsx3.init()
    except ImportError as exc:
        raise SpeechUnavailable("pyttsx3 est introuvable — installez-le : pip install pyttsx3") from exc
    except Exception as exc:
        raise SpeechUnavailable(f"le moteur vocal du système ne démarre pas ({exc})") from exc


def _pyttsx3_voices(engine) -> list[VoiceInfo]:
    return [
        VoiceInfo(
            v.id,
            v.name or v.id,
            _norm_lang((v.languages or [""])[0]),
            "female" in str(v.gender or "").lower(),
        )
        for v in engine.getProperty("voices")
    ]


def available_voices() -> list[VoiceInfo]:
    """Liste les voix installées sur cet ordinateur."""
    if sys.platform == "darwin":
        return parse_say_voices(_run("say", "-v", "?"))
    if sys.platform.startswith("linux"):
        return parse_espeak_voices(_run(_espeak_command(), "--voices"))
    return _pyttsx3_voices(_pyttsx3_engine())


# --------------------------------------------------------------------------- #
# Moteurs : un par système d'exploitation
# --------------------------------------------------------------------------- #
class Backend(Protocol):
    voice_name: str

    def speak(self, text: str) -> None: ...  # bloque jusqu'à la fin de la phrase

    def stop(self) -> None: ...  # coupe la phrase en cours, si possible

    # Facultatif : prepare(text) pour préparer une phrase à l'avance, close() pour libérer.


class _CommandBackend:
    """Moteur piloté par une commande du système ; le texte passe par l'entrée standard."""

    voice_name = "voix par défaut"
    _argv: list[str]

    def __init__(self) -> None:
        self._process: subprocess.Popen | None = None

    def speak(self, text: str) -> None:
        self._process = subprocess.Popen(
            self._argv, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:
            self._process.communicate(text.encode("utf-8"))
        except BrokenPipeError:
            pass  # coupée par stop()
        if (self._process.returncode or 0) > 0:  # négatif : interrompue volontairement
            raise RuntimeError(f"{self._argv[0]} a échoué (code {self._process.returncode})")

    def stop(self) -> None:
        process = self._process
        if process and process.poll() is None:
            process.terminate()


class SayBackend(_CommandBackend):
    """macOS : commande `say`."""

    def __init__(self, voice: str = "", rate: int = DEFAULT_RATE) -> None:
        super().__init__()
        if not shutil.which("say"):
            raise SpeechUnavailable("la commande `say` de macOS est introuvable")
        chosen = pick_voice(parse_say_voices(_run("say", "-v", "?")), voice)
        self._argv = ["say", "-r", str(rate)]
        if chosen:
            self._argv += ["-v", chosen.ident]
            self.voice_name = chosen.name


class EspeakBackend(_CommandBackend):
    """Linux : commande `espeak-ng`."""

    def __init__(self, voice: str = "", rate: int = DEFAULT_RATE) -> None:
        super().__init__()
        command = _espeak_command()
        voices = parse_espeak_voices(_run(command, "--voices"))
        if voice:
            base, plus, variant = voice.partition("+")  # variantes : fr+m3, fr-be+f2…
            try:
                ident = pick_voice(voices, base).ident + plus + variant
            except SpeechUnavailable:
                ident = voice  # nom inconnu de la liste : espeak tranchera ci-dessous
        else:
            chosen = pick_voice(voices)
            ident = f"{chosen.ident}+f3" if chosen else "fr+f3"  # +f3 : timbre féminin
        check = subprocess.run(
            [command, "-v", ident, "-q", "--stdin"], input=b"test", capture_output=True, check=False
        )
        if check.returncode != 0:
            raise SpeechUnavailable(
                f"voix « {ident} » introuvable — lancez `andrea --liste-voix` pour voir les voix"
            )
        self._argv = [command, "-v", ident, "-s", str(rate), "--stdin"]
        self.voice_name = ident


class Pyttsx3Backend:
    """Windows (SAPI5) et autres systèmes : bibliothèque pyttsx3."""

    def __init__(self, voice: str = "", rate: int = DEFAULT_RATE) -> None:
        self._engine = _pyttsx3_engine()
        chosen = pick_voice(_pyttsx3_voices(self._engine), voice)
        self.voice_name = "voix par défaut"
        if chosen:
            self._engine.setProperty("voice", chosen.ident)
            self.voice_name = chosen.name
        self._engine.setProperty("rate", rate)

    def speak(self, text: str) -> None:
        self._engine.say(text)
        self._engine.runAndWait()

    def stop(self) -> None:
        """pyttsx3 ne s'interrompt pas proprement depuis un autre fil : la phrase se termine."""


def make_system_backend(voice: str = "", rate: int = DEFAULT_RATE) -> Backend:
    if sys.platform == "darwin":
        return SayBackend(voice, rate)
    if sys.platform.startswith("linux"):
        return EspeakBackend(voice, rate)
    return Pyttsx3Backend(voice, rate)


class FallbackBackend:
    """Voix en ligne, avec repli sur la voix de l'ordinateur dès la première panne."""

    def __init__(
        self,
        online: Backend,
        make_fallback: Callable[[], Backend],
        on_fallback: Callable[[Exception], None],
    ) -> None:
        self._online = online
        self._make_fallback = make_fallback
        self._on_fallback = on_fallback
        self._fallback: Backend | None = None

    @property
    def voice_name(self) -> str:
        return (self._fallback or self._online).voice_name

    def prepare(self, text: str) -> None:
        if self._fallback is None:
            self._online.prepare(text)

    def speak(self, text: str) -> None:
        if self._fallback is None:
            try:
                self._online.speak(text)
                return
            except Exception as exc:
                try:
                    self._fallback = self._make_fallback()
                except SpeechUnavailable as local:
                    raise SpeechUnavailable(f"voix en ligne en panne ({exc}) et {local}") from exc
                self._online.close()
                self._on_fallback(exc)
        self._fallback.speak(text)  # la phrase qui a échoué est redite par la voix locale

    def stop(self) -> None:
        (self._fallback or self._online).stop()

    def close(self) -> None:
        if self._fallback is None:
            self._online.close()


def make_backend(
    voice: str = "",
    rate: int = DEFAULT_RATE,
    engine: str = "systeme",
    on_fallback: Callable[[Exception], None] | None = None,
) -> Backend:
    """Crée le moteur vocal : « systeme » (hors ligne) ou « naturelle » (voix en ligne)."""
    if engine != "naturelle":
        return make_system_backend(voice, rate)
    from andrea.voice_online import OnlineBackend  # noqa: PLC0415

    on_fallback = on_fallback or (lambda exc: None)

    def system() -> Backend:
        try:
            return make_system_backend(voice, rate)
        except SpeechUnavailable:
            if not voice:
                raise
            return make_system_backend("", rate)  # le nom désignait une voix en ligne

    try:
        online = OnlineBackend(voice, rate)
    except SpeechUnavailable as exc:
        on_fallback(exc)
        return system()
    return FallbackBackend(online, system, on_fallback)


# --------------------------------------------------------------------------- #
# La voix d'Andréa
# --------------------------------------------------------------------------- #
class Speaker:
    """Lit du texte à voix haute en arrière-plan, sans bloquer la conversation.

    Les phrases sont mises en file d'attente et dites une à une par un fil dédié
    (certains moteurs exigent d'être créés et utilisés dans le même fil).
    """

    def __init__(
        self,
        voice: str = "",
        rate: int = DEFAULT_RATE,
        engine: str = "systeme",
        backend_factory: Callable[[], Backend] | None = None,
        on_error: Callable[[Exception], None] | None = None,
        on_fallback: Callable[[Exception], None] | None = None,
    ) -> None:
        self.enabled = True
        self._factory = backend_factory or (lambda: make_backend(voice, rate, engine, on_fallback))
        self._on_error = on_error or (lambda exc: None)
        self._splitter = SentenceSplitter()
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._pending = 0  # phrases en attente ou en cours
        self._idle = threading.Condition()
        self._backend: Backend | None = None
        self._closed = False
        self._startup_error: Exception | None = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._work, name="andrea-voix", daemon=True)
        self._thread.start()
        self._ready.wait()
        if self._startup_error:
            raise self._startup_error

    # ----- Fil dédié à la parole ------------------------------------------ #
    def _work(self) -> None:
        try:
            self._backend = self._factory()
        except Exception as exc:
            self._startup_error = exc
            return
        finally:
            self._ready.set()

        while True:
            text = self._queue.get()
            try:
                if text is None:
                    return
                if self.enabled:
                    self._backend.speak(text)
            except Exception as exc:
                # Une panne de la voix ne doit jamais bloquer la conversation.
                self.enabled = False
                self._drain()
                self._on_error(exc)
            finally:
                self._done()

    def _done(self) -> None:
        with self._idle:
            self._pending -= 1
            self._idle.notify_all()

    def _put(self, item: str | None) -> None:
        with self._idle:
            self._pending += 1
        self._queue.put(item)

    def _drain(self) -> None:
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                return
            self._done()
            if item is None:  # ne jamais perdre l'ordre d'arrêt
                self._put(None)
                return

    def _enqueue(self, sentences: list[str]) -> None:
        if self.enabled and not self._closed:
            prepare = getattr(self._backend, "prepare", None)
            for sentence in sentences:
                if prepare:
                    prepare(sentence)  # voix en ligne : la synthèse démarre sans attendre
                self._put(sentence)

    # ----- Interface ------------------------------------------------------ #
    @property
    def voice_name(self) -> str:
        return self._backend.voice_name if self._backend else ""

    def feed(self, chunk: str) -> None:
        """Reçoit un morceau de réponse (streaming) ; dit chaque phrase dès qu'elle est complète."""
        self._enqueue(self._splitter.feed(chunk))

    def flush(self) -> None:
        """Fin d'une réponse : dit ce qui restait en attente."""
        self._enqueue(self._splitter.flush())

    def say(self, text: str) -> None:
        """Dit un message complet (salutation, rappel…)."""
        self._enqueue(split_for_speech(text))

    def stop(self) -> None:
        """Coupe la parole : abandonne ce qui restait à dire."""
        self._splitter = SentenceSplitter()
        self._drain()
        if self._backend:
            self._backend.stop()

    def wait(self, timeout: float = 120.0) -> bool:
        """Attend qu'Andréa ait fini de parler. Renvoie False si le délai est dépassé."""
        with self._idle:
            return self._idle.wait_for(lambda: self._pending == 0, timeout)

    def close(self, timeout: float = 60.0) -> None:
        """Termine ce qui est en cours puis arrête la voix."""
        if not self._closed:
            self.flush()
            self._closed = True
            self._put(None)
        self._thread.join(timeout)
        release = getattr(self._backend, "close", None)
        if release:
            release()
