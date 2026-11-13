// Andréa dans Claude : l'écran de conversation de l'artefact.
// Mêmes outils et même voix « phrase par phrase » que la version web (docs/), mais les
// réponses viennent du compte Claude de la personne qui ouvre la page.

import { renderMarkdown } from "../docs/js/markdown.js";
import { Listener, Speaker } from "../docs/js/speech.js";
import { Store } from "../docs/js/store.js";
import { TOOL_LABELS, Toolbox } from "../docs/js/tools.js";
import { Andrea, ClaudeDictation, ClaudeVoice, CloudStore, explain } from "./platform.js";

const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");

const DEFAULTS = { userName: "Monsieur", speak: true, voice: "", rate: 1, deep: false };
const MAX_SAVED = 600_000; // caractères : au-delà, la conversation n'est plus gardée d'une visite à l'autre
const SUGGESTIONS = [
  "Quelle heure est-il ?",
  "Note : acheter du pain",
  "Lance un minuteur de 5 minutes",
  "Combien font 17 % de 2 340 ?",
];

const local = new Store();
let memory = local; // remplacée par la base en ligne quand elle est disponible
let voice = new Speaker(); // voix du navigateur, remplacée par celle de Claude si elle est offerte
let listener = new Listener(null); // dictée : seulement si la plateforme la propose
let sample = null;

let settings = { ...DEFAULTS, ...local.get("reglages", {}) };
let conversation = { messages: [], transcript: [], ...local.get("conversation", {}) };
let andrea = null;
let current = null; // réponse en cours d'écriture
let busy = false;
let renderQueued = false;
let eraseArmed = false;

// Le lien vers Claude met un instant à répondre : on l'attend au moment d'envoyer.
const ready = connect();

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------
function nearBottom() {
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
}

function append(node) {
  const follow = nearBottom();
  chat.append(node);
  if (follow) chat.scrollTop = chat.scrollHeight;
  return node;
}

function addBubble(role, text = "") {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  if (role === "user") {
    bubble.textContent = text;
  } else {
    const content = document.createElement("div");
    content.className = "content";
    const activity = document.createElement("div");
    activity.className = "activity";
    bubble.append(content, activity);
    renderMarkdown(content, text);
  }
  return append(bubble);
}

function addNote(text, kind = "") {
  const note = document.createElement("div");
  note.className = `note ${kind}`.trim();
  note.textContent = text;
  return append(note);
}

function addLink(url) {
  const card = document.createElement("a");
  card.className = "link-card";
  card.href = url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.textContent = `Ouvrir ${new URL(url).hostname.replace(/^www\./, "")} ↗`;
  return append(card);
}

function showEntry({ role, text }) {
  if (role === "user" || role === "andrea") addBubble(role, text);
  else if (role === "link") addLink(text);
  else addNote(text, role === "alert" ? "alert" : "");
}

/** Accueil : un mot d'Andréa et quelques exemples à toucher. */
function greet() {
  addBubble("andrea", `Bonjour ${settings.userName}. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?`);
  const list = document.createElement("div");
  list.className = "suggestions";
  for (const text of SUGGESTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", () => send(text));
    list.append(button);
  }
  append(list);
}

function refreshState() {
  const state = listener.listening ? "listening" : voice.speaking ? "speaking" : busy ? "thinking" : "idle";
  const labels = { listening: "Je vous écoute…", speaking: "Andréa parle", thinking: "Réflexion…", idle: "Prête" };
  $("orb").dataset.state = state;
  $("status").textContent = labels[state];
  $("app").classList.toggle("busy", busy);
  $("app").classList.toggle("speaking", voice.speaking);
  $("app").classList.toggle("typing", input.value.trim() !== "");
  $("btn-send").setAttribute("aria-label", busy || (voice.speaking && !input.value.trim()) ? "Arrêter" : "Envoyer");
  $("btn-new").disabled = busy;
  $("btn-settings").disabled = busy;
  $("btn-mic").hidden = !listener.supported;
  $("btn-mic").classList.toggle("listening", listener.listening);
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
  refreshState();
}

// ---------------------------------------------------------------------------
// Lien avec Claude
// ---------------------------------------------------------------------------
function applySettings() {
  voice.enabled = settings.speak;
  voice.voiceName = settings.voice;
  voice.rate = settings.rate;
  voice.onChange = refreshState;
  $("btn-voice").setAttribute("aria-pressed", String(settings.speak));
}

