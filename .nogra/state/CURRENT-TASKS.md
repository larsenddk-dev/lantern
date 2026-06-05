# Current Tasks

Workspace: Lantern
Updated: 2026-06-05T13:10Z

## Completed

- [x] Phase 1 — Foundation scaffold (brief-587ac5): nav shell, 5 stub pages,
      FastAPI streaming chat + SQLite sessions, Chat UI with SSE. Build + tests green.
- [x] Phase 2a — Multi-provider selector (brief-2a7c10, run transport-…130435):
      providers CRUD + active selection in SQLite (keys masked, db gitignored),
      `/chat` resolves active provider with env fallback, Settings UI +
      chat-header switcher. 11/11 pytest + `next build` green (Manager-verified).

## Active

_None — awaiting next brief._

## Parked (next phases)

- Phase 2b: deepen light modules — Notes (CRUD), Tasks (list/check/complete),
  Documents (upload + text extract), persisted in SQLite + UI.
- Phase 3: Memory/RAG — embed + store user notes, surface relevant context in chat.
- Later: Agent + tools, Deep Research, Compare, Email, Calendar, Cookbook,
  image editor, PWA.
