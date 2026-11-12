"""Voix en ligne d'Andréa : plus naturelle, mais le texte des réponses part sur Internet.

Elle utilise les voix neuronales du service « Lecture à voix haute » de Microsoft Edge,
via la bibliothèque non officielle `edge-tts`, puis lit le son reçu avec `pygame-ce`.

Installation : pip install -e ".[naturelle]"      Utilisation : andrea --naturelle
"""

from __future__ import annotations

import asyncio
import io
import os
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, Protocol

from andrea.speak import DEFAULT_RATE, SpeechUnavailable, VoiceInfo, pick_voice

DEFAULT_VOICE = "fr-FR-DeniseNeural"
_SYNTH_TIMEOUT = 30.0  # secondes, par phrase
_INSTALL = 'la voix en ligne n\'est pas installée — lancez : pip install -e ".[naturelle]"'


def _reason(exc: BaseException) -> str:
    return str(exc) or type(exc).__name__


def _display_name(ident: str) -> str:
    """« fr-FR-VivienneMultilingualNeural » → « Vivienne Multilingual »."""
    name = ident.rsplit("-", 1)[-1].removesuffix("Neural")
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)


def _rate_percent(rate: int) -> str:
    """Débit en mots/minute → écart en pourcentage attendu par le service."""
    return f"{round((rate / DEFAULT_RATE - 1) * 100):+d}%"


def _edge_tts():
    try:
        import edge_tts  # noqa: PLC0415 - dépendance optionnelle

        return edge_tts
    except ImportError as exc:
        raise SpeechUnavailable(_INSTALL) from exc


def online_voices() -> list[VoiceInfo]:
    """Liste les voix proposées par le service (nécessite Internet)."""
    edge_tts = _edge_tts()
    try:
        voices = asyncio.run(asyncio.wait_for(edge_tts.list_voices(), 20))
    except Exception as exc:
        raise SpeechUnavailable(f"la liste des voix en ligne est inaccessible ({_reason(exc)})") from exc
    return [
        VoiceInfo(v["ShortName"], _display_name(v["ShortName"]), v["Locale"].lower(), v["Gender"] == "Female")
        for v in voices
    ]


def resolve_voice(wanted: str = "") -> str:
    """Identifiant de la voix à utiliser. Un nom partiel (« henri ») est cherché en ligne."""
    if not wanted:
        return DEFAULT_VOICE
    if re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}-.*Neural", wanted):
        return wanted
    voices = online_voices()
    french = [v for v in voices if v.lang.startswith("fr")]
    try:
        return pick_voice(french, wanted).ident
    except SpeechUnavailable:
        return pick_voice(voices, wanted).ident


class Player(Protocol):
    def play(self, audio: bytes, interrupt: threading.Event) -> None: ...


class MixerPlayer:
    """Joue un son MP3 gardé en mémoire sur les haut-parleurs (pygame)."""

    def __init__(self) -> None:
        os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
        try:
            import pygame  # noqa: PLC0415 - dépendance optionnelle
        except ImportError as exc:
            raise SpeechUnavailable(_INSTALL) from exc
        try:
            pygame.mixer.init()
        except pygame.error as exc:
            raise SpeechUnavailable(f"aucune sortie audio utilisable ({exc})") from exc
        self._mixer = pygame.mixer

    def play(self, audio: bytes, interrupt: threading.Event) -> None:
        music = self._mixer.music
        music.load(io.BytesIO(audio), "mp3")
        music.play()
        while music.get_busy():
            if interrupt.wait(0.03):
                music.stop()
        music.unload()

    def close(self) -> None:
        self._mixer.quit()


class OnlineBackend:
    """Moteur vocal en ligne : chaque phrase est synthétisée par le service, puis jouée.

    Les phrases sont envoyées au service dès qu'elles sont connues (`prepare`), sans
    attendre leur tour : pendant qu'une phrase est dite, les suivantes se préparent,
    ce qui évite les blancs entre deux phrases.
    """

    def __init__(
        self,
        voice: str = "",
        rate: int = DEFAULT_RATE,
        synthesize: Callable[[str], bytes] | None = None,
        player: Player | None = None,
    ) -> None:
        if synthesize is None:
            _edge_tts()  # vérifie tout de suite que la bibliothèque est installée
        self._voice = resolve_voice(voice)
        self._rate = _rate_percent(rate)
        self._synthesize = synthesize or self._ask_service
        self._player = player or MixerPlayer()
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="andrea-synthese")
        self._jobs: dict[str, Future[bytes]] = {}
        self._lock = threading.Lock()
        self._interrupt = threading.Event()
        self.voice_name = f"{_display_name(self._voice)} (en ligne)"

    def _ask_service(self, text: str) -> bytes:
        edge_tts = _edge_tts()

        async def fetch() -> bytes:
            talk = edge_tts.Communicate(
                text, self._voice, rate=self._rate, connect_timeout=10, receive_timeout=20
            )
            audio = bytearray()
            async for chunk in talk.stream():
                if chunk["type"] == "audio":
                    audio += chunk["data"]
            return bytes(audio)

        return asyncio.run(asyncio.wait_for(fetch(), _SYNTH_TIMEOUT))

    def prepare(self, text: str) -> None:
        """Lance la synthèse d'une phrase à l'avance."""
        with self._lock:
            if text not in self._jobs:
                self._jobs[text] = self._pool.submit(self._synthesize, text)

    def speak(self, text: str) -> None:
        self._interrupt.clear()
        with self._lock:
            job = self._jobs.pop(text, None) or self._pool.submit(self._synthesize, text)
        try:
            audio = job.result(timeout=_SYNTH_TIMEOUT + 10)
        except Exception as exc:
            raise RuntimeError(
                f"le service vocal ne répond pas, vérifiez la connexion Internet ({type(exc).__name__})"
            ) from exc
        if not audio:
            raise RuntimeError("le service vocal n'a renvoyé aucun son")
        if not self._interrupt.is_set():
            self._player.play(audio, self._interrupt)

    def stop(self) -> None:
        with self._lock:
            jobs, self._jobs = self._jobs, {}
        for job in jobs.values():
            job.cancel()
        self._interrupt.set()

    def close(self) -> None:
        self.stop()
        self._pool.shutdown(wait=False, cancel_futures=True)
        close = getattr(self._player, "close", None)
        if close:
            close()