async function connect() {
  const claude = window.claude;
  if (!claude?.use) return;
  // Chaque capacité est facultative : la page fonctionne sans, et s'enrichit quand elle arrive.
  claude.use("tts").then((tts) => {
    if (!tts) return;
    voice.stop();
    voice = new ClaudeVoice(tts);
    applySettings();
    refreshState();
  });
  claude.use("dictation").then((dictation) => {
    if (!dictation) return;
    listener = new ClaudeDictation(dictation);
    listener.onChange = refreshState;
    refreshState();
  });
  Promise.all([claude.use("db"), claude.use("user")]).then(async ([db, user]) => {
    const id = db && user ? await user.id() : null;
    if (id) memory = new CloudStore(db, id, local);
  });
  sample = await claude.use("sample");
}

function assistant() {
  if (!andrea) {
    andrea = new Andrea({
      sample,
      // Le stockage est résolu à chaque appel : la base en ligne peut arriver après coup.
      toolbox: new Toolbox({
        store: { get: (key, fallback) => memory.get(key, fallback), set: (key, value) => memory.set(key, value) },
        webSearch: false,
        onNotify: remind,
        onLink: offerLink,
      }),
      userName: settings.userName,
      tier: settings.deep ? "default" : "quick",
      callbacks: { onText, onTool },
    });
    andrea.messages = conversation.messages;
  }
  return andrea;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
function save() {
  const data = { messages: conversation.messages, transcript: conversation.transcript };
  if (JSON.stringify(data).length > MAX_SAVED || !local.set("conversation", data)) local.remove("conversation");
}

function onText(delta) {
  if (!current) return;
  current.text += delta;
  current.activity.textContent = "";
  voice.feed(delta);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderCurrent);
}

function renderCurrent() {
  renderQueued = false;
  if (!current) return;
  const follow = nearBottom();
  renderMarkdown(current.content, current.text);
  if (follow) chat.scrollTop = chat.scrollHeight;
}

function onTool(name) {
  voice.flush(); // dit ce qui précède l'action, sans attendre la suite
  if (current) current.activity.textContent = `Andréa ${TOOL_LABELS[name] ?? name}…`;
}

function offerLink(url) {
  addLink(url);
  conversation.transcript.push({ role: "link", text: url });
}

/** Un minuteur est arrivé à son terme. */
function remind(message) {
  addNote(`🔔 ${message}`, "alert");
  conversation.transcript.push({ role: "alert", text: `🔔 ${message}` });
  save();
  voice.say(message);
}

async function send(raw) {
  const text = raw.trim();
  if (!text || busy) return;
  voice.unlock(); // geste de l'utilisateur : autorise la voix du navigateur
  voice.stop(); // une nouvelle demande coupe la réponse précédente
  input.value = "";
  autosize();
  chat.querySelector(".suggestions")?.remove();

  const mark = conversation.transcript.length;
  const question = addBubble("user", text);
  const bubble = addBubble("andrea");
  bubble.classList.add("pending");
  current = { text: "", content: bubble.querySelector(".content"), activity: bubble.querySelector(".activity") };
  conversation.transcript.push({ role: "user", text });
  busy = true;
  refreshState();
  chat.scrollTop = chat.scrollHeight;

  try {
    await ready;
    if (!sample) throw { code: "sampling_disabled" };
    const reply = await assistant().ask(text);
    renderMarkdown(current.content, reply);
    voice.flush();
    conversation.transcript.splice(mark + 1, 0, { role: "andrea", text: reply });
    conversation.messages = andrea.messages;
    save();
  } catch (error) {
    // Andréa ne garde pas trace d'un échange qui n'a pas abouti : l'écran le montre.
    voice.stop();
    conversation.transcript.length = mark;
    question.classList.add("dropped");
    const partial = error?.code === "refused" ? "" : (error?.text ?? "");
    if (partial) {
      renderMarkdown(current.content, partial);
      bubble.classList.add("dropped");
    } else {
      bubble.remove();
    }
    if (!error?.code) console.error(error);
    addNote(...explain(error));
  } finally {
    bubble.classList.remove("pending");
    current = null;
    busy = false;
    refreshState();
  }
}

