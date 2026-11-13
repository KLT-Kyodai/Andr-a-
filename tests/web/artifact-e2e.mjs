// Essai de bout en bout de la version « dans Claude », dans un navigateur réglé comme un
// téléphone. La plateforme (window.claude) est simulée : réponses, voix, dictée, base.
//
//   npm run build:artifact && node tests/web/artifact-e2e.mjs [dossier-pour-les-captures]

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const SHOTS = process.argv[2];
const page_html = await readFile(fileURLToPath(new URL("../../artifact/dist/andrea.html", import.meta.url)), "utf8");
// Même enveloppe que celle ajoutée à la publication.
const document_html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page_html}</body></html>`;

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "fr-FR" });
await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
await context.route("http://andrea.test/", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: document_html }));
await context.addInitScript(() => {
  const state = (window.__claude = { spoken: [], calls: [], docs: JSON.parse(sessionStorage.getItem("docs") || "{}"), fail: null });
  const persist = () => sessionStorage.setItem("docs", JSON.stringify(state.docs));
  let ttsState = () => {};
  let dictation = {};
  const sample = async (turns, options) => {
    state.calls.push({ turns, tier: options.modelTier, tools: (options.tools || []).map((tool) => tool.name) });
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (state.fail) throw { code: state.fail, message: "simulé" };
    const question = turns.at(-1).content;
    const tool = (name) => options.tools.find((candidate) => candidate.name === name);
    let text = "À votre service.";
    if (question.includes("17 %")) text = `Cela fait **${(await tool("calculer").execute({ expression: "2340*17/100" })).split("= ")[1]}**.`;
    else if (question.includes("m'appelle")) text = `${await tool("memoriser").execute({ cle: "prenom", valeur: "Théo" })}. Enchantée 🚀`;
    else if (question.includes("souviens")) text = `Voici ce que je sais :\n${await tool("se_souvenir").execute({})}`;
    else if (question.includes("heure")) text = "Il est quatorze heures.";
    let shown = "";
    for (const piece of text.match(/.{1,12}/gs)) {
      if (options.signal.aborted) throw { code: "cancelled", message: "arrêt", text: shown };
      shown += piece;
      options.onText({ text: shown, delta: piece });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return { text, truncated: false, modelTierApplied: options.modelTier };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
  const capabilities = {
    sample,
    tts: {
      add: async (lines) => {
        state.spoken.push(...lines.map((line) => line.text));
        ttsState({ state: "speaking" });
        setTimeout(() => ttsState({ state: "idle", reason: "completed" }), 80);
        return { playedMs: 80 };
      },
      stop: async () => ttsState({ state: "idle", reason: "stopped" }),
      onState: (handler) => (ttsState = handler),
    },
    dictation: {
      start: async () => {
        dictation.state({ state: "listening" });
        setTimeout(() => dictation.final({ text: " Quelle heure est-il ?" }), 40);
      },
      stop: async () => dictation.state({ state: "idle", reason: "stopped" }),
      onPartial: (handler) => (dictation.partial = handler),
      onFinal: (handler) => (dictation.final = handler),
      onState: (handler) => (dictation.state = handler),
    },
    db: {
      doc: (path) => ({
        get: async () => ({ exists: path in state.docs, data: () => state.docs[path] }),
        set: async (data) => ((state.docs[path] = JSON.parse(JSON.stringify(data))), persist()),
        delete: async () => (delete state.docs[path], persist()),
      }),
    },
    user: { id: async () => "u_42" },
  };
  window.claude = { use: async (name) => capabilities[name] ?? null };
});

const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`erreur : ${error.message}`));
page.on("console", (message) => message.type() === "error" && problems.push(`console : ${message.text()}`));
const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
const bubbles = (role) => page.locator(`.bubble.${role}`).allInnerTexts();
const step = (label) => console.log(`✔ ${label}`);
const ask = async (text) => {
  await page.fill("#input", text);
  await page.press("#input", "Enter");
};

// 1. Accueil : un mot d'Andréa et des exemples à toucher ; aucun réglage obligatoire.
await page.goto("http://andrea.test/");
await page.locator(".suggestions button").first().waitFor();
assert.match((await bubbles("andrea"))[0], /Bonjour Monsieur/);
assert.equal(await page.locator("#settings").getAttribute("open"), null);
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
await shot("a1-accueil");
step("accueil : prêt à l'emploi, sans clé ni réglage");

// 2. Un exemple touché : outil de la page, réponse en flux, voix de Claude.
await page.locator(".suggestions button", { hasText: "17 %" }).click();
await page.locator(".bubble.andrea:not(.pending) >> text=397,8").or(page.locator(".bubble.andrea:not(.pending) >> text=397.8")).waitFor();
assert.equal(await page.locator(".suggestions").count(), 0);
const first = await page.evaluate(() => window.__claude.calls[0]);
assert.match(first.turns[0].content, /Consignes permanentes[\s\S]*Tu sers Monsieur/);
assert.equal(first.tier, "quick");
assert.ok(first.tools.includes("minuteur") && !first.tools.includes("web_search"));
await page.waitForFunction(() => window.__claude.spoken.length === 1);
assert.match(await page.evaluate(() => window.__claude.spoken[0]), /^Cela fait 397[.,]8\.$/);
step("exemple touché : calcul fait par la page, réponse dite avec la voix de Claude");

// 3. Mémoire : rangée dans la base privée de la personne.
await ask("Je m'appelle Théo");
await page.locator(".bubble.andrea:not(.pending) >> text=Enchantée").waitFor();
assert.equal(await page.evaluate(() => window.__claude.docs["data/users/u_42/memoire"].value.prenom.valeur), "Théo");
step("mémoire : enregistrée dans la base privée");
await shot("a2-conversation");

// 4. Dictée : toucher le micro, parler, retoucher pour envoyer.
await page.click("#btn-mic");
await page.waitForFunction(() => document.getElementById("input").value.includes("Quelle heure"));
await page.click("#btn-mic");
await page.locator(".bubble.andrea:not(.pending) >> text=quatorze heures").waitFor();
assert.equal((await bubbles("user")).at(-1), "Quelle heure est-il ?");
step("dictée : la question dictée est envoyée");

// 5. Rechargement : conversation et mémoire retrouvées.
await page.reload();
await page.locator(".bubble.andrea >> text=quatorze heures").waitFor();
await ask("Tu te souviens de moi ?");
await page.locator(".bubble.andrea:not(.pending) >> text=prenom : Théo").waitFor();
assert.equal(await page.evaluate(() => window.__claude.calls.at(-1).turns.length), 8); // consignes + 3 échanges + question
step("rechargement : conversation poursuivie, mémoire relue");

// 6. Limite d'utilisation : message clair, rien n'est gardé.
await page.evaluate(() => (window.__claude.fail = "rate_limited"));
await ask("Encore une question");
await page.locator(".note.error >> text=Limite d'utilisation").waitFor();
await page.evaluate(() => (window.__claude.fail = null));
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("andrea.conversation")).messages.length), 8);
step("limite atteinte : expliquée, échange non gardé");

// 7. Réglages : prénom, réflexion approfondie ; effacement en deux touchers.
await page.click("#btn-settings");
await page.fill("#set-name", "Théo");
await page.check("#set-deep");
await shot("a3-reglages");
await page.click("#settings-form button[type=submit]");
await page.locator(".bubble.andrea >> text=Bonjour Théo").waitFor();
await ask("Bonjour");
await page.locator(".bubble.andrea:not(.pending) >> text=À votre service").waitFor();
const last = await page.evaluate(() => window.__claude.calls.at(-1));
assert.match(last.turns[0].content, /Tu sers Théo/);
assert.equal(last.tier, "default");
assert.equal(last.turns.length, 2);
await page.click("#btn-settings");
await page.click("#btn-erase");
assert.equal(await page.locator("#btn-erase").innerText(), "Confirmer l'effacement");
await page.click("#btn-erase");
await page.locator(".note >> text=ont été effacés").waitFor();
assert.deepEqual(await page.evaluate(() => Object.keys(window.__claude.docs)), []);
step("réglages : prénom, réflexion approfondie, effacement confirmé en deux touchers");

assert.deepEqual(problems, []);
step("aucune erreur dans la console du navigateur");
await browser.close();
console.log("\nTout est bon.");
