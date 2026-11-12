"""Le « cerveau » d'Andréa : conversation avec Claude + boucle d'outils."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import anthropic

from andrea.config import Config
from andrea.tools import Toolbox

BETAS = [
    "server-side-fallback-2026-07-01",  # bascule automatique si une requête est refusée
    "compact-2026-01-12",  # résumé automatique des très longues conversations
]

SYSTEM_PROMPT = """\
Tu es Andréa, une assistante personnelle intelligente inspirée de J.A.R.V.I.S. \
(l'IA de Tony Stark). Tu sers {user_name}.

Personnalité :
- Élégante, calme, loyale, efficace, avec un humour pince-sans-rire très britannique, \
jamais déplacé.
- Tu t'adresses à l'utilisateur en l'appelant « {user_name} » et tu le vouvoies.
- Tu es proactive : tu anticipes les besoins, proposes la suite logique, signales \
les problèmes avant qu'ils n'arrivent.
- Tu réponds en français, sauf si on te parle dans une autre langue.

Façon de travailler :
- Réponses courtes et directes par défaut ; détaille seulement si on te le demande.
- Utilise tes outils dès qu'ils sont utiles (heure, calculs, mémoire, notes, \
minuteurs, système, navigateur, recherche web) plutôt que de deviner.
- Quand l'utilisateur partage une information personnelle durable (prénom, goûts, \
projets, habitudes), mémorise-la. Consulte ta mémoire quand le contexte s'y prête.
- Si une information demandée est récente ou incertaine, fais une recherche web \
et cite tes sources.
- Si aucun outil ne permet de faire ce qui est demandé, dis-le franchement.
{voice_rules}"""

VOICE_RULES = """
Mode vocal actif : tes réponses seront lues à voix haute. Pas de markdown, pas de \
listes, pas d'émojis, phrases courtes et naturelles."""


@dataclass
class Callbacks:
    """Points d'accroche pour l'interface (affichage, voix...)."""

    on_text: Callable[[str], None] = lambda text: None
    on_tool: Callable[[str, Any], None] = lambda name, args: None
    on_status: Callable[[str], None] = lambda message: None


@dataclass
class Andrea:
    config: Config = field(default_factory=Config)
    callbacks: Callbacks = field(default_factory=Callbacks)
    toolbox: Toolbox | None = None
    client: anthropic.Anthropic | None = None

    def __post_init__(self) -> None:
        self.client = self.client or anthropic.Anthropic()
        self.toolbox = self.toolbox or Toolbox(self.config)
        self.messages: list[dict[str, Any]] = []
        self.system = SYSTEM_PROMPT.format(
            user_name=self.config.user_name,
            voice_rules=VOICE_RULES if self.config.voice else "",
        )

    def reset(self) -> None:
        self.messages.clear()

    def ask(self, user_input: str) -> str:
        """Envoie un message à Andréa et renvoie sa réponse textuelle complète."""
        start = len(self.messages)
        self.messages.append({"role": "user", "content": user_input})
        answer: list[str] = []
        json_retries = 0

        try:
            while True:
                try:
                    response = self._stream_turn(answer)
                    json_retries = 0
                except ValueError:
                    # Entrée d'outil JSON illisible : on relance le tour (borné).
                    json_retries += 1
                    if json_retries > 2:
                        raise
                    continue

                if response.stop_reason == "refusal":
                    del self.messages[start:]
                    msg = "Je crains de ne pas pouvoir donner suite à cette demande."
                    self.callbacks.on_text(msg)
                    return msg

                self.messages.append({"role": "assistant", "content": response.content})

                if response.stop_reason == "pause_turn":
                    continue  # recherche web longue : on laisse le serveur continuer

                tool_uses = [b for b in response.content if b.type == "tool_use"]
                if not tool_uses:
                    return "".join(answer).strip()
                if response.stop_reason == "max_tokens":
                    raise RuntimeError("Réponse tronquée pendant un appel d'outil.")

                results = []
                for block in tool_uses:
                    self.callbacks.on_tool(block.name, block.input)
                    content, is_error = self.toolbox.run(block.name, block.input)
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": content,
                            "is_error": is_error,
                        }
                    )
                # Tous les résultats dans un seul message utilisateur.
                self.messages.append({"role": "user", "content": results})
        except BaseException:
            # On garde un historique valide si quelque chose échoue en cours de route.
            del self.messages[start:]
            raise

    def _stream_turn(self, answer: list[str]):
        with self.client.beta.messages.stream(
            model=self.config.model,
            max_tokens=self.config.max_tokens,
            system=self.system,
            messages=self.messages,
            tools=self.toolbox.definitions(),
            thinking={"type": "adaptive"},
            output_config={"effort": self.config.effort},
            cache_control={"type": "ephemeral"},
            context_management={"edits": [{"type": "compact_20260112"}]},
            betas=BETAS,
            fallbacks="default",
        ) as stream:
            for event in stream:
                if event.type == "text":
                    answer.append(event.text)
                    self.callbacks.on_text(event.text)
                elif event.type == "content_block_start":
                    block_type = getattr(event.content_block, "type", "")
                    if block_type == "server_tool_use":
                        self.callbacks.on_status("Recherche sur le web…")
                    elif block_type == "compaction":
                        self.callbacks.on_status("Je condense notre historique…")
            return stream.get_final_message()