function newConversation(note) {
  voice.stop();
  andrea?.toolbox.cancelTimers();
  andrea = null;
  conversation = { messages: [], transcript: [] };
  local.remove("conversation");
  chat.replaceChildren();
  greet();
  if (note) addNote(note);
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------
function fillVoices() {
  const browserVoice = voice instanceof Speaker;
  const voices = browserVoice ? voice.voices() : [];
  const options = [new Option("Choix automatique", "")];
  for (const item of voices) options.push(new Option(`${item.name} (${item.lang})`, item.name));
  $("set-voice").replaceChildren(...options);
  $("set-voice").value = voices.some((item) => item.name === settings.voice) ? settings.voice : "";
  // La voix de Claude ne se choisit pas ; celle du navigateur, oui.
  $("set-voice").hidden = $("set-voice-label").hidden = !browserVoice || voices.length === 0;
  const hint = $("voice-hint");
  hint.hidden = !browserVoice || voices.length > 0;
  hint.textContent = voice.supported
    ? "Si vous n'entendez rien, c'est que cet appareil ne laisse pas la page parler : Andréa répondra par écrit."
    : "Ici, Andréa ne peut pas parler : elle répondra seulement par écrit.";
}

function showRate() {
  $("set-rate-value").textContent = `× ${Number($("set-rate").value).toFixed(2).replace(".", ",")}`;
}

function disarmErase() {
  eraseArmed = false;
  $("btn-erase").textContent = "Tout effacer";
}

function openSettings() {
  $("set-name").value = settings.userName === DEFAULTS.userName ? "" : settings.userName;
  $("set-speak").checked = settings.speak;
  $("set-rate").value = settings.rate;
  $("set-deep").checked = settings.deep;
  showRate();
  fillVoices();
  disarmErase();
  if (!$("settings").open) $("settings").showModal();
}

function closeSettings() {
  applySettings(); // annule un éventuel essai de voix
  $("settings").close();
}

function saveSettings() {
  const next = {
    userName: $("set-name").value.trim() || DEFAULTS.userName,
    speak: $("set-speak").checked,
    voice: $("set-voice").value,
    rate: Number($("set-rate").value),
    deep: $("set-deep").checked,
  };
  const restart = next.userName !== settings.userName; // le prénom change les consignes d'Andréa
  settings = next;
  const kept = local.set("reglages", settings);
  andrea?.toolbox.cancelTimers();
  andrea = null; // recréée avec les nouveaux réglages
  if (!settings.speak) voice.stop();
  closeSettings();
  if (restart) newConversation(conversation.messages.length ? "Réglages modifiés : nouvelle conversation." : "");
  if (!kept) addNote("Les réglages n'ont pas pu être enregistrés sur cet appareil.", "error");
}

function testVoice() {
  voice.unlock();
  voice.stop();
  voice.enabled = true;
  voice.voiceName = $("set-voice").value;
  voice.rate = Number($("set-rate").value);
  voice.say(`Bonjour ${$("set-name").value.trim() || DEFAULTS.userName}. Je suis Andréa, à votre service.`);
}

/** Deux touchers pour effacer : le premier demande confirmation. */
async function eraseEverything() {
  if (!eraseArmed) {
    eraseArmed = true;
    $("btn-erase").textContent = "Confirmer l'effacement";
    return;
  }
  disarmErase();
  for (const key of ["memoire", "notes"]) await (memory.remove?.(key) ?? local.remove(key));
  local.remove("reglages");
  settings = { ...DEFAULTS };
  closeSettings();
  newConversation("Mémoire, notes, réglages et conversation ont été effacés.");
}

// ---------------------------------------------------------------------------
// Micro
// ---------------------------------------------------------------------------
function toggleMic() {
  if (listener.listening) {
    listener.stop();
    return;
  }
  voice.stop(); // Andréa se tait pour vous écouter
  listener.start({
    onHeard: (text) => {
      input.value = text;
      autosize();
    },
    onDone: (text) => {
      refreshState();
      if (text) send(text);
    },
    onError: (code) => {
      const blocked = code === "not-allowed";
      addNote(blocked ? "Le micro n'est pas autorisé pour cette page." : "La dictée n'est pas disponible pour l'instant.", "error");
    },
  });
  refreshState();
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) {
    andrea?.stop();
    voice.stop();
  } else if (!input.value.trim() && voice.speaking) {
    voice.stop();
  } else {
    send(input.value);
  }
});
input.addEventListener("input", autosize);
input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!busy) send(input.value);
});
$("btn-mic").addEventListener("click", toggleMic);
$("btn-new").addEventListener("click", () => newConversation());
$("btn-settings").addEventListener("click", openSettings);
$("btn-voice").addEventListener("click", () => {
  settings.speak = !settings.speak;
  local.set("reglages", settings);
  applySettings();
  if (settings.speak) voice.unlock();
  else voice.stop();
});
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings();
});
$("settings").addEventListener("cancel", closeSettings);
$("btn-cancel").addEventListener("click", closeSettings);
$("btn-test-voice").addEventListener("click", testVoice);
$("btn-erase").addEventListener("click", eraseEverything);
$("set-rate").addEventListener("input", showRate);
window.addEventListener("pagehide", () => voice.stop());

applySettings();
if (conversation.transcript.length) conversation.transcript.forEach(showEntry);
else greet();
chat.scrollTop = chat.scrollHeight;
refreshState();

ready.then(() => {
  if (!sample) addNote("Andréa a besoin de Claude pour répondre : ouvrez cette page depuis Claude, connecté à votre compte.", "error");
});
