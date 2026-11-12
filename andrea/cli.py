"""Interface en ligne de commande d'Andréa."""

from __future__ import annotations

import argparse
import sys

import anthropic

from andrea import __version__
from andrea.brain import Andrea, Callbacks
from andrea.config import Config
from andrea.tools import Toolbox

CYAN, GREY, YELLOW, RED, RESET = "\033[96m", "\033[90m", "\033[93m", "\033[91m", "\033[0m"

BANNER = rf"""{CYAN}
     █████╗ ███╗   ██╗██████╗ ██████╗ ███████╗ █████╗
    ██╔══██╗████╗  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
    ███████║██╔██╗ ██║██║  ██║██████╔╝█████╗  ███████║
    ██╔══██║██║╚██╗██║██║  ██║██╔══██╗██╔══╝  ██╔══██║
    ██║  ██║██║ ╚████║██████╔╝██║  ██║███████╗██║  ██║
    ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
{GREY}    Assistante personnelle intelligente — v{__version__}{RESET}
"""

HELP = f"""{GREY}Commandes : /aide  /oublie (nouvelle conversation)  /quitter{RESET}"""

TOOL_LABELS = {
    "date_et_heure": "consulte l'horloge",
    "calculer": "calcule",
    "memoriser": "mémorise",
    "se_souvenir": "fouille sa mémoire",
    "oublier": "oublie",
    "ajouter_note": "prend une note",
    "lister_notes": "lit les notes",
    "supprimer_note": "supprime une note",
    "infos_systeme": "analyse le système",
    "ouvrir_site_web": "ouvre le navigateur",
    "minuteur": "programme un minuteur",
}


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="andrea", description="Andréa, votre assistante IA.")
    parser.add_argument("--voix", action="store_true", help="active le mode vocal (micro + haut-parleur)")
    parser.add_argument("--nom", help="comment Andréa doit vous appeler (défaut : Monsieur)")
    parser.add_argument("--sans-web", action="store_true", help="désactive la recherche web")
    parser.add_argument("message", nargs="*", help="question unique (sinon mode interactif)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    config = Config()
    if args.nom:
        config.user_name = args.nom
    if args.voix:
        config.voice = True
    if args.sans_web:
        config.web_search = False

    voice = None
    if config.voice:
        try:
            from andrea.voice import Voice

            voice = Voice()
        except Exception as exc:  # dépendances absentes, pas de micro...
            print(f"{YELLOW}Mode vocal indisponible ({exc}). Passage en mode texte.{RESET}")
            config.voice = False

    def notify(message: str) -> None:
        print(f"\n{YELLOW}🔔 {message}{RESET}")
        if voice:
            voice.say(message)

    callbacks = Callbacks(
        on_text=lambda t: print(t, end="", flush=True),
        on_tool=lambda name, _a: print(f"{GREY}[Andréa {TOOL_LABELS.get(name, name)}…]{RESET}", flush=True),
        on_status=lambda m: print(f"{GREY}[{m}]{RESET}", flush=True),
    )
    andrea = Andrea(config=config, callbacks=callbacks, toolbox=Toolbox(config, notify=notify))

    if args.message:
        _answer(andrea, " ".join(args.message), voice)
        return

    print(BANNER)
    greeting = f"Bonjour {config.user_name}. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?"
    print(f"{CYAN}Andréa ›{RESET} {greeting}\n{HELP}\n")
    if voice:
        voice.say(greeting)

    while True:
        try:
            user_input = _read_input(voice)
        except (EOFError, KeyboardInterrupt):
            user_input = "/quitter"
        if user_input is None:
            continue
        command = user_input.strip().lower()
        if not command:
            continue
        if command in {"/quitter", "/exit", "quitter", "au revoir"}:
            bye = f"À votre service, {config.user_name}. Bonne journée."
            print(f"\n{CYAN}Andréa ›{RESET} {bye}")
            if voice:
                voice.say(bye)
            andrea.toolbox.cancel_timers()
            return
        if command == "/aide":
            print(HELP)
            continue
        if command == "/oublie":
            andrea.reset()
            print(f"{GREY}[Nouvelle conversation — la mémoire à long terme est conservée]{RESET}")
            continue
        _answer(andrea, user_input, voice)


def _read_input(voice) -> str | None:
    if not voice:
        return input(f"\n{YELLOW}Vous ›{RESET} ")
    from andrea.voice import strip_wake_word

    print(f"{GREY}[À l'écoute… dites « Andréa, … »]{RESET}")
    heard = voice.listen()
    if not heard:
        return None
    command = strip_wake_word(heard)
    if command is None:
        return None
    print(f"{YELLOW}Vous ›{RESET} {command}")
    return command or "Oui ?"


def _answer(andrea: Andrea, text: str, voice) -> None:
    print(f"\n{CYAN}Andréa ›{RESET} ", end="", flush=True)
    try:
        reply = andrea.ask(text)
    except anthropic.AuthenticationError:
        print(f"{RED}Clé API invalide ou absente. Définissez ANTHROPIC_API_KEY.{RESET}")
        sys.exit(1)
    except anthropic.RateLimitError:
        print(f"{RED}Trop de requêtes, réessayez dans un instant.{RESET}")
        return
    except anthropic.APIStatusError as exc:
        print(f"{RED}Erreur de l'API ({exc.status_code}) : {exc.message}{RESET}")
        return
    except anthropic.APIConnectionError:
        print(f"{RED}Connexion impossible. Vérifiez votre accès Internet.{RESET}")
        return
    print()
    if voice and reply:
        voice.say(reply)
