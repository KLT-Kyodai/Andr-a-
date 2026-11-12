from types import SimpleNamespace as NS

import anthropic

from andrea import cli
from andrea.config import Config
from andrea.speak import Speaker
from tests.test_brain import FakeClient
from tests.test_speak import FakeBackend


def make_session(monkeypatch, tmp_path, replies, **config):
    backend = FakeBackend()
    client = FakeClient(replies)
    monkeypatch.setattr(anthropic, "Anthropic", lambda: client)
    monkeypatch.setattr(cli, "Speaker", lambda *a, **kw: Speaker(backend_factory=lambda: backend, **kw))
    session = cli.Session(Config(data_dir=tmp_path, web_search=False, **config))
    return session, backend, client


def reply(text):
    return NS(stop_reason="end_turn", content=[NS(type="text", text=text)])


def test_parle_lit_la_reponse(monkeypatch, tmp_path, capsys):
    session, backend, client = make_session(
        monkeypatch, tmp_path, [reply("Bonjour **Monsieur**. Tout va bien 🚀")], speak=True
    )
    session.answer("Bonjour")
    session.close()
    assert backend.spoken == ["Bonjour Monsieur.", "Tout va bien"]
    assert "lues à voix haute" in client.calls[0]["system"]
    assert "Bonjour **Monsieur**" in capsys.readouterr().out  # l'écran garde le texte d'origine


def test_muet_puis_parle(monkeypatch, tmp_path):
    session, backend, _ = make_session(monkeypatch, tmp_path, [reply("Chut."), reply("Me revoilà.")], speak=True)
    assert session.command("/muet")
    session.answer("un")
    assert session.command("/parle")
    session.speaker.wait(5)
    session.answer("deux")
    session.close()
    assert backend.spoken == ["Je vous parle à nouveau.", "Me revoilà."]


def test_sans_voix_par_defaut(monkeypatch, tmp_path):
    session, backend, client = make_session(monkeypatch, tmp_path, [reply("Bonjour.")])
    session.answer("Bonjour")
    session.close()
    assert session.speaker is None and backend.spoken == []
    assert "lues à voix haute" not in client.calls[0]["system"]
