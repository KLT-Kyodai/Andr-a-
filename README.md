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
| 🔊 Synthèse vocale : elle lit ses réponses à voix haute | `andrea --parle` |
| 🗣️ Voix en ligne plus naturelle (optionnelle) | `andrea --naturelle` |
| 🎙️ Mode vocal complet avec mot d'éveil « Andréa » | « Andréa, quelle heure est-il ? » |
| 📱 Version téléphone (application web installable) | voir [Sur téléphone](#-sur-téléphone) |

## 📱 Sur téléphone

Andréa existe aussi en application web, dans le dossier `docs/`. Elle fonctionne dans le navigateur
d'un téléphone Android ou d'un iPhone, sans rien installer : on lui écrit ou on lui parle, et elle
répond à l'écran et à voix haute avec la voix du téléphone.

**1. Mettre l'application en ligne (une seule fois, gratuit)** avec GitHub Pages :

1. Sur GitHub, ouvrez le dépôt puis **Settings › Pages**.
2. Sous *Build and deployment*, choisissez **Deploy from a branch**.
3. Choisissez la branche qui contient le dossier `docs`, puis le dossier **/docs**, et **Save**.
4. Une minute plus tard, l'application est à l'adresse `https://<votre-compte>.github.io/<nom-du-dépôt>/`
   (pour ce dépôt : <https://klt-kyodai.github.io/Andr-a-/>).

**2. L'ouvrir sur le téléphone** : allez à cette adresse, puis dans les réglages qui s'affichent
collez votre clé API Anthropic (à créer sur <https://platform.claude.com/settings/keys>).

**3. L'installer comme une application** (facultatif) :
- Android (Chrome) : menu **⋮ › Ajouter à l'écran d'accueil**.
- iPhone (Safari) : bouton **Partager › Sur l'écran d'accueil**.

Ce qu'elle sait faire : conversation, mémoire, notes, calculs, minuteurs, recherche web, liens,
lecture à voix haute (bouton haut-parleur) et dictée (bouton micro).

À savoir :

- **Votre clé API reste sur le téléphone** (stockage du navigateur) et n'est envoyée qu'à Anthropic.
  Toute personne qui a accès à votre navigateur peut l'utiliser : fixez une limite de dépense à la clé.
  « Tout effacer », dans les réglages, la supprime de l'appareil.
- La mémoire, les notes et la conversation sont enregistrées sur le téléphone ; elles ne sont pas
  partagées avec la version ordinateur.
- Les minuteurs ne sonnent que si l'application reste ouverte à l'écran.
- La voix est celle du téléphone. Le micro dépend du navigateur : il fonctionne dans Chrome
  (Android) et Safari (iPhone) ; sinon, utilisez la dictée du clavier.
- Un site ne s'ouvre pas tout seul : Andréa affiche un lien à toucher.

Pour l'essayer sur un ordinateur : `python -m http.server -d docs 8000`, puis <http://localhost:8000>.

## Installation (ordinateur)

Python 3.10 ou plus récent est requis.

```bash
git clone https://github.com/KLT-Kyodai/Andr-a-.git
cd Andr-a-
pip install -e .            # texte + synthèse vocale
pip install -e ".[naturelle]"   # + voix en ligne plus naturelle
pip install -e ".[voix]"        # + reconnaissance vocale au micro
```

Créez une clé API sur <https://platform.claude.com> puis :

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # Windows : set ANTHROPIC_API_KEY=sk-ant-...
```

> Sous Linux : `sudo apt install espeak-ng` pour la synthèse vocale, et `portaudio19-dev` pour le micro.

## Utilisation

```bash
andrea                          # conversation au clavier
andrea --parle                  # au clavier, et Andréa répond à voix haute
andrea --naturelle              # pareil, avec la voix en ligne plus naturelle
andrea --voix                   # tout à la voix (dites « Andréa, … »)
andrea --nom "Théo"             # Andréa vous appellera Théo
andrea "Quelle heure est-il ?"  # question unique
```

Commandes pendant la conversation : `/aide`, `/parle` et `/muet` (active ou coupe la voix),
`/oublie` (nouvelle conversation, la mémoire reste), `/quitter`.

### Synthèse vocale

Andréa lit ses réponses phrase par phrase, pendant qu'elles s'écrivent. Elle ne lit ni le code,
ni les émojis, ni la mise en forme. Une nouvelle demande, `/muet` ou Ctrl+C pendant une réponse lui coupent la parole.

Elle utilise la voix française de votre ordinateur, sans connexion Internet :

| Système | Moteur | Voix choisie par défaut |
|---|---|---|
| Windows | SAPI5 (via `pyttsx3`) | voix française de Windows (Hortense en général) |
| macOS | commande `say` | Audrey, Aurélie, Marie, Amélie ou Thomas, selon ce qui est installé |
| Linux | `espeak-ng` | `fr+f3` (voix de synthèse assez robotique) |

```bash
andrea --liste-voix                          # voix françaises installées
andrea --parle --choisir-voix "Thomas"       # changer de voix
andrea --parle --vitesse 160                 # parler plus lentement (défaut : 175 mots/minute)
```

S'il n'y a aucune voix française, `andrea --liste-voix` explique comment en installer une.

### Voix en ligne plus naturelle

Les voix des ordinateurs sont souvent un peu mécaniques. Avec `--naturelle`, Andréa utilise à la
place une voix neuronale en ligne, bien plus proche d'une voix humaine (par défaut : Denise).

```bash
pip install -e ".[naturelle]"                # à faire une fois
andrea --naturelle                           # clavier + voix naturelle
andrea --voix --naturelle                    # micro + voix naturelle
andrea --naturelle --liste-voix              # voix françaises proposées
andrea --naturelle --choisir-voix "Henri"    # changer de voix
```

Pour l'utiliser à chaque fois sans retaper l'option : `ANDREA_TTS_ENGINE=naturelle` et `ANDREA_SPEAK=true`.

À savoir avant de l'activer :

- **Vos réponses partent sur Internet.** Le texte de chaque phrase dite est envoyé au service
  « Lecture à voix haute » de Microsoft Edge, qui renvoie le son. Sans `--naturelle`, rien n'est envoyé.
- **Le service est gratuit et sans compte, mais non officiel** : Andréa y accède par la bibliothèque
  `edge-tts`, que Microsoft ne garantit pas. Il peut cesser de fonctionner sans prévenir.
- **En cas de panne** (pas d'Internet, service indisponible), Andréa le signale et continue avec la
  voix de l'ordinateur.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `ANDREA_USER_NAME` | `Monsieur` | Comment Andréa vous appelle |
| `ANDREA_MODEL` | `claude-opus-5-5` | Modèle Claude utilisé |
| `ANDREA_EFFORT` | `medium` | Profondeur de réflexion : `low`, `medium`, `high`, `xhigh`, `max` |
| `ANDREA_WEB_SEARCH` | `true` | Active la recherche web |
| `ANDREA_SPEAK` | `false` | Andréa parle à voix haute par défaut (comme `--parle`) |
| `ANDREA_VOICE` | `false` | Mode vocal complet par défaut (comme `--voix`) |
| `ANDREA_TTS_ENGINE` | `systeme` | `naturelle` pour la voix en ligne (comme `--naturelle`) |
| `ANDREA_TTS_VOICE` | *(auto)* | Nom de la voix à utiliser |
| `ANDREA_TTS_RATE` | `175` | Débit de la voix, en mots par minute |
| `ANDREA_DATA_DIR` | `~/.andrea` | Dossier de la mémoire et des notes |

## Architecture

```
andrea/              # version ordinateur (Python)
├── brain.py         # cerveau : personnalité, boucle de conversation et d'outils (streaming)
├── tools.py         # outils : mémoire, notes, minuteurs, calculs, système, navigateur
├── speak.py         # parole : synthèse vocale phrase par phrase, choix de la voix
├── voice_online.py  # voix en ligne plus naturelle (edge-tts + pygame), repli automatique
├── listen.py        # écoute : reconnaissance vocale (SpeechRecognition), mot d'éveil
├── config.py        # configuration via variables d'environnement
└── cli.py           # interface terminal
docs/                # version téléphone (application web, sans étape de construction)
├── index.html, style.css, manifest.webmanifest, sw.js
├── js/              # app.js (écran), brain.js, tools.js, speech.js, calc.js, markdown.js, store.js
└── vendor/          # SDK officiel d'Anthropic, embarqué
```

Ajouter une capacité : écrivez une méthode dans `Toolbox` (`andrea/tools.py`), ajoutez sa définition
dans `definitions()` et enregistrez-la dans `_handlers`. Andréa saura l'utiliser automatiquement.

Détails techniques : réflexion adaptative, streaming, cache de prompt, résumé automatique des longues
conversations (compaction) et bascule automatique de modèle en cas de refus (`fallbacks: "default"`).

## Tests

```bash
pip install -e ".[dev]"
pytest                      # version ordinateur
npm test                    # version téléphone (Node 22 ou plus, aucune dépendance)
node tests/web/e2e.mjs      # version téléphone dans un vrai navigateur (nécessite Playwright)
```
