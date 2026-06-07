"""Lantern API — FastAPI backend with streaming chat and SQLite session persistence."""

import os
import json
import sqlite3
import uuid
import base64
import binascii
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
from fastapi.responses import Response, StreamingResponse
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

# Chat-message attachments (images for vision models today; voice/files later)
# live in a sibling dir keyed by attachment id. Same gitignored-data tree.
ATTACHMENTS_DIR = os.path.join(os.path.dirname(DB_PATH) or ".", "attachments")


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
                system_prompt_id TEXT,
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
            -- Multimodal attachments (images today; voice/files later) live
            -- alongside the text content. Bytes go on disk under
            -- data/attachments/<id>.<ext>; only metadata in the DB.
            CREATE TABLE IF NOT EXISTS message_attachments (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                filename TEXT,
                size_bytes INTEGER NOT NULL,
                path TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_attachments_message
                ON message_attachments(message_id);

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

            CREATE TABLE IF NOT EXISTS prompts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message_stars (
                message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
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
        # Migrations for users upgrading from older DBs that didn't have these
        # columns. ADD COLUMN can't be idempotent in sqlite, so we try-and-skip
        # by checking the error message.
        for stmt in (
            "ALTER TABLE sessions ADD COLUMN system_prompt_id TEXT",
        ):
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as e:
                if "duplicate column" not in str(e).lower():
                    raise


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
    # Decorate each message with its attachments so the UI can render
    # thumbnails without a second roundtrip.
    by_msg = db_list_attachments_for_session(session_id)
    for m in session["messages"]:
        m["attachments"] = by_msg.get(m["id"], [])
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


def _ensure_attachments_dir() -> None:
    os.makedirs(ATTACHMENTS_DIR, exist_ok=True)


def _ext_for_mime(mime_type: str) -> str:
    """Map common image mime types to a file extension. Falls back to '.bin'
    so unknown types are still persisted (we just won't open them later)."""
    table = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
    }
    return table.get(mime_type.lower(), ".bin")


def db_create_attachment(
    message_id: str,
    *,
    kind: str,
    mime_type: str,
    data: bytes,
    filename: Optional[str] = None,
) -> dict:
    """Persist a single attachment for a message: bytes go to disk, metadata to
    the DB. Returns the public dict (path is internal, not exposed)."""
    _ensure_attachments_dir()
    att_id = str(uuid.uuid4())
    rel = att_id + _ext_for_mime(mime_type)
    abs_path = os.path.join(ATTACHMENTS_DIR, rel)
    with open(abs_path, "wb") as f:
        f.write(data)
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO message_attachments "
            "(id, message_id, kind, mime_type, filename, size_bytes, path, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (att_id, message_id, kind, mime_type, filename, len(data), rel, now),
        )
    return {
        "id": att_id,
        "message_id": message_id,
        "kind": kind,
        "mime_type": mime_type,
        "filename": filename,
        "size_bytes": len(data),
        "created_at": now,
    }


def _attachment_to_public(row: dict) -> dict:
    """Strip the on-disk path; everything else is safe to return."""
    return {
        "id": row["id"],
        "message_id": row["message_id"],
        "kind": row["kind"],
        "mime_type": row["mime_type"],
        "filename": row["filename"],
        "size_bytes": row["size_bytes"],
        "created_at": row["created_at"],
    }


def db_list_attachments_for_session(session_id: str) -> dict:
    """Return {message_id: [attachments]} for every message in a session.
    Used by db_get_session so the UI can render thumbnails in one trip."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT a.* FROM message_attachments a "
            "JOIN messages m ON m.id = a.message_id "
            "WHERE m.session_id = ? "
            "ORDER BY a.created_at ASC",
            (session_id,),
        ).fetchall()
    grouped: dict = {}
    for r in rows:
        d = dict(r)
        grouped.setdefault(d["message_id"], []).append(_attachment_to_public(d))
    return grouped


def db_get_attachment(att_id: str) -> Optional[dict]:
    """Return raw row including on-disk path (internal use — for serving bytes)."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM message_attachments WHERE id = ?", (att_id,)
        ).fetchone()
    return dict(row) if row else None


