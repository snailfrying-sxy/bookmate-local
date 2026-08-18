"""Personal library records kept independently from uploaded files."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from .models import (
    LibraryBook,
    LibraryBookCreate,
    LibraryBookDetail,
    LibraryBookPatch,
    ReadingNote,
    ReadingNoteCreate,
)
from .storage import connect


def _tags(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        tag = " ".join(value.split())[:50]
        key = tag.casefold()
        if tag and key not in seen:
            normalized.append(tag)
            seen.add(key)
    return normalized[:20]


def _document(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "book_id": row["book_id"],
        "name": row["name"],
        "media_type": row["media_type"],
        "extension": row["extension"],
        "size_bytes": row["size_bytes"],
        "status": row["status"],
        "chunk_count": row["chunk_count"],
        "error": row["error"],
        "created_at": row["created_at"],
    }


def _book(row: sqlite3.Row) -> LibraryBook:
    return LibraryBook(
        id=row["id"],
        title=row["title"],
        author=row["author"],
        language=row["language"],
        description=row["description"],
        reading_status=row["reading_status"],
        isbn=row["isbn"],
        reading_progress=row["reading_progress"],
        spoiler_policy=row["spoiler_policy"],
        companion_stance=row["companion_stance"],
        room_intent=row["room_intent"],
        tags=json.loads(row["tags_json"]),
        document_count=row["document_count"],
        note_count=row["note_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _book_query(where: str = "", order: str = "b.updated_at DESC") -> str:
    return f"""
        SELECT b.*, COUNT(d.id) AS document_count
            , (SELECT COUNT(*) FROM reading_notes n WHERE n.book_id = b.id) AS note_count
        FROM library_books b LEFT JOIN documents d ON d.book_id = b.id
        {where}
        GROUP BY b.id ORDER BY {order}
    """


def create_book(payload: LibraryBookCreate) -> LibraryBook:
    book_id = str(uuid.uuid4())
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO library_books(
                title, id, author, language, description, reading_status, isbn, reading_progress,
                spoiler_policy, companion_stance, room_intent, tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title.strip(),
                book_id,
                payload.author.strip() if payload.author else None,
                payload.language.strip() if payload.language else None,
                payload.description.strip() if payload.description else None,
                payload.reading_status.value,
                payload.isbn.strip() if payload.isbn else None,
                payload.reading_progress.strip() if payload.reading_progress else None,
                payload.spoiler_policy.value,
                payload.companion_stance.value,
                payload.room_intent.strip() if payload.room_intent else None,
                json.dumps(_tags(payload.tags), ensure_ascii=False),
            ),
        )
    return get_book(book_id)


def list_books(reading_status: str | None = None, query: str | None = None) -> list[LibraryBook]:
    conditions: list[str] = []
    parameters: list[object] = []
    if reading_status:
        conditions.append("b.reading_status = ?")
        parameters.append(reading_status)
    if query and query.strip():
        conditions.append("(b.title LIKE ? OR b.author LIKE ? OR b.tags_json LIKE ?)")
        wildcard = f"%{query.strip()}%"
        parameters.extend((wildcard, wildcard, wildcard))
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    with connect() as connection:
        rows = connection.execute(_book_query(where), parameters).fetchall()
    return [_book(row) for row in rows]


def get_book(book_id: str) -> LibraryBook:
    with connect() as connection:
        row = connection.execute(_book_query("WHERE b.id = ?"), (book_id,)).fetchone()
    if not row:
        raise KeyError(book_id)
    return _book(row)


def get_book_detail(book_id: str) -> LibraryBookDetail:
    book = get_book(book_id)
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM documents WHERE book_id = ? ORDER BY created_at DESC", (book_id,)
        ).fetchall()
    return LibraryBookDetail(
        **book.model_dump(),
        documents=[_document(row) for row in rows],
        notes=list_reading_notes(book_id),
    )


def update_book(book_id: str, patch: LibraryBookPatch) -> LibraryBook:
    current = get_book(book_id)
    values = patch.model_dump(exclude_unset=True)
    title = values.get("title", current.title)
    author = values.get("author", current.author)
    language = values.get("language", current.language)
    description = values.get("description", current.description)
    status = values.get("reading_status", current.reading_status)
    isbn = values.get("isbn", current.isbn)
    reading_progress = values.get("reading_progress", current.reading_progress)
    spoiler_policy = values.get("spoiler_policy", current.spoiler_policy)
    companion_stance = values.get("companion_stance", current.companion_stance)
    room_intent = values.get("room_intent", current.room_intent)
    tags = _tags(values["tags"]) if "tags" in values else current.tags
    with connect() as connection:
        connection.execute(
            """
            UPDATE library_books
            SET title = ?, author = ?, language = ?, description = ?, reading_status = ?, isbn = ?,
                reading_progress = ?, spoiler_policy = ?, companion_stance = ?, room_intent = ?, tags_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                title.strip(),
                author.strip() if author else None,
                language.strip() if language else None,
                description.strip() if description else None,
                status.value,
                isbn.strip() if isbn else None,
                reading_progress.strip() if reading_progress else None,
                spoiler_policy.value,
                companion_stance.value,
                room_intent.strip() if room_intent else None,
                json.dumps(tags, ensure_ascii=False),
                book_id,
            ),
        )
    return get_book(book_id)


