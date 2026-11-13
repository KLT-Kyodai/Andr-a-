// Voix d'Andréa sur téléphone : elle lit ses réponses avec la voix de l'appareil
// (synthèse vocale du navigateur) et vous écoute au micro (reconnaissance vocale).

// ---------------------------------------------------------------------------
// Préparation du texte : ce qui s'écrit n'est pas toujours ce qui se dit
// ---------------------------------------------------------------------------
const FENCE = "```";
const CODE_NOTICE = " Le code est affiché à l'écran. ";
const LINK = /\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g; // l'adresse peut contenir des parenthèses
const URL_PATTERN = /https?:\/\/[^\s)\]>]+/g;
const LINE_PREFIX = /^\s*(?:[-•–—]\s+|#{1,6}\s+|>\s?)/; // puce, titre, citation
const MARKDOWN = /\*+|_+|`+|~~+|\|/g;
const BOUNDARY = /[.!?…]+["»”)\]]*\s+|\n+/g; // fin de phrase ou retour à la ligne
const INITIAL = /(?:^|[^\p{L}\p{N}_])\p{Lu}$/u; // « M. » n'est pas une fin de phrase
const SYMBOL_RANGES = [
  [0x2190, 0x21ff], // flèches
  [0x2300, 0x23ff], // ⏰ ⌚ …
  [0x2460, 0x27bf], // chiffres cerclés, cadres, formes, symboles, dingbats
  [0x2b00, 0x2bff], // ⭐ …
  [0x1f000, 0x10ffff], // émojis
];

function isSymbol(code) {
  return code === 0xfe0f || code === 0x200d || SYMBOL_RANGES.some(([lo, hi]) => lo <= code && code <= hi);
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Retire ce qui ne se prononce pas : markdown, liens, émojis… */
export function cleanForSpeech(text) {
  let out = text.replace(LINK, "$1").replace(URL_PATTERN, hostname);
  out = out.replace(LINE_PREFIX, "").replace(MARKDOWN, " ");
  out = Array.from(out, (char) => (isSymbol(char.codePointAt(0)) ? " " : char)).join("");
  out = out.replace(/\s+/g, " ").trim().replace(/ ([.,])/g, "$1");
  return /[\p{L}\p{N}]/u.test(out) ? out : "";
}

/** Positions où une phrase se termine dans `text`. */
function boundaryEnds(text) {
  const ends = [];
  for (const match of text.matchAll(BOUNDARY)) {
    const singleDot = match[0][0] === "." && match[0][1] !== ".";
    if (singleDot && INITIAL.test(text.slice(Math.max(0, match.index - 2), match.index))) continue;
    ends.push(match.index + match[0].length);
  }
  return ends;
}

function sentences(text) {
  const pieces = [];
  let last = 0;
  for (const end of boundaryEnds(text)) {
    pieces.push(text.slice(last, end));
    last = end;
  }
  pieces.push(text.slice(last));
  return pieces.map(cleanForSpeech).filter(Boolean);
}

/** Découpe un texte reçu par morceaux (streaming) en phrases prêtes à être dites. */
export class SentenceSplitter {
  constructor() {
    this.buffer = "";
  }

  feed(chunk) {
    this.buffer += chunk;
    return this.take(false);
  }

  flush() {
    return this.take(true);
  }

  take(final) {
    let text = this.buffer;
    let held = "";
    // Un bloc de code ne se lit pas à voix haute : on attend qu'il soit complet,
    // puis on le remplace par une courte phrase.
    const parts = text.split(FENCE); // indices pairs : texte ; impairs : code
    if (parts.length > 1) {
      const blockOpen = parts.length % 2 === 0;
      const outside = (blockOpen ? parts.slice(0, -1) : parts).filter((_, i) => i % 2 === 0);
      text = outside.join(CODE_NOTICE);
      if (blockOpen && final) text += CODE_NOTICE;
      else if (blockOpen) held = FENCE + parts.at(-1);
    }

    let ready = text;
    let rest = "";
    if (!held && !final) {
      // seules les phrases terminées peuvent être dites
      const cut = boundaryEnds(text).at(-1) ?? 0;
      ready = text.slice(0, cut);
      rest = text.slice(cut);
    }
    this.buffer = rest + held;
    return sentences(ready);
  }
}

/** Découpe un texte complet en phrases prêtes à être dites. */
export function splitForSpeech(text) {
  const splitter = new SentenceSplitter();
  return [...splitter.feed(text), ...splitter.flush()];
}

// ---------------------------------------------------------------------------
// Choix d'une voix française parmi celles de l'appareil
// ---------------------------------------------------------------------------
const PREFERRED = ["audrey", "aurélie", "marie", "amélie", "thomas", "google"];

const normLang = (voice) => String(voice.lang || "").toLowerCase().replace("_", "-");

export function frenchVoices(voices) {
  return voices.filter((voice) => normLang(voice).startsWith("fr"));
}

function score(voice) {
  const name = voice.name.toLowerCase();
  const rank = PREFERRED.findIndex((preferred) => name.includes(preferred));
  return (rank === -1 ? 0 : (PREFERRED.length - rank) * 10) + (normLang(voice) === "fr-fr" ? 5 : 0);
}

/** La voix demandée si elle existe, sinon la meilleure voix française (ou null). */
export function pickVoice(voices, wanted = "") {
  const french = frenchVoices(voices);
  const chosen = wanted && voices.find((voice) => voice.name === wanted);
  if (chosen) return chosen;
  return french.reduce((best, voice) => (best && score(best) >= score(voice) ? best : voice), null);
}

// ---------------------------------------------------------------------------
// Parole
// ---------------------------------------------------------------------------
export class Speaker {
  constructor({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    this.synth = synth;
    this.Utterance = Utterance;
    this.enabled = true;
    this.voiceName = ""; // vide : choix automatique
    this.rate = 1;
    this.onChange = () => {}; // prévenu quand Andréa commence ou finit de parler
    this.splitter = new SentenceSplitter();
    this.live = new Set(); // phrases en attente ou en cours
    this.unlocked = false;
  }

  get supported() {
    return Boolean(this.synth && this.Utterance);
  }

  get speaking() {
    return this.live.size > 0;
  }

  voices() {
    return this.supported ? frenchVoices(this.synth.getVoices()) : [];
  }

  /**
   * À appeler pendant un geste de l'utilisateur (toucher un bouton) : sur iPhone,
   * la toute première parole n'est autorisée qu'à ce moment-là.
   */
  unlock() {
    if (!this.supported || this.unlocked) return;
    this.unlocked = true;
    const primer = new this.Utterance(" ");
    primer.volume = 0;
    this.synth.speak(primer);
  }

  /** Reçoit un morceau de réponse ; dit chaque phrase dès qu'elle est complète. */
  feed(chunk) {
    this.enqueue(this.splitter.feed(chunk));
  }

  /** Fin d'une réponse : dit ce qui restait en attente. */
  flush() {
    this.enqueue(this.splitter.flush());
  }

  /** Dit un message complet (rappel d'un minuteur, essai de la voix…). */
  say(text) {
    this.enqueue(splitForSpeech(text));
  }

  /** Coupe la parole : abandonne ce qui restait à dire. */
  stop() {
    this.splitter = new SentenceSplitter();
    this.live.clear();
    if (this.supported) this.synth.cancel();
    this.onChange();
  }

  enqueue(list) {
    if (!this.enabled || !this.supported || list.length === 0) return;
    const voice = pickVoice(this.synth.getVoices(), this.voiceName);
    for (const sentence of list) {
      const utterance = new this.Utterance(sentence);
      utterance.lang = voice?.lang || "fr-FR";
      if (voice) utterance.voice = voice;
      utterance.rate = this.rate;
      const done = () => {
        this.live.delete(utterance);
        this.onChange();
      };
      utterance.onend = done;
      utterance.onerror = done;
      this.live.add(utterance); // garde une référence, sinon certains navigateurs oublient onend
      this.synth.speak(utterance); // le navigateur les dit dans l'ordre
    }
    this.onChange();
  }
}

// ---------------------------------------------------------------------------
// Écoute au micro
// ---------------------------------------------------------------------------
export class Listener {
  constructor(Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) {
    this.Recognition = Recognition;
    this.active = null;
  }

  get supported() {
    return Boolean(this.Recognition);
  }

  get listening() {
    return this.active !== null;
  }

  /**
   * Écoute une phrase. `onHeard(texte)` suit ce qui est compris au fur et à mesure,
   * `onDone(texte)` est appelé une fois à la fin, `onError(code)` en cas de problème.
   */
  start({ onHeard = () => {}, onDone = () => {}, onError = () => {} }) {
    if (!this.supported || this.active) return;
    const recognition = new this.Recognition();
    recognition.lang = "fr-FR";
    recognition.interimResults = true;
    recognition.continuous = false;
    let heard = "";
    recognition.onresult = (event) => {
      heard = Array.from(event.results, (result) => result[0].transcript).join("");
      onHeard(heard);
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") onError(event.error);
    };
    recognition.onend = () => {
      this.active = null;
      onDone(heard.trim());
    };
    this.active = recognition;
    recognition.start();
  }

  stop() {
    this.active?.stop();
  }
}
