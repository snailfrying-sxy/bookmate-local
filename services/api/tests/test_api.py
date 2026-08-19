import asyncio

import httpx

from app import main as main_module
from app.main import app
from app.models import ModelProtocol, ModelSettings


def request(method: str, path: str, **kwargs: object) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def test_health() -> None:
    response = request("GET", "/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "mode": "demo"}


def test_local_development_cors_allows_loopback_preview() -> None:
    response = request(
        "OPTIONS",
        "/v1/library/books",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"


def test_demo_session_has_transparent_companion_identity() -> None:
    response = request("GET", "/v1/demo/session")
    assert response.status_code == 200
    payload = response.json()
    assert payload["companion"]["name"] == "泊舟"
    assert "AI" in payload["companion"]["role"]
    assert payload["current_book"]["id"] == "the-stranger"


def test_challenge_direction_produces_one_clear_question() -> None:
    response = request(
        "POST",
        "/v1/chat",
        json={
            "message": "我觉得默尔索不是冷漠，他只是不愿意假装。",
            "book_id": "the-stranger",
            "direction": "challenge",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["flow_move"] == "tension"
    assert payload["demo_mode"] is True
    assert payload["citations"] == []
    assert payload["follow_up"].count("？") == 1


def test_recommendations_cover_three_distinct_lanes() -> None:
    response = request(
        "POST",
        "/v1/recommendations",
        json={
            "signals": ["真实", "孤独", "道德选择"],
            "current_book_id": "the-stranger",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 3
    assert {item["lane"] for item in payload["items"]} == {
        "continue",
        "counterpoint",
        "crossover",
    }
    assert all(item["why"] for item in payload["items"])


def test_empty_message_is_rejected() -> None:
    response = request(
        "POST",
        "/v1/chat",
        json={"message": "", "book_id": "the-stranger", "direction": "follow"},
    )
    assert response.status_code == 422


def test_general_companion_has_no_active_book() -> None:
    response = request(
        "POST",
        "/v1/chat",
        json={
            "message": "最近我总在想，一个人为什么需要通过阅读理解自己。",
            "mode": "general_companion",
            "book_id": None,
            "direction": "follow",
            "search_policy": "ask",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "general_companion"
    assert payload["active_book"] is None
    assert payload["search_decision"]["action"] == "not_needed"


def test_search_off_is_a_hard_boundary() -> None:
    response = request(
        "POST",
        "/v1/chat",
        json={
            "message": "帮我查一下这本书现在多少钱，哪里有货。",
            "mode": "book_room",
            "book_id": "the-stranger",
            "search_policy": "off",
        },
    )
    assert response.status_code == 200
    decision = response.json()["search_decision"]
    assert decision["needed"] is True
    assert decision["action"] == "disabled"
    assert decision["suggested_queries"] == []


def test_search_ask_requires_permission_for_dynamic_fact() -> None:
    response = request(
        "POST",
        "/v1/chat",
        json={
            "message": "附近图书馆现在可以借到吗？",
            "mode": "book_room",
            "book_id": "the-stranger",
            "search_policy": "ask",
        },
    )
    assert response.status_code == 200
    assert response.json()["search_decision"]["action"] == "permission_required"


def test_search_auto_routes_dynamic_fact_without_permission_prompt() -> None:
    response = request(
        "POST",
        "/v1/chat",
        json={
            "message": "这本书今天的价格是多少？",
            "mode": "book_room",
            "book_id": "the-stranger",
            "search_policy": "auto",
        },
    )
    assert response.status_code == 200
    assert response.json()["search_decision"]["action"] == "would_search"


def test_companion_state_switches_between_general_and_book_room() -> None:
    general = request(
        "PATCH",
        "/v1/companion/state",
        json={"mode": "general_companion", "search_policy": "off"},
    )
    assert general.status_code == 200
    assert general.json()["active_book"] is None

    invalid_room = request(
        "PATCH",
        "/v1/companion/state",
        json={"mode": "book_room"},
    )
    assert invalid_room.status_code == 422

    room = request(
        "PATCH",
        "/v1/companion/state",
        json={"mode": "book_room", "active_book_id": "the-stranger", "search_policy": "ask"},
    )
    assert room.status_code == 200
    assert room.json()["active_book"]["id"] == "the-stranger"


def test_local_model_settings_are_configurable_and_secret_is_redacted() -> None:
    try:
        response = request(
            "PATCH",
            "/v1/settings/model",
            json={
                "protocol": "chat_completions",
                "base_url": "http://127.0.0.1:11434/v1",
                "model": "local-bookmate-test",
                "api_key": "local-secret",
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["base_url"] == "http://127.0.0.1:11434/v1"
        assert payload["model"] == "local-bookmate-test"
        assert payload["api_key_configured"] is True
        assert "api_key" not in payload

        fetched = request("GET", "/v1/settings/model")
        assert fetched.status_code == 200
        assert "api_key" not in fetched.json()
    finally:
        cleared = request(
            "PATCH",
            "/v1/settings/model",
            json={"base_url": "", "model": "", "clear_api_key": True},
        )
        assert cleared.status_code == 200


def test_reader_profile_is_a_local_interface_preference() -> None:
    try:
        updated = request("PATCH", "/v1/settings/reader", json={"display_name": "小舟"})
        assert updated.status_code == 200
        assert updated.json() == {"display_name": "小舟"}

        fetched = request("GET", "/v1/settings/reader")
        assert fetched.status_code == 200
        assert fetched.json() == {"display_name": "小舟"}
    finally:
        cleared = request("PATCH", "/v1/settings/reader", json={"display_name": ""})
        assert cleared.status_code == 200


def test_model_profiles_are_local_redacted_and_selectable() -> None:
    created = request(
        "POST",
        "/v1/settings/models",
        json={
            "name": "OpenAI compatible test",
            "protocol": "chat_completions",
            "base_url": "http://127.0.0.1:11434/v1",
            "model": "local-bookmate-test",
            "api_key": "profile-secret",
            "set_as_default": True,
        },
    )
    assert created.status_code == 201
    profile = created.json()
    profile_id = profile["id"]
    assert profile["is_default"] is True
    assert profile["api_key_configured"] is True
    assert "api_key" not in profile

    try:
        listed = request("GET", "/v1/settings/models")
        assert listed.status_code == 200
        assert any(item["id"] == profile_id and item["is_default"] for item in listed.json())

        updated = request(
            "PATCH",
            f"/v1/settings/models/{profile_id}",
            json={"name": "OpenAI compatible revised", "model": "local-bookmate-revised"},
        )
        assert updated.status_code == 200
        assert updated.json()["model"] == "local-bookmate-revised"
        assert "api_key" not in updated.json()
    finally:
        deleted = request("DELETE", f"/v1/settings/models/{profile_id}")
        assert deleted.status_code == 204


def test_chat_uses_the_selected_model_profile(monkeypatch: object) -> None:
    selected: dict[str, object] = {}

    def fake_profile(profile_id: str, include_key: bool = False) -> ModelSettings:
        selected["id"] = profile_id
        selected["include_key"] = include_key
        return ModelSettings(
            protocol=ModelProtocol.CHAT_COMPLETIONS,
            base_url="http://model.local/v1",
            model="selected-model",
            api_key_configured=False,
            timeout_seconds=60,
            source="local",
        )

    async def fake_response(*args: object) -> object:
        return main_module.respond(args[0])

    monkeypatch.setattr(main_module, "get_model_profile", fake_profile)
    monkeypatch.setattr(main_module, "respond_with_model", fake_response)

    created = request(
        "POST",
        "/v1/chat",
        json={
            "message": "Use the selected profile for this conversation.",
            "mode": "book_room",
            "book_id": "the-stranger",
            "model_profile_id": "model-selected-for-test",
        },
    )
    assert created.status_code == 200
    assert selected == {"id": "model-selected-for-test", "include_key": True}

    conversation_id = created.json()["conversation_id"]
    assert conversation_id
    deleted = request("DELETE", f"/v1/conversations/{conversation_id}")
    assert deleted.status_code == 204


def test_local_text_document_can_be_uploaded_searched_and_deleted() -> None:
    content = "默尔索拒绝按照社会期待表演悲伤。真实与责任之间存在持续的张力。"
    upload = request(
        "POST",
        "/v1/knowledge/documents",
        files={"file": ("局外人笔记.txt", content.encode("utf-8"), "text/plain")},
    )
    assert upload.status_code == 201
    document = upload.json()
    document_id = document["id"]
    assert document["status"] == "ready"
    assert document["chunk_count"] >= 1

    try:
        search = request(
            "POST",
            "/v1/knowledge/search",
            json={"query": "真实和责任", "document_id": document_id},
        )
        assert search.status_code == 200
        items = search.json()["items"]
        assert items
        assert items[0]["document_id"] == document_id
        assert "责任" in items[0]["text"]
    finally:
        deleted = request("DELETE", f"/v1/knowledge/documents/{document_id}")
        assert deleted.status_code == 204


def test_book_room_chat_retrieves_documents_attached_to_the_selected_book(monkeypatch: object) -> None:
    from app import companion

    captured: list[dict[str, str]] = []

    async def fake_generate(messages: list[dict[str, str]], *_: object) -> tuple[str, str]:
        captured.extend(messages)
        return ('{"reply":"我会先从你保存的资料继续。","follow_up":"哪一点最让你停住？"}', "test-model")

    monkeypatch.setattr(companion, "generate_text", fake_generate)
    created = request("POST", "/v1/library/books", json={"title": "带版本的书房"})
    assert created.status_code == 201
    book_id = created.json()["id"]
    document_id = ""

    try:
        upload = request(
            "POST",
            "/v1/knowledge/documents",
            data={"book_id": book_id},
            files={
                "file": (
                    "书房版本.txt",
                    "伊丽莎白重新阅读那封信，开始怀疑自己的判断。",
                    "text/plain",
                )
            },
        )
        assert upload.status_code == 201
        document_id = upload.json()["id"]

        configured = request(
            "PATCH",
            "/v1/settings/model",
            json={"base_url": "https://example.invalid/v1", "model": "test-model"},
        )
        assert configured.status_code == 200
        chat = request(
            "POST",
            "/v1/chat",
            json={
                "message": "她为什么开始怀疑自己的判断？",
                "mode": "book_room",
                "book_id": None,
                "book_title": "带版本的书房",
                "library_book_id": book_id,
            },
        )
        assert chat.status_code == 200
        assert chat.json()["citations"][0]["source_type"] == "local_document"
        assert chat.json()["citations"][0]["label"] == "书房版本.txt"
        system_prompt = next(message["content"] for message in captured if message["role"] == "system")
        assert "伊丽莎白重新阅读那封信" in system_prompt
    finally:
        request(
            "PATCH",
            "/v1/settings/model",
            json={"base_url": "", "model": "", "clear_api_key": True},
        )
        if document_id:
            request("DELETE", f"/v1/knowledge/documents/{document_id}")
        request("DELETE", f"/v1/library/books/{book_id}")


def test_existing_document_can_be_archived_to_and_detached_from_a_library_book() -> None:
    created = request(
        "POST",
        "/v1/library/books",
        json={"title": "归档测试书", "author": "BookMate"},
    )
    assert created.status_code == 201
    book_id = created.json()["id"]

    upload = request(
        "POST",
        "/v1/knowledge/documents",
        files={"file": ("归档笔记.txt", "这是一本书的附注。".encode("utf-8"), "text/plain")},
    )
    assert upload.status_code == 201
    document_id = upload.json()["id"]

    try:
        archived = request(
            "PATCH",
            f"/v1/knowledge/documents/{document_id}/book",
            data={"book_id": book_id},
        )
        assert archived.status_code == 200
        assert archived.json()["book_id"] == book_id

        detached = request("PATCH", f"/v1/knowledge/documents/{document_id}/book")
        assert detached.status_code == 200
        assert detached.json()["book_id"] is None
    finally:
        request("DELETE", f"/v1/knowledge/documents/{document_id}")
        request("DELETE", f"/v1/library/books/{book_id}")


def test_unsupported_knowledge_file_is_rejected() -> None:
    response = request(
        "POST",
        "/v1/knowledge/documents",
        files={"file": ("archive.exe", b"not a book", "application/octet-stream")},
    )
    assert response.status_code == 422


def test_chat_persists_conversation_and_requires_memory_confirmation() -> None:
    created = request(
        "POST",
        "/v1/chat",
        json={
            "message": "我发现自己总会被书里关于责任的选择吸引。",
            "mode": "book_room",
            "book_id": "the-stranger",
            "direction": "follow",
        },
    )
    assert created.status_code == 200
    payload = created.json()
    conversation_id = payload["conversation_id"]
    memory_id = payload["memory_candidate_id"]
    assert conversation_id
    assert memory_id

    try:
        detail = request("GET", f"/v1/conversations/{conversation_id}")
        assert detail.status_code == 200
        messages = detail.json()["messages"]
        assert [message["role"] for message in messages] == ["reader", "companion"]

        pending = request("GET", "/v1/memories?status_filter=pending")
        assert pending.status_code == 200
        candidate = next(memory for memory in pending.json() if memory["id"] == memory_id)
        assert candidate["status"] == "pending"

        confirmed = request(
            "POST",
            f"/v1/memories/{memory_id}/confirm",
            json={"scope": "book", "content": "用户常被书中关于责任的选择吸引。"},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "confirmed"

        continued = request(
            "POST",
            "/v1/chat",
            json={
                "conversation_id": conversation_id,
                "message": "这也让我不愿意轻易为默尔索开脱。",
                "mode": "book_room",
                "book_id": "the-stranger",
            },
        )
        assert continued.status_code == 200
        assert continued.json()["conversation_id"] == conversation_id

        updated = request("GET", f"/v1/conversations/{conversation_id}")
        assert len(updated.json()["messages"]) == 4
        exported = request("GET", "/v1/export")
        assert exported.status_code == 200
        assert any(item["id"] == conversation_id for item in exported.json()["conversations"])
    finally:
        deleted = request("DELETE", f"/v1/conversations/{conversation_id}")
        assert deleted.status_code == 204
        absent = request("GET", f"/v1/conversations/{conversation_id}")
        assert absent.status_code == 404


def test_personal_library_book_keeps_files_separate_from_book_metadata() -> None:
    created = request(
        "POST",
        "/v1/library/books",
        json={
            "title": "局外人",
            "author": "阿尔贝·加缪",
            "reading_status": "reading",
            "tags": ["存在主义", "法国文学", "存在主义"],
        },
    )
    assert created.status_code == 201
    book = created.json()
    book_id = book["id"]
    assert book["tags"] == ["存在主义", "法国文学"]

    document_id = ""
    try:
        upload = request(
            "POST",
            "/v1/knowledge/documents",
            data={"book_id": book_id},
            files={"file": ("局外人摘录.txt", "今天，妈妈死了。".encode("utf-8"), "text/plain")},
        )
        assert upload.status_code == 201
        document_id = upload.json()["id"]
        assert upload.json()["book_id"] == book_id

        detail = request("GET", f"/v1/library/books/{book_id}")
        assert detail.status_code == 200
        assert detail.json()["document_count"] == 1
        assert detail.json()["documents"][0]["id"] == document_id

        updated = request(
            "PATCH",
            f"/v1/library/books/{book_id}",
            json={"reading_status": "finished", "tags": ["重读", "道德选择"]},
        )
        assert updated.status_code == 200
        assert updated.json()["reading_status"] == "finished"
        assert updated.json()["tags"] == ["重读", "道德选择"]

        searched = request("GET", "/v1/library/books?query=加缪")
        assert searched.status_code == 200
        assert any(item["id"] == book_id for item in searched.json())

        deleted = request("DELETE", f"/v1/library/books/{book_id}")
        assert deleted.status_code == 204
        documents = request("GET", "/v1/knowledge/documents")
        detached = next(item for item in documents.json() if item["id"] == document_id)
        assert detached["book_id"] is None
    finally:
        if document_id:
            response = request("DELETE", f"/v1/knowledge/documents/{document_id}")
            assert response.status_code in {204, 404}


def test_book_room_can_start_from_reader_notes_without_an_uploaded_ebook(monkeypatch: object) -> None:
    from app import companion

    captured: list[dict[str, str]] = []

    async def fake_generate(messages: list[dict[str, str]], *_: object) -> tuple[str, str]:
        captured.extend(messages)
        return (
            '{"reply":"你先抓住的不是结论，而是那种不肯轻易原谅的张力。",'
            '"follow_up":"这段摘录里，哪一个词最让你无法略过？",'
            '"memory_candidate":"用户重视作品中责任与宽恕之间的张力。"}',
            "test-model",
        )

    monkeypatch.setattr(companion, "generate_text", fake_generate)
    created = request(
        "POST",
        "/v1/library/books",
        json={
            "title": "没有上传全文的书",
            "reading_status": "reading",
            "reading_progress": "读到第三章",
            "spoiler_policy": "up_to_progress",
            "companion_stance": "challenge",
            "room_intent": "帮我准备一次不流于摘抄的读书会讨论。",
        },
    )
    assert created.status_code == 201
    book_id = created.json()["id"]

    try:
        note = request(
            "POST",
            f"/v1/library/books/{book_id}/notes",
            json={
                "kind": "quote",
                "quote": "宽恕不是遗忘。",
                "content": "我不同意把宽恕说成软弱。",
                "locator": "第三章",
            },
        )
        assert note.status_code == 201

        detail = request("GET", f"/v1/library/books/{book_id}")
        assert detail.status_code == 200
        assert detail.json()["note_count"] == 1
        assert detail.json()["notes"][0]["quote"] == "宽恕不是遗忘。"

        exported = request("GET", "/v1/export")
        assert exported.status_code == 200
        assert exported.json()["schema_version"] == 2
        assert any(item["id"] == book_id for item in exported.json()["library_books"])
        assert any(item["id"] == note.json()["id"] for item in exported.json()["reading_notes"])

        configured = request(
            "PATCH",
            "/v1/settings/model",
            json={"base_url": "https://example.invalid/v1", "model": "test-model"},
        )
        assert configured.status_code == 200
        chat = request(
            "POST",
            "/v1/chat",
            json={
                "message": "为什么我会对这句话有抵触？",
                "mode": "book_room",
                "book_title": "没有上传全文的书",
                "library_book_id": book_id,
            },
        )
        assert chat.status_code == 200
        assert chat.json()["model_used"] == "test-model"
        assert chat.json()["active_book"] is None
        assert chat.json()["citations"][0]["source_type"] == "reader_note"
        system_prompt = next(message["content"] for message in captured if message["role"] == "system")
        assert "读到第三章" in system_prompt
        assert "只能讨论用户声明已读进度以内" in system_prompt
        assert "宽恕不是遗忘" in system_prompt
    finally:
        request(
            "PATCH",
            "/v1/settings/model",
            json={"base_url": "", "model": "", "clear_api_key": True},
        )
        request("DELETE", f"/v1/library/books/{book_id}")
