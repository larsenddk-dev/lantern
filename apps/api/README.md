# Lantern API

FastAPI backend for Lantern — streaming chat, SQLite session persistence, and an
OpenAI-compatible provider layer.

## Quick start

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API listens on http://localhost:8000. `/health` should return `{"status":"ok"}`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LANTERN_OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible base URL |
| `LANTERN_OPENAI_API_KEY` | _(empty)_ | API key for the provider |
| `LANTERN_MODEL` | `openai/gpt-4o-mini` | Model name |
| `LANTERN_WEB_ORIGIN` | `http://localhost:3000` | CORS origin for the web app |
| `LANTERN_DB_PATH` | `lantern.db` | SQLite database path |

Copy `.env.example` from the workspace root and fill in your values.

## Running tests (no network, no secrets required)

```bash
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -v
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/sessions` | Create a new chat session |
| GET | `/sessions` | List all sessions |
| GET | `/sessions/{id}` | Get session with message history |
| POST | `/chat` | Stream an assistant reply (SSE) |

### Chat SSE format

`POST /chat` body: `{"session_id": "<id>", "message": "<text>"}`

Response: `text/event-stream`
- Delta lines: `data: {"delta": "<token>"}`
- End sentinel: `data: [DONE]`
