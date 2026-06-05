"""Lantern API — FastAPI backend with streaming chat and SQLite session persistence."""

import os
import json
import sqlite3
import uuid
import time
import shutil
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
LANTERN_WEB_ORIGIN = os.environ.get("LANTERN_WEB_ORIGIN", "http://localhost:3000")

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
    allow_origins=[LANTERN_WEB_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    title: str = "New conversation"


class ChatRequest(BaseModel):
    session_id: str
    message: str
    provider_id: Optional[str] = None
    model: Optional[str] = None


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
