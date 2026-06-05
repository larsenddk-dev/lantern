"""
Lantern API tests — no network, no secrets required.

The OpenAI-compatible streaming call is monkeypatched so tests run fully
offline. Tests prove:

1. /health returns {"status": "ok", ...}
2. Session round-trip: create → list → get with messages.
3. POST /chat streams reply in multiple SSE chunks (using a fake streaming
   source), persists both user and assistant messages.
4. Provider CRUD: create → list → update → delete.
5. Active provider selection persists across reads.
6. /chat uses the selected provider's base_url + model (stub verifies routing).
7. API keys are never returned in full (masked on read).
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

# Tracks what the last stream_chat_completion call received
_last_stream_kwargs: dict = {}


async def _fake_stream(*_args, **kwargs):
    _last_stream_kwargs.clear()
    _last_stream_kwargs.update(kwargs)
    for token in FAKE_DELTAS:
        yield token


# ---------------------------------------------------------------------------
# Tests — original Phase 1
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


# ---------------------------------------------------------------------------
# Tests — Phase 2a: provider CRUD
# ---------------------------------------------------------------------------


def test_provider_create_list_update_delete():
    """CRUD round-trip for provider configs."""
    # Create
    resp = client.post("/providers", json={
        "label": "My OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "openai/gpt-4o-mini",
        "api_key": "sk-secret-key",
    })
    assert resp.status_code == 200
    provider = resp.json()
    pid = provider["id"]
    assert provider["label"] == "My OpenRouter"
    assert provider["base_url"] == "https://openrouter.ai/api/v1"
    assert provider["model"] == "openai/gpt-4o-mini"
    # Key must be masked — never the real value
    assert "sk-secret-key" not in json.dumps(provider)
    assert provider["api_key_masked"] == "sk-***"
    assert provider["is_active"] is False

    # List — should contain our new provider
    list_resp = client.get("/providers")
    assert list_resp.status_code == 200
    ids = [p["id"] for p in list_resp.json()]
    assert pid in ids

    # Update label and model
    upd_resp = client.put(f"/providers/{pid}", json={
        "label": "OpenRouter Free",
        "model": "openai/gpt-4o",
    })
    assert upd_resp.status_code == 200
    updated = upd_resp.json()
    assert updated["label"] == "OpenRouter Free"
    assert updated["model"] == "openai/gpt-4o"
    # base_url unchanged
    assert updated["base_url"] == "https://openrouter.ai/api/v1"

    # Delete
    del_resp = client.delete(f"/providers/{pid}")
    assert del_resp.status_code == 200
    assert del_resp.json()["ok"] is True

    # Confirm gone
    list_after = [p["id"] for p in client.get("/providers").json()]
    assert pid not in list_after


def test_provider_not_found():
    resp = client.put("/providers/no-such-id", json={"label": "x"})
    assert resp.status_code == 404

    resp2 = client.delete("/providers/no-such-id")
    assert resp2.status_code == 404

    resp3 = client.post("/providers/no-such-id/activate")
    assert resp3.status_code == 404


# ---------------------------------------------------------------------------
# Tests — Phase 2a: active provider selection + persistence
# ---------------------------------------------------------------------------


def test_active_provider_selection_persists():
    """Create two providers, activate one, confirm active selection persists."""
    # Create provider A
    pa = client.post("/providers", json={
        "label": "Provider A",
        "base_url": "https://a.example.com/v1",
        "model": "model-a",
        "api_key": "key-a",
    }).json()

    # Create provider B
    pb = client.post("/providers", json={
        "label": "Provider B",
        "base_url": "https://b.example.com/v1",
        "model": "model-b",
        "api_key": "key-b",
    }).json()

    # Activate A
    act_resp = client.post(f"/providers/{pa['id']}/activate")
    assert act_resp.status_code == 200
    assert act_resp.json()["is_active"] is True

    # GET /providers/active should return A
    active_resp = client.get("/providers/active")
    assert active_resp.status_code == 200
    active = active_resp.json()["active"]
    assert active is not None
    assert active["id"] == pa["id"]
    assert active["label"] == "Provider A"
    # Key must not be leaked
    assert "key-a" not in json.dumps(active)

    # Activate B — A should become inactive
    client.post(f"/providers/{pb['id']}/activate")
    active_resp2 = client.get("/providers/active")
    active2 = active_resp2.json()["active"]
    assert active2["id"] == pb["id"]

    # List should show only B as active
    providers = client.get("/providers").json()
    pa_row = next(p for p in providers if p["id"] == pa["id"])
    pb_row = next(p for p in providers if p["id"] == pb["id"])
    assert pa_row["is_active"] is False
    assert pb_row["is_active"] is True

    # Clean up
    client.delete(f"/providers/{pa['id']}")
    client.delete(f"/providers/{pb['id']}")


# ---------------------------------------------------------------------------
# Tests — Phase 2a: /chat uses selected provider/model (stub verifies routing)
# ---------------------------------------------------------------------------


def test_chat_uses_active_provider(monkeypatch):
    """Verify that /chat routes to the active provider's base_url and model."""
    monkeypatch.setattr(main, "stream_chat_completion", _fake_stream)

    # Create a provider and activate it
    prov = client.post("/providers", json={
        "label": "Stub Provider",
        "base_url": "https://stub.example.com/v1",
        "model": "stub-model-1",
        "api_key": "stub-key",
    }).json()
    client.post(f"/providers/{prov['id']}/activate")

    # Create a session and send a chat
    sess = client.post("/sessions", json={"title": "Provider routing test"}).json()
    with client.stream("POST", "/chat", json={
        "session_id": sess["id"],
        "message": "ping",
    }) as resp:
        assert resp.status_code == 200
        b"".join(resp.iter_bytes())  # consume stream

    # Confirm the stub was called with the active provider's base_url + model
    assert _last_stream_kwargs.get("base_url") == "https://stub.example.com/v1"
    assert _last_stream_kwargs.get("model") == "stub-model-1"

    # Clean up
    client.delete(f"/providers/{prov['id']}")


