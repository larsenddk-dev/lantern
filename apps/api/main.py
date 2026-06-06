"""Lantern API — FastAPI backend with streaming chat and SQLite session persistence."""

import os
import json
import sqlite3
import uuid
import time
import math
import shutil
import ast
import operator
import imaplib
import email as emaillib
from email.header import decode_header
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import AsyncIterator, Optional

# ---------------------------------------------------------------------------
# Config — read from environment with sensible defaults
# ---------------------------------------------------------------------------
LANTERN_OPENAI_BASE_URL = os.environ.get(
    "LANTERN_OPENAI_BASE_URL", "https://openrouter.ai/api/v1"
)
LANTERN_OPENAI_API_KEY = os.environ.get("LANTERN_OPENAI_API_KEY", "")
LANTERN_MODEL = os.environ.get("LANTERN_MODEL", "openai/gpt-4o-mini")
LANTERN_EMBED_MODEL = os.environ.get("LANTERN_EMBED_MODEL", "text-embedding-3-small")
LANTERN_WEB_ORIGIN = os.environ.get("LANTERN_WEB_ORIGIN", "http://localhost:3000")
# Optional web search (Tavily). Build-time integration; activate by setting the
# key in .env — same pattern as the AI provider keys (the app never stores it).
LANTERN_TAVILY_API_KEY = os.environ.get("LANTERN_TAVILY_API_KEY", "")
# Optional read-only email (IMAP). Env-keyed; the app never stores credentials.
LANTERN_IMAP_HOST = os.environ.get("LANTERN_IMAP_HOST", "")
LANTERN_IMAP_PORT = int(os.environ.get("LANTERN_IMAP_PORT", "993"))
LANTERN_IMAP_USER = os.environ.get("LANTERN_IMAP_USER", "")
LANTERN_IMAP_PASSWORD = os.environ.get("LANTERN_IMAP_PASSWORD", "")
# Optional read-only calendar (CalDAV). Env-keyed; the app never stores creds.
LANTERN_CALDAV_URL = os.environ.get("LANTERN_CALDAV_URL", "")
LANTERN_CALDAV_USER = os.environ.get("LANTERN_CALDAV_USER", "")
LANTERN_CALDAV_PASSWORD = os.environ.get("LANTERN_CALDAV_PASSWORD", "")

# ---------------------------------------------------------------------------
# DB path — always stored in a gitignored data/ dir relative to this file,
# unless overridden (e.g. tests override via LANTERN_DB_PATH env var).
# ---------------------------------------------------------------------------
_DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DEFAULT_DB_PATH = os.path.join(_DEFAULT_DATA_DIR, "lantern.db")
DB_PATH = os.environ.get("LANTERN_DB_PATH", _DEFAULT_DB_PATH)

# Uploaded document files are stored on disk in a gitignored uploads/ dir
# next to the DB (so tests that override LANTERN_DB_PATH stay isolated too).
UPLOADS_DIR = os.path.join(os.path.dirname(DB_PATH) or ".", "uploads")


def _ensure_data_dir() -> None:
    """Create the data/ directory if it does not exist (holds gitignored SQLite DB)."""
    data_dir = os.path.dirname(DB_PATH)
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    _ensure_data_dir()
    with _get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New conversation',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key TEXT NOT NULL DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT '',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                extracted_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL DEFAULT '',
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS embeddings (
                id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL DEFAULT 0,
                content TEXT NOT NULL,
                vector TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
            """
        )


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def db_create_session(title: str = "New conversation") -> dict:
    session_id = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (session_id, title, now, now),
        )
    return {"id": session_id, "title": title, "created_at": now, "updated_at": now}


def db_list_sessions() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def db_get_session(session_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        session = dict(row)
        msgs = conn.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        ).fetchall()
        session["messages"] = [dict(m) for m in msgs]
    return session


def db_append_message(session_id: str, role: str, content: str) -> dict:
    msg_id = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (msg_id, session_id, role, content, now),
        )
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id)
        )
    return {"id": msg_id, "session_id": session_id, "role": role, "content": content, "created_at": now}


def db_delete_session(session_id: str) -> bool:
    with _get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if exists is None:
            return False
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return True


def db_rename_session(session_id: str, title: str) -> Optional[dict]:
    now = _now_iso()
    with _get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if exists is None:
            return None
        conn.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return dict(row)


# ---------------------------------------------------------------------------
# Notes helpers
# ---------------------------------------------------------------------------

def db_create_note(title: str, content: str) -> dict:
    note_id = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (note_id, title, content, now, now),
        )
    return {"id": note_id, "title": title, "content": content, "created_at": now, "updated_at": now}


def db_list_notes() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM notes ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def db_get_note(note_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
    return dict(row) if row else None


def db_update_note(note_id: str, title: Optional[str], content: Optional[str]) -> Optional[dict]:
    row = db_get_note(note_id)
    if row is None:
        return None
    now = _now_iso()
    new_title = title if title is not None else row["title"]
    new_content = content if content is not None else row["content"]
    with _get_conn() as conn:
        conn.execute(
            "UPDATE notes SET title=?, content=?, updated_at=? WHERE id=?",
            (new_title, new_content, now, note_id),
        )
    return {"id": note_id, "title": new_title, "content": new_content,
            "created_at": row["created_at"], "updated_at": now}


def db_delete_note(note_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# Tasks helpers
# ---------------------------------------------------------------------------

def db_create_task(title: str) -> dict:
    task_id = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO tasks (id, title, done, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
            (task_id, title, now, now),
        )
    return {"id": task_id, "title": title, "done": False, "created_at": now, "updated_at": now}


def db_list_tasks() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC"
        ).fetchall()
    return [_task_to_public(dict(r)) for r in rows]


def _task_to_public(row: dict) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "done": bool(row["done"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def db_get_task(task_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
    return _task_to_public(dict(row)) if row else None


def db_update_task(task_id: str, title: Optional[str], done: Optional[bool]) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
    if row is None:
        return None
    row = dict(row)
    now = _now_iso()
    new_title = title if title is not None else row["title"]
    new_done = int(done) if done is not None else row["done"]
    with _get_conn() as conn:
        conn.execute(
            "UPDATE tasks SET title=?, done=?, updated_at=? WHERE id=?",
            (new_title, new_done, now, task_id),
        )
    return {"id": task_id, "title": new_title, "done": bool(new_done),
            "created_at": row["created_at"], "updated_at": now}


def db_delete_task(task_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

_KEY_MASK = "sk-***"


def _mask_key(key: str) -> str:
    """Return a masked version of an API key — never expose the real value."""
    if not key:
        return ""
    return _KEY_MASK


def _provider_to_public(row: dict) -> dict:
    """Convert a raw DB provider row to a safe public dict (key masked)."""
    return {
        "id": row["id"],
        "label": row["label"],
        "base_url": row["base_url"],
        "model": row["model"],
        "api_key_masked": _mask_key(row["api_key"]),
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def db_list_providers() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM providers ORDER BY created_at ASC"
        ).fetchall()
    return [_provider_to_public(dict(r)) for r in rows]


def db_get_provider(provider_id: str) -> Optional[dict]:
    """Return raw provider row (includes real key — internal use only)."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM providers WHERE id = ?", (provider_id,)
        ).fetchone()
    return dict(row) if row else None


