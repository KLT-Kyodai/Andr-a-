import sys
import threading

import pytest

from andrea.speak import (
    SentenceSplitter,
    Speaker,
    SpeechUnavailable,
    VoiceInfo,
    clean_for_speech,
    parse_espeak_voices,
    parse_say_voices,
    pick_voice,
    split_for_speech,
)


# --------------------------------------------------------------------------- #
# Préparation du texte
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("texte", "attendu"),
    [
        ("**Bonjour** _Monsieur_ !", "Bonjour Monsieur !"),
        ("## Météo du jour", "Météo du jour"),
        ("- Acheter du café", "Acheter du café"),
        ("Voir [Le Monde](https://www.lemonde.fr/a/b?x=1).", "Voir Le Monde."),
        ("Source : https://www.meteofrance.com/previsions/paris", "Source : meteofrance.com"),
        ("C'est noté ✅ 🚀.", "C'est noté."),
        ("Il fait -5 °C, soit 2 − 7.", "Il fait -5 °C, soit 2 − 7."),
        ("Lancez `andrea --parle`", "Lancez andrea --parle"),
        ("🎉🎉", ""),
        ("---", ""),
    ],
)
def test_nettoyage(texte, attendu):
    assert clean_for_speech(texte) == attendu


def test_decoupage_en_phrases():
    assert split_for_speech("Bonjour Monsieur. Il est 14 h 30 ! Tout va bien ?") == [
        "Bonjour Monsieur.",
        "Il est 14 h 30 !",
        "Tout va bien ?",
    ]


def test_decoupage_garde_initiales_et_decimales():
    assert split_for_speech("M. Stark a gagné 3.5 points. Bravo.") == [
        "M. Stark a gagné 3.5 points.",
        "Bravo.",
    ]


def test_streaming_attend_la_fin_de_phrase():
    s = SentenceSplitter()
    assert s.feed("Bien sûr, Mon") == []
    assert s.feed("sieur. Je m'en occ") == ["Bien sûr, Monsieur."]
    assert s.feed("upe") == []
    assert s.flush() == ["Je m'en occupe"]
    assert s.flush() == []


def test_streaming_ne_lit_pas_le_code():
    s = SentenceSplitter()
    dit = []
    for morceau in ["Voici le script :\n``", "`python\nprint('a. b')\nx = 1\n", "```", "\nIl affiche un texte."]:
        dit += s.feed(morceau)
    dit += s.flush()
    assert dit == ["Voici le script :", "Le code est affiché à l'écran.", "Il affiche un texte."]


def test_code_jamais_ferme():
    s = SentenceSplitter()
    assert s.feed("Regardez.\n```\nrm -rf") == ["Regardez."]
    assert s.flush() == ["Le code est affiché à l'écran."]


# --------------------------------------------------------------------------- #
# Choix de la voix
# --------------------------------------------------------------------------- #
SAY = """\
Albert              en_US    # Hello! My name is Albert.
Amélie              fr_CA    # Bonjour! Je m’appelle Amélie.
Eddy (Français (France)) fr_FR    # Bonjour ! Je m’appelle Eddy.
Marie               fr_FR    # Bonjour ! Je m’appelle Marie.
Thomas              fr_FR    # Bonjour, je m’appelle Thomas.
"""

ESPEAK = """\
Pty Language       Age/Gender VoiceName          File                 Other Languages
 5  en-gb           --/M      English_(Great_Britain) gmw/en               (en 2)
 5  fr-fr           --/M      French_(France)    roa/fr               (fr 5)
 7  fr-fr           --/F      french-mbrola-4    mb/mb-fr4            (fr 7)
 5  fr-be           --/M      French_(Belgium)   roa/fr-BE            (fr 8)
"""


def test_voix_macos():
    voices = parse_say_voices(SAY)
    assert [v.name for v in voices if v.lang.startswith("fr")] == [
        "Amélie", "Eddy (Français (France))", "Marie", "Thomas",
    ]
    assert pick_voice(voices).name == "Marie"
    assert pick_voice([v for v in voices if v.name != "Marie"]).name == "Amélie"
    assert pick_voice(voices, "thomas").name == "Thomas"


