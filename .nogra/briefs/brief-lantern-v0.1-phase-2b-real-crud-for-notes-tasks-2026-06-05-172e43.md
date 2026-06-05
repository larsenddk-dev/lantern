---
schema: nogra.brief.v1
releaseVersion: v1.0.0
briefId: brief-lantern-v0.1-phase-2b-real-crud-for-notes-tasks-2026-06-05-172e43
workspaceId: lantern
title: "Lantern v0.1 — Phase 2b: real CRUD for Notes + Tasks"
createdAt: 2026-06-05T14:57:11.477Z
updatedAt: 2026-06-05T14:57:11.525Z
status: ready
owner: ""
targetRole: ""
targetModel: anthropic:sonnet
evidenceRequired: reported
---

# Lantern v0.1 — Phase 2b: real CRUD for Notes + Tasks

## Intent

Turn the Notes and Tasks placeholder pages into real, persisted modules: full CRUD backed by SQLite on the FastAPI side and working UIs on the Next.js side, following the conventions already established in Phase 1/2a. Documents and Memory stay stubs (Documents is the separate Phase 2c).

## Context Handoff

Lantern is a self-hosted local-first AI workspace; Phase 1 (foundation) and Phase 2a (multi-provider selector) are done and verified. Backend apps/api/main.py uses stdlib sqlite3 with `db_*` helper functions, `CREATE TABLE IF NOT EXISTS` in init_db(), Pydantic request models, and FastAPI route handlers — follow these exact conventions for new notes/tasks tables, helpers, and endpoints. Frontend apps/web defines shared types in lib/types.ts and a typed fetch client in lib/api.ts (methods like createSession/listSessions/getSession); the nav lives in components/nav-sidebar.tsx (already lists Notes and Tasks) and the placeholder pages are app/notes/page.tsx and app/tasks/page.tsx (lucide icon + 'Coming soon' styling using CSS vars). The API base URL on the client is NEXT_PUBLIC_LANTERN_API_URL (default http://localhost:8000). There are currently 11 passing offline pytest tests (no network/secrets, stubbed provider) — keep them green. FIRST ACTION: read CLAUDE.md, README.md, .nogra/state/*, apps/api/main.py, apps/api/test_main.py, apps/web/lib/types.ts, apps/web/lib/api.ts, and the existing notes/tasks stub pages before writing code, so new code matches existing patterns and styling.

## Decisions

- Phase 2b covers Notes + Tasks only; Documents (upload + text extraction + new deps) is deferred to its own bounded brief 2c.
- Reuse the existing backend conventions (sqlite3 + db_* helpers + init_db tables + Pydantic models + route handlers) and frontend conventions (lib/types.ts + lib/api.ts + page components with the existing styling).
- Leave the chat/provider/session code paths untouched except additively; the 11 existing tests must stay green.

## Rejected

- Notes + Tasks + Documents in one run — Documents adds file upload, text extraction and new dependencies; bundling risks an executor turn-limit stall mid-Documents.
- One module per brief (Notes only) — unnecessarily slow since Notes and Tasks share the same CRUD pattern.

## Known Gaps

- Memory and Documents remain placeholder pages after this phase by design.

## Scope

In:

- Backend (apps/api/main.py): add `notes` and `tasks` SQLite tables in init_db(); add db_* helper functions and FastAPI endpoints following existing conventions.
- Notes endpoints: list, create, get-one, update, delete (e.g. GET/POST /notes, GET/PUT/DELETE /notes/{id}); note fields include id, title, content, created_at, updated_at.
- Tasks endpoints: list, create, update, toggle done/complete, delete (e.g. GET/POST /tasks, PUT/DELETE /tasks/{id}, plus a way to mark done/undone); task fields include id, title, done, created_at, updated_at.
- Frontend types + client: add Note/Task types and payloads to lib/types.ts and the corresponding methods to the lib/api.ts client.
- Notes page (app/notes/page.tsx): replace the stub with a working UI to create, list, edit, and delete notes via the API.
- Tasks page (app/tasks/page.tsx): replace the stub with a working UI to create tasks, toggle done/complete, and delete them via the API.
- Tests (apps/api/test_main.py): add offline pytest coverage for Notes CRUD and Tasks CRUD + done-toggle; keep all existing tests passing, no network or secrets.
- Docs/state: update README (Notes + Tasks now live) and .nogra/state/SESSION-CHECKPOINT.md + CURRENT-TASKS.md (mark Phase 2b done, name Phase 2c = Documents upload + text extract).

Out:

- Documents module (upload, listing, text extraction) — that is Phase 2c.
- Memory module / RAG.
- Any change to chat, streaming, sessions, or provider behavior beyond additive, non-breaking edits.
- Auth/multi-user, deployment/hosting/Docker.
- Adding heavyweight dependencies (e.g. file/PDF parsing libraries) — not needed for Notes/Tasks.
- Calling live external providers or adding real API keys/secrets.

Files:

- apps/api/main.py (EDIT — notes + tasks tables, db_* helpers, endpoints)
- apps/api/test_main.py (EDIT — add Notes + Tasks offline tests)
- apps/web/lib/types.ts (EDIT — Note/Task types + payloads)
- apps/web/lib/api.ts (EDIT — notes/tasks client methods)
- apps/web/app/notes/page.tsx (EDIT — replace stub with CRUD UI)
- apps/web/app/tasks/page.tsx (EDIT — replace stub with CRUD UI)
- apps/web/components/ (NEW — optional note/task UI components if helpful)
- README.md (EDIT — Notes + Tasks usage)
- .nogra/state/SESSION-CHECKPOINT.md (EDIT — Phase 2b done, name 2c)
- .nogra/state/CURRENT-TASKS.md (EDIT — move 2b to done, queue 2c)

## Success Criteria

- The backend exposes working Notes CRUD and Tasks CRUD (including marking a task done/undone), all persisted in the SQLite database.
- The Notes page can create, list, edit, and delete notes, and the changes persist across a page reload (data comes from the API, not local state).
- The Tasks page can create a task, toggle it done/undone, and delete it, and the changes persist across a page reload.
- New offline pytest tests cover Notes CRUD and Tasks CRUD + toggle, the full suite passes with no network or secrets, and the 11 pre-existing tests still pass.
- `next build` for apps/web completes cleanly; the Documents and Memory pages remain stubs and the nav is unchanged.
- README and .nogra/state files are updated to mark Phase 2b done and name Phase 2c (Documents) as next.

## Stop Criteria

- First action: read CLAUDE.md, README.md, .nogra/state/*, apps/api/main.py, apps/api/test_main.py, apps/web/lib/types.ts, apps/web/lib/api.ts, and the notes/tasks stub pages. Then verify toolchain: `python3 --version`, the api venv at apps/api/.venv (or create it from requirements.txt), and the JS package manager. If python3 or node is missing, status: blocked, name what is missing, and do not install runtimes.
- Stay strictly within Notes + Tasks. Do NOT implement Documents (upload/extraction), Memory, or any provider/chat/session feature changes; those pages stay as they are.
- Do not weaken, skip, or delete existing tests to make the suite pass. If a pre-existing test would break, stop and report it rather than editing the test to hide a regression.
- Do not add new third-party dependencies for this slice. If you believe one is genuinely required, stop and return for approval instead of installing it.
- Do not modify .nogra/ contracts or config.json; only update the .nogra/state/* files named in scope. No secrets, no live external provider calls.

## Execution Shape

Tool needs:

- read-only inspection
- file checks
- command output
- diff review

## Max Output

Format: evidence-first state brief
Limit: no hard word limit; keep the opening summary concise and include all evidence needed to verify the result
