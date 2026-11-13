// Andréa sur téléphone : l'écran de conversation.
// Tout se passe dans le navigateur : la page parle directement à l'API d'Anthropic
// avec la clé de l'utilisateur, enregistrée sur son appareil.

import Anthropic from "../vendor/anthropic-sdk.js";
import { Andrea } from "./brain.js";
import { renderMarkdown } from "./markdown.js";
import { Listener, Speaker } from "./speech.js";
import { Store } from "./store.js";
import { TOOL_LABELS, Toolbox } from "./tools.js";

const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");

const DEFAULTS = { apiKey: "", userName: "Monsieur", speak: true, voice: "", rate: 1, webSearch: true };
const MAX_SAVED = 1_500_000; // caractères : au-delà, la conversation n'est plus gardée d'une visite à l'autre

const store = new Store();
const speaker = new Speaker();
const listener = new Listener();

let settings = { ...DEFAULTS, ...store.get("reglages", {}) };
let conversation = { messages: [], transcript: [], ...store.get("conversation", {}) };
let andrea = null; // créée à la première demande, quand la clé est connue
let current = null; // réponse en cours d'écriture
let busy = false;
let renderQueued = false;

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

function greet() {
  addBubble("andrea", `Bonjour ${settings.userName}. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?`);
}

function refreshState() {
  const state = listener.listening ? "listening" : speaker.speaking ? "speaking" : busy ? "thinking" : "idle";
  const labels = {
    listening: "Je vous écoute…",
    speaking: "Andréa parle",
    thinking: "Réflexion…",
    idle: navigator.onLine ? "En ligne" : "Hors ligne",
  };
  $("orb").dataset.state = state;
  $("status").textContent = labels[state];
  $("app").classList.toggle("busy", busy);
  $("btn-send").setAttribute("aria-label", busy ? "Arrêter" : "Envoyer");
  $("btn-new").disabled = busy;
  $("btn-settings").disabled = busy;
  $("btn-mic").classList.toggle("listening", listener.listening);
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
function save() {
  const data = { messages: conversation.messages, transcript: conversation.transcript };
  if (JSON.stringify(data).length > MAX_SAVED || !store.set("conversation", data)) store.remove("conversation");
}

function assistant() {
  if (!andrea) {
    andrea = new Andrea({
      client: new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true }),
      toolbox: new Toolbox({ store, webSearch: settings.webSearch, onNotify: remind, onLink: offerLink }),
      userName: settings.userName,
      isApiError: (error) => error instanceof Anthropic.APIError,
      callbacks: { onText, onTool, onStatus },
    });
    andrea.messages = conversation.messages;
  }
  return andrea;
}

function onText(delta) {
  if (!current) return;
  current.text += delta;
  current.activity.textContent = "";
  speaker.feed(delta);
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
  speaker.flush(); // dit ce qui précède l'action, sans attendre la suite
  if (current) current.activity.textContent = `Andréa ${TOOL_LABELS[name] ?? name}…`;
}

function onStatus(message) {
  if (current) current.activity.textContent = message;
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
  speaker.say(message);
  navigator.vibrate?.([200, 100, 200]);
}

function explain(error) {
  if (error instanceof Anthropic.APIUserAbortError) return ["Réponse interrompue.", ""];
  if (error instanceof Anthropic.AuthenticationError) return ["Clé API refusée. Vérifiez-la dans les réglages.", "error"];
  if (error instanceof Anthropic.PermissionDeniedError) return ["Cette clé API n'a pas le droit de faire cette demande.", "error"];
  if (error instanceof Anthropic.RateLimitError) return ["Trop de demandes pour l'instant. Réessayez dans un moment.", "error"];
  if (error instanceof Anthropic.APIConnectionError) return ["Connexion impossible. Vérifiez votre accès à Internet.", "error"];
  if (error instanceof Anthropic.APIError) return [`Erreur de l'API (${error.status}) : ${error.message}`, "error"];
  return [`Une erreur est survenue : ${error.message}`, "error"];
}

async function send(raw) {
  const text = raw.trim();
  if (!text || busy) return;
  if (!settings.apiKey) {
    openSettings();
    return;
  }
  speaker.unlock(); // geste de l'utilisateur : autorise la voix sur iPhone
  speaker.stop(); // une nouvelle demande coupe la réponse précédente
  input.value = "";
  autosize();

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
    const reply = await assistant().ask(text);
    renderMarkdown(current.content, reply || "…");
    speaker.flush();
    conversation.transcript.splice(mark + 1, 0, { role: "andrea", text: reply });
    conversation.messages = andrea.messages;
    save();
  } catch (error) {
    // Andréa ne garde pas trace d'un échange qui n'a pas abouti : l'écran le montre.
    speaker.stop();
    conversation.transcript.length = mark;
    question.classList.add("dropped");
    if (current.text) bubble.classList.add("dropped");
    else bubble.remove();
    addNote(...explain(error));
    if (error instanceof Anthropic.AuthenticationError) openSettings();
  } finally {
    bubble.classList.remove("pending");
    current = null;
    busy = false;
    refreshState();
  }
}