def db_attachments_for_message(message_id: str) -> list[dict]:
    """Return raw rows for one message — internal helper used when building
    the multimodal LLM payload from past turns."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM message_attachments WHERE message_id = ? "
            "ORDER BY created_at ASC",
            (message_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _llm_content_for(msg: dict) -> dict:
    """Convert a stored message dict to the shape an OpenAI-compatible chat
    completion expects. Plain text turns return {role, content: str}; turns
    with image attachments return {role, content: [parts]} using the
    vision format (`{"type":"image_url","image_url":{"url":"data:..."}}`).

    Reads each attachment's bytes from disk and base64-inlines them so the
    request is self-contained — no follow-up fetches from the model side."""
    role = msg["role"]
    text = msg.get("content", "") or ""
    attachments = msg.get("attachments") or []
    # Only image attachments contribute to the LLM payload today.
    images = [a for a in attachments if a.get("kind") == "image"]
    if not images:
        return {"role": role, "content": text}

    parts: list[dict] = []
    if text:
        parts.append({"type": "text", "text": text})
    for att in images:
        path = att.get("path")
        # `attachments` coming from db_get_session are public dicts that strip
        # `path`; fetch the row again so we have the on-disk filename.
        if not path:
            row = db_get_attachment(att["id"])
            if row is None:
                continue
            path = row["path"]
        full = os.path.join(ATTACHMENTS_DIR, path)
        try:
            with open(full, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
        except OSError:
            continue  # missing file — skip rather than crashing the whole request
        parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:{att['mime_type']};base64,{b64}"},
        })
    return {"role": role, "content": parts}


def db_update_message(message_id: str, content: str) -> Optional[dict]:
    """Edit a stored message's content. Bumps the parent session's updated_at."""
    now = _now_iso()
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE messages SET content = ? WHERE id = ?", (content, message_id)
        )
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?", (now, row["session_id"])
        )
        updated = conn.execute(
            "SELECT * FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
    return dict(updated)


def _purge_attachment_files(rows: list[dict]) -> None:
    """Remove the on-disk bytes for the given attachment rows. Best-effort —
    a missing file just means we already cleaned it up."""
    for r in rows:
        path = os.path.join(ATTACHMENTS_DIR, r["path"])
        try:
            os.remove(path)
        except OSError:
            pass


def db_delete_message(message_id: str) -> bool:
    """Delete a single message. Its star (if any) cascades away."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT session_id FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
        if row is None:
            return False
        # FK cascade isn't enabled on this connection, so clear the star explicitly.
        attachments = conn.execute(
            "SELECT * FROM message_attachments WHERE message_id = ?", (message_id,)
        ).fetchall()
        conn.execute("DELETE FROM message_stars WHERE message_id = ?", (message_id,))
        conn.execute("DELETE FROM message_attachments WHERE message_id = ?", (message_id,))
        conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (_now_iso(), row["session_id"]),
        )
    _purge_attachment_files([dict(a) for a in attachments])
    return True


def db_delete_session(session_id: str) -> bool:
    with _get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if exists is None:
            return False
        # Collect attachment rows first so we can remove the files after the
        # cascade in the DB.
        attachments = conn.execute(
            "SELECT a.* FROM message_attachments a "
            "JOIN messages m ON m.id = a.message_id WHERE m.session_id = ?",
            (session_id,),
        ).fetchall()
        conn.execute(
            "DELETE FROM message_attachments WHERE message_id IN "
            "(SELECT id FROM messages WHERE session_id = ?)",
            (session_id,),
        )
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    _purge_attachment_files([dict(a) for a in attachments])
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


