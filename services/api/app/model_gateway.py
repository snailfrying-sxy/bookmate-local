from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from .models import (
    ModelConnection,
    ModelProfile,
    ModelProfileCreate,
    ModelProfilePatch,
    ModelProtocol,
    ModelSettings,
    ModelSettingsPatch,
    ModelTestResponse,
)
from .storage import connect, iter_settings, set_settings


SETTING_KEYS = {
    "protocol": "model.protocol",
    "base_url": "model.base_url",
    "model": "model.name",
    "api_key": "model.api_key",
    "timeout_seconds": "model.timeout_seconds",
}
DEFAULT_PROFILE_KEY = "model.default_profile_id"


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


def _default_profile_id() -> str | None:
    return dict(iter_settings([DEFAULT_PROFILE_KEY])).get(DEFAULT_PROFILE_KEY)


def _profile_from_row(row: Any, default_id: str | None, include_key: bool = False) -> ModelProfile:
    return ModelProfile(
        id=row["id"],
        name=row["name"],
        protocol=ModelProtocol(row["protocol"]),
        base_url=row["base_url"],
        model=row["model"],
        api_key_configured=bool(row["api_key"]),
        api_key=row["api_key"] if include_key else None,
        timeout_seconds=row["timeout_seconds"],
        source="local",
        is_default=row["id"] == default_id,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_model_profiles() -> list[ModelProfile]:
    default_id = _default_profile_id()
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM model_profiles ORDER BY updated_at DESC, name COLLATE NOCASE"
        ).fetchall()
    return [_profile_from_row(row, default_id) for row in rows]


def get_model_profile(profile_id: str, include_key: bool = False) -> ModelProfile:
    default_id = _default_profile_id()
    with connect() as connection:
        row = connection.execute("SELECT * FROM model_profiles WHERE id = ?", (profile_id,)).fetchone()
    if row is None:
        raise KeyError("Model profile not found")
    return _profile_from_row(row, default_id, include_key)


def create_model_profile(payload: ModelProfileCreate) -> ModelProfile:
    _validate_base_url(payload.base_url)
    profile_id = f"model-{uuid4().hex}"
    with connect() as connection:
        try:
            connection.execute(
                """
                INSERT INTO model_profiles(id, name, protocol, base_url, model, api_key, timeout_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile_id,
                    payload.name.strip(),
                    payload.protocol.value,
                    payload.base_url.rstrip("/"),
                    payload.model.strip(),
                    payload.api_key.strip() if payload.api_key else None,
                    payload.timeout_seconds,
                ),
            )
        except Exception as error:
            if "UNIQUE constraint failed" in str(error):
                raise ValueError("A model profile with this name already exists") from error
            raise
    if payload.set_as_default or not _default_profile_id():
        set_settings({DEFAULT_PROFILE_KEY: profile_id})
    return get_model_profile(profile_id)


def update_model_profile(profile_id: str, patch: ModelProfilePatch) -> ModelProfile:
    get_model_profile(profile_id, include_key=True)
    changes: dict[str, object] = {}
    if patch.name is not None:
        changes["name"] = patch.name.strip()
    if patch.protocol is not None:
        changes["protocol"] = patch.protocol.value
    if patch.base_url is not None:
        _validate_base_url(patch.base_url)
        changes["base_url"] = patch.base_url.rstrip("/")
    if patch.model is not None:
        changes["model"] = patch.model.strip()
    if patch.api_key is not None:
        changes["api_key"] = patch.api_key.strip() or None
    if patch.clear_api_key:
        changes["api_key"] = None
    if patch.timeout_seconds is not None:
        changes["timeout_seconds"] = patch.timeout_seconds
    if changes:
        assignments = ", ".join(f"{column} = ?" for column in changes)
        values = [*changes.values(), profile_id]
        with connect() as connection:
            try:
                connection.execute(
                    f"UPDATE model_profiles SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    values,
                )
            except Exception as error:
                if "UNIQUE constraint failed" in str(error):
                    raise ValueError("A model profile with this name already exists") from error
                raise
    if patch.set_as_default is True:
        set_settings({DEFAULT_PROFILE_KEY: profile_id})
    elif patch.set_as_default is False and _default_profile_id() == profile_id:
        set_settings({DEFAULT_PROFILE_KEY: None})
    return get_model_profile(profile_id)


def delete_model_profile(profile_id: str) -> None:
    get_model_profile(profile_id)
    with connect() as connection:
        connection.execute("DELETE FROM model_profiles WHERE id = ?", (profile_id,))
    if _default_profile_id() == profile_id:
        set_settings({DEFAULT_PROFILE_KEY: None})


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


async def generate_text(
    messages: list[dict[str, str]], settings: ModelConnection | None = None
) -> tuple[str, str]:
    settings = settings or get_model_settings(include_key=True)
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


async def test_model_connection(profile_id: str | None = None) -> ModelTestResponse:
    started = time.perf_counter()
    settings: ModelConnection = (
        get_model_profile(profile_id, include_key=True)
        if profile_id
        else get_model_settings(include_key=True)
    )
    try:
        text, model = await generate_text(
            [
                {"role": "system", "content": "Reply with the single word OK."},
                {"role": "user", "content": "Connection test"},
            ],
            settings,
        )
        return ModelTestResponse(
            ok=True,
            message="Model returned readable text",
            model=model,
            latency_ms=round((time.perf_counter() - started) * 1000),
            preview=text.strip()[:120],
        )
    except httpx.TimeoutException:
        message = f"Connection timed out after {settings.timeout_seconds}s"
    except httpx.HTTPStatusError as error:
        message = f"Model service returned HTTP {error.response.status_code}"
    except Exception as error:
        message = str(error) or error.__class__.__name__
    return ModelTestResponse(
        ok=False,
        message=message[:500],
        model=settings.model or None,
        latency_ms=round((time.perf_counter() - started) * 1000),
        preview=None,
    )