def db_create_provider(label: str, base_url: str, model: str, api_key: str) -> dict:
    provider_id = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO providers (id, label, base_url, model, api_key, is_active, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            (provider_id, label, base_url, model, api_key, now, now),
        )
    return _provider_to_public({
        "id": provider_id, "label": label, "base_url": base_url,
        "model": model, "api_key": api_key, "is_active": 0,
        "created_at": now, "updated_at": now,
    })


def db_update_provider(provider_id: str, label: Optional[str], base_url: Optional[str],
                       model: Optional[str], api_key: Optional[str]) -> Optional[dict]:
    row = db_get_provider(provider_id)
    if row is None:
        return None
    now = _now_iso()
    new_label = label if label is not None else row["label"]
    new_base_url = base_url if base_url is not None else row["base_url"]
    new_model = model if model is not None else row["model"]
    new_key = api_key if api_key is not None else row["api_key"]
    with _get_conn() as conn:
        conn.execute(
            "UPDATE providers SET label=?, base_url=?, model=?, api_key=?, updated_at=? WHERE id=?",
            (new_label, new_base_url, new_model, new_key, now, provider_id),
        )
    return _provider_to_public({
        "id": provider_id, "label": new_label, "base_url": new_base_url,
        "model": new_model, "api_key": new_key, "is_active": row["is_active"],
        "created_at": row["created_at"], "updated_at": now,
    })


def db_delete_provider(provider_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM providers WHERE id = ?", (provider_id,)
        )
    return result.rowcount > 0


def db_set_active_provider(provider_id: str) -> Optional[dict]:
    row = db_get_provider(provider_id)
    if row is None:
        return None
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute("UPDATE providers SET is_active = 0, updated_at = ?", (now,))
        conn.execute(
            "UPDATE providers SET is_active = 1, updated_at = ? WHERE id = ?",
            (now, provider_id),
        )
    return _provider_to_public({**row, "is_active": 1, "updated_at": now})


