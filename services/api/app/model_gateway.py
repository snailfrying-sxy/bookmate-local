from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from .models import ModelProtocol, ModelSettings, ModelSettingsPatch, ModelTestResponse
from .storage import iter_settings, set_settings


SETTING_KEYS = {
    "protocol": "model.protocol",
    "base_url": "model.base_url",
    "model": "model.name",
    "api_key": "model.api_key",
    "timeout_seconds": "model.timeout_seconds",
}


def _stored_values() -> dict[str, str]:
    return dict(iter_settings(list(SETTING_KEYS.values())))


def _value(field: str, env_name: str, stored: dict[str, str], default: str = "") -> tuple[str, str]:
    environment = os.getenv(env_name)
    if environment not in (None, ""):
        return environment, "environment"
    if SETTING_KEYS[field] in stored:
        return stored[SETTING_KEYS[field]], "local"
    return default, "default"


def get_model_settings(include_key: bool = False) -> ModelSettings:
    stored = _stored_values()
    protocol, protocol_source = _value("protocol", "BOOKMATE_MODEL_PROTOCOL", stored, ModelProtocol.CHAT_COMPLETIONS)
    base_url, base_source = _value("base_url", "BOOKMATE_MODEL_BASE_URL", stored)
    model, model_source = _value("model", "BOOKMATE_MODEL_NAME", stored)
    api_key, key_source = _value("api_key", "BOOKMATE_MODEL_API_KEY", stored)
    timeout, _ = _value("timeout_seconds", "BOOKMATE_MODEL_TIMEOUT_SECONDS", stored, "60")
    sources = {protocol_source, base_source, model_source, key_source}
    source = "environment" if "environment" in sources else "local" if "local" in sources else "default"
    try:
        timeout_seconds = max(5, min(int(timeout), 300))
    except ValueError:
        timeout_seconds = 60
    return ModelSettings(
        protocol=ModelProtocol(protocol),
        base_url=base_url,
        model=model,
        api_key_configured=bool(api_key),
        api_key=api_key if include_key else None,
        timeout_seconds=timeout_seconds,
        source=source,
    )


def update_model_settings(patch: ModelSettingsPatch) -> ModelSettings:
    values: dict[str, str | None] = {}
    if patch.protocol is not None:
        values[SETTING_KEYS["protocol"]] = patch.protocol.value
    if patch.base_url is not None:
        if patch.base_url.strip():
            _validate_base_url(patch.base_url)
            values[SETTING_KEYS["base_url"]] = patch.base_url.rstrip("/")
        else:
            values[SETTING_KEYS["base_url"]] = None
    if patch.model is not None:
        values[SETTING_KEYS["model"]] = patch.model.strip() or None
    if patch.api_key is not None:
        values[SETTING_KEYS["api_key"]] = patch.api_key.strip() or None
    if patch.clear_api_key:
        values[SETTING_KEYS["api_key"]] = None
    if patch.timeout_seconds is not None:
        values[SETTING_KEYS["timeout_seconds"]] = str(patch.timeout_seconds)
    set_settings(values)
    return get_model_settings()


def _validate_base_url(base_url: str) -> None:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base_url must be an absolute HTTP(S) URL")


def _endpoint(base_url: str, protocol: ModelProtocol) -> str:
    base = base_url.rstrip("/")
    suffix = "/chat/completions" if protocol == ModelProtocol.CHAT_COMPLETIONS else "/responses"
    return f"{base}{suffix}"


def _extract_text(payload: dict[str, Any], protocol: ModelProtocol) -> str:
    if protocol == ModelProtocol.CHAT_COMPLETIONS:
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("Response does not contain choices[0].message.content") from error
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
        raise ValueError("Model returned an unsupported content shape")

    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    parts: list[str] = []
    for output in payload.get("output", []):
        if not isinstance(output, dict):
            continue
        for content in output.get("content", []):
            if isinstance(content, dict) and content.get("type") in {"output_text", "text"}:
                parts.append(str(content.get("text", "")))
    if not parts:
        raise ValueError("Response does not contain text output")
    return "".join(parts)


async def generate_text(messages: list[dict[str, str]]) -> tuple[str, str]:
    settings = get_model_settings(include_key=True)
    if not settings.base_url or not settings.model:
        raise ValueError("Configure model base_url and model before chatting")
    _validate_base_url(settings.base_url)
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    if settings.protocol == ModelProtocol.CHAT_COMPLETIONS:
        body: dict[str, Any] = {"model": settings.model, "messages": messages, "stream": False}
    else:
        system = "\n".join(message["content"] for message in messages if message["role"] == "system")
        dialogue = "\n".join(
            f"{message['role']}: {message['content']}" for message in messages if message["role"] != "system"
        )
        body = {"model": settings.model, "input": dialogue}
        if system:
            body["instructions"] = system
    async with httpx.AsyncClient(timeout=settings.timeout_seconds) as client:
        response = await client.post(_endpoint(settings.base_url, settings.protocol), headers=headers, json=body)
    response.raise_for_status()
    payload = response.json()
    return _extract_text(payload, settings.protocol), settings.model


async def test_model_connection() -> ModelTestResponse:
    started = time.perf_counter()
    try:
        text, model = await generate_text(
            [
                {"role": "system", "content": "Reply with the single word OK."},
                {"role": "user", "content": "Connection test"},
            ]
        )
        return ModelTestResponse(
            ok=True,
            message="Model returned readable text",
            model=model,
            latency_ms=round((time.perf_counter() - started) * 1000),
            preview=text.strip()[:120],
        )
    except Exception as error:
        return ModelTestResponse(
            ok=False,
            message=str(error)[:500],
            model=get_model_settings().model or None,
            latency_ms=round((time.perf_counter() - started) * 1000),
            preview=None,
        )
