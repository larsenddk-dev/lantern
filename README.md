# 🏮 Lantern

> A self-hosted AI workspace — **local-first, privacy-first.** Carry your own light.

Lantern is your own ChatGPT/Claude-style workspace, running on **your** hardware
with **your** data. Inspired by [PewDiePie's Odysseus](https://github.com/pewdiepie-archdaemon/odysseus),
but broader, with more features and a much better UI. New project, built from scratch — not a fork.

> **Status:** v0.1 shell complete **plus** v1 AI features — Memory, **RAG**
> (retrieval wired into chat), **Agent** (tool-calling), and **Compare**
> (multi-model). Installable **desktop app** via Tauri + Python sidecar (proven;
> see [`apps/desktop/README.md`](apps/desktop/README.md)) with a cross-platform
> build CI (`.github/workflows/desktop-build.yml`). Parked (need your input):
> Email/Calendar (credentials), Cookbook/image editor (heavy), code signing.

## Tech stack
- **Frontend:** React / Next.js · Tailwind CSS · shadcn/ui
- **Backend:** Python · FastAPI
- **AI providers:** every **free** tier via an OpenAI-compatible layer
  (OpenRouter free models, Google Gemini free, Groq, Mistral, Cerebras, …) **+ local Ollama**

## v0.1 — "broad feature shell"
Many feature areas visible from day one. **Chat is fully functional**
(multi-provider, streaming, sessions, runtime provider switching); the other areas
ship as real-but-light modules / stubs that we deepen over later milestones:

| Area | Status |
|---|---|
| Chat | ✅ working (streaming, sessions, provider switching, RAG context) |
| Agent + tools | ✅ working (knowledge search, notes, tasks, calculator) |
| Compare | ✅ working (one prompt → multiple models, side by side) |
| Settings — AI Providers | ✅ working (add/edit/delete/activate; key masking) |
| Notes | ✅ working (CRUD; persisted in SQLite) |
| Tasks | ✅ working (create, toggle done/undone, delete; SQLite) |
| Documents | ✅ working (upload + text extraction .txt/.md/.pdf/.docx) |
| Memory + RAG | ✅ working (remembered facts, embeddings, retrieval into chat) |
| Desktop app | ✅ Tauri + Python sidecar proven; cross-platform build CI |

## Later milestones (parked)
- **Email** (IMAP/SMTP + AI triage) — needs your account credentials.
- **Calendar** (CalDAV) — needs your account credentials.
- **Deep Research** — multi-step web research.
- **Cookbook** (hardware-aware model serving) and **image editor** — heavier.
- **Desktop polish** — installers/signing/notarization, auto-update, tray,
  faster sidecar start (`--onedir`); Windows `.exe` builds via the CI matrix.

## Local development

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env if you want an env-level default provider.
# Or skip — just add providers through the Settings UI instead.
```

### 2. Start the API (FastAPI)

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check: http://localhost:8000/health

The API stores its SQLite database in `apps/api/data/lantern.db` (gitignored).

### 3. Start the web app (Next.js)

In a separate terminal:

```bash
cd apps/web
npm install        # or pnpm install if you have pnpm
npm run dev
```

Open http://localhost:3000 — the app redirects to `/chat`.

### 4. Configure a provider

1. Open **Settings** in the Lantern sidebar.
2. Click **Add provider**, pick a preset (or enter your own base URL + model), enter your API key.
3. Click **Use** next to the provider to make it active.
4. The chat header shows the active model; use the model switcher to change it without leaving chat.

**Supported providers (all free tiers):**

| Provider | Base URL | Free model example |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Cerebras | `https://api.cerebras.ai/v1` | `llama-4-scout-17b-16e-instruct` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |

API keys are stored **only** in the local gitignored `apps/api/data/` directory — never committed.

### 5. Run API tests (no network required)

```bash
cd apps/api
source .venv/bin/activate
pytest -v
```

All tests run offline — the OpenAI-compatible client is monkeypatched with a stub provider.

## Workflow — Nogra
This repo is driven with **[Nogra](https://github.com/nograai/nogra-claude-marketplace)**:
`brief → GO → dispatch → evidence → verify`. Local Nogra state lives in
[`.nogra/`](.nogra/); see [`CLAUDE.md`](CLAUDE.md) for the workspace contract.

## Continue on another machine
1. Install **Claude Code**, then the **Nogra plugin**:
   ```bash
   claude plugin marketplace add nograai/nogra-claude-marketplace
   claude plugin install nogra@nogra-claude
   ```
   …and restart Claude Code.
2. `git clone` this repo and open Claude Code in the folder.
3. Say: **"continue Lantern — write the Nogra brief."**
   Nogra reads `.nogra/state/` and resumes exactly where we left off.

## License
TBD (Odysseus uses MIT — likely the same).
