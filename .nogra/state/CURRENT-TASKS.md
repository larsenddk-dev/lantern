# Current Tasks

Workspace: Lantern
Updated: 2026-06-06T14:40Z

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
- [x] Deep Research (c560796): plan → gather (RAG) → synthesized report over
      saved knowledge; POST /research; Research nav + page. 37/37 pytest;
      verified live in browser (4 sub-questions + structured report vs Groq).
- [x] Windows desktop installer (brief-lantern-v1-windows-desktop-installer,
      run transport-20260606120724-773d10b9): MSI 22.55 MB + NSIS .exe 21.94 MB
      built on Windows; app launches natively + spawns sidecar (/health 200);
      pytest 37/37. Fixed pre-existing launch crash (invalid plugins.shell.scope
      in tauri.conf.json, rejected by tauri-plugin-shell 2.3.5). Build env: VS
      Dev Shell + onecore LIB. Run ledger stays `partial` (executor stalled at
      turn limit → Manager completed build+fix); verification: ship.
      tauri.conf.json edit NOT yet committed.
- [x] Markdown rendering in Chat + Research (direct, no brief): shared
      components/markdown.tsx (react-markdown 10 + remark-gfm 4). Assistant
      replies + research reports now render GFM (headings, lists, code blocks,
      tables, links, strikethrough); user messages stay plain. Verified: next
      build clean (13 routes) + live snapshot + computed styles + no console
      errors. Deps added to apps/web. Not committed.
- [x] Chat stop button (direct): Send becomes a Stop button while streaming
      (AbortController); streaming cursor clears on stop. Build-verified.
- [x] RAG context toggle (direct): "Context" on/off in the chat header; sends
      use_context:false to /chat when off (backend ChatRequest.use_context).
      Verified interactively in preview (toggles + aria-pressed, no errors).
- [x] Desktop startup splash (direct): components/startup-gate.tsx polls /health
      and shows a "Starting Lantern…" splash during sidecar cold start; 30s
      fall-through + 500ms anti-flash. Both paths verified in preview.
- [x] Embeddings helper in Settings (direct): components/embeddings-settings.tsx
      — "Embeddings & RAG" section shows /rag/status count + Re-index (/rag/index)
      with result feedback + provider-capability guidance. Verified in preview
      (renders, live status "0 items embedded", re-index flow). No console errors.

## Active

v1.0 polish push (direct, UNCOMMITTED). **Tier A DONE:** markdown · stop button ·
RAG toggle · startup splash · embeddings helper. Remaining for v1.0: Tier B
`--onedir` faster sidecar (rebuilds the desktop) + optional CI tag-validation.
⚠️ LARGE uncommitted set (desktop launch fix + 5 web polish features) — commit
checkpoint strongly recommended BEFORE the next desktop rebuild.

## Open user/Manager checks

- [x] Desktop window launch — VERIFIED (2026-06-06): built app opens natively,
  spawns sidecar, /health 200; window left open this session for your eyeball.
  (Running the RAW release exe needs the sidecar copied beside it; installer is fine.)
- Optional: commit the tauri.conf.json launch fix.
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