def db_get_active_provider() -> Optional[dict]:
    """Return raw active provider row (includes real key — internal use only)."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM providers WHERE is_active = 1 LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def db_resolve_provider(provider_id: Optional[str] = None) -> tuple[str, str, str]:
    """Resolve (base_url, api_key, model) from active provider or env fallback."""
    target = None
    if provider_id:
        target = db_get_provider(provider_id)
    if target is None:
        target = db_get_active_provider()
    if target:
        return (target["base_url"], target["api_key"], target["model"])
    # Fall back to environment variables
    return (LANTERN_OPENAI_BASE_URL, LANTERN_OPENAI_API_KEY, LANTERN_MODEL)


# ---------------------------------------------------------------------------
# OpenAI-compatible streaming client
# ---------------------------------------------------------------------------

def complete_chat_once(messages: list[dict], *, base_url: str, api_key: str, model: str) -> str:
    """Non-streaming chat completion via an OpenAI-compatible endpoint. Returns
    the full reply text. Used by Compare and the Agent loop. Stubbed in tests."""
    url = base_url.rstrip("/") + "/chat/completions"
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def chat_with_tools(messages: list[dict], tools: list[dict], *,
                    base_url: str, api_key: str, model: str) -> dict:
    """One OpenAI-compatible chat-completions call with tools. Returns the raw
    assistant message dict (which may include tool_calls). Stubbed in tests."""
    url = base_url.rstrip("/") + "/chat/completions"
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "tools": tools,
              "tool_choice": "auto", "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]


def web_search(query: str, max_results: int = 5) -> dict:
    """Search the public web via Tavily. Requires LANTERN_TAVILY_API_KEY.
    Never raises: returns {configured, results, note?/error?}. Stubbed in tests."""
    if not LANTERN_TAVILY_API_KEY:
        return {"configured": False, "results": [],
                "note": "Web search not configured. Set LANTERN_TAVILY_API_KEY in .env."}
    try:
        resp = httpx.post(
            "https://api.tavily.com/search",
            json={"api_key": LANTERN_TAVILY_API_KEY, "query": query,
                  "max_results": max_results, "search_depth": "basic"},
            timeout=30,
        )
        resp.raise_for_status()
        results = [
            {"title": r.get("title", ""), "url": r.get("url", ""),
             "content": (r.get("content") or "")[:500]}
            for r in resp.json().get("results", [])
        ]
        return {"configured": True, "results": results}
    except Exception as e:
        return {"configured": True, "results": [], "error": str(e)[:200]}


async def stream_chat_completion(
    messages: list[dict],
    *,
    base_url: str = LANTERN_OPENAI_BASE_URL,
    api_key: str = LANTERN_OPENAI_API_KEY,
    model: str = LANTERN_MODEL,
) -> AsyncIterator[str]:
    """Yield text deltas from an OpenAI-compatible streaming chat endpoint."""
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data: "):
                    continue
                data = line[len("data: "):]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


# ---------------------------------------------------------------------------
# Documents — upload, store on disk, extract text
# ---------------------------------------------------------------------------

# Reject uploads larger than this to avoid runaway storage / memory use.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

# Extensions we extract plain text from directly. PDFs and .docx are handled
# separately; any other type uploads fine but stores empty extracted text.
_TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".text"}


def _ensure_uploads_dir() -> None:
    os.makedirs(UPLOADS_DIR, exist_ok=True)


def _safe_filename(filename: str) -> str:
    """Reduce an uploaded filename to a safe, non-empty basename (no path traversal)."""
    base = os.path.basename(filename or "").replace("\\", "").strip()
    base = base.lstrip(".") or "file"
    return base[:255]


def _extract_text(path: str, filename: str) -> str:
    """Best-effort text extraction by extension. Never raises — returns '' on failure."""
    ext = os.path.splitext(filename)[1].lower()
    try:
        if ext in _TEXT_EXTS:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        if ext == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(path)
            return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        if ext == ".docx":
            import docx  # python-docx
            document = docx.Document(path)
            return "\n".join(p.text for p in document.paragraphs).strip()
    except Exception:
        # Corrupt / unreadable file — keep the document but with empty text
        # rather than failing the whole upload.
        return ""
    return ""


def _document_to_public(row: dict, *, include_text: bool = False) -> dict:
    out = {
        "id": row["id"],
        "filename": row["filename"],
        "content_type": row["content_type"],
        "size_bytes": row["size_bytes"],
        "has_text": bool((row.get("extracted_text") or "").strip()),
        "created_at": row["created_at"],
    }
    if include_text:
        out["extracted_text"] = row.get("extracted_text") or ""
    return out


def db_create_document(doc_id: str, filename: str, content_type: str,
                       size_bytes: int, extracted_text: str) -> dict:
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO documents (id, filename, content_type, size_bytes, extracted_text, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, filename, content_type, size_bytes, extracted_text, now),
        )
    return _document_to_public(
        {"id": doc_id, "filename": filename, "content_type": content_type,
         "size_bytes": size_bytes, "extracted_text": extracted_text, "created_at": now},
        include_text=True,
    )


def db_list_documents() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT id, filename, content_type, size_bytes, extracted_text, created_at "
            "FROM documents ORDER BY created_at DESC"
        ).fetchall()
    return [_document_to_public(dict(r)) for r in rows]


def db_get_document(doc_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    return _document_to_public(dict(row), include_text=True) if row else None


def db_delete_document(doc_id: str) -> bool:
    with _get_conn() as conn:
        row = conn.execute("SELECT id FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row is None:
            return False
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    # Remove the stored file directory (best-effort).
    shutil.rmtree(os.path.join(UPLOADS_DIR, doc_id), ignore_errors=True)
    return True


# ---------------------------------------------------------------------------
# Memory — remembered facts the assistant should keep across sessions
# ---------------------------------------------------------------------------

def _memory_to_public(row: dict) -> dict:
    return {
        "id": row["id"],
        "content": row["content"],
        "pinned": bool(row["pinned"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def db_create_memory(content: str, pinned: bool = False) -> dict:
    mem_id = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO memories (id, content, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (mem_id, content, 1 if pinned else 0, now, now),
        )
    return _memory_to_public(
        {"id": mem_id, "content": content, "pinned": 1 if pinned else 0,
         "created_at": now, "updated_at": now}
    )


def db_list_memories() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM memories ORDER BY pinned DESC, updated_at DESC"
        ).fetchall()
    return [_memory_to_public(dict(r)) for r in rows]


def db_get_memory(mem_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
    return _memory_to_public(dict(row)) if row else None


def db_update_memory(mem_id: str, content: Optional[str], pinned: Optional[bool]) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
        if row is None:
            return None
        row = dict(row)
        new_content = content if content is not None else row["content"]
        new_pinned = (1 if pinned else 0) if pinned is not None else row["pinned"]
        now = _now_iso()
        conn.execute(
            "UPDATE memories SET content = ?, pinned = ?, updated_at = ? WHERE id = ?",
            (new_content, new_pinned, now, mem_id),
        )
    return _memory_to_public(
        {"id": mem_id, "content": new_content, "pinned": new_pinned,
         "created_at": row["created_at"], "updated_at": now}
    )


def db_delete_memory(mem_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM memories WHERE id = ?", (mem_id,))
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# RAG — embeddings + semantic retrieval over memories and documents
# ---------------------------------------------------------------------------

def embed_texts(texts: list[str], *, base_url: Optional[str] = None,
                api_key: Optional[str] = None, model: Optional[str] = None) -> list[list[float]]:
    """Return one embedding vector per input text via an OpenAI-compatible
    /embeddings endpoint. Resolves base_url/api_key from the active provider (or
    env) and the embedding model from LANTERN_EMBED_MODEL. Raises on failure;
    callers decide how to degrade. Monkeypatched in tests for offline runs."""
    if not texts:
        return []
    b, k, _m = db_resolve_provider()
    base = (base_url or b).rstrip("/")
    key = api_key or k
    mdl = model or LANTERN_EMBED_MODEL
    resp = httpx.post(
        base + "/embeddings",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": mdl, "input": texts},
        timeout=60,
    )
    resp.raise_for_status()
    return [item["embedding"] for item in resp.json()["data"]]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _chunk_text(text: str, size: int = 1000) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    return [text[i:i + size] for i in range(0, len(text), size)]


def _embedding_count() -> int:
    with _get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM embeddings").fetchone()["n"]


def db_clear_embeddings(source_type: str, source_id: str) -> None:
    with _get_conn() as conn:
        conn.execute(
            "DELETE FROM embeddings WHERE source_type = ? AND source_id = ?",
            (source_type, source_id),
        )


def db_store_embedding(source_type: str, source_id: str, chunk_index: int,
                       content: str, vector: list[float]) -> None:
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO embeddings (id, source_type, source_id, chunk_index, content, vector, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), source_type, source_id, chunk_index, content,
             json.dumps(vector), _now_iso()),
        )


def db_embedded_source_ids(source_type: str) -> set:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT source_id FROM embeddings WHERE source_type = ?",
            (source_type,),
        ).fetchall()
    return {r["source_id"] for r in rows}


def db_all_embeddings() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT source_type, source_id, content, vector FROM embeddings"
        ).fetchall()
    return [dict(r) for r in rows]


def rag_reindex(force: bool = False) -> dict:
    """Embed memories + document text that are not yet embedded (or all, if
    force=True). Returns how many chunks were indexed and the new total."""
    to_embed: list[tuple] = []  # (source_type, source_id, chunk_index, content)

    mem_done = set() if force else db_embedded_source_ids("memory")
    for m in db_list_memories():
        if force or m["id"] not in mem_done:
            if force:
                db_clear_embeddings("memory", m["id"])
            if m["content"].strip():
                to_embed.append(("memory", m["id"], 0, m["content"]))

    doc_done = set() if force else db_embedded_source_ids("document")
    for d in db_list_documents():
        if force or d["id"] not in doc_done:
            if force:
                db_clear_embeddings("document", d["id"])
            detail = db_get_document(d["id"])
            for i, ch in enumerate(_chunk_text(detail["extracted_text"]) if detail else []):
                to_embed.append(("document", d["id"], i, ch))

    if not to_embed:
        return {"indexed": 0, "total": _embedding_count()}

    vectors = embed_texts([t[3] for t in to_embed])
    for (st, sid, ci, content), vec in zip(to_embed, vectors):
        db_store_embedding(st, sid, ci, content, vec)
    return {"indexed": len(to_embed), "total": _embedding_count()}


def rag_search(query: str, k: int = 5) -> list[dict]:
    """Return the top-k stored chunks most similar to the query by cosine
    similarity. Returns [] if nothing is indexed."""
    rows = db_all_embeddings()
    if not rows or not query.strip():
        return []
    qvec = embed_texts([query])[0]
    scored = []
    for r in rows:
        try:
            vec = json.loads(r["vector"])
        except (json.JSONDecodeError, TypeError):
            continue
        scored.append({
            "source_type": r["source_type"],
            "source_id": r["source_id"],
            "content": r["content"],
            "score": _cosine(qvec, vec),
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:k]


def build_chat_context(query: str, *, k: int = 5, min_score: float = 0.15) -> list[str]:
    """Gather context lines for a chat turn: pinned memories (always, no
    embedding needed) plus semantically retrieved chunks (best-effort)."""
    lines: list[str] = []
    seen = set()
    try:
        for m in db_list_memories():
            if m["pinned"] and m["content"].strip():
                lines.append(m["content"].strip())
                seen.add(m["content"].strip())
    except Exception:
        pass
    try:
        for h in rag_search(query, k=k):
            text = (h["content"] or "").strip()
            if h["score"] >= min_score and text and text not in seen:
                lines.append(text[:600])
                seen.add(text)
    except Exception:
        # No embedding provider / network — degrade to pinned memories only.
        pass
    return lines


# ---------------------------------------------------------------------------
# Agent — a tool-calling loop over safe, local tools
# ---------------------------------------------------------------------------

AGENT_SYSTEM = (
    "You are Lantern's agent. You can call tools to look up the user's saved "
    "knowledge (memories and documents), search the public web, list their "
    "notes and tasks, and do arithmetic. Use tools when they help; then answer "
    "concisely."
)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "Semantic search over the user's saved memories and documents.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What to look for"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the public web for current/external information.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_tasks",
            "description": "List the user's tasks and whether each is done.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_notes",
            "description": "List the titles of the user's notes.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Evaluate a basic arithmetic expression (+ - * / ** %).",
            "parameters": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
        },
    },
]

_SAFE_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.USub: operator.neg, ast.UAdd: operator.pos, ast.FloorDiv: operator.floordiv,
}


def _safe_eval(expr: str):
    """Evaluate a basic arithmetic expression safely (no names, calls, attrs)."""
    def _ev(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPS:
            return _SAFE_OPS[type(node.op)](_ev(node.left), _ev(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_OPS:
            return _SAFE_OPS[type(node.op)](_ev(node.operand))
        raise ValueError("unsupported expression")
    return _ev(ast.parse(expr, mode="eval").body)


def _run_agent_tool(name: str, args: dict) -> str:
    """Execute a single tool call and return a string result."""
    try:
        if name == "search_knowledge":
            hits = rag_search(args.get("query", ""), k=5)
            if not hits:
                pinned = [m["content"] for m in db_list_memories() if m["pinned"]]
                return json.dumps({"pinned_memories": pinned, "results": []})
            return json.dumps([
                {"content": h["content"][:500], "score": round(h["score"], 3)} for h in hits
            ])
        if name == "web_search":
            r = web_search(args.get("query", ""), max_results=5)
            if not r.get("configured"):
                return "Web search is not configured (no API key). Tell the user to set LANTERN_TAVILY_API_KEY."
            if r.get("error"):
                return f"web search error: {r['error']}"
            return json.dumps([
                {"title": x["title"], "url": x["url"], "snippet": x["content"][:200]}
                for x in r["results"]
            ])
        if name == "list_tasks":
            return json.dumps([
                {"title": t["title"], "done": t["done"]} for t in db_list_tasks()
            ])
        if name == "list_notes":
            return json.dumps([
                {"id": n["id"], "title": n["title"]} for n in db_list_notes()
            ])
        if name == "calculator":
            return str(_safe_eval(args.get("expression", "")))
        return f"Unknown tool: {name}"
    except Exception as e:
        return f"tool error: {e}"


def agent_run(message: str, *, max_steps: int = 5) -> dict:
    """Run the agent loop: call the model with tools, execute any tool calls,
    feed results back, repeat until a final answer or max_steps. Returns the
    final reply plus the list of tool steps taken."""
    base_url, api_key, model = db_resolve_provider()
    messages = [
        {"role": "system", "content": AGENT_SYSTEM},
        {"role": "user", "content": message},
    ]
    steps: list[dict] = []
    for _ in range(max_steps):
        msg = chat_with_tools(messages, AGENT_TOOLS, base_url=base_url, api_key=api_key, model=model)
        messages.append(msg)
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            return {"reply": msg.get("content") or "", "steps": steps}
        for tc in tool_calls:
            fn = tc.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _run_agent_tool(name, args)
            steps.append({"tool": name, "args": args, "result": result[:1000]})
            messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": result})
    return {"reply": "(agent stopped after reaching the step limit)", "steps": steps}


# ---------------------------------------------------------------------------
# Deep Research — plan → gather (RAG over saved knowledge) → synthesize report
# ---------------------------------------------------------------------------

def _parse_subquestions(text: str, limit: int) -> list[str]:
    """Tolerantly extract sub-questions from a model reply (JSON array preferred,
    bullet/line list as fallback)."""
    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        arr = json.loads(text[start:end])
        subs = [str(x).strip() for x in arr if str(x).strip()]
        if subs:
            return subs[:limit]
    except (ValueError, json.JSONDecodeError):
        pass
    subs = []
    for line in text.splitlines():
        cleaned = line.strip().lstrip("-*0123456789.) ").strip()
        if len(cleaned) > 8:
            subs.append(cleaned)
    return subs[:limit]


def research_run(question: str, *, max_subquestions: int = 4) -> dict:
    """Multi-step research over the user's saved knowledge (documents + memories)
    plus the model's own knowledge. Returns sub-questions, per-question sources,
    and a synthesized report."""
    base_url, api_key, model = db_resolve_provider()

    # 1) Plan — break the question into sub-questions.
    plan_prompt = [
        {"role": "system", "content": (
            "You are a research planner. Break the user's question into a few "
            "concise sub-questions. Reply ONLY with a JSON array of strings."
        )},
        {"role": "user", "content": f"Question: {question}\nMax sub-questions: {max_subquestions}"},
    ]
    plan_raw = complete_chat_once(plan_prompt, base_url=base_url, api_key=api_key, model=model)
    subquestions = _parse_subquestions(plan_raw, max_subquestions) or [question]

    # 2) Gather — retrieve relevant saved knowledge for each sub-question.
    findings = []
    context_blocks = []
    for sq in subquestions:
        try:
            hits = rag_search(sq, k=3)
        except Exception:
            hits = []
        sources = [
            {"source_type": h["source_type"], "content": h["content"][:400],
             "score": round(h["score"], 3)}
            for h in hits if h["score"] > 0.1
        ]
        findings.append({"subquestion": sq, "sources": sources})
        if sources:
            context_blocks.append(
                f"Sub-question: {sq}\n" + "\n".join(f"- {s['content']}" for s in sources)
            )

    # 3) Synthesize — write the report.
    context = "\n\n".join(context_blocks) if context_blocks else (
        "(No saved knowledge matched — answer from general knowledge and say so.)"
    )
    synth_prompt = [
        {"role": "system", "content": (
            "You are a research assistant. Write a clear, well-structured report "
            "that answers the question. Use the provided context from the user's "
            "saved knowledge where relevant, and note where you rely on general "
            "knowledge instead."
        )},
        {"role": "user", "content": f"Question: {question}\n\nContext:\n{context}\n\nWrite the report."},
    ]
    report = complete_chat_once(synth_prompt, base_url=base_url, api_key=api_key, model=model)
    return {"question": question, "subquestions": subquestions, "findings": findings, "report": report}


# ---------------------------------------------------------------------------
# Global search — across notes, tasks, documents, memories and chats
# ---------------------------------------------------------------------------

def db_search(q: str, limit: int = 20) -> list[dict]:
    """Case-insensitive substring search across all content. Returns a unified
    list of hits, each with type/id/title/snippet and the page to open."""
    like = f"%{q}%"
    out: list[dict] = []
    with _get_conn() as conn:
        for r in conn.execute(
            "SELECT id, title, content FROM notes WHERE title LIKE ? OR content LIKE ? "
            "ORDER BY updated_at DESC LIMIT ?", (like, like, limit),
        ):
            out.append({"type": "note", "id": r["id"], "title": r["title"] or "(untitled note)",
                        "snippet": (r["content"] or "")[:120], "path": "/notes"})
        for r in conn.execute(
            "SELECT id, title, done FROM tasks WHERE title LIKE ? ORDER BY created_at DESC LIMIT ?",
            (like, limit),
        ):
            out.append({"type": "task", "id": r["id"], "title": r["title"],
                        "snippet": "done" if r["done"] else "to do", "path": "/tasks"})
        for r in conn.execute(
            "SELECT id, filename, extracted_text FROM documents WHERE filename LIKE ? OR extracted_text LIKE ? "
            "ORDER BY created_at DESC LIMIT ?", (like, like, limit),
        ):
            out.append({"type": "document", "id": r["id"], "title": r["filename"],
                        "snippet": (r["extracted_text"] or "")[:120], "path": "/documents"})
        for r in conn.execute(
            "SELECT id, content FROM memories WHERE content LIKE ? ORDER BY pinned DESC, updated_at DESC LIMIT ?",
            (like, limit),
        ):
            out.append({"type": "memory", "id": r["id"], "title": (r["content"] or "")[:80],
                        "snippet": "", "path": "/memory"})
        for r in conn.execute(
            "SELECT DISTINCT s.id, s.title FROM sessions s JOIN messages m ON m.session_id = s.id "
            "WHERE m.content LIKE ? ORDER BY s.updated_at DESC LIMIT ?", (like, limit),
        ):
            out.append({"type": "chat", "id": r["id"], "title": r["title"] or "(conversation)",
                        "snippet": "matching message", "path": "/chat"})
    return out[:limit]


# ---------------------------------------------------------------------------
# Email — read-only IMAP (list / view / AI triage). Env-keyed; no sending.
# ---------------------------------------------------------------------------

def email_configured() -> bool:
    return bool(LANTERN_IMAP_HOST and LANTERN_IMAP_USER and LANTERN_IMAP_PASSWORD)


def _decode_header(value: Optional[str]) -> str:
    if not value:
        return ""
    out = ""
    for text, enc in decode_header(value):
        if isinstance(text, bytes):
            out += text.decode(enc or "utf-8", errors="replace")
        else:
            out += text
    return out


def _email_text_body(msg) -> str:
    """Best-effort plain-text body from an email message (prefers text/plain)."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition", "")):
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        # fall back to any text/* part
        for part in msg.walk():
            if part.get_content_type().startswith("text/"):
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        return ""
    payload = msg.get_payload(decode=True)
    return payload.decode(msg.get_content_charset() or "utf-8", errors="replace") if payload else ""


