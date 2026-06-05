"""Lantern API — FastAPI backend with streaming chat and SQLite session persistence."""

import os
import json
import sqlite3
import uuid
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
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
