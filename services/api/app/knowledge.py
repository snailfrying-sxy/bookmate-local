from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import uuid
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from xml.etree import ElementTree

from fastapi import UploadFile
from pypdf import PdfReader

from .storage import UPLOAD_DIR, connect


ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf", ".epub"}
MAX_UPLOAD_BYTES = int(os.getenv("BOOKMATE_MAX_UPLOAD_MB", "50")) * 1024 * 1024
MAX_EPUB_ENTRIES = 10_000
MAX_EPUB_EXPANDED_BYTES = 300 * 1024 * 1024


class KnowledgeError(Exception):
    pass


class DuplicateDocumentError(KnowledgeError):
    def __init__(self, document_id: str) -> None:
        super().__init__("The same file is already in the local knowledge base")
        self.document_id = document_id


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "svg"}:
            self.ignored_depth += 1
        elif tag in {"p", "div", "br", "h1", "h2", "h3", "li", "blockquote"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "svg"} and self.ignored_depth:
            self.ignored_depth -= 1
        elif tag in {"p", "div", "h1", "h2", "h3", "li", "blockquote"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            self.parts.append(data)


def _normalize_text(text: str) -> str:
    lines = [re.sub(r"[ \t\u00a0]+", " ", line).strip() for line in text.replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _html_to_text(data: bytes) -> str:
    parser = TextExtractor()
    parser.feed(_decode_text(data))
    return _normalize_text("".join(parser.parts))


def _safe_epub_name(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts


def _epub_units(path: Path) -> list[tuple[str, str]]:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_EPUB_ENTRIES:
            raise KnowledgeError("EPUB contains too many files")
        if sum(entry.file_size for entry in entries) > MAX_EPUB_EXPANDED_BYTES:
            raise KnowledgeError("EPUB expanded size exceeds the safety limit")
        if any(not _safe_epub_name(entry.filename) for entry in entries):
            raise KnowledgeError("EPUB contains an unsafe path")

        ordered_names: list[str] = []
        try:
            container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
            rootfile = container.find(".//{*}rootfile")
            if rootfile is not None:
                package_name = rootfile.attrib["full-path"]
                package = ElementTree.fromstring(archive.read(package_name))
                package_dir = PurePosixPath(package_name).parent
                manifest = {
                    item.attrib["id"]: item.attrib["href"]
                    for item in package.findall(".//{*}manifest/{*}item")
                    if "id" in item.attrib and "href" in item.attrib
                }
                for itemref in package.findall(".//{*}spine/{*}itemref"):
                    href = manifest.get(itemref.attrib.get("idref", ""))
                    if href:
                        ordered_names.append(str(package_dir / PurePosixPath(href)))
        except (KeyError, ElementTree.ParseError, zipfile.BadZipFile):
            ordered_names = []

        if not ordered_names:
            ordered_names = [
                entry.filename
                for entry in entries
                if entry.filename.lower().endswith((".xhtml", ".html", ".htm"))
            ]

        units: list[tuple[str, str]] = []
        available = set(archive.namelist())
        for index, name in enumerate(ordered_names, start=1):
            if name not in available or not _safe_epub_name(name):
                continue
            text = _html_to_text(archive.read(name))
            if text:
                units.append((text, f"EPUB section {index}: {name}"))
        return units


def _pdf_units(path: Path) -> list[tuple[str, str]]:
    reader = PdfReader(str(path))
    units: list[tuple[str, str]] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = _normalize_text(page.extract_text() or "")
        if text:
            units.append((text, f"PDF page {page_number}"))
    return units


def _extract_units(path: Path, extension: str) -> list[tuple[str, str]]:
    if extension in {".txt", ".md"}:
        text = _normalize_text(_decode_text(path.read_bytes()))
        return [(text, "document")] if text else []
    if extension == ".pdf":
        return _pdf_units(path)
    if extension == ".epub":
        return _epub_units(path)
    raise KnowledgeError(f"Unsupported extension: {extension}")


def _chunk_units(units: list[tuple[str, str]], size: int = 1200, overlap: int = 160) -> list[tuple[str, str]]:
    chunks: list[tuple[str, str]] = []
    for text, locator in units:
        paragraphs = text.split("\n")
        buffer = ""
        for paragraph in paragraphs:
            if not paragraph:
                continue
            candidate = f"{buffer}\n{paragraph}".strip() if buffer else paragraph
            if len(candidate) <= size:
                buffer = candidate
                continue
            if buffer:
                chunks.append((buffer, locator))
                buffer = f"{buffer[-overlap:]}\n{paragraph}".strip()
            else:
                start = 0
                while start < len(paragraph):
                    chunks.append((paragraph[start : start + size], locator))
                    start += max(1, size - overlap)
                buffer = ""
        if buffer:
            chunks.append((buffer, locator))
    return chunks


async def import_document(file: UploadFile, book_id: str | None = None) -> dict[str, object]:
    original_name = Path(file.filename or "document").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise KnowledgeError("Supported file types: TXT, Markdown, PDF, EPUB")

    document_id = str(uuid.uuid4())
    stored_path = UPLOAD_DIR / f"{document_id}{extension}"
    digest = hashlib.sha256()
    size = 0
    with stored_path.open("wb") as destination:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                destination.close()
                stored_path.unlink(missing_ok=True)
                raise KnowledgeError(f"File exceeds the {MAX_UPLOAD_BYTES // 1024 // 1024} MB limit")
            digest.update(chunk)
            destination.write(chunk)

    checksum = digest.hexdigest()
    with connect() as connection:
        duplicate = connection.execute("SELECT id FROM documents WHERE sha256 = ?", (checksum,)).fetchone()
        if duplicate:
            stored_path.unlink(missing_ok=True)
            raise DuplicateDocumentError(duplicate["id"])
        connection.execute(
            """
            INSERT INTO documents(
                id, book_id, name, media_type, extension, size_bytes, sha256, stored_path, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing')
            """,
            (document_id, book_id, original_name, file.content_type, extension, size, checksum, str(stored_path)),
        )

    try:
        chunks = _chunk_units(_extract_units(stored_path, extension))
        if not chunks:
            raise KnowledgeError("No readable text was found in the file")
        with connect() as connection:
            connection.executemany(
                "INSERT INTO chunks(document_id, ordinal, locator, text) VALUES (?, ?, ?, ?)",
                ((document_id, index, locator, text) for index, (text, locator) in enumerate(chunks)),
            )
            connection.execute(
                "UPDATE documents SET status = 'ready', chunk_count = ?, error = NULL WHERE id = ?",
                (len(chunks), document_id),
            )
    except Exception as error:
        with connect() as connection:
            connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        stored_path.unlink(missing_ok=True)
        raise KnowledgeError(str(error)) from error
    return get_document(document_id)


def _document_from_row(row: sqlite3.Row) -> dict[str, object]:
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


def list_documents() -> list[dict[str, object]]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
    return [_document_from_row(row) for row in rows]


def get_document(document_id: str) -> dict[str, object]:
    with connect() as connection:
        row = connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not row:
        raise KeyError(document_id)
    return _document_from_row(row)


def delete_document(document_id: str) -> None:
    with connect() as connection:
        row = connection.execute("SELECT stored_path FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            raise KeyError(document_id)
        connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    Path(row["stored_path"]).unlink(missing_ok=True)


def _query_terms(query: str) -> set[str]:
    compact = re.sub(r"\s+", "", query.lower())
    terms = {word for word in re.findall(r"[a-z0-9_]{2,}", query.lower())}
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", compact))
    terms.update(cjk[index : index + 2] for index in range(max(0, len(cjk) - 1)))
    return {term for term in terms if term}


def search_chunks(
    query: str,
    document_id: str | None = None,
    book_id: str | None = None,
    limit: int = 5,
) -> list[dict[str, object]]:
    sql = """
        SELECT c.id, c.document_id, c.ordinal, c.locator, c.text, d.name AS document_name
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.status = 'ready'
    """
    parameters: list[object] = []
    if document_id:
        sql += " AND c.document_id = ?"
        parameters.append(document_id)
    if book_id:
        sql += " AND d.book_id = ?"
        parameters.append(book_id)
    sql += " LIMIT 10000"
    with connect() as connection:
        rows = connection.execute(sql, parameters).fetchall()

    terms = _query_terms(query)
    compact_query = re.sub(r"\s+", "", query.lower())
    ranked: list[tuple[float, sqlite3.Row]] = []
    for row in rows:
        lowered = row["text"].lower()
        compact_text = re.sub(r"\s+", "", lowered)
        score = sum(compact_text.count(term) for term in terms)
        if compact_query and compact_query in compact_text:
            score += 8
        if score:
            ranked.append((float(score), row))
    ranked.sort(key=lambda item: (-item[0], item[1]["ordinal"]))
    return [
        {
            "chunk_id": row["id"],
            "document_id": row["document_id"],
            "document_name": row["document_name"],
            "ordinal": row["ordinal"],
            "locator": row["locator"],
            "text": row["text"],
            "score": score,
        }
        for score, row in ranked[: max(1, min(limit, 20))]
    ]
