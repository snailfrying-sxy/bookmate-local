import os
import sqlite3
from pathlib import Path
from typing import Iterator


DATA_DIR = Path(os.getenv("BOOKMATE_DATA_DIR", ".bookmate-data")).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
DATABASE_PATH = DATA_DIR / "bookmate.db"


def initialize_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS model_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                protocol TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key TEXT,
                timeout_seconds INTEGER NOT NULL DEFAULT 60,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_model_profiles_name
                ON model_profiles(name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS library_books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT,
                language TEXT,
                description TEXT,
                reading_status TEXT NOT NULL,
                isbn TEXT,
                reading_progress TEXT,
                spoiler_policy TEXT NOT NULL DEFAULT 'avoid',
                companion_stance TEXT NOT NULL DEFAULT 'explore',
                room_intent TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                book_id TEXT REFERENCES library_books(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                media_type TEXT,
                extension TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL UNIQUE,
                stored_path TEXT NOT NULL,
                status TEXT NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL,
                locator TEXT,
                text TEXT NOT NULL,
                UNIQUE(document_id, ordinal)
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
            CREATE INDEX IF NOT EXISTS idx_library_books_status ON library_books(reading_status, updated_at);

            CREATE TABLE IF NOT EXISTS reading_notes (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('quote', 'reflection', 'question')),
                content TEXT NOT NULL,
                quote TEXT,
                locator TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_reading_notes_book_created
                ON reading_notes(book_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                mode TEXT NOT NULL,
                book_key TEXT,
                book_title TEXT,
                document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('reader', 'companion')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                scope TEXT NOT NULL CHECK(scope IN ('global', 'book', 'session')),
                book_key TEXT,
                book_title TEXT,
                content TEXT NOT NULL,
                source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                confirmed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
                ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_memories_context
                ON memories(status, scope, book_key, conversation_id, created_at);
            """
        )
        _ensure_column(connection, "documents", "book_id", "TEXT REFERENCES library_books(id) ON DELETE SET NULL")
        _ensure_column(connection, "library_books", "isbn", "TEXT")
        _ensure_column(connection, "library_books", "reading_progress", "TEXT")
        _ensure_column(connection, "library_books", "spoiler_policy", "TEXT NOT NULL DEFAULT 'avoid'")
        _ensure_column(connection, "library_books", "companion_stance", "TEXT NOT NULL DEFAULT 'explore'")
        _ensure_column(connection, "library_books", "room_intent", "TEXT")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_documents_book_id ON documents(book_id)")


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    existing = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def iter_settings(keys: list[str]) -> Iterator[tuple[str, str]]:
    if not keys:
        return iter(())
    placeholders = ",".join("?" for _ in keys)
    with connect() as connection:
        rows = connection.execute(
            f"SELECT key, value FROM settings WHERE key IN ({placeholders})",
            keys,
        ).fetchall()
    return ((row["key"], row["value"]) for row in rows)


def set_settings(values: dict[str, str | None]) -> None:
    with connect() as connection:
        for key, value in values.items():
            if value is None:
                connection.execute("DELETE FROM settings WHERE key = ?", (key,))
            else:
                connection.execute(
                    """
                    INSERT INTO settings(key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (key, value),
                )


initialize_storage()