def test_chat_uses_env_fallback_when_no_active_provider(monkeypatch):
    """When no provider is active, /chat falls back to env vars."""
    monkeypatch.setattr(main, "stream_chat_completion", _fake_stream)

    # Ensure no active provider (deactivate all by activating a throwaway then deleting it)
    tmp = client.post("/providers", json={
        "label": "Throwaway",
        "base_url": "https://throwaway.example.com/v1",
        "model": "throwaway-model",
        "api_key": "",
    }).json()
    client.post(f"/providers/{tmp['id']}/activate")
    client.delete(f"/providers/{tmp['id']}")

    # Confirm no active provider in DB
    active_resp = client.get("/providers/active")
    assert active_resp.json()["active"] is None

    sess = client.post("/sessions", json={"title": "Env fallback test"}).json()
    with client.stream("POST", "/chat", json={
        "session_id": sess["id"],
        "message": "fallback ping",
    }) as resp:
        assert resp.status_code == 200
        b"".join(resp.iter_bytes())

    # Should fall back to the env-configured values set at top of this file
    assert _last_stream_kwargs.get("base_url") == main.LANTERN_OPENAI_BASE_URL
    assert _last_stream_kwargs.get("model") == main.LANTERN_MODEL


# ---------------------------------------------------------------------------
# Tests — Phase 2a: API key masking
# ---------------------------------------------------------------------------


def test_api_key_never_returned_in_full():
    """Keys stored must never appear in API responses."""
    real_key = "super-secret-api-key-12345"
    prov = client.post("/providers", json={
        "label": "Key Masking Test",
        "base_url": "https://example.com/v1",
        "model": "test-model",
        "api_key": real_key,
    }).json()
    pid = prov["id"]

    # Single provider response — key must not appear
    assert real_key not in json.dumps(prov)

    # List response — key must not appear
    providers_json = json.dumps(client.get("/providers").json())
    assert real_key not in providers_json

    # Update response — key must not appear even after updating
    upd = client.put(f"/providers/{pid}", json={"label": "Updated"}).json()
    assert real_key not in json.dumps(upd)

    # Activate response — key must not appear
    act = client.post(f"/providers/{pid}/activate").json()
    assert real_key not in json.dumps(act)

    # Active provider response — key must not appear
    active_json = json.dumps(client.get("/providers/active").json())
    assert real_key not in active_json

    # Clean up
    client.delete(f"/providers/{pid}")
