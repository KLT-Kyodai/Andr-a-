// Andréa dans Claude : ce qui change quand la page est publiée comme artefact claude.ai.
// Elle n'a plus besoin de clé API : elle passe par le compte Claude de la personne qui
// l'ouvre (capacité « sample »), et peut utiliser la voix, la dictée et la base de données
// que la plateforme met à disposition. Chaque capacité peut manquer : tout est prévu pour.

import { persona } from "../docs/js/brain.js";
import { splitForSpeech } from "../docs/js/speech.js";

const MAX_TURNS = 40; // au-delà, les plus anciens échanges ne sont plus renvoyés
const MAX_SPOKEN = 1800; // caractères par passage lu (la plateforme en accepte 2 000)

/** Consignes permanentes : sans « prompt système », elles ouvrent chaque demande. */
export function instructions(userName) {
  return `Consignes permanentes pour toute cette conversation (ne les répète pas, ne les commente pas).

${persona(userName)}

Façon de travailler :
- Tu fonctionnes sur le téléphone de l'utilisateur : tes réponses s'affichent sur un petit \
écran et sont souvent lues à voix haute. Écris comme on parle : phrases courtes et \
naturelles, peu de mise en forme, pas de tableaux ni d'émojis. Détaille seulement si on \
te le demande.
- Utilise tes outils dès qu'ils sont utiles (heure, calculs, mémoire, notes, minuteurs, \
liens) plutôt que de deviner. Ne décris pas tes appels d'outils : donne le résultat.
- Quand l'utilisateur partage une information personnelle durable (prénom, goûts, \
projets, habitudes), mémorise-la. Consulte ta mémoire quand le contexte s'y prête.
- Tu n'as pas accès à Internet ici : pour une information récente (actualité, météo, \
prix), dis-le simplement au lieu d'inventer.
- Si aucun outil ne permet de faire ce qui est demandé, dis-le franchement.`;
}

/** Message à afficher pour chaque échec de la plateforme : [texte, gravité, garder le brouillon ?]. */
export function explain(error) {
  switch (error?.code) {
    case "cancelled":
      return ["Réponse interrompue.", ""];
    case "not_granted":
      return ["Andréa n'a pas été autorisée à utiliser Claude. Rechargez la page pour qu'elle vous le redemande.", "error"];
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      return ["Claude n'est pas disponible ici pour ce compte.", "error"];
    case "rate_limited":
      return ["Limite d'utilisation de Claude atteinte. Réessayez un peu plus tard.", "error"];
    case "session_expired":
      return ["Votre session Claude a expiré : reconnectez-vous, puis rechargez la page.", "error"];
    case "refused":
      return ["Je crains de ne pas pouvoir donner suite à cette demande.", ""];
    case "prompt_too_large":
      return ["La conversation est devenue trop longue : commencez-en une nouvelle avec le bouton +.", "error"];
    default:
      return ["Un problème est survenu. Réessayez dans un instant.", "error"];
  }
}

/** Le cerveau d'Andréa quand Claude est fourni par la plateforme. */
export class Andrea {
  /**
   * @param sample    capacité « sample » de la plateforme
   * @param toolbox   outils d'Andréa (mêmes que la version web)
   * @param userName  comment Andréa appelle l'utilisateur
   * @param tier      "quick" (réponses vives) ou "default" (plus réfléchies, plus lentes)
   * @param callbacks onText(morceau), onTool(nom)
   */
  constructor({ sample, toolbox, userName = "Monsieur", tier = "quick", callbacks = {} }) {
    this.sample = sample;
    this.toolbox = toolbox;
    this.rules = instructions(userName);
    this.tier = tier;
    this.callbacks = { onText: () => {}, onTool: () => {}, ...callbacks };
    this.messages = []; // [{ role, content }] : seule la page garde la conversation
    this.controller = null;
    this.toolLimit = null; // nombre d'outils accepté ; 0 si cette vue n'en accepte pas
    this.queue = Promise.resolve();
  }

  reset() {
    this.messages = [];
  }

  /** Interrompt la réponse en cours. */
  stop() {
    this.controller?.abort();
  }

