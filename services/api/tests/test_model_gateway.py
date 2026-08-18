import asyncio

from app import model_gateway
from app.model_gateway import _endpoint, _extract_text
from app.models import ModelProtocol, ModelSettings


def test_chat_completions_text_shape() -> None:
    payload = {"choices": [{"message": {"content": "你好，书友。"}}]}
    assert _extract_text(payload, ModelProtocol.CHAT_COMPLETIONS) == "你好，书友。"


def test_responses_text_shape() -> None:
    payload = {
        "output": [
            {"content": [{"type": "output_text", "text": "我们继续聊。"}]}
        ]
    }
    assert _extract_text(payload, ModelProtocol.RESPONSES) == "我们继续聊。"


def test_protocol_endpoint_is_appended_to_v1_root() -> None:
    assert (
        _endpoint("http://127.0.0.1:11434/v1/", ModelProtocol.CHAT_COMPLETIONS)
        == "http://127.0.0.1:11434/v1/chat/completions"
    )
    assert (
        _endpoint("https://api.example/v1", ModelProtocol.RESPONSES)
        == "https://api.example/v1/responses"
    )


def test_generate_text_uses_minimal_chat_completions_contract(monkeypatch: object) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": "模型回复"}}]}

    class FakeClient:
        def __init__(self, timeout: int) -> None:
            captured["timeout"] = timeout

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, headers: dict[str, str], json: dict[str, object]) -> FakeResponse:
            captured.update(url=url, headers=headers, body=json)
            return FakeResponse()

    monkeypatch.setattr(
        model_gateway,
        "get_model_settings",
        lambda include_key=False: ModelSettings(
            protocol=ModelProtocol.CHAT_COMPLETIONS,
            base_url="http://model.local/v1",
            model="book-model",
            api_key_configured=True,
            api_key="secret" if include_key else None,
            timeout_seconds=42,
            source="local",
        ),
    )
    monkeypatch.setattr(model_gateway.httpx, "AsyncClient", FakeClient)

    text, model = asyncio.run(
        model_gateway.generate_text([{"role": "user", "content": "聊聊这本书"}])
    )
    assert text == "模型回复"
    assert model == "book-model"
    assert captured["url"] == "http://model.local/v1/chat/completions"
    assert captured["headers"] == {
        "Content-Type": "application/json",
        "Authorization": "Bearer secret",
    }
    assert captured["body"] == {
        "model": "book-model",
        "messages": [{"role": "user", "content": "聊聊这本书"}],
        "stream": False,
    }
