// Outils (capacités) qu'Andréa peut utiliser pendant une conversation, version téléphone.
// Mémoire et notes sont enregistrées sur l'appareil.

import { calculate } from "./calc.js";

export const TOOL_LABELS = {
  date_et_heure: "consulte l'horloge",
  calculer: "calcule",
  memoriser: "mémorise",
  se_souvenir: "fouille sa mémoire",
  oublier: "oublie",
  ajouter_note: "prend une note",
  lister_notes: "lit les notes",
  supprimer_note: "supprime une note",
  infos_appareil: "examine l'appareil",
  ouvrir_site_web: "prépare un lien",
  minuteur: "programme un minuteur",
};

function tool(name, description, properties = {}, required = []) {
  return {
    name,
    description,
    eager_input_streaming: true,
    input_schema: { type: "object", properties, required, additionalProperties: false },
  };
}

const DEFINITIONS = [
  tool("date_et_heure", "Donne la date et l'heure locales actuelles."),
  tool(
    "calculer",
    "Évalue une expression mathématique (+ - * / % ^, sqrt, sin, cos, log, pi...).",
    { expression: { type: "string", description: "Ex : '(12*3)+sqrt(16)'" } },
    ["expression"],
  ),
  tool(
    "memoriser",
    "Enregistre durablement une information sur l'utilisateur ou ses préférences.",
    {
      cle: { type: "string", description: "Nom court, ex : 'couleur_preferee'" },
      valeur: { type: "string" },
    },
    ["cle", "valeur"],
  ),
  tool("se_souvenir", "Relit la mémoire à long terme. Sans 'recherche', renvoie tout.", {
    recherche: { type: "string", description: "Mot-clé optionnel" },
  }),
  tool("oublier", "Efface une information mémorisée.", { cle: { type: "string" } }, ["cle"]),
  tool("ajouter_note", "Ajoute une note ou une tâche à la liste.", { texte: { type: "string" } }, ["texte"]),
  tool("lister_notes", "Liste toutes les notes et tâches."),
  tool(
    "supprimer_note",
    "Supprime une note par son numéro (commence à 1).",
    { numero: { type: "integer" } },
    ["numero"],
  ),
  tool("infos_appareil", "Donne l'état du téléphone (appareil, écran, batterie, connexion)."),
  tool(
    "ouvrir_site_web",
    "Affiche à l'écran un lien http(s) que l'utilisateur peut toucher pour ouvrir le site.",
    { url: { type: "string" } },
    ["url"],
  ),
  tool(
    "minuteur",
    "Lance un minuteur/rappel. Il ne sonne que si l'application reste ouverte à l'écran.",
    {
      secondes: { type: "integer", description: "Durée en secondes (1 à 86400)" },
      message: { type: "string", description: "Texte du rappel" },
    },
    ["secondes", "message"],
  ),
];
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 5 };

export class Toolbox {
  /**
   * @param store      stockage local (mémoire, notes)
   * @param webSearch  autorise la recherche web
   * @param onNotify   appelé quand un minuteur arrive à son terme
   * @param onLink     appelé pour afficher un lien à l'écran
   */
  constructor({ store, webSearch = true, onNotify = () => {}, onLink = () => {} }) {
    this.store = store;
    this.webSearch = webSearch;
    this.onNotify = onNotify;
    this.onLink = onLink;
    this.timers = new Set();
  }

  definitions() {
    return this.webSearch ? [...DEFINITIONS, WEB_SEARCH] : DEFINITIONS;
  }

  /** Exécute un outil. Renvoie { content, isError } ; ne lève jamais d'erreur. */
  async run(name, args) {
    const definition = DEFINITIONS.find((candidate) => candidate.name === name);
    if (!definition) return { content: `Outil inconnu : ${name}`, isError: true };
    const problem = validate(definition.input_schema, args);
    if (problem) return { content: problem, isError: true };
    try {
      return { content: await this[name](args), isError: false };
    } catch (error) {
      return { content: `Erreur : ${error.message}`, isError: true };
    }
  }

  cancelTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // ----- Implémentations --------------------------------------------------

