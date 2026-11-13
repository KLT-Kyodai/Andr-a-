import assert from "node:assert/strict";
import { test } from "node:test";

import { Store } from "../../docs/js/store.js";
import { Toolbox } from "../../docs/js/tools.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function toolbox(options = {}) {
  return new Toolbox({ store: new Store(memoryStorage()), ...options });
}

test("mémoire à long terme", async () => {
  const tools = toolbox();
  await tools.run("memoriser", { cle: "prenom", valeur: "Théo" });
  const found = await tools.run("se_souvenir", { recherche: "prenom" });
  assert.equal(found.isError, false);
  assert.match(found.content, /Théo/);
  await tools.run("oublier", { cle: "prenom" });
  assert.equal((await tools.run("se_souvenir", {})).content, "Aucun souvenir correspondant.");
});

test("notes", async () => {
  const tools = toolbox();
  await tools.run("ajouter_note", { texte: "Acheter du café" });
  await tools.run("ajouter_note", { texte: "Appeler Pepper" });
  assert.match((await tools.run("lister_notes", {})).content, /2\. Appeler Pepper/);
  await tools.run("supprimer_note", { numero: 1 });
  assert.doesNotMatch((await tools.run("lister_notes", {})).content, /Acheter/);
  assert.match((await tools.run("supprimer_note", { numero: 9 })).content, /invalide/);
});

test("calcul, date et appareil", async () => {
  const tools = toolbox();
  assert.equal((await tools.run("calculer", { expression: "6*7" })).content, "6*7 = 42");
  assert.equal((await tools.run("calculer", { expression: "alert(1)" })).isError, true);
  assert.match((await tools.run("date_et_heure", {})).content, /\d{4}/);
  assert.match((await tools.run("infos_appareil", {})).content, /Connexion/);
});

test("validation des paramètres", async () => {
  const tools = toolbox();
  assert.equal((await tools.run("calculer", {})).isError, true);
  assert.equal((await tools.run("calculer", { expression: 3 })).isError, true);
  assert.equal((await tools.run("supprimer_note", { numero: 1.5 })).isError, true);
  assert.equal((await tools.run("calculer", { expression: "1", autre: "x" })).isError, true);
  assert.equal((await tools.run("inexistant", {})).isError, true);
  assert.equal((await tools.run("constructor", {})).isError, true);
  assert.equal((await tools.run("calculer", "pas un objet")).isError, true);
});

test("un lien s'affiche, il ne s'ouvre pas tout seul", async () => {
  const links = [];
  const tools = toolbox({ onLink: (url) => links.push(url) });
  assert.match((await tools.run("ouvrir_site_web", { url: "javascript:alert(1)" })).content, /Seules/);
  assert.match((await tools.run("ouvrir_site_web", { url: "file:///etc/passwd" })).content, /Seules/);
  assert.match((await tools.run("ouvrir_site_web", { url: "https://www.lemonde.fr/" })).content, /toucher le lien/);
  assert.deepEqual(links, ["https://www.lemonde.fr/"]);
});

test("minuteur", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const alerts = [];
  const tools = toolbox({ onNotify: (message) => alerts.push(message) });
  assert.match((await tools.run("minuteur", { secondes: 600, message: "le gâteau" })).content, /reste ouverte/);
  assert.match((await tools.run("minuteur", { secondes: 0, message: "x" })).content, /comprise/);
  t.mock.timers.tick(599_000);
  assert.deepEqual(alerts, []);
  t.mock.timers.tick(1_000);
  assert.deepEqual(alerts, ["Rappel : le gâteau"]);
});

test("recherche web activable", () => {
  assert.ok(toolbox().definitions().some((tool) => tool.type === "web_search_20260209"));
  assert.ok(!toolbox({ webSearch: false }).definitions().some((tool) => tool.type));
});