function newConversation(note) {
  speaker.stop();
  andrea?.toolbox.cancelTimers();
  andrea = null;
  conversation = { messages: [], transcript: [] };
  store.remove("conversation");
  chat.replaceChildren();
  greet();
  if (note) addNote(note);
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------
function applySettings() {
  speaker.enabled = settings.speak;
  speaker.voiceName = settings.voice;
  speaker.rate = settings.rate;
  $("btn-voice").setAttribute("aria-pressed", String(settings.speak));
}

function fillVoices() {
  const select = $("set-voice");
  const hint = $("voice-hint");
  const voices = speaker.voices();
  const options = [new Option("Choix automatique", "")];
  for (const voice of voices) options.push(new Option(`${voice.name} (${voice.lang})`, voice.name));
  select.replaceChildren(...options);
  select.value = voices.some((voice) => voice.name === settings.voice) ? settings.voice : "";
  hint.hidden = speaker.supported && voices.length > 0;
  hint.textContent = speaker.supported
    ? "Aucune voix française n'est installée sur cet appareil : ajoutez-en une dans les réglages du téléphone (synthèse vocale)."
    : "Ce navigateur ne sait pas parler : Andréa répondra seulement par écrit.";
}

function showRate() {
  $("set-rate-value").textContent = `× ${Number($("set-rate").value).toFixed(2).replace(".", ",")}`;
}

function openSettings() {
  $("set-key").value = settings.apiKey;
  $("set-name").value = settings.userName === DEFAULTS.userName ? "" : settings.userName;
  $("set-speak").checked = settings.speak;
  $("set-rate").value = settings.rate;
  $("set-web").checked = settings.webSearch;
  showRate();
  fillVoices();
  if (!$("settings").open) $("settings").showModal();
}

function closeSettings() {
  applySettings(); // annule un éventuel essai de voix
  $("settings").close();
}

function saveSettings() {
  const next = {
    apiKey: $("set-key").value.trim(),
    userName: $("set-name").value.trim() || DEFAULTS.userName,
    speak: $("set-speak").checked,
    voice: $("set-voice").value,
    rate: Number($("set-rate").value),
    webSearch: $("set-web").checked,
  };
  // Le nom et la recherche web changent les consignes d'Andréa : on repart de zéro.
  const restart = next.userName !== settings.userName || next.webSearch !== settings.webSearch;
  settings = next;
  const kept = store.set("reglages", settings);
  andrea?.toolbox.cancelTimers();
  andrea = null; // recréée avec les nouveaux réglages
  if (!settings.speak) speaker.stop();
  closeSettings();
  if (restart) newConversation(conversation.messages.length ? "Réglages modifiés : nouvelle conversation." : "");
  if (!kept) addNote("Ce navigateur refuse d'enregistrer les réglages (navigation privée ?).", "error");
}

function testVoice() {
  speaker.unlock();
  speaker.stop();
  speaker.enabled = true;
  speaker.voiceName = $("set-voice").value;
  speaker.rate = Number($("set-rate").value);
  speaker.say(`Bonjour ${$("set-name").value.trim() || DEFAULTS.userName}. Je suis Andréa, à votre service.`);
}

function eraseEverything() {
  if (!confirm("Effacer de cet appareil la clé API, la mémoire, les notes et la conversation ?")) return;
  for (const key of ["reglages", "memoire", "notes", "conversation"]) store.remove(key);
  settings = { ...DEFAULTS };
  applySettings();
  newConversation("Tout a été effacé de cet appareil.");
  openSettings();
}

// ---------------------------------------------------------------------------
// Micro
// ---------------------------------------------------------------------------
function toggleMic() {
  if (listener.listening) {
    listener.stop();
    return;
  }
  speaker.unlock();
  speaker.stop(); // Andréa se tait pour vous écouter
  try {
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
        const blocked = code === "not-allowed" || code === "service-not-allowed";
        addNote(blocked ? "Le micro est bloqué. Autorisez-le dans les réglages du navigateur." : "Je n'ai pas réussi à vous entendre.", "error");
      },
    });
  } catch {
    addNote("Le micro n'a pas pu démarrer.", "error");
  }
  refreshState();
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
function fitViewport() {
  // Sur iPhone, le clavier recouvre la page : on cale la hauteur sur la zone visible.
  document.documentElement.style.setProperty("--app-height", `${window.visualViewport.height}px`);
  window.scrollTo(0, 0);
}

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) {
    andrea?.stop();
    speaker.stop();
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
  store.set("reglages", settings);
  applySettings();
  if (settings.speak) speaker.unlock();
  else speaker.stop();
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

speaker.onChange = refreshState;
if (speaker.supported) speaker.synth.addEventListener?.("voiceschanged", fillVoices);
window.addEventListener("online", refreshState);
window.addEventListener("offline", refreshState);
window.addEventListener("pagehide", () => speaker.stop());
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitViewport);
  fitViewport();
}

$("btn-mic").hidden = !listener.supported;
applySettings();
if (conversation.transcript.length) conversation.transcript.forEach(showEntry);
else greet();
chat.scrollTop = chat.scrollHeight;
refreshState();
if (!settings.apiKey) openSettings();

navigator.serviceWorker?.register("sw.js").catch(() => {});