def bind_document(document_id: str, book_id: str | None) -> dict[str, object]:
    if book_id:
        get_book(book_id)
    with connect() as connection:
        row = connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            raise KeyError(document_id)
        connection.execute("UPDATE documents SET book_id = ? WHERE id = ?", (book_id, document_id))
        updated = connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    return _document(updated)


def _note(row: sqlite3.Row) -> ReadingNote:
    return ReadingNote(
        id=row["id"],
        book_id=row["book_id"],
        kind=row["kind"],
        content=row["content"],
        quote=row["quote"],
        locator=row["locator"],
        created_at=row["created_at"],
    )


def list_reading_notes(book_id: str, limit: int = 100) -> list[ReadingNote]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM reading_notes WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (book_id, max(1, min(limit, 500))),
        ).fetchall()
    return [_note(row) for row in rows]


def create_reading_note(book_id: str, payload: ReadingNoteCreate) -> ReadingNote:
    get_book(book_id)
    note_id = str(uuid.uuid4())
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO reading_notes(id, book_id, kind, content, quote, locator)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                note_id,
                book_id,
                payload.kind.value,
                payload.content.strip(),
                payload.quote.strip() if payload.quote else None,
                payload.locator.strip() if payload.locator else None,
            ),
        )
        row = connection.execute("SELECT * FROM reading_notes WHERE id = ?", (note_id,)).fetchone()
    return _note(row)


def delete_reading_note(book_id: str, note_id: str) -> None:
    with connect() as connection:
        cursor = connection.execute(
            "DELETE FROM reading_notes WHERE id = ? AND book_id = ?", (note_id, book_id)
        )
    if cursor.rowcount != 1:
        raise KeyError(note_id)


def search_reading_notes(book_id: str, query: str, limit: int = 4) -> list[ReadingNote]:
    terms = [term.casefold() for term in query.split() if len(term.strip()) > 1]
    notes = list_reading_notes(book_id, limit=100)
    if not terms:
        return notes[:limit]

    def score(note: ReadingNote) -> int:
        haystack = f"{note.quote or ''}\n{note.content}".casefold()
        return sum(haystack.count(term) for term in terms)

    matches = [note for note in notes if score(note) > 0]
    matches.sort(key=score, reverse=True)
    # Readers often ask follow-up questions such as "why does this sentence bother me?"
    # without repeating a word from their last annotation. Recent notes are the honest fallback.
    return (matches or notes)[:limit]


def delete_book(book_id: str) -> None:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM library_books WHERE id = ?", (book_id,))
    if cursor.rowcount != 1:
        raise KeyError(book_id)
