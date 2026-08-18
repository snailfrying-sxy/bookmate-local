"""Local conversation and user-confirmed memory persistence."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from .models import (
    ChatRequest,
    ChatResponse,
    CompanionMode,
    ConversationDetail,
    ConversationMessage,
    ConversationSummary,
    Memory,
    MemoryScope,
    MemoryStatus,
    LibraryBook,
    ReadingNote,
)
from .storage import connect


def _book_context(request: ChatRequest) -> tuple[str | None, str | None]:
    if request.mode == CompanionMode.GENERAL_COMPANION:
        return None, None
    if request.library_book_id:
        return f"library:{request.library_book_id}", request.book_title
    if request.knowledge_document_id:
        return f"document:{request.knowledge_document_id}", request.book_title
    if request.book_id:
        return f"catalog:{request.book_id}", request.book_title
    return None, request.book_title


def _title(message: str) -> str:
    compact = re.sub(r"\s+", " ", message).strip(" ，。！？!?；;：:")
    return compact if len(compact) <= 30 else f"{compact[:30]}…"


def _message_from_row(row: Any) -> ConversationMessage:
    return ConversationMessage(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
    )


def _summary_from_row(row: Any) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"],
        title=row["title"],
        mode=row["mode"],
        book_key=row["book_key"],
        book_title=row["book_title"],
        document_id=row["document_id"],
        message_count=row["message_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _memory_from_row(row: Any) -> Memory:
    return Memory(
        id=row["id"],
        conversation_id=row["conversation_id"],
        scope=row["scope"],
        book_key=row["book_key"],
        book_title=row["book_title"],
        content=row["content"],
        source_message_id=row["source_message_id"],
        status=row["status"],
        created_at=row["created_at"],
        confirmed_at=row["confirmed_at"],
    )


def ensure_conversation(request: ChatRequest) -> ConversationSummary:
    conversation_id = request.conversation_id or str(uuid.uuid4())
    book_key, book_title = _book_context(request)
    with connect() as connection:
        row = connection.execute(
            """
            SELECT c.*, COUNT(m.id) AS message_count
            FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.id = ? GROUP BY c.id
            """,
            (conversation_id,),
        ).fetchone()
        if row:
            return _summary_from_row(row)
        connection.execute(
            """
            INSERT INTO conversations(id, title, mode, book_key, book_title, document_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id,
                _title(request.message),
                request.mode.value,
                book_key,
                book_title,
                request.knowledge_document_id,
            ),
        )
    return get_conversation_summary(conversation_id)


def get_conversation_summary(conversation_id: str) -> ConversationSummary:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT c.*, COUNT(m.id) AS message_count
            FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.id = ? GROUP BY c.id
            """,
            (conversation_id,),
        ).fetchone()
    if not row:
        raise KeyError(conversation_id)
    return _summary_from_row(row)


def list_conversations(limit: int = 30) -> list[ConversationSummary]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT c.*, COUNT(m.id) AS message_count
            FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?
            """,
            (max(1, min(limit, 100)),),
        ).fetchall()
    return [_summary_from_row(row) for row in rows]


def get_conversation(conversation_id: str) -> ConversationDetail:
    summary = get_conversation_summary(conversation_id)
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
            (conversation_id,),
        ).fetchall()
    return ConversationDetail(**summary.model_dump(), messages=[_message_from_row(row) for row in rows])


def recent_messages(conversation_id: str, limit: int = 8) -> list[dict[str, str]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT role, content FROM messages WHERE conversation_id = ?
            ORDER BY created_at DESC, rowid DESC LIMIT ?
            """,
            (conversation_id, max(1, min(limit, 20))),
        ).fetchall()
    rows.reverse()
    return [
        {"role": "user" if row["role"] == "reader" else "assistant", "content": row["content"]}
        for row in rows
    ]


def relevant_memories(conversation_id: str, request: ChatRequest, limit: int = 8) -> list[Memory]:
    book_key, _ = _book_context(request)
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM memories
            WHERE status = 'confirmed' AND (
                scope = 'global'
                OR (scope = 'session' AND conversation_id = ?)
                OR (scope = 'book' AND book_key = ?)
            )
            ORDER BY confirmed_at DESC, created_at DESC LIMIT ?
            """,
            (conversation_id, book_key, max(1, min(limit, 20))),
        ).fetchall()
    return [_memory_from_row(row) for row in rows]


def record_chat(
    conversation_id: str,
    request: ChatRequest,
    response: ChatResponse,
) -> ChatResponse:
    reader_message_id = str(uuid.uuid4())
    companion_message_id = str(uuid.uuid4())
    candidate_id: str | None = None
    book_key, book_title = _book_context(request)
    companion_text = f"{response.reply}\n\n{response.follow_up}".strip()
    with connect() as connection:
        connection.execute(
            "INSERT INTO messages(id, conversation_id, role, content) VALUES (?, ?, 'reader', ?)",
            (reader_message_id, conversation_id, request.message),
        )
        connection.execute(
            "INSERT INTO messages(id, conversation_id, role, content) VALUES (?, ?, 'companion', ?)",
            (companion_message_id, conversation_id, companion_text),
        )
        if response.memory_candidate:
            candidate_id = str(uuid.uuid4())
            default_scope = MemoryScope.BOOK if request.mode == CompanionMode.BOOK_ROOM else MemoryScope.GLOBAL
            connection.execute(
                """
                INSERT INTO memories(
                    id, conversation_id, scope, book_key, book_title, content, source_message_id, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
                """,
                (
                    candidate_id,
                    conversation_id,
                    default_scope.value,
                    book_key,
                    book_title,
                    response.memory_candidate[:500],
                    reader_message_id,
                ),
            )
        connection.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (conversation_id,),
        )
    return response.model_copy(update={"conversation_id": conversation_id, "memory_candidate_id": candidate_id})


def list_memories(status: MemoryStatus | None = None, limit: int = 100) -> list[Memory]:
    sql = "SELECT * FROM memories"
    parameters: list[object] = []
    if status:
        sql += " WHERE status = ?"
        parameters.append(status.value)
    sql += " ORDER BY created_at DESC LIMIT ?"
    parameters.append(max(1, min(limit, 300)))
    with connect() as connection:
        rows = connection.execute(sql, parameters).fetchall()
    return [_memory_from_row(row) for row in rows]


def confirm_memory(memory_id: str, content: str | None, scope: MemoryScope | None) -> Memory:
    with connect() as connection:
        row = connection.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if not row:
            raise KeyError(memory_id)
        connection.execute(
            """
            UPDATE memories SET content = ?, scope = ?, status = 'confirmed', confirmed_at = ?
            WHERE id = ?
            """,
            (
                content.strip() if content else row["content"],
                (scope or MemoryScope(row["scope"])).value,
                datetime.now(timezone.utc).isoformat(),
                memory_id,
            ),
        )
        updated = connection.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
    return _memory_from_row(updated)


def delete_memory(memory_id: str) -> None:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    if cursor.rowcount != 1:
        raise KeyError(memory_id)


def delete_conversation(conversation_id: str) -> None:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    if cursor.rowcount != 1:
        raise KeyError(conversation_id)


def export_local_data(
    documents: list[dict[str, object]],
    library_books: list[LibraryBook],
    reading_notes: list[ReadingNote],
) -> dict[str, object]:
    conversations = [get_conversation(summary.id) for summary in list_conversations(limit=100)]
    return {
        "schema_version": 2,
        "exported_at": datetime.now(timezone.utc),
        "conversations": conversations,
        "memories": list_memories(limit=300),
        "documents": documents,
        "library_books": library_books,
        "reading_notes": reading_notes,
    }
