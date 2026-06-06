# Session Checkpoint

Workspace: Lantern
Created: 2026-06-05T08:05:15Z
Updated: 2026-06-06T14:40Z

## Current State

**Windows desktop installer — SHIPPED & app launches (2026-06-06).**
brief-lantern-v1-windows-desktop-installer, run transport-20260606120724-773d10b9.
- Installers built on this Windows host: `bundle/msi/Lantern_0.1.0_x64_en-US.msi`
  (22.55 MB, WiX) + `bundle/nsis/Lantern_0.1.0_x64-setup.exe` (21.94 MB, NSIS).
- Built app launches natively: WebView2 window renders, spawns the sidecar,
  app-spawned `/health` -> 200. pytest 37/37.
- Fixed a pre-existing launch crash: `plugins.shell.scope`/`sidecar` in
  `apps/desktop/src-tauri/tauri.conf.json` is invalid for tauri-plugin-shell
  2.3.5 (Tauri v2 moved sidecar perms to capabilities). Removed them, kept
  `"open": false`. No capability file needed — sidecar spawns Rust-side in
  setup(). **This tauri.conf.json edit is NOT yet committed.**
- Build env (this host): build from a VS Dev Shell (VS 18 / MSVC 14.50) and add
  `lib\onecore\x64` to LIB — this toolset ships `legacy_stdio_definitions.lib`
  only under onecore. Git link.exe did NOT shadow MSVC. Running the RAW
  target/release exe needs the sidecar copied beside it; the installer handles it.
- Ledger note: dispatched executor (Sonnet, bg) stalled at its turn limit on the
  long compile (its bg build died on subagent exit); Manager completed the build
  via a persistent main-session bg task + the approved fix. Run terminal status
  stays `partial` (honest); brief goal met. Manager verification: **ship**.

**v1 AI features shipped (direct build, autonomous overnight)** — all on GitHub
`origin/main` (through commit e639c9c). 35/35 pytest green, `next build` clean.
- **Memory** (commit b63ce90): remembered facts CRUD + pin; pinned injected into chat.
- **RAG foundation** (939b4bc): embeddings + cosine retrieval over memories &
  documents; build_chat_context auto-injects into /chat (ChatRequest.use_context);
  degrades gracefully w/o embedding provider. Routes /rag/status|index|search.
  embed_texts() OpenAI-compatible /embeddings, LANTERN_EMBED_MODEL; stub in tests.
- **Compare** (e383e22): complete_chat_once(); POST /compare → N models side by
  side, per-target error capture. UI: Compare nav + page.
- **Agent + tools** (5e10861): chat_with_tools() tool-calling loop; tools =
  search_knowledge (RAG), list_tasks, list_notes, calculator (AST-safe). POST
  /agent → {reply, steps}. UI: Agent nav + page (shows tool calls). Live 200 vs Groq.
- **Desktop build CI + PWA manifest** (e639c9c): .github/workflows/desktop-build.yml
  (mac/win/linux matrix → .dmg/.exe+.msi/.AppImage via tauri-action + PyInstaller
  sidecar; DRAFT, signing not wired). apps/web/app/manifest.ts (force-static).

Nav now: Chat · Agent · Compare · Documents · Notes · Tasks · Memory · Settings.

**Environment incident:** mid-session `~/Desktop/minai` was iCloud-evicted
(dataless) — file contents unreadable, all git/build/edits failed with EPERM.
Recovered later. Recommend moving the repo off iCloud-synced `~/Desktop`.

**Parked (need user/heavy):** Email (IMAP/SMTP) + Calendar (CalDAV) — credentials;
Cookbook (model serving) + image editor — heavy; code signing — certificates.

### Prior: Documents module — Phase 2c (commit e04a62a)
Built directly. Verified by Manager:
- apps/api: `documents` SQLite table + db_* helpers; endpoints POST `/documents`
  (multipart upload), GET `/documents`, GET `/documents/{id}` (+extracted text),
  DELETE `/documents/{id}` (row + stored file).
- Text extraction: .txt/.md (stdlib), .pdf (pypdf), .docx (python-docx);
  unsupported types upload gracefully with empty text. Files under gitignored
  `data/uploads/`; filename sanitized, 25 MB cap, empty uploads rejected.
- New deps: python-multipart, pypdf, python-docx (pure-Python; bundle into the
  Tauri sidecar). apps/web: Document types + api client (FormData) + Documents
  page (upload/list/view-text/delete).
- Tests: **24/24 pytest green** (17 prior + 7 new). `next build` clean.
  Live round-trip + browser render confirmed by Manager.

