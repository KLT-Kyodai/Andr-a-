import pytest

from andrea.config import Config
from andrea.tools import Toolbox, calculer_expression
from andrea.listen import strip_wake_word


@pytest.fixture
def toolbox(tmp_path):
    return Toolbox(Config(data_dir=tmp_path, web_search=False), notify=lambda m: None)


def test_calculatrice():
    assert calculer_expression("2 + 3 * 4") == 14
    assert calculer_expression("sqrt(16) + 2^3") == 12
    assert calculer_expression("1,5 * 2") == 3


@pytest.mark.parametrize("expr", ["__import__('os')", "open('x')", "2**100000"])
def test_calculatrice_refuse_le_code(expr):
    with pytest.raises(ValueError):
        calculer_expression(expr)


def test_memoire(toolbox):
    toolbox.run("memoriser", {"cle": "prenom", "valeur": "Théo"})
    result, err = toolbox.run("se_souvenir", {"recherche": "prenom"})
    assert not err and "Théo" in result
    toolbox.run("oublier", {"cle": "prenom"})
    assert toolbox.run("se_souvenir", {})[0] == "Aucun souvenir correspondant."


def test_notes(toolbox):
    toolbox.run("ajouter_note", {"texte": "Acheter du café"})
    toolbox.run("ajouter_note", {"texte": "Appeler Pepper"})
    assert "2. Appeler Pepper" in toolbox.run("lister_notes", {})[0]
    toolbox.run("supprimer_note", {"numero": 1})
    assert "Acheter" not in toolbox.run("lister_notes", {})[0]


def test_validation(toolbox):
    assert toolbox.run("calculer", {})[1] is True
    assert toolbox.run("calculer", {"expression": 3})[1] is True
    assert toolbox.run("supprimer_note", {"numero": True})[1] is True
    assert toolbox.run("inexistant", {})[1] is True
    assert toolbox.run("calculer", "pas un dict")[1] is True


def test_url_securisee(toolbox):
    assert "Seules" in toolbox.run("ouvrir_site_web", {"url": "file:///etc/passwd"})[0]


def test_mot_eveil():
    assert strip_wake_word("Andréa, quelle heure est-il ?") == "quelle heure est-il ?"
    assert strip_wake_word("Hey Andrea lance un minuteur") == "lance un minuteur"
    assert strip_wake_word("bonjour tout le monde") is None


def test_definitions_web(tmp_path):
    tools = Toolbox(Config(data_dir=tmp_path, web_search=True)).definitions()
    assert any(t.get("type") == "web_search_20260209" for t in tools)
