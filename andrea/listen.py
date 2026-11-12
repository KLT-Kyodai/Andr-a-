"""Écoute d'Andréa : reconnaissance vocale au micro et mot d'éveil.

Optionnel : installez les dépendances avec `pip install -e ".[voix]"`.
"""

from __future__ import annotations

WAKE_WORDS = ("andréa", "andrea", "andré a")


class Listener:
    def __init__(self) -> None:
        import speech_recognition as sr  # noqa: PLC0415 - dépendance optionnelle

        self._sr = sr
        self._recognizer = sr.Recognizer()
        sr.Microphone()  # échoue tout de suite si PyAudio ou le micro manque

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
