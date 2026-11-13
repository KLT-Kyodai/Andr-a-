// Version « dans Claude » : les capacités de la plateforme sont simulées.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Andrea, ClaudeDictation, ClaudeVoice, CloudStore, explain } from "../../artifact/platform.js";
import { Store } from "../../docs/js/store.js";
import { Toolbox } from "../../docs/js/tools.js";

function localStore() {
  const data = new Map();
  return new Store({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) });
}

function fakeSample(script) {
  const calls = [];
  const sample = async (turns, options) => {
    calls.push({ turns, options });
    const text = await script(turns, options);
    options.onText({ text, delta: text });
    return { text, truncated: false };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
  return { sample, calls };
}

test("conversation : consignes en tête, outils de la page, historique gardé par la page", async () => {
  const seen = { text: "", tools: [] };
  const { sample, calls } = fakeSample(async (turns, options) => {
    if (!turns.at(-1).content.includes("6 fois 7")) return "Bien sûr.";
    const tool = options.tools.find((candidate) => candidate.name === "calculer");
    return `Cela fait ${(await tool.execute({ expression: "6*7" })).split("= ")[1]}.`;
  });
  const andrea = new Andrea({
    sample,
    toolbox: new Toolbox({ store: localStore(), webSearch: false }),
    userName: "Théo",
    callbacks: { onText: (t) => (seen.text += t), onTool: (name) => seen.tools.push(name) },
  });
  assert.equal(await andrea.ask("Combien font 6 fois 7 ?"), "Cela fait 42.");
  assert.equal(await andrea.ask("Merci"), "Bien sûr.");
  assert.deepEqual(seen, { text: "Cela fait 42.Bien sûr.", tools: ["calculer"] });

  const { turns, options } = calls[1];
  assert.match(turns[0].content, /Tu sers Théo/);
  assert.deepEqual(turns.slice(1).map((turn) => turn.role), ["user", "assistant", "user"]);
  assert.equal(options.cache, false);
  assert.equal(options.modelTier, "quick");
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(options.tools.every((tool) => tool.inputSchema.type === "object" && typeof tool.execute === "function"));
  assert.ok(!options.tools.some((tool) => tool.name === "web_search"));
});

test("un outil qui échoue prévient Claude sans casser la réponse ; un échec ne laisse pas de trace", async () => {
  const { sample } = fakeSample(async (turns, options) => {
    if (turns.at(-1).content === "panne") throw { code: "rate_limited", message: "x" };
    await assert.rejects(options.tools.find((t) => t.name === "calculer").execute({ expression: "alert(1)" }), /fonction inconnue/);
    return "Je ne peux pas calculer cela.";
  });
  const andrea = new Andrea({ sample, toolbox: new Toolbox({ store: localStore(), webSearch: false }) });
  assert.equal(await andrea.ask("calcule"), "Je ne peux pas calculer cela.");
  await assert.rejects(andrea.ask("panne"), (error) => error.code === "rate_limited");
  assert.equal(andrea.messages.length, 2);
  assert.match(explain({ code: "rate_limited" })[0], /Limite/);
  assert.equal(explain({ code: "cancelled" })[1], "");
  assert.match(explain({ code: "code_inconnu" })[0], /Réessayez/);
});

test("sans outils disponibles dans cette vue, Andréa répond quand même", async () => {
  const { sample, calls } = fakeSample(async () => "Bonjour.");
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  const andrea = new Andrea({ sample, toolbox: new Toolbox({ store: localStore(), webSearch: false }) });
  assert.equal(await andrea.ask("Bonjour"), "Bonjour.");
  assert.equal(calls[0].options.tools, undefined);
});

function fakeTts() {
  const tts = { lines: [], stops: 0, handler: null };
  tts.add = async (lines) => (tts.lines.push(...lines), { playedMs: 1 });
  tts.stop = async () => void tts.stops++;
  tts.onState = (handler) => (tts.handler = handler);
  return tts;
}

test("voix de Claude : lecture paragraphe par paragraphe, texte nettoyé, code jamais lu", () => {
  const tts = fakeTts();
  const voice = new ClaudeVoice(tts);
  voice.rate = 1.2;
  voice.feed("Bonjour **Monsieur** 🚀. Voici :\n\n```js\nlet a = 1;\n\nlet b = 2;\n```\n\nC'est");
  // Tout ce qui est complet part en un seul passage ; le bloc de code n'est pas coupé en deux.
  assert.deepEqual(tts.lines.map((line) => line.text), ["Bonjour Monsieur. Voici : Le code est affiché à l'écran."]);
  voice.feed(" tout.");
  voice.flush();
  assert.equal(tts.lines.at(-1).text, "C'est tout.");
  assert.deepEqual([tts.lines[0].language, tts.lines[0].rate], ["fr", 1.2]);

  tts.handler({ state: "speaking" });
  assert.equal(voice.speaking, true);
  voice.stop();
  assert.equal(tts.stops, 1);
  voice.enabled = false;
  voice.say("Silence.");
  assert.equal(tts.lines.length, 2);
});

test("voix de Claude : un long texte est découpé sous la limite de la plateforme", () => {
  const tts = fakeTts();
  new ClaudeVoice(tts).say("Une phrase assez longue pour remplir. ".repeat(120));
  assert.ok(tts.lines.length >= 3);
  assert.ok(tts.lines.every((line) => line.text.length <= 1800));
});

test("dictée : le texte s'affiche au fil de l'eau et part quand on arrête depuis la page", async () => {
  const handlers = {};
  const dictation = {
    start: async () => handlers.state({ state: "listening" }),
    stop: async () => handlers.state({ state: "idle", reason: "stopped" }),
    onPartial: (fn) => (handlers.partial = fn),
    onFinal: (fn) => (handlers.final = fn),
    onState: (fn) => (handlers.state = fn),
  };
  const listener = new ClaudeDictation(dictation);
  const heard = [];
  let done;
  listener.start({ onHeard: (text) => heard.push(text), onDone: (text) => (done = text) });
  await Promise.resolve();
  assert.equal(listener.listening, true);
  handlers.partial({ text: "quelle heu" });
  handlers.final({ text: " Quelle heure" });
  handlers.final({ text: " est-il ?" });
  listener.stop();
  await Promise.resolve();
  assert.deepEqual(heard, ["quelle heu", "Quelle heure", "Quelle heure est-il ?"]);
  assert.equal(done, "Quelle heure est-il ?");
  assert.equal(listener.listening, false);

  // Arrêt par le bouton de la plateforme : le texte reste à relire, rien n'est envoyé.
  listener.start({ onDone: (text) => (done = text) });
  await Promise.resolve();
  handlers.final({ text: " Brouillon" });
  handlers.state({ state: "idle", reason: "viewer_stopped" });
  assert.equal(done, "");
});

test("mémoire en ligne : privée par personne, copie modifiable, secours local", async () => {
  const docs = new Map();
  let broken = false;
  const db = {
    doc: (path) => ({
      get: async () => {
        if (broken) throw new Error("hors ligne");
        return { exists: docs.has(path), data: () => Object.freeze(docs.get(path)) };
      },
      set: async (data) => {
        if (broken) throw new Error("hors ligne");
        docs.set(path, Object.freeze(JSON.parse(JSON.stringify(data))));
      },
      delete: async () => void docs.delete(path),
    }),
  };
  const local = localStore();
  const tools = new Toolbox({ store: new CloudStore(db, "u_42", local), webSearch: false });
  await tools.run("memoriser", { cle: "prenom", valeur: "Théo" });
  await tools.run("memoriser", { cle: "ville", valeur: "Lyon" });
  assert.deepEqual(Object.keys(docs.get("data/users/u_42/memoire").value), ["prenom", "ville"]);

  broken = true; // la base ne répond plus : la copie locale prend le relais
  assert.match((await tools.run("se_souvenir", {})).content, /Théo[\s\S]*Lyon/);
  assert.equal((await tools.run("ajouter_note", { texte: "Pain" })).isError, false);
  assert.equal(local.get("notes", []).length, 1);
});
