from types import SimpleNamespace as NS

from andrea.brain import Andrea, Callbacks
from andrea.config import Config


class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        for block in self.message.content:
            if block.type == "text":
                yield NS(type="text", text=block.text)

    def get_final_message(self):
        return self.message


class FakeClient:
    """Simule l'API : 1er tour -> appel d'outil, 2e tour -> réponse finale."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.beta = NS(messages=NS(stream=self._stream))

    def _stream(self, **kwargs):
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})
        return FakeStream(self.responses.pop(0))


def test_boucle_outils(tmp_path):
    client = FakeClient([
        NS(stop_reason="tool_use", content=[
            NS(type="tool_use", id="t1", name="calculer", input={"expression": "6*7"}),
        ]),
        NS(stop_reason="end_turn", content=[NS(type="text", text="Cela fait 42, Monsieur.")]),
    ])
    used = []
    andrea = Andrea(
        config=Config(data_dir=tmp_path, web_search=False),
        callbacks=Callbacks(on_tool=lambda n, a: used.append(n)),
        client=client,
    )
    assert andrea.ask("Combien font 6 fois 7 ?") == "Cela fait 42, Monsieur."
    assert used == ["calculer"]
    tool_result = client.calls[1]["messages"][-1]["content"][0]
    assert tool_result["content"] == "6*7 = 42" and tool_result["is_error"] is False
    assert client.calls[0]["model"] == "claude-opus-5-5"
    assert client.calls[0]["fallbacks"] == "default"
    assert len(andrea.messages) == 4


def test_refus_nettoie_historique(tmp_path):
    client = FakeClient([NS(stop_reason="refusal", content=[])])
    andrea = Andrea(config=Config(data_dir=tmp_path), client=client)
    andrea.ask("...")
    assert andrea.messages == []