def db_set_session_prompt(session_id: str, prompt_id: Optional[str]) -> Optional[dict]:
    """Pin (or unpin with prompt_id=None) a saved Prompt as the system prompt
    for a chat session. The linked Prompt's content is injected as the first
    system message on every /chat turn until cleared."""
    now = _now_iso()
    with _get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if exists is None:
            return None
        if prompt_id is not None:
            # Defensive: don't let the caller pin a prompt that doesn't exist.
            p = conn.execute("SELECT 1 FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
            if p is None:
                return None
        conn.execute(
            "UPDATE sessions SET system_prompt_id = ?, updated_at = ? WHERE id = ?",
            (prompt_id, now, session_id),
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


class ProviderError(Exception):
    """A non-2xx response from the upstream model provider, with a body we can
    turn into a clear, user-facing message instead of a dead stream."""

    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body or ""
        super().__init__(f"provider returned HTTP {status}")

    def user_message(self) -> str:
        detail = ""
        try:
            j = json.loads(self.body)
            if isinstance(j, list) and j:
                j = j[0]
            if isinstance(j, dict):
                err = j.get("error")
                if isinstance(err, dict):
                    detail = err.get("message", "")
                detail = detail or j.get("message", "")
        except Exception:
            detail = ""
        detail = (detail or self.body).strip().replace("\n", " ")[:200]
        s = self.status
        if s in (401, 403):
            return f"Authentication failed (HTTP {s}) — check this provider's API key in Settings. {detail}".strip()
        if s == 404:
            return f"Model not found (HTTP 404) — pick an available model in Settings. {detail}".strip()
        if s == 429:
            return f"Rate limit or quota exceeded (HTTP 429) — wait a moment or switch provider. {detail}".strip()
        return f"Provider error (HTTP {s}). {detail}".strip()


async def stream_chat_completion(
    messages: list[dict],
    *,
    base_url: str = LANTERN_OPENAI_BASE_URL,
    api_key: str = LANTERN_OPENAI_API_KEY,
    model: str = LANTERN_MODEL,
) -> AsyncIterator[str]:
    """Yield text deltas from an OpenAI-compatible streaming chat endpoint.

    Raises ProviderError on a non-2xx response so the caller can surface a
    clear message; lets httpx transport errors propagate for retry handling.
    """
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        # Some providers front their API with a WAF (Cloudflare) that 1010-blocks
        # default client User-Agents; a named UA gets through reliably.
        "User-Agent": "Lantern/1.0",
    }
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                raise ProviderError(resp.status_code, body.decode(errors="replace"))
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
# Prompts — reusable system/user prompts
# ---------------------------------------------------------------------------

def db_create_prompt(title: str, content: str) -> dict:
    pid = str(uuid.uuid4())
    now = _now_iso()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO prompts (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (pid, title, content, now, now),
        )
    return {"id": pid, "title": title, "content": content, "created_at": now, "updated_at": now}


def db_list_prompts() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute("SELECT * FROM prompts ORDER BY updated_at DESC").fetchall()
    return [dict(r) for r in rows]


def db_get_prompt(pid: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM prompts WHERE id = ?", (pid,)).fetchone()
    return dict(row) if row else None


def db_update_prompt(pid: str, title: Optional[str], content: Optional[str]) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM prompts WHERE id = ?", (pid,)).fetchone()
        if row is None:
            return None
        row = dict(row)
        new_title = title if title is not None else row["title"]
        new_content = content if content is not None else row["content"]
        now = _now_iso()
        conn.execute(
            "UPDATE prompts SET title = ?, content = ?, updated_at = ? WHERE id = ?",
            (new_title, new_content, now, pid),
        )
    return {"id": pid, "title": new_title, "content": new_content,
            "created_at": row["created_at"], "updated_at": now}


def db_delete_prompt(pid: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM prompts WHERE id = ?", (pid,))
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# Message stars — favorite individual messages
# ---------------------------------------------------------------------------

def db_star_message(message_id: str) -> bool:
    with _get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM messages WHERE id = ?", (message_id,)).fetchone()
        if not exists:
            return False
        conn.execute(
            "INSERT OR IGNORE INTO message_stars (message_id, created_at) VALUES (?, ?)",
            (message_id, _now_iso()),
        )
    return True


def db_unstar_message(message_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM message_stars WHERE message_id = ?", (message_id,))
    return result.rowcount > 0


def db_list_starred() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT m.id, m.session_id, m.role, m.content, m.created_at, s.title AS session_title "
            "FROM message_stars ms "
            "JOIN messages m ON m.id = ms.message_id "
            "LEFT JOIN sessions s ON s.id = m.session_id "
            "ORDER BY ms.created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


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


def _parse_task_titles(text: str, limit: int) -> list[str]:
    """Tolerantly extract task titles from a model reply that should be a JSON
    array of strings. Accepts arrays of objects ({title}/{task}) and falls back
    to bullet/line parsing. Dedupes case-insensitively and caps at `limit`."""
    titles: list[str] = []
    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        arr = json.loads(text[start:end])
        if isinstance(arr, list):
            for item in arr:
                if isinstance(item, str):
                    titles.append(item.strip())
                elif isinstance(item, dict):
                    val = item.get("title") or item.get("task") or ""
                    if val:
                        titles.append(str(val).strip())
    except (ValueError, json.JSONDecodeError):
        pass
    if not titles:
        for line in text.splitlines():
            cleaned = line.strip().lstrip("-*0123456789.) ").strip()
            if len(cleaned) > 2:
                titles.append(cleaned)
    seen: set[str] = set()
    result: list[str] = []
    for t in titles:
        t = t.strip().strip('"').strip()
        key = t.lower()
        if t and key not in seen:
            seen.add(key)
            result.append(t[:200])
        if len(result) >= limit:
            break
    return result


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

    # 2) Gather — retrieve relevant saved knowledge for each sub-question, and
    #    additionally search the public web when configured (Tavily). Web hits
    #    are added as their own source type so the UI can show them with a URL.
    findings = []
    context_blocks = []
    web_configured = bool(LANTERN_TAVILY_API_KEY)
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

        if web_configured:
            web = web_search(sq, max_results=3)
            for r in web.get("results", []):
                sources.append({
                    "source_type": "web",
                    "content": f"{r['title']} — {r['content'][:300]}",
                    "url": r.get("url") or None,
                    "score": 0.0,
                })

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
# Cookbook — local Ollama integration: hardware-aware model recommendations,
# install/uninstall, and one-click "use this model as a provider".
# ---------------------------------------------------------------------------

OLLAMA_BASE_URL = os.environ.get("LANTERN_OLLAMA_URL", "http://127.0.0.1:11434")

# Curated catalog. Each entry's `min_ram_gb` is the rough floor we'll let a
# user comfortably run the model at; `recommended_ram_gb` is what we tag as
# "good fit". Sizes are GB of the default quantization Ollama pulls.
COOKBOOK_CATALOG: list[dict] = [
    {"id": "llama3.2:1b", "name": "Llama 3.2 1B", "size_gb": 1.3,
     "min_ram_gb": 4, "recommended_ram_gb": 8, "tags": ["tiny", "general"],
     "description": "Tiny but surprisingly capable. Runs anywhere."},
    {"id": "llama3.2:3b", "name": "Llama 3.2 3B", "size_gb": 2.0,
     "min_ram_gb": 6, "recommended_ram_gb": 8, "tags": ["small", "general"],
     "description": "Small and fast. A solid default on modest hardware."},
    {"id": "phi3:mini", "name": "Phi-3 Mini", "size_gb": 2.3,
     "min_ram_gb": 6, "recommended_ram_gb": 8, "tags": ["small", "reasoning"],
     "description": "Microsoft's small reasoning model."},
    {"id": "qwen2.5:7b", "name": "Qwen 2.5 7B", "size_gb": 4.7,
     "min_ram_gb": 8, "recommended_ram_gb": 16, "tags": ["general", "reasoning"],
     "description": "Strong reasoning and multilingual. A great all-rounder."},
    {"id": "llama3.1:8b", "name": "Llama 3.1 8B", "size_gb": 4.9,
     "min_ram_gb": 8, "recommended_ram_gb": 16, "tags": ["general", "popular"],
     "description": "The default for most users. Balanced and well-tested."},
    {"id": "mistral:7b", "name": "Mistral 7B", "size_gb": 4.4,
     "min_ram_gb": 8, "recommended_ram_gb": 16, "tags": ["general"],
     "description": "Reliable general-purpose model from Mistral."},
    {"id": "gemma2:9b", "name": "Gemma 2 9B", "size_gb": 5.4,
     "min_ram_gb": 10, "recommended_ram_gb": 16, "tags": ["general"],
     "description": "Google's open model. Polite and helpful."},
    {"id": "deepseek-coder-v2:16b", "name": "DeepSeek Coder V2 16B",
     "size_gb": 8.9, "min_ram_gb": 16, "recommended_ram_gb": 24,
     "tags": ["code"],
     "description": "Specialist for code completion and refactoring."},
    {"id": "llava:7b", "name": "LLaVA 7B", "size_gb": 4.7,
     "min_ram_gb": 8, "recommended_ram_gb": 16, "tags": ["vision"],
     "description": "Vision-capable: send it an image and ask about it."},
    {"id": "mixtral:8x7b", "name": "Mixtral 8x7B", "size_gb": 26.4,
     "min_ram_gb": 32, "recommended_ram_gb": 48, "tags": ["large", "general"],
     "description": "Mixture-of-experts. Powerful but heavy."},
    {"id": "llama3.1:70b", "name": "Llama 3.1 70B", "size_gb": 40.0,
     "min_ram_gb": 48, "recommended_ram_gb": 64, "tags": ["large", "general"],
     "description": "Top-tier quality. Needs a workstation or Apple Silicon Max."},
]


def detect_hardware() -> dict:
    """Detect OS, CPU model, RAM, and any obvious GPU. Best-effort; never
    raises. Returns shape: {os, cpu, ram_gb, gpu, apple_silicon}."""
    import platform
    info: dict = {
        "os": platform.system().lower(),
        "cpu": platform.processor() or platform.machine(),
        "ram_gb": 0,
        "gpu": None,
        "apple_silicon": False,
    }
    # RAM
    try:
        if hasattr(os, "sysconf") and "SC_PHYS_PAGES" in os.sysconf_names:
            info["ram_gb"] = round(
                os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
                / (1024 ** 3),
                1,
            )
        elif info["os"] == "windows":
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong),
                            ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong),
                            ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            info["ram_gb"] = round(stat.ullTotalPhys / (1024 ** 3), 1)
    except Exception:
        pass

    # Apple Silicon — gives unified-memory GPU "for free"
    if info["os"] == "darwin" and platform.machine() == "arm64":
        info["apple_silicon"] = True
        info["gpu"] = "Apple Silicon (unified memory)"
        # Read a friendlier CPU name via sysctl.
        try:
            import subprocess
            out = subprocess.run(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                capture_output=True, text=True, timeout=2,
            )
            if out.returncode == 0 and out.stdout.strip():
                info["cpu"] = out.stdout.strip()
        except Exception:
            pass

    # NVIDIA via nvidia-smi (works on Win + Linux)
    if not info["gpu"]:
        try:
            import subprocess
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=2,
            )
            if out.returncode == 0 and out.stdout.strip():
                info["gpu"] = out.stdout.strip().splitlines()[0]
        except Exception:
            pass

    return info


def cookbook_status() -> dict:
    """Is Ollama reachable? Returns {running, version?, model_count?}.
    Never raises; designed to be polled cheaply from the UI."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/version", timeout=2.0)
        if resp.status_code != 200:
            return {"running": False, "error": f"HTTP {resp.status_code}"}
        version = resp.json().get("version", "")
        tags = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3.0)
        models = tags.json().get("models", []) if tags.status_code == 200 else []
        return {
            "running": True,
            "version": version,
            "model_count": len(models),
            "base_url": OLLAMA_BASE_URL,
        }
    except Exception as e:
        return {"running": False, "error": str(e)[:200]}


def cookbook_list_installed() -> list[dict]:
    """List models currently installed in Ollama. Returns the raw `models`
    array from /api/tags, or [] on error."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3.0)
        resp.raise_for_status()
        return resp.json().get("models", [])
    except Exception:
        return []


def cookbook_recommend(catalog: list[dict], ram_gb: float) -> list[dict]:
    """Annotate each catalog entry with a `fit` rating relative to the caller's
    RAM. fit ∈ {recommended, ok, tight, too_big}."""
    out: list[dict] = []
    for item in catalog:
        if ram_gb <= 0:
            fit = "unknown"
        elif ram_gb >= item["recommended_ram_gb"]:
            fit = "recommended"
        elif ram_gb >= item["min_ram_gb"]:
            fit = "ok"
        elif ram_gb >= item["min_ram_gb"] * 0.75:
            fit = "tight"
        else:
            fit = "too_big"
        out.append({**item, "fit": fit})
    return out


async def cookbook_pull_stream(model: str) -> AsyncIterator[dict]:
    """Stream pull progress from Ollama. Yields parsed JSON-line dicts, each
    typically containing {status, digest?, completed?, total?}. Final event
    has status='success' (or error)."""
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE_URL}/api/pull",
            json={"name": model, "stream": True},
        ) as resp:
            if resp.status_code != 200:
                err = await resp.aread()
                yield {"status": "error", "error": err.decode("utf-8", "ignore")[:500]}
                return
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def cookbook_delete_model(model: str) -> bool:
    """Uninstall a model from Ollama."""
    try:
        resp = httpx.request(
            "DELETE",
            f"{OLLAMA_BASE_URL}/api/delete",
            json={"name": model},
            timeout=10.0,
        )
        return resp.status_code in (200, 404)
    except Exception:
        return False