def _imap_connect():
    M = imaplib.IMAP4_SSL(LANTERN_IMAP_HOST, LANTERN_IMAP_PORT)
    M.login(LANTERN_IMAP_USER, LANTERN_IMAP_PASSWORD)
    M.select("INBOX", readonly=True)  # read-only: Lantern never modifies the mailbox
    return M


def fetch_emails(limit: int = 20) -> dict:
    """List recent inbox messages (headers only). Never raises."""
    if not email_configured():
        return {"configured": False, "emails": [],
                "note": "Email not configured. Set LANTERN_IMAP_HOST/USER/PASSWORD in .env."}
    try:
        M = _imap_connect()
        try:
            _typ, data = M.search(None, "ALL")
            ids = data[0].split()
            recent = ids[-limit:][::-1]
            emails = []
            for i in recent:
                _t, msgdata = M.fetch(i, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
                msg = emaillib.message_from_bytes(msgdata[0][1])
                emails.append({
                    "uid": i.decode(),
                    "subject": _decode_header(msg.get("Subject")) or "(no subject)",
                    "from": _decode_header(msg.get("From")),
                    "date": msg.get("Date", ""),
                })
            return {"configured": True, "emails": emails}
        finally:
            M.logout()
    except Exception as e:
        return {"configured": True, "emails": [], "error": str(e)[:200]}


def fetch_email_body(uid: str) -> dict:
    """Fetch one message's text body (read-only). Never raises."""
    if not email_configured():
        return {"configured": False}
    try:
        M = _imap_connect()
        try:
            _t, msgdata = M.fetch(uid.encode(), "(BODY.PEEK[])")
            if not msgdata or not msgdata[0]:
                return {"configured": True, "error": "message not found"}
            msg = emaillib.message_from_bytes(msgdata[0][1])
            return {
                "configured": True,
                "uid": uid,
                "subject": _decode_header(msg.get("Subject")) or "(no subject)",
                "from": _decode_header(msg.get("From")),
                "date": msg.get("Date", ""),
                "body": _email_text_body(msg)[:20000],
            }
        finally:
            M.logout()
    except Exception as e:
        return {"configured": True, "error": str(e)[:200]}


def email_triage(subject: str, body: str) -> str:
    """Summarize + categorize an email using the active chat provider."""
    base_url, api_key, model = db_resolve_provider()
    prompt = [
        {"role": "system", "content": (
            "Summarize the email in 1-2 sentences, then on a new line give a "
            "category: one of [Action needed, FYI, Newsletter, Personal, Spam]."
        )},
        {"role": "user", "content": f"Subject: {subject}\n\n{body[:6000]}"},
    ]
    return complete_chat_once(prompt, base_url=base_url, api_key=api_key, model=model)


# ---------------------------------------------------------------------------
# Calendar — read-only CalDAV (upcoming events). Env-keyed; no writes.
# ---------------------------------------------------------------------------

def calendar_configured() -> bool:
    return bool(LANTERN_CALDAV_URL and LANTERN_CALDAV_USER and LANTERN_CALDAV_PASSWORD)


def _ical_dt_to_iso(value) -> str:
    try:
        return value.isoformat()
    except AttributeError:
        return str(value)


def fetch_events(days: int = 14) -> dict:
    """List upcoming events from all CalDAV calendars (read-only). Never raises."""
    if not calendar_configured():
        return {"configured": False, "events": [],
                "note": "Calendar not configured. Set LANTERN_CALDAV_URL/USER/PASSWORD in .env."}
    try:
        import caldav
        from datetime import datetime, timedelta, timezone

        client = caldav.DAVClient(
            url=LANTERN_CALDAV_URL, username=LANTERN_CALDAV_USER, password=LANTERN_CALDAV_PASSWORD
        )
        principal = client.principal()
        now = datetime.now(timezone.utc)
        end = now + timedelta(days=days)
        events = []
        for cal in principal.calendars():
            try:
                found = cal.search(start=now, end=end, event=True, expand=True)
            except Exception:
                continue
            for ev in found:
                comp = getattr(ev, "icalendar_component", None)
                if comp is None:
                    continue
                dtstart = comp.get("DTSTART")
                dtend = comp.get("DTEND")
                events.append({
                    "summary": str(comp.get("SUMMARY", "(no title)")),
                    "start": _ical_dt_to_iso(dtstart.dt) if dtstart else "",
                    "end": _ical_dt_to_iso(dtend.dt) if dtend else "",
                    "location": str(comp.get("LOCATION", "")) or None,
                    "calendar": str(getattr(cal, "name", "") or ""),
                })
        events.sort(key=lambda e: e["start"])
        return {"configured": True, "events": events}
    except Exception as e:
        return {"configured": True, "events": [], "error": str(e)[:200]}


# ---------------------------------------------------------------------------
# Lifespan — init DB once on startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Lantern API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        LANTERN_WEB_ORIGIN,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        # Tauri desktop webview origins — Windows WebView2 serves the app from
        # http://tauri.localhost; macOS/Linux use tauri://localhost. Without
        # these the packaged app's fetches fail CORS ("failed to fetch").
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    title: str = "New conversation"


class RenameSessionRequest(BaseModel):
    title: str


class ChatRequest(BaseModel):
    session_id: str
    message: str
    provider_id: Optional[str] = None
    model: Optional[str] = None
    use_context: bool = True


class RagSearchRequest(BaseModel):
    query: str
    k: int = 5


class CompareTarget(BaseModel):
    provider_id: Optional[str] = None
    model: Optional[str] = None


class CompareRequest(BaseModel):
    message: str
    targets: list[CompareTarget] = []


class AgentRequest(BaseModel):
    message: str
    max_steps: int = 5


class ResearchRequest(BaseModel):
    question: str
    max_subquestions: int = 4


class CreateProviderRequest(BaseModel):
    label: str
    base_url: str
    model: str
    api_key: str = ""


class UpdateProviderRequest(BaseModel):
    label: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None


class CreateNoteRequest(BaseModel):
    title: str = ""
    content: str = ""


class UpdateNoteRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class CreateTaskRequest(BaseModel):
    title: str


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    done: Optional[bool] = None


class CreateMemoryRequest(BaseModel):
    content: str
    pinned: bool = False


class UpdateMemoryRequest(BaseModel):
    content: Optional[str] = None
    pinned: Optional[bool] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "service": "lantern-api"}


