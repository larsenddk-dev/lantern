# Current Tasks

Workspace: Lantern
Updated: 2026-06-05T15:35Z

## Completed

- [x] Phase 1 — Foundation scaffold (brief-587ac5): nav shell, 5 stub pages,
      FastAPI streaming chat + SQLite sessions, Chat UI with SSE. Build + tests green.
- [x] Phase 2a — Multi-provider selector (brief-2a7c10, run transport-…130435):
      providers CRUD + active selection in SQLite (keys masked, db gitignored),
      `/chat` resolves active provider with env fallback, Settings UI +
      chat-header switcher. 11/11 pytest + `next build` green (Manager-verified).
- [x] Phase 2b — Notes + Tasks CRUD (brief-…-phase-2b-…, run transport-20260605145812-e3aed9cf):
      notes + tasks SQLite tables + db_* helpers + FastAPI endpoints; Notes CRUD
      UI; Tasks create/toggle/delete UI; 17/17 pytest + `next build` green.
- [x] Phase 3a — Tauri desktop spike (brief-…-phase-3a-…, run transport-20260605151942-647d304a):
      apps/desktop Tauri v2 shell compiles; FastAPI PyInstaller sidecar serves
      /health; Next static export viable; icons from logo; docs in
      apps/desktop/README.md. Build artifacts gitignored. Manager-verified.

## Active

_None — awaiting next brief._

## Open user/Manager check

- Launch the desktop window (`cd apps/desktop && npm run dev`) to visually
  confirm Lantern renders natively + chat/notes/tasks work against the sidecar.

## Parked (next phases)

- Phase 2c: Documents — upload + list + text extract (PDF/Word dep decision
  pending), persisted in SQLite + UI.
- Memory (light), then Memory/RAG — embed notes, surface context in chat.
- Later: Agent + tools, Deep Research, Compare, Email, Calendar, Cookbook,
  image editor, PWA.
- Desktop polish (later): installers, code signing/notarization, auto-update,
  tray/menu, faster sidecar start (--onedir), Windows/Linux builds.
