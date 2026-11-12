# Andréa 🤖

**Andréa** est une assistante personnelle intelligente inspirée de J.A.R.V.I.S. (l'IA de Tony Stark).
Elle parle français, vous vouvoie, a de l'humour, se souvient de vous et agit grâce à ses outils.
Elle est propulsée par Claude (API Anthropic).

```
Andréa › Bonjour Monsieur. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?

Vous › Rappelle-moi de sortir le gâteau du four dans 10 minutes
[Andréa programme un minuteur…]
Andréa › C'est noté, Monsieur. Je vous préviendrai dans dix minutes — le gâteau n'a qu'à bien se tenir.
```

## Capacités

| Capacité | Exemple |
|---|---|
| 💬 Conversation naturelle avec personnalité | « Andréa, comment vas-tu ? » |
| 🧠 Mémoire à long terme (entre les sessions) | « Je m'appelle Théo et j'adore le jazz » |
| 📝 Notes et liste de tâches | « Ajoute "appeler le garage" à mes tâches » |
| ⏰ Minuteurs et rappels | « Préviens-moi dans 5 minutes » |
| 🧮 Calculs | « Combien font 17 % de 2 340 ? » |
| 🌐 Recherche web avec sources | « Quelles sont les actualités du jour ? » |
| 🖥️ État du système | « Comment va mon ordinateur ? » |
| 🔗 Ouverture de sites | « Ouvre YouTube » |
| 🎙️ Mode vocal avec mot d'éveil « Andréa » | « Andréa, quelle heure est-il ? » |

## Installation

Python 3.10 ou plus récent est requis.

```bash
git clone https://github.com/KLT-Kyodai/Andr-a-.git
cd Andr-a-
pip install -e .            # mode texte
pip install -e ".[voix]"    # + mode vocal (micro et synthèse vocale)
```

Créez une clé API sur <https://platform.claude.com> puis :

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # Windows : set ANTHROPIC_API_KEY=sk-ant-...
```

> Mode vocal sous Linux : `sudo apt install espeak-ng portaudio19-dev` avant l'installation.

## Utilisation

```bash
andrea                          # conversation au clavier
andrea --voix                   # conversation à la voix (dites « Andréa, … »)
andrea --nom "Théo"             # Andréa vous appellera Théo
andrea "Quelle heure est-il ?"  # question unique
```

Commandes pendant la conversation : `/aide`, `/oublie` (nouvelle conversation, la mémoire reste), `/quitter`.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `ANDREA_USER_NAME` | `Monsieur` | Comment Andréa vous appelle |
| `ANDREA_MODEL` | `claude-opus-5-5` | Modèle Claude utilisé |
| `ANDREA_EFFORT` | `medium` | Profondeur de réflexion : `low`, `medium`, `high`, `xhigh`, `max` |
| `ANDREA_WEB_SEARCH` | `true` | Active la recherche web |
| `ANDREA_VOICE` | `false` | Active le mode vocal par défaut |
| `ANDREA_DATA_DIR` | `~/.andrea` | Dossier de la mémoire et des notes |

## Architecture

```
andrea/
├── brain.py   # cerveau : personnalité, boucle de conversation et d'outils (streaming)
├── tools.py   # outils : mémoire, notes, minuteurs, calculs, système, navigateur
├── voice.py   # voix : synthèse (pyttsx3), reconnaissance (SpeechRecognition), mot d'éveil
├── config.py  # configuration via variables d'environnement
└── cli.py     # interface terminal
```

Ajouter une capacité : écrivez une méthode dans `Toolbox` (`andrea/tools.py`), ajoutez sa définition
dans `definitions()` et enregistrez-la dans `_handlers`. Andréa saura l'utiliser automatiquement.

Détails techniques : réflexion adaptative, streaming, cache de prompt, résumé automatique des longues
conversations (compaction) et bascule automatique de modèle en cas de refus (`fallbacks: "default"`).

## Tests

```bash
pip install -e ".[dev]"
pytest
```
