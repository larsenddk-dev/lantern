# Current Tasks

Workspace: Lantern
Updated: 2026-06-06T00:10Z

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
- [x] Documents module — Phase 2c (built DIRECTLY, no Nogra run): upload +
      text extraction (.txt/.md/.pdf/.docx) + list/view/delete; SQLite + files
      under gitignored data/uploads/; 3 new deps (python-multipart, pypdf,
      python-docx). 24/24 pytest + `next build` green; live + browser verified.
- [x] Branding — pixel-lantern logo in sidebar + favicon (app/icon.png).
- [x] Memory module (commit b63ce90): CRUD + pin; 27/27 pytest.
- [x] RAG foundation (939b4bc): embeddings + cosine retrieval + chat injection;
      /rag/status|index|search; 30/30 pytest.
- [x] Compare (e383e22): multi-model side by side; 32/32 pytest.
- [x] Agent + tools (5e10861): tool-calling loop (knowledge/notes/tasks/calc);
      35/35 pytest; live 200 vs Groq.
- [x] Desktop build CI + PWA manifest (e639c9c): cross-platform tauri-action
      matrix (incl. Windows .exe) + app/manifest.ts. CI is a draft.

## Active

_None — autonomous overnight batch complete. See MORNING-REPORT.md._

## Open user/Manager checks

- Launch the desktop window (`cd apps/desktop && npm run dev`) to confirm native
  render (note: stop the dev API on :8000 first; sidecar binds 8000).
- RAG indexing needs an embeddings-capable provider; set one + click Re-index
  on the Memory page to use semantic retrieval (pinned memories work without it).
- **Move the repo off iCloud-synced `~/Desktop`** to avoid another eviction.
- Run the desktop build CI on a tag to produce real installers; validate it.

## Parked (need user / heavy)

- **Email** (IMAP/SMTP + AI triage), **Calendar** (CalDAV) — your credentials.
- **Deep Research** — multi-step web research.
- **Cookbook** (model serving), **image editor** — heavy.
- **Desktop polish:** installers signing/notarization, auto-update, tray/menu,
  faster sidecar start (--onedir).
