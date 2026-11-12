"""Outils (capacités) qu'Andréa peut utiliser pendant une conversation."""

from __future__ import annotations

import ast
import json
import math
import operator
import os
import platform
import shutil
import threading
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from andrea.config import Config

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


# --------------------------------------------------------------------------- #
# Calculatrice sécurisée (pas d'eval)
# --------------------------------------------------------------------------- #
_BIN_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS: dict[str, Callable[..., float]] = {
    "sqrt": math.sqrt, "racine": math.sqrt, "sin": math.sin, "cos": math.cos,
    "tan": math.tan, "log": math.log, "log10": math.log10, "exp": math.exp,
    "abs": abs, "round": round, "arrondi": round, "floor": math.floor, "ceil": math.ceil,
}
_CONSTS = {"pi": math.pi, "e": math.e}


def calculer_expression(expression: str) -> float:
    """Évalue une expression mathématique de façon sûre."""
    tree = ast.parse(expression.replace("^", "**").replace(",", "."), mode="eval")

    def _eval(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            left, right = _eval(node.left), _eval(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 1000:
                raise ValueError("exposant trop grand")
            return _BIN_OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
            return _UNARY_OPS[type(node.op)](_eval(node.operand))
        if isinstance(node, ast.Name) and node.id in _CONSTS:
            return _CONSTS[node.id]
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _FUNCS
            and not node.keywords
        ):
            return _FUNCS[node.func.id](*[_eval(a) for a in node.args])
        raise ValueError(f"élément non autorisé : {ast.dump(node)[:40]}")

    return _eval(tree)


# --------------------------------------------------------------------------- #
# Stockage JSON simple
# --------------------------------------------------------------------------- #
def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Boîte à outils
# --------------------------------------------------------------------------- #
class Toolbox:
    """Regroupe les définitions d'outils envoyées à Claude et leur exécution locale."""

    def __init__(self, config: Config, notify: Callable[[str], None] | None = None):
        self.config = config
        self.notify = notify or (lambda msg: print(f"\n🔔 {msg}"))
        self._timers: list[threading.Timer] = []
        self._handlers: dict[str, Callable[..., str]] = {
            "date_et_heure": self.date_et_heure,
            "calculer": self.calculer,
            "memoriser": self.memoriser,
            "se_souvenir": self.se_souvenir,
            "oublier": self.oublier,
            "ajouter_note": self.ajouter_note,
            "lister_notes": self.lister_notes,
            "supprimer_note": self.supprimer_note,
            "infos_systeme": self.infos_systeme,
            "ouvrir_site_web": self.ouvrir_site_web,
            "minuteur": self.minuteur,
        }

    # ----- Définitions envoyées à l'API ----------------------------------- #
    def definitions(self) -> list[dict[str, Any]]:
        def tool(name: str, description: str, props: dict, required: list[str]) -> dict:
            return {
                "name": name,
                "description": description,
                "eager_input_streaming": True,
                "input_schema": {
                    "type": "object",
                    "properties": props,
                    "required": required,
                    "additionalProperties": False,
                },
            }

        tools = [
            tool("date_et_heure", "Donne la date et l'heure locales actuelles.", {}, []),
            tool(
                "calculer",
                "Évalue une expression mathématique (+ - * / ** %, sqrt, sin, cos, log, pi...).",
                {"expression": {"type": "string", "description": "Ex : '(12*3)+sqrt(16)'"}},
                ["expression"],
            ),
            tool(
                "memoriser",
                "Enregistre durablement une information sur l'utilisateur ou ses préférences.",
                {
                    "cle": {"type": "string", "description": "Nom court, ex : 'couleur_preferee'"},
                    "valeur": {"type": "string"},
                },
                ["cle", "valeur"],
            ),
            tool(
                "se_souvenir",
                "Relit la mémoire à long terme. Sans 'recherche', renvoie tout.",
                {"recherche": {"type": "string", "description": "Mot-clé optionnel"}},
                [],
            ),
            tool("oublier", "Efface une information mémorisée.", {"cle": {"type": "string"}}, ["cle"]),
            tool("ajouter_note", "Ajoute une note ou une tâche à la liste.", {"texte": {"type": "string"}}, ["texte"]),
            tool("lister_notes", "Liste toutes les notes et tâches.", {}, []),
            tool(
                "supprimer_note",
                "Supprime une note par son numéro (commence à 1).",
                {"numero": {"type": "integer"}},
                ["numero"],
            ),
            tool("infos_systeme", "Donne l'état de l'ordinateur (OS, CPU, disque).", {}, []),
            tool(
                "ouvrir_site_web",
                "Ouvre une URL http(s) dans le navigateur de l'utilisateur.",
                {"url": {"type": "string"}},
                ["url"],
            ),
            tool(
                "minuteur",
                "Lance un minuteur/rappel qui préviendra l'utilisateur après un délai.",
                {
                    "secondes": {"type": "integer", "description": "Durée en secondes (1 à 86400)"},
                    "message": {"type": "string", "description": "Texte du rappel"},
                },
                ["secondes", "message"],
            ),
        ]
        if self.config.web_search:
            tools.append({"type": "web_search_20260209", "name": "web_search", "max_uses": 5})
        return tools

    # ----- Exécution ------------------------------------------------------ #
    def run(self, name: str, args: Any) -> tuple[str, bool]:
        """Exécute un outil. Renvoie (résultat, est_une_erreur)."""
        handler = self._handlers.get(name)
        if handler is None:
            return f"Outil inconnu : {name}", True
        error = self._validate(name, args)
        if error:
            return error, True
        try:
            return handler(**args), False
        except Exception as exc:  # l'erreur est renvoyée au modèle, pas levée
            return f"Erreur : {exc}", True

    def _validate(self, name: str, args: Any) -> str | None:
        if not isinstance(args, dict):
            return json.dumps({"INVALID_JSON": json.dumps(args, ensure_ascii=False)})
        schema = next(t for t in self.definitions() if t.get("name") == name)["input_schema"]
        types = {"string": str, "integer": int}
        for key in schema["required"]:
            if key not in args:
                return f"Paramètre manquant : {key}"
        for key, value in args.items():
            spec = schema["properties"].get(key)
            if spec is None:
                return f"Paramètre inattendu : {key}"
            expected = types[spec["type"]]
            if not isinstance(value, expected) or isinstance(value, bool):
                return f"Type invalide pour {key} (attendu : {spec['type']})"
        return None

    # ----- Implémentations ------------------------------------------------ #
    def date_et_heure(self) -> str:
        now = datetime.now().astimezone()
        return (
            f"{JOURS[now.weekday()]} {now.day} {MOIS[now.month - 1]} {now.year}, "
            f"{now:%H:%M:%S} ({now.tzname()})"
        )

    def calculer(self, expression: str) -> str:
        result = calculer_expression(expression)
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        return f"{expression} = {result}"

    def memoriser(self, cle: str, valeur: str) -> str:
        memory = _load(self.config.memory_file, {})
        memory[cle] = {"valeur": valeur, "date": datetime.now().isoformat(timespec="seconds")}
        _save(self.config.memory_file, memory)
        return f"Mémorisé : {cle} = {valeur}"

    def se_souvenir(self, recherche: str = "") -> str:
        memory = _load(self.config.memory_file, {})
        q = recherche.lower().strip()
        items = {
            k: v["valeur"] for k, v in memory.items()
            if not q or q in k.lower() or q in str(v["valeur"]).lower()
        }
        if not items:
            return "Aucun souvenir correspondant."
        return "\n".join(f"- {k} : {v}" for k, v in items.items())

    def oublier(self, cle: str) -> str:
        memory = _load(self.config.memory_file, {})
        if memory.pop(cle, None) is None:
            return f"Aucun souvenir nommé « {cle} »."
        _save(self.config.memory_file, memory)
        return f"Oublié : {cle}"

    def ajouter_note(self, texte: str) -> str:
        notes = _load(self.config.notes_file, [])
        notes.append({"texte": texte, "date": datetime.now().isoformat(timespec="minutes")})
        _save(self.config.notes_file, notes)
        return f"Note n°{len(notes)} ajoutée."

    def lister_notes(self) -> str:
        notes = _load(self.config.notes_file, [])
        if not notes:
            return "La liste de notes est vide."
        return "\n".join(f"{i}. {n['texte']} ({n['date']})" for i, n in enumerate(notes, 1))

    def supprimer_note(self, numero: int) -> str:
        notes = _load(self.config.notes_file, [])
        if not 1 <= numero <= len(notes):
            return f"Numéro invalide (1 à {len(notes)})."
        removed = notes.pop(numero - 1)
        _save(self.config.notes_file, notes)
        return f"Note supprimée : {removed['texte']}"

    def infos_systeme(self) -> str:
        disk = shutil.disk_usage(Path.home())
        lines = [
            f"Système : {platform.system()} {platform.release()} ({platform.machine()})",
            f"Machine : {platform.node()}",
            f"Python : {platform.python_version()}",
            f"Cœurs CPU : {os.cpu_count()}",
            f"Disque : {disk.free / 1e9:.1f} Go libres sur {disk.total / 1e9:.1f} Go",
        ]
        if hasattr(os, "getloadavg"):
            load = os.getloadavg()
            lines.append(f"Charge moyenne : {load[0]:.2f} / {load[1]:.2f} / {load[2]:.2f}")
        return "\n".join(lines)

    def ouvrir_site_web(self, url: str) -> str:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return "Seules les URL http(s) complètes sont autorisées."
        opened = webbrowser.open(url)
        return f"Ouverture de {url}" if opened else f"Aucun navigateur disponible pour ouvrir {url}"

    def minuteur(self, secondes: int, message: str) -> str:
        if not 1 <= secondes <= 86400:
            return "La durée doit être comprise entre 1 seconde et 24 heures."
        timer = threading.Timer(secondes, self.notify, args=(f"Rappel : {message}",))
        timer.daemon = True
        timer.start()
        self._timers.append(timer)
        return f"Minuteur lancé : « {message} » dans {secondes} s."

    def cancel_timers(self) -> None:
        for timer in self._timers:
            timer.cancel()
