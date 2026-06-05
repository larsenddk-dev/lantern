"""
Lantern API tests — no network, no secrets required.

The OpenAI-compatible streaming call is monkeypatched so tests run fully
offline. Tests prove:

1. /health returns {"status": "ok", ...}
2. Session round-trip: create → list → get with messages.
3. POST /chat streams reply in multiple SSE chunks (using a fake streaming
   source), persists both user and assistant messages.
"""

import json
import os
import tempfile
import pytest

# Point the DB at a fresh temp file before importing the app so no production
# data is touched.
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["LANTERN_DB_PATH"] = _tmp.name

# Minimal provider env — not used in tests (client is monkeypatched)
os.environ.setdefault("LANTERN_OPENAI_API_KEY", "test-key")
os.environ.setdefault("LANTERN_MODEL", "test-model")

import main  # noqa: E402 — imported after env patching
from fastapi.testclient import TestClient  # noqa: E402

# Call init_db explicitly so TestClient requests hit an initialised schema.
main.init_db()

client = TestClient(main.app, raise_server_exceptions=True)

# ---------------------------------------------------------------------------
# Fake streaming source — yields three deltas
# ---------------------------------------------------------------------------

FAKE_DELTAS = ["Hello", ", ", "world!"]


async def _fake_stream(*_args, **_kwargs):
    for token in FAKE_DELTAS:
        yield token


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"


def test_create_and_list_sessions():
    resp = client.post("/sessions", json={"title": "Test session"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test session"
    assert "id" in data

    list_resp = client.get("/sessions")
    assert list_resp.status_code == 200
    ids = [s["id"] for s in list_resp.json()]
    assert data["id"] in ids


def test_get_session_not_found():
    resp = client.get("/sessions/nonexistent-id")
    assert resp.status_code == 404


def test_chat_streaming_and_session_history(monkeypatch):
    """End-to-end: create session, send message, verify streaming chunks,
    then reload session and confirm both messages are stored."""
    monkeypatch.setattr(main, "stream_chat_completion", _fake_stream)

    # Create session
    sess = client.post("/sessions", json={"title": "Streaming test"}).json()
    session_id = sess["id"]

    # Send a chat message — stream response
    with client.stream(
        "POST",
        "/chat",
        json={"session_id": session_id, "message": "Say hello"},
    ) as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        raw = b"".join(resp.iter_bytes())

    lines = raw.decode().strip().splitlines()

    # Parse SSE lines: "data: <json>" and "data: [DONE]"
    data_lines = [l[len("data: "):] for l in lines if l.startswith("data: ")]
    delta_lines = [l for l in data_lines if l != "[DONE]"]
    done_lines = [l for l in data_lines if l == "[DONE]"]

    assert len(done_lines) == 1, "Expected exactly one [DONE] sentinel"
    assert len(delta_lines) >= 2, (
        f"Expected multiple delta chunks, got {len(delta_lines)}: {delta_lines}"
    )

    deltas = [json.loads(l)["delta"] for l in delta_lines]
    assert "".join(deltas) == "Hello, world!"

    # Reload session and verify history
    reloaded = client.get(f"/sessions/{session_id}").json()
    messages = reloaded["messages"]
    assert len(messages) == 2, f"Expected 2 messages, got {len(messages)}"
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Say hello"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "Hello, world!"


def test_chat_unknown_session():
    resp = client.post(
        "/chat", json={"session_id": "no-such-session", "message": "hi"}
    )
    assert resp.status_code == 404
