"""Configuration d'Andréa (via variables d'environnement)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "oui", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _engine(value: str) -> str:
    return "naturelle" if value.strip().lower() in {"naturelle", "en-ligne", "enligne", "online"} else "systeme"


@dataclass
class Config:
    model: str = field(default_factory=lambda: os.environ.get("ANDREA_MODEL", "claude-opus-5-5"))
    effort: str = field(default_factory=lambda: os.environ.get("ANDREA_EFFORT", "medium"))
    user_name: str = field(default_factory=lambda: os.environ.get("ANDREA_USER_NAME", "Monsieur"))
    data_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("ANDREA_DATA_DIR", Path.home() / ".andrea"))
    )
    web_search: bool = field(default_factory=lambda: _bool("ANDREA_WEB_SEARCH", True))
    # Parole : Andréa lit ses réponses à voix haute. Voix : on lui parle aussi au micro.
    speak: bool = field(default_factory=lambda: _bool("ANDREA_SPEAK", False))
    voice: bool = field(default_factory=lambda: _bool("ANDREA_VOICE", False))
    # Moteur vocal : « systeme » (hors ligne) ou « naturelle » (voix en ligne).
    tts_engine: str = field(default_factory=lambda: _engine(os.environ.get("ANDREA_TTS_ENGINE", "")))
    tts_voice: str = field(default_factory=lambda: os.environ.get("ANDREA_TTS_VOICE", ""))
    tts_rate: int = field(default_factory=lambda: _int("ANDREA_TTS_RATE", 175))
    max_tokens: int = 64000

    @property
    def spoken(self) -> bool:
        """Vrai si les réponses sont lues à voix haute."""
        return self.speak or self.voice

    @property
    def memory_file(self) -> Path:
        return self.data_dir / "memoire.json"

    @property
    def notes_file(self) -> Path:
        return self.data_dir / "notes.json"
