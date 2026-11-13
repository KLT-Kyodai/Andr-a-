// Essai de bout en bout de la version téléphone, dans un vrai navigateur réglé comme un
// téléphone. Seuls l'API d'Anthropic, la voix et le micro sont simulés.
//
//   node tests/web/e2e.mjs [dossier-pour-les-captures]      (nécessite Playwright)

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { sseMessage } from "./sse.mjs";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const ROOT = fileURLToPath(new URL("../../docs/", import.meta.url));
const SHOTS = process.argv[2];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};

// --- petit serveur de fichiers pour docs/ -----------------------------------
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
  try {
    const file = join(ROOT, path.endsWith("/") ? `${path}index.html` : path);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${server.address().port}`;

// --- navigateur « téléphone », voix et micro simulés -------------------------
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "fr-FR" });
await context.addInitScript(() => {
  window.__spoken = [];
  const voices = [{ name: "Google français", lang: "fr-FR" }, { name: "Google US English", lang: "en-US" }];
  const synth = {
    getVoices: () => voices,
    speak: (utterance) => {
      if (utterance.volume !== 0) window.__spoken.push(utterance.text);
      setTimeout(() => utterance.onend?.(), 30);
    },
    cancel: () => {},
    addEventListener: () => {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  window.SpeechRecognition = class {
    start() {
      setTimeout(() => {
        this.onresult({ results: [[{ transcript: "Quelle heure est-il ?" }]] });
        this.onend();
      }, 50);
    }
    stop() {}
  };
});

const requests = [];
const replies = [];
await context.route("https://api.anthropic.com/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  requests.push({ headers: request.headers(), body: request.postDataJSON() });
  const next = replies.shift();
  const headers = { "access-control-allow-origin": "*" };
  if (next?.status) {
    return route.fulfill({ status: next.status, headers, contentType: "application/json", body: JSON.stringify(next.body) });
  }
  return route.fulfill({ status: 200, headers, contentType: "text/event-stream", body: next });
});

const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`erreur : ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/status of 401/.test(message.text())) problems.push(`console : ${message.text()}`);
});
const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
const bubbles = (role) => page.locator(`.bubble.${role}`).allInnerTexts();
const step = (label) => console.log(`✔ ${label}`);

// 1. Première ouverture : les réglages demandent la clé.
await page.goto(`${origin}/`);
await page.locator("#settings[open]").waitFor();
await shot("1-reglages");
await page.fill("#set-key", "sk-ant-api03-essai");
await page.fill("#set-name", "Théo");
await page.click("#settings-form button[type=submit]");
await page.locator("#settings").waitFor({ state: "hidden" });
assert.match((await bubbles("andrea"))[0], /Bonjour Théo/);
step("réglages : clé et prénom enregistrés, accueil personnalisé");

// 2. Une question qui demande un outil : deux allers-retours avec l'API.
replies.push(
  sseMessage([{ text: "Je calcule, |Théo." }, { tool: "calculer", input: { expression: "6*7" }, id: "toolu_1" }], "tool_use"),
  sseMessage([{ text: " Cela fait **42**. |Voir [le détail](https://fr.wikipedia.org/wiki/42_(nombre)) 🚀" }]),
);
await page.fill("#input", "Combien font 6 fois 7 ?");
await page.press("#input", "Enter");
await page.locator(".bubble.andrea:not(.pending) >> text=Cela fait").waitFor();
assert.deepEqual(await bubbles("user"), ["Combien font 6 fois 7 ?"]);
assert.equal(await page.locator(".bubble.andrea strong").innerText(), "42");
assert.equal(await page.locator(".bubble.andrea a").getAttribute("href"), "https://fr.wikipedia.org/wiki/42_(nombre)");
assert.equal(requests.length, 2);
assert.match(`${requests[0].headers["x-api-key"]} ${requests[0].headers.authorization}`, /sk-ant-api03-essai/);
assert.equal(requests[0].headers["anthropic-dangerous-direct-browser-access"], "true");
assert.equal(requests[0].body.model, "claude-opus-5-5");
assert.match(requests[0].body.system, /Tu sers Théo/);
assert.equal(requests[1].body.messages.at(-1).content[0].content, "6*7 = 42");
step("conversation : réponse en flux, outil exécuté sur le téléphone, mise en forme");

await page.waitForFunction(() => window.__spoken.length >= 3);
assert.deepEqual(await page.evaluate(() => window.__spoken), ["Je calcule, Théo.", "Cela fait 42.", "Voir le détail"]);
step("voix : chaque phrase est dite, sans mise en forme ni émoji");
await shot("2-conversation");

// 3. Micro : la phrase entendue part toute seule.
replies.push(sseMessage([{ text: "Il est quatorze heures." }]));
await page.click("#btn-mic");
await page.locator(".bubble.andrea >> text=quatorze heures").waitFor();
assert.equal((await bubbles("user")).at(-1), "Quelle heure est-il ?");
step("micro : la question dictée est envoyée");

// 4. La conversation survit à un rechargement de la page.
await page.reload();
await page.locator(".bubble.andrea >> text=quatorze heures").waitFor();
assert.equal((await bubbles("user")).length, 2);
replies.push(sseMessage([{ text: "Oui, je m'en souviens." }]));
await page.fill("#input", "Vous vous souvenez ?");
await page.press("#input", "Enter");
await page.locator(".bubble.andrea >> text=je m'en souviens").waitFor();
assert.equal(requests.at(-1).body.messages.length, 7); // tout l'historique est renvoyé
step("rechargement : conversation retrouvée et poursuivie");

// 5. Voix coupée : plus rien n'est dit.
await page.click("#btn-voice");
const before = await page.evaluate(() => window.__spoken.length);
replies.push(sseMessage([{ text: "Réponse silencieuse." }]));
await page.fill("#input", "Chut");
await page.press("#input", "Enter");
await page.locator(".bubble.andrea >> text=silencieuse").waitFor();
assert.equal(await page.evaluate(() => window.__spoken.length), before);
step("bouton voix : Andréa se tait");

// 6. Clé refusée : message clair, réglages rouverts, rien n'est gardé.
replies.push({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
await page.fill("#input", "Bonjour");
await page.press("#input", "Enter");
await page.locator(".note.error >> text=Clé API refusée").waitFor();
await page.locator("#settings[open]").waitFor();
await page.click("#btn-cancel");
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("andrea.conversation")).transcript.at(-1).text), "Réponse silencieuse.");
step("erreur : clé refusée expliquée, échange non gardé");

// 7. Nouvelle conversation, puis l'application s'ouvre même sans réseau.
await page.click("#btn-new");
assert.equal((await bubbles("user")).length, 0);
await page.evaluate(() => navigator.serviceWorker.ready);
await context.setOffline(true);
await page.reload();
assert.match((await bubbles("andrea"))[0], /Bonjour Théo/);
await context.setOffline(false);
step("hors ligne : l'application s'ouvre quand même");

assert.deepEqual(problems, []);
step("aucune erreur dans la console du navigateur");

await browser.close();
server.close();
console.log("\nTout est bon.");
