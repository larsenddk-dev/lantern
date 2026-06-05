---
schema: nogra.brief.v1
releaseVersion: v1.0.0
briefId: brief-lantern-v0.1-phase-1-foundation-scaffold-nav-shell-single-provider-strea-2026-06-05-587ac5
workspaceId: lantern
title: "Lantern v0.1 — Phase 1: foundation (scaffold + nav shell + single-provider streaming chat)"
createdAt: 2026-06-05T09:38:50.844Z
updatedAt: 2026-06-05T09:38:57.769Z
status: ready
owner: ""
targetRole: ""
targetModel: anthropic:sonnet
evidenceRequired: reported
---

# Lantern v0.1 — Phase 1: foundation (scaffold + nav shell + single-provider streaming chat)

## Intent

Stand up the Lantern foundation: a Next.js + FastAPI monorepo with a persistent navigation shell across all v0.1 feature areas, and a fully working chat that streams responses from one OpenAI-compatible provider with persisted sessions. This is phase 1 of v0.1; later briefs add multi-provider selection and deepen the light modules.

## Context Handoff

Lantern is a self-hosted, local-first AI workspace (decisions locked in .nogra/state/DECISIONS.md). Stack: React/Next.js + Tailwind CSS + shadcn/ui frontend, Python + FastAPI backend, AI via an OpenAI-compatible layer over free provider tiers (OpenRouter free, Gemini, Groq, Mistral, Cerebras) plus local Ollama. New project from scratch — no app code exists yet; the repo currently holds only Nogra state + docs. First action: read CLAUDE.md, README.md, and .nogra/state/* before writing code so framework/setup assumptions are current. Build the OpenAI-compatible provider abstraction from day one but wire only ONE default provider in this phase; make streaming chat provable without any secret/live call via a stubbed provider in tests. Suggested layout: apps/web (Next.js App Router, TypeScript) and apps/api (FastAPI); executor may adjust if a cleaner convention fits, but keep web and api clearly separated.

## Decisions

- Foundation-first phased approach: this brief is phase 1 of v0.1.
- Build the OpenAI-compatible provider abstraction now, wire only ONE provider this phase.
- Streaming chat must be verifiable without secrets via a stub/fake provider in an automated test.
- Non-chat areas ship as real routed placeholder pages, not dead links.

## Rejected

- Full v0.1 (scaffold + multi-provider + all five modules) in a single run — too large to verify reliably.
- Scaffold-only first with no chat — slower to a useful, demonstrable app.

## Known Gaps

- Executor environment likely lacks live provider API keys and/or a running Ollama, so a real end-to-end call to an external model is a user action, not a run requirement. Streaming and session behavior are proven against a stub provider instead.

## Scope

In:

- Initialize a monorepo at the workspace root with a Next.js (App Router, TypeScript) web app and a Python FastAPI backend, plus local run/dev docs.
- Web app: configure Tailwind CSS + shadcn/ui; build an app shell with a persistent left navigation listing all v0.1 areas — Chat, Documents, Notes, Tasks, Memory, Settings — with client-side routing between them.
- Render Documents, Notes, Tasks, Memory, and Settings as light, labeled placeholder pages (real routes, clearly marked as stubs/coming soon).
- Chat (functional, single provider): a chat UI (message list + composer) that streams the assistant reply incrementally; conversation sessions persisted server-side (create, list, switch, append messages, reload history).
- Backend: FastAPI app with a /health endpoint, a streaming chat endpoint that proxies an OpenAI-compatible provider (base URL, model, and API key read from environment), and simple local session persistence (SQLite or JSON file — executor's choice).
- OpenAI-compatible client layer wired to ONE default provider, configurable via environment, with a .env.example documenting provider options (OpenRouter free / Gemini / Groq / local Ollama).
- An automated test proving the streaming chat + session round-trip against a stubbed/fake OpenAI-compatible endpoint (no live external calls, no secrets required).
- Update README run instructions and .nogra/state/SESSION-CHECKPOINT.md + CURRENT-TASKS.md to reflect the foundation phase landing and name the next phase.

Out:

- Multi-provider selection UI, provider routing/fallback (later brief).
- Deepening any light module beyond a stub (real Documents/Notes/Tasks/Memory features).
- Agent + tools, Memory/RAG retrieval, Deep Research, Compare, Email, Calendar, Cookbook, image editor, PWA.
- Auth/multi-user, deployment/hosting/Docker configuration.
- Calling live external AI providers during automated tests, or adding real API keys/secrets to the repo.

Files:

- apps/web/ (NEW — Next.js App Router + TypeScript, Tailwind, shadcn/ui, nav shell, chat UI, stub pages)
- apps/api/ (NEW — FastAPI app: health, streaming chat endpoint, OpenAI-compatible client, session persistence, stub-provider test)
- .env.example (NEW — provider/base-url/model/key config)
- README.md (EDIT — local run instructions for web + api)
- .nogra/state/SESSION-CHECKPOINT.md (EDIT — mark phase 1 done, name next phase)
- .nogra/state/CURRENT-TASKS.md (EDIT — move foundation to done, queue multi-provider + modules)

## Success Criteria

- The Next.js web app builds and dev-serves, and the FastAPI backend starts with /health returning an ok response.
- The web app shows a persistent nav with all six areas; navigating to each renders its route, and Documents/Notes/Tasks/Memory/Settings render labeled stub pages.
- Sending a message in Chat streams the assistant reply incrementally (chunk-by-chunk), not as a single blob.
- Chat sessions persist: a new session can be created, prior sessions are listed and can be reopened, and message history reloads from the backend.
- The streaming + session round-trip is covered by an automated test that passes against a stub provider with no network or secret dependency.
- .env.example documents how to point the OpenAI-compatible layer at a provider, and README documents how to run web + api locally.
- .nogra/state/SESSION-CHECKPOINT.md and CURRENT-TASKS.md are updated to mark the foundation phase done and name the next phase.

## Stop Criteria

- First action: read CLAUDE.md, README.md, and .nogra/state/*; then check the toolchain — run `node --version`, a JS package manager (`pnpm --version` or `npm --version`), and `python3 --version`. If Node, a JS package manager, or Python 3 is missing, status: blocked, name what is missing, and do not install runtimes or scaffold partial files.
- Do not add real API keys or secrets to the repo and do not call live external AI providers, including in tests — use a stub/fake endpoint for the streaming test.
- If delivering working chat would require going outside this foundation slice (multi-provider UI, real module features, auth, deployment), stop and return for a follow-up brief instead of expanding scope.
- If a scaffolding command exits non-zero and cannot proceed cleanly, stop with the command output rather than hand-patching a broken scaffold.
- Do not modify .nogra/ contracts or config.json; only update the .nogra/state/* continuity files named in scope.

## Execution Shape

Tool needs:

- read-only inspection
- file checks
- command output
- diff review

## Max Output

Format: evidence-first state brief
Limit: no hard word limit; keep the opening summary concise and include all evidence needed to verify the result
