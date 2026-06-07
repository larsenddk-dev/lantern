# 🏮 Lantern

> A self-hosted AI workspace — **local-first, privacy-first.** Carry your own light.

Lantern is your own ChatGPT/Claude-style workspace, running on **your** hardware
with **your** data. It ships with a **bundled local AI engine** (Ollama), so you
just download, pick a model, and start chatting — no command line, no separate
installs, nothing leaves your machine unless you explicitly route a chat through
a cloud provider.

> **Status:** v1 desktop app — Chat, Agent, Compare, Research, Documents, Notes,
> Tasks, Memory, Prompts, Stars, Email, Calendar, Stats, and a hardware-aware
> Cookbook for installing local models in one click. Installs and launches on
> macOS/Windows/Linux. **81 backend tests passing**, web build clean.

<!-- Add a screenshot of the Cookbook or Chat page here when you have one -->

## ⬇️ Download & install (just want to use it?)

Grab the installer for your OS from the
[**Releases**](https://github.com/larsenddk-dev/lantern/releases) page:

| OS | File | Notes |
|---|---|---|
| **macOS (Apple Silicon)** | `Lantern_*_aarch64.dmg` | ~500 MB — bundles the AI engine |
| **Windows** | `Lantern_*_x64-setup.exe` | ~1.6 GB — bundles AI engine + GPU libs |
| **Linux x86_64** | `Lantern_*_amd64.AppImage` | ~1.5 GB — bundles AI engine + GPU libs |

> Lantern is free, open, and **unsigned**, so the OS will warn the first time
> you run it:
> - **Windows:** SmartScreen says *"Windows protected your PC"* → click
>   **More info → Run anyway**.
> - **macOS:** right-click the app → **Open** → confirm. The first launch can
>   take 30-60 seconds while macOS Gatekeeper scans the bundle; after that it's
>   sub-2-second startup.
> - **Linux:** `chmod +x Lantern_*_amd64.AppImage && ./Lantern_*_amd64.AppImage`

### Your first 60 seconds

1. **Launch Lantern.** The first thing you see is the **Cookbook** — a list of
   local AI models, sized and ranked for your hardware (RAM, GPU detected
   automatically).
2. **Click "Install"** on a recommended model. For most people on 8-16 GB RAM,
   that's **Llama 3.2 3B** (2 GB download) or **Llama 3.1 8B** (4.9 GB).
3. When the download finishes, click **"Use in chat"** — Lantern flips to the
   Chat page with that model active. Start typing.

That's it. No accounts, no API keys, no cloud — the model runs on your
hardware. The app is also a fully featured workspace once you're in: see the
sidebar.

### Want to use a cloud model too?

Open **Settings → Add provider** to add OpenRouter, Groq, Mistral, Gemini, etc.
Mix local and cloud freely: switch models per chat from the model picker in
the header.

## Features

Every area below is real, working, and tested. Chat is the workhorse; the
others are productivity tools you'll discover as you use it.

| Area | What it does |
|---|---|
| **Chat** | Streaming · Markdown + syntax highlighting · stop / pause / retry · edit + delete individual messages · star · save-as-memory · export `.md`/`.pdf` · keyboard shortcuts |
| **Cookbook** | Hardware-aware local model picker (Ollama). Detects your RAM/GPU, recommends models that fit, one-click install, one-click activate. |
| **Agent** | Tool-calling loop (knowledge search, list notes/tasks, calculator, optional web search) |
| **Research** | Plan → gather (via RAG + web) → synthesised report · export `.md`/`.pdf` |
| **Compare** | One prompt → multiple models side by side · per-target error capture |
| **Documents** | Drag-drop upload · text extraction (.txt/.md/.pdf/.docx) · filter |
| **Notes** | CRUD · save-as-memory · Markdown export · filter |
| **Tasks** | CRUD · toggle done · **AI-generate tasks** from a chat conversation |
| **Memory + RAG** | Remembered facts (pinned or auto-retrieved) injected into chat |
| **Prompts** | Reusable system / user prompts · copy · filter |
| **Starred** | Bookmark individual messages across all chats |
| **Email** | Read-only IMAP inbox + AI-triage (env-keyed — bring your own credentials) |
| **Calendar** | Read-only CalDAV upcoming events (env-keyed) |
| **Stats** | Counts across everything you've created |
| **Global ⌘K** | Fuzzy search across chats, notes, tasks, documents, memories |
| **Shortcuts** | ⌘/Ctrl+1-9 to jump between pages, `?` for the full list |
| **Themes** | Light / dark / system (no-flash) |

### Bring-your-own AI providers (all free tiers)

| Provider | Base URL | Free model example |
|---|---|---|
| Local (bundled) | `http://127.0.0.1:11434/v1` | whatever you install in Cookbook |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Cerebras | `https://api.cerebras.ai/v1` | `llama-4-scout-17b-16e-instruct` |

API keys you enter live **only** in `apps/api/data/lantern.db` (gitignored).
Nothing is sent to any third party that isn't the provider you explicitly
routed a chat to.

## How it works under the hood

```
  ┌──────────────────────────────────────────────────────────┐
  │                   Lantern desktop app                    │
  │                                                          │
  │  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐  │
  │  │  Next.js    │ ↔  │   FastAPI    │ ↔  │   Ollama    │  │
  │  │  (webview)  │    │   (sidecar)  │    │  (sidecar)  │  │
  │  └─────────────┘    └──────────────┘    └─────────────┘  │
  │         UI            sessions, RAG,      local models    │
  │                      provider routing                     │
  └──────────────────────────────────────────────────────────┘
```

The Tauri shell wraps a static export of the Next.js app and spawns two
sidecars on startup:

- **lantern-api** — a PyInstaller-packaged FastAPI server (port 8000) that
  owns the SQLite database, provider routing, RAG, agents, and research.
- **Ollama** — the upstream Ollama runtime (port 11434). Bundled per-platform
  by the build CI. Models you install live in
  `~/Library/Application Support/com.lantern.app/ollama-models/` (macOS) so
  they don't conflict with a separately-installed Ollama at `~/.ollama`.

If you already have your own Ollama on `:11434`, Lantern detects it on start
and steps aside — Cookbook then operates against your existing daemon.

## Local development

You don't need this if you just want to use the app — the installers above
include everything. This is for hacking on Lantern itself.

### 1. Configure environment

```bash
cp .env.example .env
# Edit if you want an env-level default provider; otherwise skip and use
# the Settings UI or Cookbook instead.
```

### 2. Start the API

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check: http://localhost:8000/health

### 3. Start the web app

In a separate terminal:

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000 — first-run routes you to `/cookbook`, returning
users go to `/chat`.

### 4. (Optional) Install Ollama locally for Cookbook to work

In dev mode Lantern doesn't run a bundled Ollama. Install it once with your
package manager:

```bash
brew install ollama   # macOS
# or:                  https://ollama.com/download
ollama serve &        # in another terminal
```

Cookbook will detect it automatically.

### 5. Run tests

```bash
cd apps/api && pytest -v        # 81 backend tests, all offline
cd apps/web && npm run build    # type-check + static export
```

### 6. (Optional) Build the desktop app locally

```bash
# Build the FastAPI sidecar
cd apps/api
pyinstaller lantern-api.spec
mkdir -p ../desktop/src-tauri/sidecar
rm -rf ../desktop/src-tauri/sidecar/lantern-api
cp -R dist/lantern-api ../desktop/src-tauri/sidecar/lantern-api

# Fetch the bundled Ollama
cd ../desktop
python scripts/fetch-ollama.py

# Build the web app
cd ../web && npm run build

# Build the Tauri bundle
cd ../desktop && npm install && npm run tauri build
```

Output ends up under `apps/desktop/src-tauri/target/release/bundle/`.

## Tech stack

- **Frontend:** React 19 · Next.js 16 (App Router, static export) · Tailwind CSS · lucide-react
- **Backend:** Python · FastAPI · SQLite · httpx · OpenAI-compatible provider shim
- **Desktop shell:** Tauri 2 · two Rust-managed sidecars (FastAPI + Ollama)
- **Local AI engine:** Ollama (bundled per-platform; pinned to v0.30.6)
- **AI providers:** any OpenAI-compatible endpoint — local Ollama, OpenRouter,
  Groq, Mistral, Gemini, Cerebras, OpenAI, Anthropic, …

## Releases

The GitHub Actions workflow at `.github/workflows/desktop-build.yml` builds
installers for macOS, Windows, and Linux. Push a tag matching `v*` and a
draft GitHub Release is created with all three installers attached.

```bash
git tag v1.0.0
git push --tags
```

## License

TBD — likely MIT.

## Workflow

This repo is driven with **[Nogra](https://github.com/nograai/nogra-claude-marketplace)**.
Local Nogra state lives in [`.nogra/`](.nogra/); see [`CLAUDE.md`](CLAUDE.md)
for the workspace contract.
