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
DB_PATH = os.environ.get("LANTERN_DB_PATH", "lantern.db")

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
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


@app.post("/chat")
async def chat(body: ChatRequest):
    """Stream an assistant reply for a chat message, persisting both turns."""
    # Validate session exists
    session = db_get_session(body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

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
        async for delta in stream_chat_completion(history):
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
