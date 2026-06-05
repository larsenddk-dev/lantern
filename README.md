# 🏮 Lantern

> A self-hosted AI workspace — **local-first, privacy-first.** Carry your own light.

Lantern is your own ChatGPT/Claude-style workspace, running on **your** hardware
with **your** data. Inspired by [PewDiePie's Odysseus](https://github.com/pewdiepie-archdaemon/odysseus),
but broader, with more features and a much better UI. New project, built from scratch — not a fork.

> **Status:** v0.1 Phase 2a complete. Multi-provider selector working (Settings + chat header switcher). Chat remains fully functional.

## Tech stack
- **Frontend:** React / Next.js · Tailwind CSS · shadcn/ui
- **Backend:** Python · FastAPI
- **AI providers:** every **free** tier via an OpenAI-compatible layer
  (OpenRouter free models, Google Gemini free, Groq, Mistral, Cerebras, …) **+ local Ollama**

## v0.1 — "broad feature shell"
Many feature areas visible from day one. **Chat is fully functional**
(multi-provider, streaming, sessions, runtime provider switching); the other areas
ship as real-but-light modules / stubs that we deepen over later milestones:

| Area | v0.1 |
|---|---|
| Chat | ✅ working (streaming, sessions, provider switching) |
| Settings — AI Providers | ✅ working (add/edit/delete/activate; key masking) |
| Documents · Notes · Tasks · Memory | 🟡 light modules |
| Agent + tools | ⬜ later |

## Later milestones
Agent + tools (web/files/shell/MCP) · Memory/RAG · Deep Research · Compare ·
Email (IMAP/SMTP + AI triage) · Calendar (CalDAV) · Cookbook (hardware-aware
model serving) · image editor · PWA.

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