def cookbook_install_as_provider(model: str, *, label: Optional[str] = None) -> dict:
    """Create (or reuse) a provider row that points at the local Ollama for
    the given model, and activate it. Idempotent: if a provider with the same
    base_url + model exists it is reused."""
    base_url = f"{OLLAMA_BASE_URL.rstrip('/')}/v1"
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM providers WHERE base_url = ? AND model = ?",
            (base_url, model),
        ).fetchone()
    if row:
        provider_id = row["id"]
    else:
        provider = db_create_provider(
            label=label or f"Local · {model}",
            base_url=base_url,
            model=model,
            api_key="ollama",  # Ollama ignores the key but our shim wants something
        )
        provider_id = provider["id"]
    db_set_active_provider(provider_id)
    raw = db_get_provider(provider_id)
    return _provider_to_public(raw) if raw else {"id": provider_id}


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

app = FastAPI(title="Lantern API", version="1.0.0", lifespan=lifespan)

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


class SetSessionPromptRequest(BaseModel):
    # null clears the pin; a non-null id pins that Prompt as the system prompt.
    prompt_id: Optional[str] = None


class ChatAttachment(BaseModel):
    """One image (and later: file/voice) attached to the next user message.
    Bytes are sent inline base64 — sized to ~10 MB max per attachment in
    practice; the LLM will refuse anything wildly bigger anyway."""
    filename: Optional[str] = None
    mime_type: str
    data_base64: str