Also synced from the other machine (commits 154de1f, 5e634c3): dev chore —
web preview now runs via `npm run dev` with autoPort (`.claude/launch.json`);
package-lock resync. No feature impact.

**Prior: Phase 3a — Tauri desktop spike** (brief
brief-lantern-v1-phase-3a-tauri-desktop-spike-…, run
transport-20260605151942-647d304a). Desktop packaging architecture **proven**:
- `apps/desktop/` Tauri v2 app (Tauri CLI 2.11.2). `cargo`/Tauri shell
  **compiles** → `target/debug/lantern-desktop` (Manager-verified).
- FastAPI packaged as a PyInstaller `--onefile` sidecar (`apps/api/run.py` +
  `lantern-api.spec` → `dist/lantern-api`, copied to
  `src-tauri/binaries/lantern-api-aarch64-apple-darwin`). Standalone binary
  **serves `/health` 200** (Manager-verified; ~15–18s cold start — `--onefile`
  unpack; documented).
- Next.js **static export viable**: `next.config.ts` `output:'export'` →
  `apps/web/out/` (built). Tauri loads it via `frontendDist`; `lib.rs` spawns
  the sidecar on startup. API URL (`NEXT_PUBLIC_LANTERN_API_URL`) baked at build.
- Icons generated from the brand logo (`npx tauri icon`).
- Docs: `apps/desktop/README.md` (architecture, build/run, findings). Build
  artifacts gitignored (target/, gen/schemas/, binaries/, out/, dist/).
- pytest still **17/17 green**.
- Manager note: the executor run stopped (turn limit) before docs/state;
  Manager verified the build evidence and completed docs + this bookkeeping.
- **Open visual check:** launching the window (`npm run dev` in apps/desktop)
  to see Lantern render natively is the user/Manager confirmation step.

Decision locked (see DECISIONS.md): build to **v1**, ship as **desktop app**
(Tauri + Python sidecar).

### Prior: Phase 2b — Notes + Tasks CRUD
(run transport-20260605145812-e3aed9cf) 17/17 pytest, `next build` clean.
Notes/Tasks tables + db_* helpers + endpoints; CRUD UIs replacing the stubs.

Shipped on top of Phase 2a:
- apps/api: `notes` and `tasks` tables added to SQLite via `init_db()`.
  Notes: `db_create_note`, `db_list_notes`, `db_get_note`, `db_update_note`,
  `db_delete_note` + endpoints GET/POST `/notes`, GET/PUT/DELETE `/notes/{id}`.
  Tasks: `db_create_task`, `db_list_tasks`, `db_get_task`, `db_update_task`,
  `db_delete_task` + endpoints GET/POST `/tasks`, GET/PUT/DELETE `/tasks/{id}`.
  Tasks `done` field serialized as boolean via `_task_to_public()`.
- apps/web/lib/types.ts: Note, CreateNotePayload, UpdateNotePayload, Task,
  CreateTaskPayload, UpdateTaskPayload interfaces added.
- apps/web/lib/api.ts: listNotes, getNote, createNote, updateNote, deleteNote,
  listTasks, getTask, createTask, updateTask, deleteTask methods added.
- apps/web/app/notes/page.tsx: full CRUD UI (create, list, edit inline, delete).
- apps/web/app/tasks/page.tsx: create + toggle done/undone + delete UI;
  tasks split into TO DO / DONE sections.
- Tests: +6 (notes CRUD, notes 404, notes empty fields, tasks CRUD+toggle,
  tasks 404, tasks bool type-check) — 17/17 pass, no network/secrets.
- README updated: Notes + Tasks marked as working.

## v0.1 shell status

✅ Chat · ✅ Notes · ✅ Tasks · ✅ Documents · ✅ Settings (providers) · ✅ logo
· 🟡 **Memory** (last light module remaining). Desktop packaging proven (3a).

## Next

- **Memory** (light module) — last v0.1 module. Then **Memory/RAG** (embed
  notes, surface relevant context in chat).
- Open visual check: launch the desktop window (`cd apps/desktop && npm run dev`)
  to confirm Lantern renders natively against the sidecar.
- Then: Agent + tools, Deep Research, Compare, Email, Calendar, Cookbook
  (model serving), image editor, PWA.
- **Desktop polish (later):** installers (.dmg/.msi/.AppImage), code signing +
  notarization, auto-update, tray/menu, faster sidecar start (`--onedir`),
  Windows/Linux builds (Windows .exe via PyInstaller-on-Windows + tauri build).

## Verification

- SessionStart must remain read-only: no full memory load, no write, no dispatch.
