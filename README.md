# 🏮 Lantern

> A self-hosted AI workspace — **local-first, privacy-first.** Carry your own light.

Lantern is your own ChatGPT/Claude-style workspace, running on **your** hardware
with **your** data. Inspired by [PewDiePie's Odysseus](https://github.com/pewdiepie-archdaemon/odysseus),
but broader, with more features and a much better UI. New project, built from scratch — not a fork.

> **Status:** bootstrapping. Nogra workspace initialized; the first brief is the next step. No app code yet.

## Tech stack
- **Frontend:** React / Next.js · Tailwind CSS · shadcn/ui
- **Backend:** Python · FastAPI
- **AI providers:** every **free** tier via an OpenAI-compatible layer
  (OpenRouter free models, Google Gemini free, Groq, Mistral, Cerebras, …) **+ local Ollama**

## v0.1 — "broad feature shell"
Many feature areas visible from day one. **Chat is fully functional**
(multi-provider, streaming, sessions); the other areas ship as real-but-light
modules / stubs that we deepen over later milestones:

| Area | v0.1 |
|---|---|
| Chat | ✅ working (multi-provider, streaming, sessions) |
| Documents · Notes · Tasks · Memory · Settings | 🟡 light modules |
| Agent + tools | ⬜ later |

## Later milestones
Agent + tools (web/files/shell/MCP) · Memory/RAG · Deep Research · Compare ·
Email (IMAP/SMTP + AI triage) · Calendar (CalDAV) · Cookbook (hardware-aware
model serving) · image editor · PWA.

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