class ChatRequest(BaseModel):
    session_id: str
    message: str
    provider_id: Optional[str] = None
    model: Optional[str] = None
    use_context: bool = True
    attachments: list[ChatAttachment] = []


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


class CreatePromptRequest(BaseModel):
    title: str = ""
    content: str = ""


class UpdatePromptRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class UpdateMessageRequest(BaseModel):
    content: str


class CookbookPullRequest(BaseModel):
    model: str


class CookbookUseRequest(BaseModel):
    model: str
    label: Optional[str] = None


class GenerateTasksRequest(BaseModel):
    session_id: Optional[str] = None
    text: Optional[str] = None
    provider_id: Optional[str] = None
    model: Optional[str] = None
    max_tasks: int = 8


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


@app.put("/sessions/{session_id}/prompt")
def set_session_prompt(session_id: str, body: SetSessionPromptRequest):
    """Pin (or clear with prompt_id=null) a saved Prompt as the chat's
    system prompt. Returns the updated session row."""
    result = db_set_session_prompt(session_id, body.prompt_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Session or prompt not found")
    return result


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


@app.post("/tasks/generate")
def generate_tasks(body: GenerateTasksRequest):
    """Extract actionable to-do items from a chat session (or raw text) using the
    LLM and create them. Returns the created task rows."""
    source = ""
    if body.text and body.text.strip():
        source = body.text.strip()
    elif body.session_id:
        session = db_get_session(body.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        source = "\n\n".join(
            f"{m['role']}: {m['content']}" for m in session["messages"]
        ).strip()
    if not source:
        raise HTTPException(
            status_code=400,
            detail="Provide a session_id with messages or non-empty text",
        )

    base_url, api_key, model = db_resolve_provider(body.provider_id)
    if body.model:
        model = body.model

    limit = max(1, min(body.max_tasks, 20))
    system = (
        "You extract concrete, actionable to-do items from a conversation. "
        f"Return ONLY a JSON array of at most {limit} short task-title strings, "
        'each an imperative phrase (e.g. "Email the supplier"). '
        "No commentary, no numbering. If there are no clear tasks, return []."
    )
    try:
        reply = complete_chat_once(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": source[:12000]},
            ],
            base_url=base_url,
            api_key=api_key,
            model=model,
        )
    except Exception as e:  # network / provider error
        raise HTTPException(status_code=502, detail=f"Task generation failed: {e}")

    titles = _parse_task_titles(reply, limit)
    created = [db_create_task(title=t) for t in titles]
    return {"created": created, "count": len(created)}


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
# Prompt library routes
# ---------------------------------------------------------------------------

@app.get("/prompts")
def list_prompts():
    return db_list_prompts()


@app.post("/prompts")
def create_prompt(body: CreatePromptRequest):
    return db_create_prompt(title=body.title, content=body.content)


@app.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: str):
    p = db_get_prompt(prompt_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return p


@app.put("/prompts/{prompt_id}")
def update_prompt(prompt_id: str, body: UpdatePromptRequest):
    result = db_update_prompt(prompt_id, title=body.title, content=body.content)
    if result is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return result


@app.delete("/prompts/{prompt_id}")
def delete_prompt(prompt_id: str):
    if not db_delete_prompt(prompt_id):
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Cookbook routes — first-run model picker + local Ollama integration.
# ---------------------------------------------------------------------------

@app.get("/cookbook/status")
def cookbook_status_route():
    """Whether the local Ollama is running, and how many models are installed."""
    return cookbook_status()


@app.get("/cookbook/hardware")
def cookbook_hardware_route():
    """Best-effort hardware probe used to annotate model recommendations."""
    return detect_hardware()


@app.get("/cookbook/catalog")
def cookbook_catalog_route():
    """Curated list of models, annotated with a per-entry `fit` rating
    relative to the host's RAM. Pure read; safe to poll."""
    hw = detect_hardware()
    return {
        "hardware": hw,
        "models": cookbook_recommend(COOKBOOK_CATALOG, hw.get("ram_gb", 0) or 0),
    }


@app.get("/cookbook/models")
def cookbook_models_route():
    """Models actually installed in the local Ollama."""
    return {"models": cookbook_list_installed()}


@app.post("/cookbook/pull")
async def cookbook_pull_route(body: CookbookPullRequest):
    """Stream the pull progress for a model as SSE. The frontend can show a
    progress bar from `completed / total` and surface `status` for stage info."""
    model = body.model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="model is required")

    async def generate():
        async for event in cookbook_pull_stream(model):
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/cookbook/use")
def cookbook_use_route(body: CookbookUseRequest):
    """Create (or reuse) a provider pointing at the local Ollama for the given
    model, and mark it active. Returns the public provider row."""
    model = body.model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="model is required")
    return cookbook_install_as_provider(model, label=body.label)


