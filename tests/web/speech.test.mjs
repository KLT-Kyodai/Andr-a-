import assert from "node:assert/strict";
import { test } from "node:test";

import { Listener, SentenceSplitter, Speaker, cleanForSpeech, pickVoice, splitForSpeech } from "../../docs/js/speech.js";

test("nettoyage du texte à dire", () => {
  const cases = [
    ["**Bonjour** _Monsieur_ !", "Bonjour Monsieur !"],
    ["## Météo du jour", "Météo du jour"],
    ["- Acheter du café", "Acheter du café"],
    ["Voir [Le Monde](https://www.lemonde.fr/a/b?x=1).", "Voir Le Monde."],
    ["Voir [42](https://fr.wikipedia.org/wiki/42_(nombre)).", "Voir 42."],
    ["Source : https://www.meteofrance.com/previsions/paris", "Source : meteofrance.com"],
    ["C'est noté ✅ 🚀.", "C'est noté."],
    ["Il fait -5 °C, soit 2 − 7.", "Il fait -5 °C, soit 2 − 7."],
    ["🎉🎉", ""],
    ["---", ""],
  ];
  for (const [text, expected] of cases) assert.equal(cleanForSpeech(text), expected);
});

test("découpage en phrases", () => {
  assert.deepEqual(splitForSpeech("Bonjour Monsieur. Il est 14 h 30 ! Tout va bien ?"), [
    "Bonjour Monsieur.", "Il est 14 h 30 !", "Tout va bien ?",
  ]);
  assert.deepEqual(splitForSpeech("M. Stark a gagné 3.5 points. Bravo."), ["M. Stark a gagné 3.5 points.", "Bravo."]);
  assert.deepEqual(splitForSpeech("Attendez... Voilà."), ["Attendez...", "Voilà."]);
});

test("en streaming : attend la fin de la phrase et ne lit pas le code", () => {
  const splitter = new SentenceSplitter();
  assert.deepEqual(splitter.feed("Bien sûr, Mon"), []);
  assert.deepEqual(splitter.feed("sieur. Je m'en occ"), ["Bien sûr, Monsieur."]);
  assert.deepEqual(splitter.flush(), ["Je m'en occ"]);

  const said = [];
  for (const chunk of ["Voici le script :\n``", "`python\nprint('a. b')\nx = 1\n", "```", "\nIl affiche un texte."]) {
    said.push(...splitter.feed(chunk));
  }
  said.push(...splitter.flush());
  assert.deepEqual(said, ["Voici le script :", "Le code est affiché à l'écran.", "Il affiche un texte."]);
});

const VOICES = [
  { name: "Samantha", lang: "en-US" },
  { name: "Amélie", lang: "fr-CA" },
  { name: "Thomas", lang: "fr-FR" },
  { name: "Google français", lang: "fr_FR" },
];

test("choix de la voix", () => {
  assert.equal(pickVoice(VOICES).name, "Amélie"); // voix féminine connue, même canadienne
  assert.equal(pickVoice([...VOICES, { name: "Marie", lang: "fr-FR" }]).name, "Marie");
  assert.equal(pickVoice(VOICES.slice(2)).name, "Thomas");
  assert.equal(pickVoice(VOICES.slice(3)).name, "Google français"); // Android
  assert.equal(pickVoice(VOICES, "Thomas").name, "Thomas");
  assert.equal(pickVoice(VOICES, "Voix disparue").name, "Amélie");
  assert.equal(pickVoice(VOICES.slice(0, 1)), null);
});

function fakeSynth() {
  const synth = { spoken: [], cancelled: 0, getVoices: () => VOICES };
  synth.speak = (utterance) => synth.spoken.push(utterance);
  synth.cancel = () => synth.cancelled++;
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { synth, Utterance };
}

test("Andréa dit chaque phrase avec la voix française de l'appareil", () => {
  const { synth, Utterance } = fakeSynth();
  const speaker = new Speaker({ synth, Utterance });
  speaker.rate = 1.2;
  for (const chunk of ["Bonjour ", "Monsieur. Il ", "fait **beau** 🚀"]) speaker.feed(chunk);
  speaker.flush();
  assert.deepEqual(synth.spoken.map((u) => u.text), ["Bonjour Monsieur.", "Il fait beau"]);
  assert.equal(synth.spoken[0].voice.name, "Amélie");
  assert.equal(synth.spoken[0].lang, "fr-CA");
  assert.equal(synth.spoken[0].rate, 1.2);
  assert.equal(speaker.speaking, true);
  synth.spoken.forEach((u) => u.onend());
  assert.equal(speaker.speaking, false);
});

test("couper la parole, mode muet, premier geste", () => {
  const { synth, Utterance } = fakeSynth();
  const speaker = new Speaker({ synth, Utterance });
  speaker.unlock();
  speaker.unlock();
  assert.equal(synth.spoken.length, 1); // une seule amorce silencieuse
  assert.equal(synth.spoken[0].volume, 0);

  speaker.say("Un. Deux.");
  speaker.feed("Phrase inachev");
  speaker.stop();
  assert.equal(synth.cancelled, 1);
  assert.equal(speaker.speaking, false);
  speaker.flush();
  assert.equal(synth.spoken.length, 3); // rien de plus après stop()

  speaker.enabled = false;
  speaker.say("Silence.");
  assert.equal(synth.spoken.length, 3);
});

test("sans synthèse vocale dans le navigateur, rien ne casse", () => {
  const speaker = new Speaker({ synth: undefined, Utterance: undefined });
  assert.equal(speaker.supported, false);
  speaker.unlock();
  speaker.say("Bonjour.");
  speaker.stop();
  assert.deepEqual(speaker.voices(), []);
  assert.equal(new Listener(undefined).supported, false);
});

test("écoute au micro", () => {
  let instance;
  class Recognition {
    constructor() {
      instance = this;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend();
    }
  }
  const listener = new Listener(Recognition);
  const heard = [];
  let done;
  listener.start({ onHeard: (t) => heard.push(t), onDone: (t) => (done = t) });
  assert.equal(instance.lang, "fr-FR");
  assert.equal(listener.listening, true);
  instance.onresult({ results: [[{ transcript: "quelle heure" }]] });
  instance.onresult({ results: [[{ transcript: "quelle heure est-il " }]] });
  listener.stop();
  assert.deepEqual(heard, ["quelle heure", "quelle heure est-il "]);
  assert.equal(done, "quelle heure est-il");
  assert.equal(listener.listening, false);
});