@app.post("/sessions")
def create_session(body: CreateSessionRequest):
    return db_create_session(title=body.title)


@app.get("/sessions")
def list_sessions():
    return db_list_sessions()


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    session = db_get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.patch("/sessions/{session_id}")
def rename_session(session_id: str, body: RenameSessionRequest):
    session = db_rename_session(session_id, body.title.strip() or "Untitled")
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    if not db_delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Provider CRUD routes
# ---------------------------------------------------------------------------

@app.get("/providers")
def list_providers():
    """List all provider configs (API keys are masked)."""
    return db_list_providers()


@app.post("/providers")
def create_provider(body: CreateProviderRequest):
    """Create a new provider config."""
    return db_create_provider(
        label=body.label,
        base_url=body.base_url,
        model=body.model,
        api_key=body.api_key,
    )


@app.put("/providers/{provider_id}")
def update_provider(provider_id: str, body: UpdateProviderRequest):
    """Update an existing provider config (partial update)."""
    result = db_update_provider(
        provider_id=provider_id,
        label=body.label,
        base_url=body.base_url,
        model=body.model,
        api_key=body.api_key,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return result


@app.delete("/providers/{provider_id}")
def delete_provider(provider_id: str):
    """Delete a provider config."""
    deleted = db_delete_provider(provider_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Provider not found")
    return {"ok": True}


@app.post("/providers/{provider_id}/activate")
def activate_provider(provider_id: str):
    """Mark a provider as the active selection."""
    result = db_set_active_provider(provider_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return result


@app.get("/providers/active")
def get_active_provider():
    """Return the currently active provider (key masked), or null if none set."""
    raw = db_get_active_provider()
    if raw is None:
        return {"active": None}
    return {"active": _provider_to_public(raw)}


# ---------------------------------------------------------------------------
# Notes routes
# ---------------------------------------------------------------------------

@app.get("/notes")
def list_notes():
    """List all notes ordered by updated_at descending."""
    return db_list_notes()


@app.post("/notes")
def create_note(body: CreateNoteRequest):
    """Create a new note."""
    return db_create_note(title=body.title, content=body.content)


@app.get("/notes/{note_id}")
def get_note(note_id: str):
    """Get a single note by id."""
    note = db_get_note(note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@app.put("/notes/{note_id}")
def update_note(note_id: str, body: UpdateNoteRequest):
    """Partially update a note's title and/or content."""
    result = db_update_note(note_id=note_id, title=body.title, content=body.content)
    if result is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return result


@app.delete("/notes/{note_id}")
def delete_note(note_id: str):
    """Delete a note."""
    deleted = db_delete_note(note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Tasks routes
# ---------------------------------------------------------------------------

@app.get("/tasks")
def list_tasks():
    """List all tasks ordered by created_at descending."""
    return db_list_tasks()


@app.post("/tasks")
def create_task(body: CreateTaskRequest):
    """Create a new task."""
    return db_create_task(title=body.title)


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    """Get a single task by id."""
    task = db_get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.put("/tasks/{task_id}")
def update_task(task_id: str, body: UpdateTaskRequest):
    """Partially update a task's title and/or done status."""
    result = db_update_task(task_id=task_id, title=body.title, done=body.done)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    """Delete a task."""
    deleted = db_delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Documents routes
# ---------------------------------------------------------------------------

@app.post("/documents")
async def upload_document(file: UploadFile = File(...)):
    """Upload a file: store under data/uploads/, extract text, persist metadata."""
    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")

    safe_name = _safe_filename(file.filename or "file")
    doc_id = str(uuid.uuid4())
    _ensure_uploads_dir()
    doc_dir = os.path.join(UPLOADS_DIR, doc_id)
    os.makedirs(doc_dir, exist_ok=True)
    dest = os.path.join(doc_dir, safe_name)
    with open(dest, "wb") as f:
        f.write(raw)

    extracted = _extract_text(dest, safe_name)
    return db_create_document(
        doc_id=doc_id,
        filename=safe_name,
        content_type=file.content_type or "",
        size_bytes=len(raw),
        extracted_text=extracted,
    )


@app.get("/documents")
def list_documents():
    """List uploaded documents (metadata only, no full extracted text)."""
    return db_list_documents()


@app.get("/documents/{document_id}")
def get_document(document_id: str):
    """Get a single document including its extracted text."""
    doc = db_get_document(document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@app.delete("/documents/{document_id}")
def delete_document(document_id: str):
    """Delete a document row and its stored file."""
    deleted = db_delete_document(document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Memory routes
# ---------------------------------------------------------------------------

@app.get("/memories")
def list_memories():
    """List remembered items (pinned first, then most recently updated)."""
    return db_list_memories()


@app.post("/memories")
def create_memory(body: CreateMemoryRequest):
    """Remember a new fact."""
    return db_create_memory(content=body.content, pinned=body.pinned)


@app.get("/memories/{memory_id}")
def get_memory(memory_id: str):
    mem = db_get_memory(memory_id)
    if mem is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return mem


@app.put("/memories/{memory_id}")
def update_memory(memory_id: str, body: UpdateMemoryRequest):
    """Update a memory's content and/or pinned state."""
    result = db_update_memory(memory_id, content=body.content, pinned=body.pinned)
    if result is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return result


@app.delete("/memories/{memory_id}")
def delete_memory(memory_id: str):
    deleted = db_delete_memory(memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# RAG routes — index + semantic search over memories and documents
# ---------------------------------------------------------------------------

@app.get("/rag/status")
def rag_status():
    """How many chunks are currently embedded."""
    return {"embeddings": _embedding_count()}


@app.post("/rag/index")
def rag_index(force: bool = False):
    """Embed memories + documents not yet indexed (or re-embed all if force)."""
    return rag_reindex(force=force)


@app.post("/rag/search")
def rag_search_route(body: RagSearchRequest):
    """Return the top-k stored chunks most similar to the query."""
    return rag_search(body.query, k=body.k)


# ---------------------------------------------------------------------------
# Compare route — same prompt across multiple models, side by side
# ---------------------------------------------------------------------------

@app.post("/compare")
def compare(body: CompareRequest):
    """Send one prompt to several provider/model targets and return each reply.
    Defaults to the active provider if no targets given. Per-target errors are
    captured (one failing model does not fail the whole comparison)."""
    targets = body.targets or [CompareTarget()]
    messages = [{"role": "user", "content": body.message}]
    results = []
    for t in targets:
        base, key, model = db_resolve_provider(t.provider_id)
        if t.model:
            model = t.model
        try:
            reply = complete_chat_once(messages, base_url=base, api_key=key, model=model)
            results.append({"model": model, "reply": reply, "error": None})
        except Exception as e:
            results.append({"model": model, "reply": "", "error": str(e)[:200]})
    return {"results": results}


# ---------------------------------------------------------------------------
# Agent route — tool-calling loop
# ---------------------------------------------------------------------------

@app.post("/agent")
def agent(body: AgentRequest):
    """Run the agent loop over the message and return the reply + tool steps."""
    steps = max(1, min(body.max_steps, 8))
    return agent_run(body.message, max_steps=steps)


# ---------------------------------------------------------------------------
# Deep Research route
# ---------------------------------------------------------------------------

@app.post("/research")
def research(body: ResearchRequest):
    """Plan sub-questions, gather from saved knowledge (RAG), synthesize a report."""
    n = max(1, min(body.max_subquestions, 6))
    return research_run(body.question, max_subquestions=n)


# ---------------------------------------------------------------------------
# Global search route
# ---------------------------------------------------------------------------

@app.get("/search")
def search(q: str = "", limit: int = 20):
    """Substring search across notes, tasks, documents, memories and chats."""
    q = q.strip()
    if not q:
        return {"results": []}
    return {"results": db_search(q, max(1, min(limit, 50)))}


# ---------------------------------------------------------------------------
# Email routes — read-only IMAP
# ---------------------------------------------------------------------------

@app.get("/email")
def email_list(limit: int = 20):
    """List recent inbox messages (read-only)."""
    return fetch_emails(max(1, min(limit, 50)))


@app.get("/email/{uid}")
def email_get(uid: str):
    """Fetch one message's text body (read-only)."""
    return fetch_email_body(uid)


@app.post("/email/{uid}/triage")
def email_triage_route(uid: str):
    """AI summary + category for one message."""
    msg = fetch_email_body(uid)
    if not msg.get("configured"):
        return {"configured": False, "note": "Email not configured."}
    if msg.get("error"):
        return {"configured": True, "error": msg["error"]}
    summary = email_triage(msg.get("subject", ""), msg.get("body", ""))
    return {"configured": True, "uid": uid, "summary": summary}


# ---------------------------------------------------------------------------
# Calendar route — read-only CalDAV
# ---------------------------------------------------------------------------

@app.get("/calendar")
def calendar_list(days: int = 14):
    """Upcoming events across CalDAV calendars (read-only)."""
    return fetch_events(max(1, min(days, 90)))


# ---------------------------------------------------------------------------
# Chat route
# ---------------------------------------------------------------------------

@app.post("/chat")
async def chat(body: ChatRequest):
    """Stream an assistant reply for a chat message, persisting both turns."""
    # Validate session exists
    session = db_get_session(body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Resolve provider: request body overrides → active provider → env fallback
    resolved_base_url, resolved_api_key, resolved_model = db_resolve_provider(body.provider_id)
    # Per-request model override (e.g. from quick-switcher)
    if body.model:
        resolved_model = body.model

    # Persist the user message
    db_append_message(body.session_id, "user", body.message)

    # Build message list for the LLM
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in session["messages"]
    ]

    # RAG: inject pinned memories + semantically relevant context as a system
    # message. Degrades gracefully (pinned-only, or nothing) if no embeddings.
    if body.use_context:
        context_lines = build_chat_context(body.message)
        if context_lines:
            context = (
                "Use the following context the user has saved when relevant. "
                "If it is not relevant, ignore it.\n"
                + "\n".join(f"- {line}" for line in context_lines)
            )
            history.insert(0, {"role": "system", "content": context})

    history.append({"role": "user", "content": body.message})

    async def generate():
        collected: list[str] = []
        async for delta in stream_chat_completion(
            history,
            base_url=resolved_base_url,
            api_key=resolved_api_key,
            model=resolved_model,
        ):
            collected.append(delta)
            # SSE format: "data: <json>\n\n"
            yield f"data: {json.dumps({'delta': delta})}\n\n"
        full_reply = "".join(collected)
        if full_reply:
            db_append_message(body.session_id, "assistant", full_reply)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
