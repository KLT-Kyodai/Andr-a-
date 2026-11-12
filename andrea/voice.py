"""Voix d'Andréa : synthèse vocale (TTS) et reconnaissance vocale (STT).

Ces fonctions sont optionnelles : installez les dépendances avec
`pip install -e ".[voix]"`. Sans elles, Andréa fonctionne en mode texte.
"""

from __future__ import annotations

import re
import threading

WAKE_WORDS = ("andréa", "andrea", "andré a")


class Voice:
    def __init__(self) -> None:
        import pyttsx3  # noqa: PLC0415 - dépendance optionnelle
        import speech_recognition as sr  # noqa: PLC0415

        self._sr = sr
        self._engine = pyttsx3.init()
        self._lock = threading.Lock()
        self._choose_french_voice()
        self._engine.setProperty("rate", 175)
        self._recognizer = sr.Recognizer()

    def _choose_french_voice(self) -> None:
        for voice in self._engine.getProperty("voices"):
            label = f"{voice.id} {voice.name} {getattr(voice, 'languages', '')}".lower()
            if "fr" in label and any(f in label for f in ("female", "amelie", "audrey", "marie", "julie")):
                self._engine.setProperty("voice", voice.id)
                return
        for voice in self._engine.getProperty("voices"):
            if "fr" in f"{voice.id} {voice.name}".lower():
                self._engine.setProperty("voice", voice.id)
                return

    def say(self, text: str) -> None:
        text = re.sub(r"[*_#`>\[\]]", "", text).strip()
        if not text:
            return
        with self._lock:
            self._engine.say(text)
            self._engine.runAndWait()

    def listen(self, timeout: float = 8.0) -> str | None:
        """Écoute le micro et renvoie le texte reconnu (ou None)."""
        sr = self._sr
        with sr.Microphone() as source:
            self._recognizer.adjust_for_ambient_noise(source, duration=0.4)
            try:
                audio = self._recognizer.listen(source, timeout=timeout, phrase_time_limit=20)
            except sr.WaitTimeoutError:
                return None
        try:
            return self._recognizer.recognize_google(audio, language="fr-FR")
        except (sr.UnknownValueError, sr.RequestError):
            return None


def strip_wake_word(text: str) -> str | None:
    """Renvoie la commande si la phrase commence par le mot d'éveil, sinon None."""
    lowered = text.lower().strip()
    for word in WAKE_WORDS:
        idx = lowered.find(word)
        if idx != -1 and idx <= 12:  # tolère « Dis Andréa », « Hey Andréa »...
            return text[idx + len(word):].lstrip(" ,.!?") or ""
    return None