  date_et_heure() {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "long" }).format(new Date());
  }

  calculer({ expression }) {
    return `${expression} = ${calculate(expression)}`;
  }

  memoriser({ cle, valeur }) {
    const memory = this.store.get("memoire", {});
    memory[cle] = { valeur, date: new Date().toISOString() };
    if (!this.store.set("memoire", memory)) throw new Error("le stockage de l'appareil est plein");
    return `Mémorisé : ${cle} = ${valeur}`;
  }

  se_souvenir({ recherche = "" }) {
    const query = recherche.toLowerCase().trim();
    const lines = Object.entries(this.store.get("memoire", {}))
      .filter(([key, item]) => !query || key.toLowerCase().includes(query) || String(item.valeur).toLowerCase().includes(query))
      .map(([key, item]) => `- ${key} : ${item.valeur}`);
    return lines.length ? lines.join("\n") : "Aucun souvenir correspondant.";
  }

  oublier({ cle }) {
    const memory = this.store.get("memoire", {});
    if (!Object.hasOwn(memory, cle)) return `Aucun souvenir nommé « ${cle} ».`;
    delete memory[cle];
    this.store.set("memoire", memory);
    return `Oublié : ${cle}`;
  }

  ajouter_note({ texte }) {
    const notes = this.store.get("notes", []);
    notes.push({ texte, date: new Date().toISOString().slice(0, 16) });
    if (!this.store.set("notes", notes)) throw new Error("le stockage de l'appareil est plein");
    return `Note n°${notes.length} ajoutée.`;
  }

  lister_notes() {
    const notes = this.store.get("notes", []);
    if (!notes.length) return "La liste de notes est vide.";
    return notes.map((note, index) => `${index + 1}. ${note.texte} (${note.date})`).join("\n");
  }

  supprimer_note({ numero }) {
    const notes = this.store.get("notes", []);
    if (numero < 1 || numero > notes.length) return `Numéro invalide (1 à ${notes.length}).`;
    const [removed] = notes.splice(numero - 1, 1);
    this.store.set("notes", notes);
    return `Note supprimée : ${removed.texte}`;
  }

  async infos_appareil() {
    const nav = globalThis.navigator ?? {};
    const lines = [`Appareil : ${nav.userAgent ?? "inconnu"}`];
    if (globalThis.screen) lines.push(`Écran : ${screen.width} × ${screen.height} points`);
    lines.push(`Connexion : ${nav.onLine === false ? "hors ligne" : "en ligne"}${nav.connection?.effectiveType ? ` (${nav.connection.effectiveType})` : ""}`);
    if (nav.language) lines.push(`Langue : ${nav.language}`);
    try {
      const battery = await nav.getBattery?.();
      if (battery) lines.push(`Batterie : ${Math.round(battery.level * 100)} %${battery.charging ? ", en charge" : ""}`);
    } catch {
      /* information indisponible sur ce navigateur */
    }
    return lines.join("\n");
  }

  ouvrir_site_web({ url }) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      return "Seules les URL http(s) complètes sont autorisées.";
    }
    this.onLink(parsed.href);
    return `Lien vers ${parsed.hostname} affiché à l'écran. Sur téléphone, un site ne s'ouvre pas tout seul : l'utilisateur doit toucher le lien.`;
  }

  minuteur({ secondes, message }) {
    if (secondes < 1 || secondes > 86400) return "La durée doit être comprise entre 1 seconde et 24 heures.";
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.onNotify(`Rappel : ${message}`);
    }, secondes * 1000);
    this.timers.add(timer);
    return `Minuteur lancé : « ${message} » dans ${secondes} s. Il ne sonnera que si l'application reste ouverte à l'écran.`;
  }
}

/** Vérifie les paramètres reçus du modèle. Renvoie un message d'erreur, ou null. */
function validate(schema, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return JSON.stringify({ INVALID_JSON: JSON.stringify(args) });
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(args, key)) return `Paramètre manquant : ${key}`;
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = Object.hasOwn(schema.properties, key) ? schema.properties[key] : null;
    if (!spec) return `Paramètre inattendu : ${key}`;
    const valid = spec.type === "integer" ? Number.isInteger(value) : typeof value === "string";
    if (!valid) return `Type invalide pour ${key} (attendu : ${spec.type})`;
  }
  return null;
}
