"""Interface en ligne de commande d'Andréa."""

from __future__ import annotations

import argparse
import sys

import anthropic

from andrea import __version__
from andrea.brain import Andrea, Callbacks
from andrea.config import Config
from andrea.speak import Speaker, SpeechUnavailable, available_voices, pick_voice
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

HELP = (
    f"{GREY}Commandes : /aide  /parle (voix activée)  /muet (voix coupée)  "
    f"/oublie (nouvelle conversation)  /quitter{RESET}"
)

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
    parser.add_argument("--parle", action="store_true", help="Andréa lit ses réponses à voix haute")
    parser.add_argument("--voix", action="store_true", help="mode vocal complet : micro + voix haute")
    parser.add_argument("--choisir-voix", metavar="NOM", help="voix à utiliser (voir --liste-voix)")
    parser.add_argument("--vitesse", type=int, metavar="N", help="débit de la voix en mots/minute (défaut : 175)")
    parser.add_argument("--liste-voix", action="store_true", help="affiche les voix françaises installées")
    parser.add_argument("--nom", help="comment Andréa doit vous appeler (défaut : Monsieur)")
    parser.add_argument("--sans-web", action="store_true", help="désactive la recherche web")
    parser.add_argument("message", nargs="*", help="question unique (sinon mode interactif)")
    return parser.parse_args(argv)


class Session:
    """Une conversation dans le terminal : clavier ou micro en entrée, texte et voix en sortie."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.speaker: Speaker | None = None
        self.listener = None

        if config.spoken and not self.start_speaker():
            config.speak = False
        if config.voice:
            try:
                from andrea.listen import Listener

                self.listener = Listener()
            except Exception as exc:  # dépendances absentes, pas de micro...
                print(f"{YELLOW}Micro indisponible ({exc}). Vous pouvez m'écrire au clavier.{RESET}")
                config.voice = False
                config.speak = self.speaker is not None

        callbacks = Callbacks(on_text=self._on_text, on_tool=self._on_tool, on_status=self._on_status)
        self.andrea = Andrea(config=config, callbacks=callbacks, toolbox=Toolbox(config, notify=self.notify))

    # ----- Voix ----------------------------------------------------------- #
    def start_speaker(self) -> bool:
        try:
            self.speaker = Speaker(self.config.tts_voice, self.config.tts_rate, on_error=self._speech_failed)
        except Exception as exc:
            reason = str(exc) if isinstance(exc, SpeechUnavailable) else f"{type(exc).__name__} : {exc}"
            print(f"{YELLOW}Synthèse vocale indisponible : {reason}. Je réponds par écrit.{RESET}")
            return False
        print(f"{GREY}[Synthèse vocale activée — voix : {self.speaker.voice_name}]{RESET}")
        return True

    def _speech_failed(self, exc: Exception) -> None:
        print(f"\n{YELLOW}[La synthèse vocale s'est arrêtée ({exc}). Je continue par écrit.]{RESET}")

    def say(self, text: str) -> None:
        if self.speaker:
            self.speaker.say(text)

    def hush(self) -> None:
        if self.speaker:
            self.speaker.stop()

    def notify(self, message: str) -> None:
        """Rappel d'un minuteur : affiché, et dit à voix haute si la voix est active."""
        print(f"\n{YELLOW}🔔 {message}{RESET}")
        self.say(message)

    # ----- Affichage de la réponse en cours ------------------------------- #
    def _on_text(self, text: str) -> None:
        print(text, end="", flush=True)
        if self.speaker:
            self.speaker.feed(text)

    def _on_tool(self, name: str, _args: object) -> None:
        if self.speaker:
            self.speaker.flush()
        print(f"{GREY}[Andréa {TOOL_LABELS.get(name, name)}…]{RESET}", flush=True)

    def _on_status(self, message: str) -> None:
        print(f"{GREY}[{message}]{RESET}", flush=True)

    # ----- Conversation --------------------------------------------------- #
    def answer(self, text: str) -> None:
        self.hush()  # une nouvelle demande coupe la réponse précédente
        print(f"\n{CYAN}Andréa ›{RESET} ", end="", flush=True)
        try:
            self.andrea.ask(text)
        except KeyboardInterrupt:
            self.hush()
            print(f"\n{GREY}[Interrompu]{RESET}")
            return
        except anthropic.AuthenticationError:
            print(f"{RED}Clé API invalide. Vérifiez ANTHROPIC_API_KEY.{RESET}")
            sys.exit(1)
        except TypeError as exc:
            if "authentication" not in str(exc):
                raise
            print(f"{RED}Aucune clé API trouvée. Définissez la variable ANTHROPIC_API_KEY.{RESET}")
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
        if self.speaker:
            self.speaker.flush()

    def read_input(self) -> str | None:
        if not self.listener:
            return input(f"\n{YELLOW}Vous ›{RESET} ")
        from andrea.listen import strip_wake_word

        if self.speaker:
            self.speaker.wait()  # ne pas s'écouter parler
        print(f"{GREY}[À l'écoute… dites « Andréa, … »]{RESET}")
        heard = self.listener.listen()
        if not heard:
            return None
        command = strip_wake_word(heard)
        if command is None:
            return None
        print(f"{YELLOW}Vous ›{RESET} {command}")
        return command or "Oui ?"

    def command(self, command: str) -> bool:
        """Exécute une commande « /… ». Renvoie False si ce n'en est pas une."""
        if command == "/aide":
            print(HELP)
        elif command == "/oublie":
            self.andrea.reset()
            print(f"{GREY}[Nouvelle conversation — la mémoire à long terme est conservée]{RESET}")
        elif command == "/muet":
            if self.speaker:
                self.speaker.enabled = False
                self.speaker.stop()
            print(f"{GREY}[Voix coupée — /parle pour la réactiver]{RESET}")
        elif command == "/parle":
            if self.speaker:
                self.speaker.enabled = True
                print(f"{GREY}[Synthèse vocale activée — voix : {self.speaker.voice_name}]{RESET}")
            if self.speaker or self.start_speaker():
                self.say("Je vous parle à nouveau.")
        else:
            return False
        return True

    def run(self) -> None:
        name = self.config.user_name
        print(BANNER)
        greeting = f"Bonjour {name}. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?"
        print(f"{CYAN}Andréa ›{RESET} {greeting}\n{HELP}\n")
        self.say(greeting)

        while True:
            try:
                user_input = self.read_input()
            except (EOFError, KeyboardInterrupt):
                user_input = "/quitter"
            if not user_input or not user_input.strip():
                continue
            command = user_input.strip().lower()
            if command in {"/quitter", "/exit", "quitter", "au revoir"}:
                self.hush()
                bye = f"À votre service, {name}. Bonne journée."
                print(f"\n{CYAN}Andréa ›{RESET} {bye}")
                self.say(bye)
                return
            if not self.command(command):
                self.answer(user_input)

    def close(self) -> None:
        self.andrea.toolbox.cancel_timers()
        if self.speaker:
            self.speaker.close()  # laisse Andréa finir sa phrase


