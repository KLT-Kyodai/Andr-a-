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


@dataclass
class Config:
    model: str = field(default_factory=lambda: os.environ.get("ANDREA_MODEL", "claude-opus-5-5"))
    effort: str = field(default_factory=lambda: os.environ.get("ANDREA_EFFORT", "medium"))
    user_name: str = field(default_factory=lambda: os.environ.get("ANDREA_USER_NAME", "Monsieur"))
    data_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("ANDREA_DATA_DIR", Path.home() / ".andrea"))
    )
    web_search: bool = field(default_factory=lambda: _bool("ANDREA_WEB_SEARCH", True))
    voice: bool = field(default_factory=lambda: _bool("ANDREA_VOICE", False))
    max_tokens: int = 64000

    @property
    def memory_file(self) -> Path:
        return self.data_dir / "memoire.json"

    @property
    def notes_file(self) -> Path:
        return self.data_dir / "notes.json"