  async tools() {
    if (this.toolLimit === null) {
      const limits = await this.sample.limits().catch(() => null);
      this.toolLimit = limits?.tools?.maxCount ?? 0;
    }
    return this.toolbox
      .definitions()
      .filter((tool) => tool.input_schema)
      .slice(0, this.toolLimit)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
        execute: (input) => this.runTool(tool.name, input),
      }));
  }

  /** Les outils d'un même tour arrivent en parallèle : on les exécute un par un. */
  runTool(name, input) {
    const run = this.queue.then(async () => {
      this.callbacks.onTool(name, input);
      const { content, isError } = await this.toolbox.run(name, input);
      if (isError) throw new Error(content);
      return content;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Envoie un message à Andréa et renvoie sa réponse complète. */
  async ask(userInput) {
    const history = this.messages.slice(-MAX_TURNS);
    while (history.length && history[0].role !== "user") history.shift();
    const turns = [{ role: "user", content: this.rules }, ...history, { role: "user", content: userInput }];

    const tools = await this.tools();
    const options = {
      cache: false, // une conversation : chaque demande mérite une vraie réponse
      modelTier: this.tier,
      onText: ({ delta }) => this.callbacks.onText(delta),
    };
    if (tools.length) options.tools = tools;
    this.controller = new AbortController();
    options.signal = this.controller.signal;
    try {
      const { text } = await this.sample(turns, options);
      this.messages.push({ role: "user", content: userInput }, { role: "assistant", content: text });
      return text;
    } finally {
      this.controller = null;
    }
  }
}

/** Coupe un texte en passages d'au plus `size` caractères, sans casser les phrases. */
function passages(text, size = MAX_SPOKEN) {
  const parts = [];
  let current = "";
  for (const sentence of splitForSpeech(text)) {
    for (let start = 0; start < sentence.length; start += size) {
      const piece = sentence.slice(start, start + size);
      if (current && current.length + piece.length + 1 > size) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** La voix de Claude fournie par la plateforme (capacité « tts »), lue paragraphe par paragraphe. */
export class ClaudeVoice {
  constructor(tts) {
    this.tts = tts;
    this.enabled = true;
    this.rate = 1;
    this.supported = true;
    this.speaking = false;
    this.onChange = () => {};
    this.buffer = "";
    tts.onState(({ state }) => {
      this.speaking = state !== "idle";
      this.onChange();
    });
  }

  unlock() {}

  /** Reçoit un morceau de réponse ; lit chaque paragraphe dès qu'il est complet. */
  feed(chunk) {
    this.buffer += chunk;
    let cut = this.buffer.lastIndexOf("\n\n");
    // On ne coupe jamais au milieu d'un bloc de code.
    while (cut !== -1 && (this.buffer.slice(0, cut).split("```").length - 1) % 2 === 1) {
      cut = this.buffer.lastIndexOf("\n\n", cut - 1);
    }
    if (cut === -1) return;
    this.read(this.buffer.slice(0, cut));
    this.buffer = this.buffer.slice(cut + 2);
  }

  flush() {
    this.read(this.buffer);
    this.buffer = "";
  }

  say(text) {
    this.read(text);
  }

  stop() {
    this.buffer = "";
    this.tts.stop().catch(() => {});
  }

  read(text) {
    if (!this.enabled) return;
    for (const passage of passages(text)) {
      // Un refus (limite atteinte, dictée en cours, arrêt demandé) ne doit rien casser.
      this.tts.add([{ text: passage, language: "fr", rate: this.rate }]).catch(() => {});
    }
  }
}

/** La dictée fournie par la plateforme (capacité « dictation »). */
export class ClaudeDictation {
  constructor(dictation) {
    this.dictation = dictation;
    this.supported = true;
    this.listening = false;
    this.onChange = () => {};
    this.handlers = null;
    this.settled = "";
    dictation.onPartial(({ text }) => this.handlers?.onHeard((this.settled + text).trimStart()));
    dictation.onFinal(({ text }) => {
      this.settled += text;
      this.handlers?.onHeard(this.settled.trimStart());
    });
    dictation.onState(({ state, reason }) => {
      const was = this.listening;
      this.listening = state !== "idle";
      if (was && !this.listening) {
        const handlers = this.handlers;
        this.handlers = null;
        // Seul l'arrêt demandé depuis la page envoie le message ; sinon il reste à relire.
        handlers?.onDone(reason === "stopped" ? this.settled.trim() : "");
      }
      this.onChange();
    });
  }

  /** À appeler directement depuis le toucher du bouton micro. */
  start({ onHeard = () => {}, onDone = () => {}, onError = () => {} }) {
    this.settled = "";
    this.handlers = { onHeard, onDone };
    this.dictation.start().catch((error) => {
      if (error?.code === "stopped" || error?.code === "dismissed") return;
      this.handlers = null;
      onError(error?.code === "not_granted" ? "not-allowed" : error?.code);
    });
  }

  stop() {
    this.dictation.stop().catch(() => {});
  }
}

/**
 * Mémoire et notes rangées dans la base privée de l'utilisateur : elles le suivent d'un
 * appareil à l'autre. Une copie locale sert de secours si la base ne répond pas.
 */
export class CloudStore {
  constructor(db, userId, local) {
    this.db = db;
    this.userId = userId;
    this.local = local;
  }

  ref(key) {
    return this.db.doc(`data/users/${this.userId}/${key}`);
  }

  async get(key, fallback) {
    try {
      const snapshot = await this.ref(key).get();
      const value = snapshot.exists ? snapshot.data().value : undefined;
      // Les données lues sont figées : on en fait une copie modifiable.
      return value === undefined ? this.local.get(key, fallback) : JSON.parse(JSON.stringify(value));
    } catch {
      return this.local.get(key, fallback);
    }
  }

  async set(key, value) {
    const kept = this.local.set(key, value);
    try {
      await this.ref(key).set({ value });
      return true;
    } catch {
      return kept;
    }
  }

  async remove(key) {
    this.local.remove(key);
    await this.ref(key).delete().catch(() => {});
  }
}