def list_voices(config: Config) -> None:
    try:
        voices = available_voices()
        chosen = pick_voice(voices, config.tts_voice)
    except SpeechUnavailable as exc:
        print(f"{YELLOW}Synthèse vocale indisponible : {exc}.{RESET}")
        return
    french = [v for v in voices if v.lang.startswith("fr")]
    if not french:
        print(
            "Aucune voix française n'est installée sur cet ordinateur.\n"
            "  Windows : Paramètres › Heure et langue › Voix › Ajouter des voix › Français\n"
            "  macOS   : Réglages Système › Accessibilité › Contenu énoncé › Voix du système\n"
            "  Linux   : sudo apt install espeak-ng"
        )
        return
    print("Voix françaises installées (← : voix utilisée) :")
    for voice in french:
        mark = "  ←" if chosen and voice.ident == chosen.ident else ""
        print(f"  {voice.name}  ({voice.lang}){mark}")
    print('\nPour en changer : andrea --parle --choisir-voix "NOM"   (ou ANDREA_TTS_VOICE=NOM)')
    if sys.platform.startswith("linux"):
        print("Sous Linux, ajoutez +f1…+f5 (timbre féminin) ou +m1…+m7 (masculin), ex. : fr+f3")


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    config = Config()
    if args.nom:
        config.user_name = args.nom
    if args.parle:
        config.speak = True
    if args.voix:
        config.voice = True
    if args.choisir_voix:
        config.tts_voice = args.choisir_voix
    if args.vitesse:
        config.tts_rate = args.vitesse
    if args.sans_web:
        config.web_search = False

    if args.liste_voix:
        list_voices(config)
        return

    session = Session(config)
    try:
        if args.message:
            session.answer(" ".join(args.message))
        else:
            session.run()
    finally:
        session.close()
