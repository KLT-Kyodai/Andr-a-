// Teste la boucle de conversation avec le vrai SDK embarqué ; seul le réseau est simulé.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Andrea } from "../../docs/js/brain.js";
import { Store } from "../../docs/js/store.js";
import { Toolbox } from "../../docs/js/tools.js";
import Anthropic from "../../docs/vendor/anthropic-sdk.js";
import { fakeFetch, sseMessage } from "./sse.mjs";

function setup(responses) {
  const { fetch, requests } = fakeFetch(responses);
  const client = new Anthropic({ apiKey: "sk-ant-test", dangerouslyAllowBrowser: true, fetch, maxRetries: 0 });
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const seen = { text: "", tools: [] };
  const andrea = new Andrea({
    client,
    toolbox: new Toolbox({ store: new Store(storage), webSearch: true }),
    userName: "Théo",
    isApiError: (error) => error instanceof Anthropic.APIError,
    callbacks: { onText: (t) => (seen.text += t), onTool: (name) => seen.tools.push(name) },
  });
  return { andrea, requests, seen };
}

test("réponse en streaming, puis appel d'outil et réponse finale", async () => {
  const { andrea, requests, seen } = setup([
    sseMessage([{ text: "Je calcule, |Théo." }, { tool: "calculer", input: { expression: "6*7" }, id: "toolu_1" }], "tool_use"),
    sseMessage([{ text: " Cela fait |42." }]),
  ]);
  const answer = await andrea.ask("Combien font 6 fois 7 ?");
  assert.equal(answer, "Je calcule, Théo. Cela fait 42.");
  assert.equal(seen.text, "Je calcule, Théo. Cela fait 42.");
  assert.deepEqual(seen.tools, ["calculer"]);

  const [first, second] = requests;
  assert.match(first.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  // Le SDK choisit l'en-tête (x-api-key ou Authorization) ; la clé doit y figurer.
  assert.match(`${first.headers.get("x-api-key")} ${first.headers.get("authorization")}`, /sk-ant-test/);
  assert.equal(first.headers.get("anthropic-dangerous-direct-browser-access"), "true");
  assert.match(first.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  assert.match(first.headers.get("anthropic-beta"), /compact-2026-01-12/);
  assert.equal(first.body.model, "claude-opus-5-5");
  assert.equal(first.body.stream, true);
  assert.equal(first.body.fallbacks, "default");
  assert.deepEqual(first.body.thinking, { type: "adaptive" });
  assert.equal(first.body.betas, undefined); // envoyé en en-tête, pas dans le corps
  assert.match(first.body.system, /Tu sers Théo/);
  assert.ok(first.body.tools.some((tool) => tool.name === "minuteur"));
  assert.ok(first.body.tools.some((tool) => tool.type === "web_search_20260209"));

  const result = second.body.messages.at(-1).content[0];
  assert.deepEqual(result, { type: "tool_result", tool_use_id: "toolu_1", content: "6*7 = 42", is_error: false });
  assert.equal(andrea.messages.length, 4);
});

test("un refus ne laisse aucune trace dans l'historique", async () => {
  const { andrea, seen } = setup([sseMessage([], "refusal")]);
  const answer = await andrea.ask("…");
  assert.match(answer, /Je crains/);
  assert.equal(seen.text, answer);
  assert.deepEqual(andrea.messages, []);
});

test("une erreur de l'API n'est pas relancée et l'historique reste propre", async () => {
  const { andrea, requests } = setup([
    { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } },
  ]);
  await assert.rejects(andrea.ask("Bonjour"), (error) => error instanceof Anthropic.AuthenticationError);
  assert.equal(requests.length, 1);
  assert.deepEqual(andrea.messages, []);
});

test("une recherche web en pause reprend toute seule", async () => {
  const { andrea, requests } = setup([
    sseMessage([{ text: "Je cherche." }], "pause_turn"),
    sseMessage([{ text: " Voilà." }]),
  ]);
  assert.equal(await andrea.ask("Les nouvelles ?"), "Je cherche. Voilà.");
  assert.equal(requests[1].body.messages.at(-1).role, "assistant");
});
