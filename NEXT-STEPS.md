# 🏮 Lantern — Next steps to v1.0

> **Status (2026-06-07):** All major feature areas done + **Cookbook**
> (hardware-aware local model picker) + **bundled Ollama** (no separate
> install). **81/81 backend tests** green, web build clean, macOS `.app`
> verified end-to-end with bundled stack.
>
> Pending for v1.0.0: Windows installer verification (needs you), README
> screenshots, tag.

---

## Done since v0.1.0

### Core feature work
- ✅ **Memory** + RAG (embeddings, semantic retrieval, pinned facts in chat)
- ✅ **Agent** (tool-calling: RAG search, list notes/tasks, calculator, web)
- ✅ **Compare** (N models side-by-side)
- ✅ **Research** (plan → gather → synthesise, with web search)
- ✅ **Email** (read-only IMAP + AI triage, env-keyed)
- ✅ **Calendar** (read-only CalDAV, env-keyed)
- ✅ **Prompts** library
- ✅ **Starred** messages page
- ✅ **Stats** page
- ✅ Chat features: edit + delete messages, pause/resume streaming,
  AI-generate tasks from a conversation, filter bars on Notes/Documents/Prompts

### v1 desktop work (this push)
- ✅ **Cookbook** — Ollama-backed model picker with hardware fit ratings,
  one-click install with progress, one-click activate as provider
- ✅ **First-run router** — empty Lantern routes to `/cookbook` instead of
  an empty chat
- ✅ **Sidecar `--onedir`** — cold start 15-18s → ~5s; bundled `.app` second
  launch <2s
- ✅ **Bundled Ollama** — Tauri ships the Ollama runtime so users don't have
  to install it; `OLLAMA_MODELS` points at app data dir for clean uninstall
- ✅ **Port-conflict handling** — step aside if user already runs Ollama
- ✅ **Better StartupGate** — 90s timeout, "first launch is slow" hint at 15s
- ✅ **README refresh** — reflects v1 reality
- ✅ **OPEN-QUESTIONS.md** — decisions made during AFK work

---

## Remaining to tag v1.0.0

### Critical path
- [ ] **Verify Windows installer end-to-end** — build via CI (push a temp
  tag, or `gh workflow run`), download the `.exe`, click through SmartScreen,
  confirm bundled Ollama spawns and Cookbook works on Windows.
- [ ] **Take 3-4 screenshots** for the README:
  - Cookbook with hardware detected + model fit ratings
  - Chat mid-stream
  - Agent or Research result
  - Settings / providers
- [ ] **Add the screenshots** under `docs/screenshots/` and reference them
  from `README.md`.
- [ ] **Choose a license** (MIT recommended; `LICENSE` file at repo root).
- [ ] **Tag v1.0.0** — `git tag v1.0.0 && git push --tags`. CI builds and
  attaches installers to a draft GitHub Release. Publish manually after a
  smoke test of the downloaded installer.

### Nice-to-have before tag (your call)
- [ ] **Intel Mac** in the CI matrix (`x86_64-apple-darwin`) — one-line
  addition, doubles macOS coverage.
- [ ] **Smaller Linux/Windows Ollama variant** (rocm-only, ~280 MB instead
  of 1.3-1.4 GB) — sacrifices NVIDIA support, but huge installer-size win.

### Explicitly skipped for v1.0
These were originally on the v1 list but parked with reason:
- ~~Code signing~~ — costs $99/year (Apple) + $200-500/year (Windows EV).
  The unsigned-app warning is well-documented in the README for now.
- ~~Auto-updater~~ — GitHub Releases is the distribution channel; users
  re-download to update. Add in v1.x if traction warrants the engineering.
- ~~Image editor~~ — pushed to v1.1 or later. Separate, large feature.
- ~~Cookbook (heavy variant)~~ — the slim, Ollama-only version we built
  is what makes sense for v1; "hardware-aware model serving with multiple
  backends" was over-scoped.

---

## After v1.0.0 — known polish items
Captured here so they're not forgotten:

- Pause/resume in chat is render-side only — works fine but a true
  abort-and-continue would feel cleaner. Low priority.
- Background pulls in Cookbook (right now navigating away cancels)
- MB/s + ETA on the Cookbook progress bar
- Streaming progress for the model-install panel that survives reloads
- Pre-existing lint warnings in two deep-link `useEffect`s
  (chat-shell.tsx, documents/page.tsx) — `react-hooks/set-state-in-effect`
- Stats page could plot trends over time
- Compare page: per-model token cost
- Onboarding tour (after first chat) showing the rest of the sidebar

---

## How to ship from here

```bash
# 1. Verify locally (done by Claude during the AFK session)
cd apps/api && .venv/bin/pytest          # 81 passing
cd apps/web && npm run build              # clean

# 2. Verify desktop bundle on Windows (only you can do this)
#    On Windows: pnpm/npm install, fetch Ollama, build sidecar, then:
#    cd apps/desktop && npm run tauri build

# 3. Take screenshots (open the Tauri app and capture)

# 4. Update README to reference screenshots under docs/screenshots/

# 5. Choose license — add LICENSE file at repo root

# 6. Tag and push — CI builds & uploads
git tag v1.0.0
git push --tags

# 7. Smoke-test downloaded installers, then publish the draft release.
```

See [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) for the decisions I made during
the AFK build session — review and override anything you disagree with.