def test_voix_linux():
    voices = parse_espeak_voices(ESPEAK)
    assert [v.ident for v in voices] == ["en", "fr", "fr-BE"]  # MBROLA ignorée
    assert pick_voice(voices).ident == "fr"
    assert pick_voice(voices, "belgium").ident == "fr-BE"


def test_voix_windows():
    voices = [
        VoiceInfo("HKLM\\...\\TTS_MS_EN-US_ZIRA_11.0", "Microsoft Zira Desktop", "en-us", True),
        VoiceInfo("HKLM\\...\\TTS_MS_FR-FR_PAUL_11.0", "Microsoft Paul Desktop", "fr-fr", False),
        VoiceInfo("HKLM\\...\\TTS_MS_FR-FR_HORTENSE_11.0", "Microsoft Hortense Desktop", "fr-fr", True),
    ]
    assert "Hortense" in pick_voice(voices).name


def test_voix_absente():
    anglaises = [VoiceInfo("en", "English", "en-gb")]
    assert pick_voice(anglaises) is None
    with pytest.raises(SpeechUnavailable):
        pick_voice(anglaises, "Hortense")


# --------------------------------------------------------------------------- #
# File d'attente de parole
# --------------------------------------------------------------------------- #
class FakeBackend:
    voice_name = "voix de test"

    def __init__(self, gate: threading.Event | None = None, fail: bool = False):
        self.spoken, self.stopped = [], 0
        self.gate, self.fail = gate, fail

    def speak(self, text):
        if self.gate:
            self.gate.wait(5)
        if self.fail:
            raise RuntimeError("carte son absente")
        self.spoken.append(text)

    def stop(self):
        self.stopped += 1


def test_parle_phrase_par_phrase_dans_l_ordre():
    backend = FakeBackend()
    speaker = Speaker(backend_factory=lambda: backend)
    assert speaker.voice_name == "voix de test"
    for morceau in ["Bonjour ", "Monsieur. Il ", "fait **beau**"]:
        speaker.feed(morceau)
    speaker.flush()
    speaker.say("Rappel : le gâteau !")
    assert speaker.wait(5)
    assert backend.spoken == ["Bonjour Monsieur.", "Il fait beau", "Rappel : le gâteau !"]
    speaker.close()


def test_stop_coupe_la_parole():
    gate = threading.Event()
    backend = FakeBackend(gate)
    speaker = Speaker(backend_factory=lambda: backend)
    speaker.say("Un. Deux. Trois. Quatre.")
    speaker.feed("Phrase inachev")
    speaker.stop()  # la phrase « Un. » est peut-être déjà en cours
    gate.set()
    assert speaker.wait(5)
    assert backend.spoken in ([], ["Un."])
    assert backend.stopped == 1
    speaker.say("Suite.")
    speaker.close()
    assert backend.spoken[-1] == "Suite."


def test_muet():
    backend = FakeBackend()
    speaker = Speaker(backend_factory=lambda: backend)
    speaker.enabled = False
    speaker.say("Silence.")
    speaker.enabled = True
    speaker.say("Je parle.")
    speaker.close()
    assert backend.spoken == ["Je parle."]


def test_panne_ne_bloque_pas():
    erreurs = []
    speaker = Speaker(backend_factory=lambda: FakeBackend(fail=True), on_error=erreurs.append)
    speaker.say("Un. Deux. Trois.")
    assert speaker.wait(5)
    assert len(erreurs) == 1 and speaker.enabled is False
    speaker.close(5)


def test_demarrage_impossible():
    def factory():
        raise SpeechUnavailable("espeak-ng est introuvable")

    with pytest.raises(SpeechUnavailable):
        Speaker(backend_factory=factory)


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="moteur espeak-ng (Linux)")
def test_espeak_refuse_une_voix_inconnue():
    import shutil

    from andrea.speak import EspeakBackend

    if not shutil.which("espeak-ng"):
        pytest.skip("espeak-ng non installé")
    assert EspeakBackend().voice_name == "fr+f3"
    assert EspeakBackend("belgium+m3").voice_name == "fr-BE+m3"
    with pytest.raises(SpeechUnavailable):
        EspeakBackend("zz-inconnue")