@app.delete("/cookbook/models/{model:path}")
def cookbook_delete_route(model: str):
    """Uninstall a model from Ollama. The :path converter is used so tags like
    `llama3.1:8b` (which contain a colon) survive routing."""
    if not cookbook_delete_model(model):
        raise HTTPException(status_code=502, detail="Ollama refused the delete")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Starred-messages routes
# ---------------------------------------------------------------------------

@app.put("/messages/{message_id}")
def update_message(message_id: str, body: UpdateMessageRequest):
    result = db_update_message(message_id, body.content)
    if result is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return result


@app.delete("/messages/{message_id}")
def delete_message(message_id: str):
    if not db_delete_message(message_id):
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True}


@app.post("/messages/{message_id}/star")
def star_message(message_id: str):
    if not db_star_message(message_id):
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True, "starred": True}


@app.delete("/messages/{message_id}/star")
def unstar_message(message_id: str):
    db_unstar_message(message_id)
    return {"ok": True, "starred": False}


@app.get("/messages/starred")
def list_starred_messages():
    return db_list_starred()


# ---------------------------------------------------------------------------
# Attachments route — serve the raw bytes for image thumbnails in chat
# ---------------------------------------------------------------------------

@app.get("/attachments/{attachment_id}")
def get_attachment(attachment_id: str):
    """Return the raw bytes of a stored attachment with its original mime type.
    Used by the chat UI to render inline thumbnails next to messages."""
    row = db_get_attachment(attachment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    full = os.path.join(ATTACHMENTS_DIR, row["path"])
    try:
        with open(full, "rb") as f:
            data = f.read()
    except OSError:
        raise HTTPException(status_code=410, detail="Attachment file missing")
    return Response(
        content=data,
        media_type=row["mime_type"],
        # Long cache; the id never changes once an attachment lands.
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


# ---------------------------------------------------------------------------
# Stats route — high-level counts for the Stats page
# ---------------------------------------------------------------------------

@app.get("/stats")
def stats():
    with _get_conn() as conn:
        def n(sql: str) -> int:
            return conn.execute(sql).fetchone()[0]
        return {
            "sessions": n("SELECT COUNT(*) FROM sessions"),
            "messages": n("SELECT COUNT(*) FROM messages"),
            "messages_user": n("SELECT COUNT(*) FROM messages WHERE role = 'user'"),
            "messages_assistant": n("SELECT COUNT(*) FROM messages WHERE role = 'assistant'"),
            "notes": n("SELECT COUNT(*) FROM notes"),
            "tasks": n("SELECT COUNT(*) FROM tasks"),
            "tasks_done": n("SELECT COUNT(*) FROM tasks WHERE done = 1"),
            "documents": n("SELECT COUNT(*) FROM documents"),
            "memories": n("SELECT COUNT(*) FROM memories"),
            "memories_pinned": n("SELECT COUNT(*) FROM memories WHERE pinned = 1"),
            "prompts": n("SELECT COUNT(*) FROM prompts"),
            "embeddings": n("SELECT COUNT(*) FROM embeddings"),
            "providers": n("SELECT COUNT(*) FROM providers"),
            "starred_messages": n("SELECT COUNT(*) FROM message_stars"),
        }


# ---------------------------------------------------------------------------
# Export route — all chats as a zipped Markdown archive
# ---------------------------------------------------------------------------

@app.get("/export/chats")
def export_chats():
    """Stream a zip of every session as a Markdown file. Read-only."""
    import io
    import zipfile
    from fastapi.responses import StreamingResponse as _SR

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for s in db_list_sessions():
            detail = db_get_session(s["id"])
            if not detail:
                continue
            title = s.get("title") or "conversation"
            safe_name = _safe_filename(title) or s["id"]
            lines = [f"# {title}\n", f"*Exported from Lantern*\n", ""]
            for m in detail["messages"]:
                role = "You" if m["role"] == "user" else "Lantern"
                lines.append(f"## {role}\n\n{m['content'].strip()}\n")
            zf.writestr(f"{safe_name}-{s['id'][:8]}.md", "\n".join(lines))
    buf.seek(0)
    return _SR(iter([buf.getvalue()]), media_type="application/zip",
               headers={"Content-Disposition": 'attachment; filename="lantern-chats.zip"'})


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

    # Persist the user message, then any attachments tied to it. We do this
    # before building the history so the new turn carries its images too.
    user_msg = db_append_message(body.session_id, "user", body.message)
    for att in body.attachments:
        try:
            raw = base64.b64decode(att.data_base64, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(status_code=400, detail="Invalid base64 attachment")
        db_create_attachment(
            user_msg["id"],
            kind="image",
            mime_type=att.mime_type,
            data=raw,
            filename=att.filename,
        )

    # Build message list for the LLM. Past turns that had image attachments
    # come back as OpenAI vision-style multipart content so the model sees the
    # same context the user did when they wrote those messages.
    history = [
        _llm_content_for(m) for m in session["messages"]
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

    # Session-pinned system prompt — comes from the user's saved Prompt library.
    # Sits at the very top so it sets the persona/mode for the whole chat,
    # ahead of the auto-RAG context block.
    sp_id = session.get("system_prompt_id")
    if sp_id:
        sp = db_get_prompt(sp_id)
        if sp and sp.get("content", "").strip():
            history.insert(0, {"role": "system", "content": sp["content"]})

    # The brand-new user turn (with any attachments just saved above).
    new_turn = _llm_content_for({
        "role": "user",
        "content": body.message,
        "attachments": db_attachments_for_message(user_msg["id"]),
    })
    history.append(new_turn)

    async def generate():
        collected: list[str] = []
        error_msg: Optional[str] = None
        # Up to two attempts: a transient connection drop that happens before any
        # token streamed is silently retried once. A provider error (4xx) or a
        # drop mid-stream is not retried — we surface it / keep the partial.
        for attempt in range(2):
            try:
                async for delta in stream_chat_completion(
                    history,
                    base_url=resolved_base_url,
                    api_key=resolved_api_key,
                    model=resolved_model,
                ):
                    collected.append(delta)
                    # SSE format: "data: <json>\n\n"
                    yield f"data: {json.dumps({'delta': delta})}\n\n"
                error_msg = None
                break
            except ProviderError as e:
                error_msg = e.user_message()
                break  # provider rejected the request; retrying won't help
            except (httpx.HTTPError, Exception) as e:  # noqa: BLE001
                error_msg = (
                    "The connection to the model provider was interrupted. "
                    "Please try again."
                )
                # Only retry if nothing has streamed yet (a clean restart);
                # retrying mid-stream would duplicate text.
                if collected or attempt == 1:
                    break

        full_reply = "".join(collected)
        if full_reply:
            db_append_message(body.session_id, "assistant", full_reply)
        if error_msg:
            # Surface the failure to the client instead of a dead stream.
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
