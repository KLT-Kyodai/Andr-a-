import threading
import time
from pathlib import Path

import pytest

from andrea import cli, speak, voice_online
from andrea.config import Config
from andrea.speak import FallbackBackend, Speaker, SpeechUnavailable, VoiceInfo, make_backend
from andrea.voice_online import DEFAULT_VOICE, OnlineBackend, _display_name, _rate_percent, resolve_voice
from tests.test_speak import FakeBackend

MP3 = Path(__file__).parent / "data" / "bonjour.mp3"

EN_LIGNE = [
    VoiceInfo("en-US-EmmaMultilingualNeural", "Emma Multilingual", "en-us", True),
    VoiceInfo("fr-CA-SylvieNeural", "Sylvie", "fr-ca", True),
    VoiceInfo("fr-FR-DeniseNeural", "Denise", "fr-fr", True),
    VoiceInfo("fr-FR-HenriNeural", "Henri", "fr-fr", False),
]


class FakePlayer:
    def __init__(self, gate: threading.Event | None = None):
        self.played, self.gate, self.closed = [], gate, False

    def play(self, audio, interrupt):
        if self.gate:
            self.gate.wait(5)
        if not interrupt.is_set():
            self.played.append(audio.decode())

    def close(self):
        self.closed = True


def test_noms_et_debit():
    assert _display_name("fr-FR-VivienneMultilingualNeural") == "Vivienne Multilingual"
    assert _rate_percent(175) == "+0%"
    assert _rate_percent(210) == "+20%"
    assert _rate_percent(140) == "-20%"


def test_choix_de_la_voix_en_ligne(monkeypatch):
    assert resolve_voice() == DEFAULT_VOICE
    assert resolve_voice("fr-FR-HenriNeural") == "fr-FR-HenriNeural"  # identifiant complet : pas de réseau
    monkeypatch.setattr(voice_online, "online_voices", lambda: EN_LIGNE)
    assert resolve_voice("henri") == "fr-FR-HenriNeural"
    assert resolve_voice("emma") == "en-US-EmmaMultilingualNeural"
    with pytest.raises(SpeechUnavailable):
        resolve_voice("Hortense")


def test_phrases_preparees_a_l_avance_et_dites_dans_l_ordre():
    demandes, gate = [], threading.Event()
    player = FakePlayer(gate)

    def synthesize(text):
        demandes.append(text)
        return text.encode()

    backend = OnlineBackend(synthesize=synthesize, player=player)
    speaker = Speaker(backend_factory=lambda: backend)
    assert speaker.voice_name == "Denise (en ligne)"
    speaker.say("Un. Deux. Trois.")
    deadline = time.time() + 5
    while len(demandes) < 3 and time.time() < deadline:  # la 1re phrase n'est pas encore dite
        time.sleep(0.01)
    assert sorted(demandes) == ["Deux.", "Trois.", "Un."] and player.played == []
    gate.set()
    assert speaker.wait(5)
    assert player.played == ["Un.", "Deux.", "Trois."]
    assert len(demandes) == 3  # aucune phrase synthétisée deux fois
    speaker.close()
    assert player.closed


def test_stop_annule_les_phrases_en_ligne():
    gate = threading.Event()
    player = FakePlayer(gate)
    backend = OnlineBackend(synthesize=lambda text: text.encode(), player=player)
    speaker = Speaker(backend_factory=lambda: backend)
    speaker.say("Un. Deux. Trois.")
    speaker.stop()
    gate.set()
    assert speaker.wait(5)
    assert player.played == [] and backend._jobs == {}
    speaker.say("Suite.")
    speaker.close()
    assert player.played == ["Suite."]


def test_repli_sur_la_voix_locale_en_cas_de_panne():
    appels, replis = [], []
    local = FakeBackend()

    def synthesize(text):
        appels.append(text)
        raise ConnectionError("réseau coupé")

    online = OnlineBackend(synthesize=synthesize, player=FakePlayer())
    backend = FallbackBackend(online, lambda: local, replis.append)
    speaker = Speaker(backend_factory=lambda: backend)
    speaker.say("Un.")
    assert speaker.wait(5)
    speaker.say("Deux. Trois.")
    speaker.close()
    assert local.spoken == ["Un.", "Deux.", "Trois."]  # rien n'est perdu
    assert len(replis) == 1 and "connexion Internet (ConnectionError)" in str(replis[0])
    assert appels == ["Un."]  # plus aucun envoi au service après la panne
    assert speaker.voice_name == "voix de test" and speaker.enabled


def test_repli_des_le_demarrage_si_non_installee(monkeypatch):
    def absent():
        raise SpeechUnavailable("la voix en ligne n'est pas installée")

    local, replis = FakeBackend(), []
    monkeypatch.setattr(voice_online, "_edge_tts", absent)
    monkeypatch.setattr(speak, "make_system_backend", lambda voice, rate: local)
    assert make_backend(engine="naturelle", on_fallback=replis.append) is local
    assert len(replis) == 1


def test_lecture_mp3_reelle(monkeypatch):
    pytest.importorskip("pygame")
    monkeypatch.setenv("SDL_AUDIODRIVER", "dummy")  # pas de carte son nécessaire
    player = voice_online.MixerPlayer()
    backend = OnlineBackend(synthesize=lambda text: MP3.read_bytes(), player=player)
    debut = time.time()
    backend.speak("Bonjour Monsieur.")
    assert time.time() - debut > 0.5  # le son (1 s) a bien été joué
    threading.Timer(0.1, backend.stop).start()
    debut = time.time()
    backend.speak("Bonjour Monsieur.")
    assert time.time() - debut < 0.6  # coupé net
    backend.close()


def test_option_naturelle(monkeypatch, tmp_path, capsys):
    vus = {}

    class Espion:
        voice_name = "Denise (en ligne)"

        def __init__(self, voice, rate, engine, **kwargs):
            vus.update(engine=engine, voice=voice)

    monkeypatch.setattr(cli, "Speaker", Espion)
    monkeypatch.setenv("ANDREA_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(cli.Session, "answer", lambda self, text: None)
    monkeypatch.setattr(cli.Session, "close", lambda self: None)
    cli.main(["--naturelle", "--choisir-voix", "henri", "bonjour"])
    assert vus == {"engine": "naturelle", "voice": "henri"}
    assert "Denise (en ligne)" in capsys.readouterr().out


def test_liste_des_voix_en_ligne(monkeypatch, capsys):
    monkeypatch.setattr(voice_online, "online_voices", lambda: EN_LIGNE)
    cli.list_voices(Config(tts_engine="naturelle"))
    sortie = capsys.readouterr().out
    assert "Denise  (fr-fr, féminine)  ←" in sortie
    assert "Henri  (fr-fr, masculine)" in sortie and "Emma" not in sortie
