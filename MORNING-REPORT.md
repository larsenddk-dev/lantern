# 🏮 Lantern — overnight report (2026-06-05 → 06)

Good morning. Here's exactly what happened while you slept, what's verified,
and what's left.

## TL;DR
The **functional core of v1 took a big leap** and is all on GitHub
(`origin/main`): Memory, **RAG** (semantic retrieval wired into chat), an
**Agent** with tools, and **Compare**. Everything is tested (35 passing) and the
web build is clean. A cross-platform desktop **build CI** (incl. the Windows
`.exe` path) and a PWA manifest are in place.

"Full v1, everything done" did **not** fully land — partly because the repo
folder got iCloud-evicted mid-session (blocking all builds/commits for a
while; now recovered), and partly because Email/Calendar/signing genuinely
need *you* (credentials/certificates), as flagged up front.

## Shipped tonight (committed + pushed)
| Feature | What it does | Tests |
|---|---|---|
| **Memory** | Remembered facts (CRUD, pin); pinned always injected into chat | 27 |
| **RAG foundation** | Embeddings + cosine retrieval over memories & documents; auto-injected as chat context; degrades gracefully with no embedding provider | 30 |
| **Compare** | One prompt → N models side by side; per-target error capture | 32 |
| **Agent + tools** | Tool-calling loop: knowledge search (RAG), list notes/tasks, safe AST calculator | 35 |
| **Desktop build CI** | GitHub Actions matrix (mac/win/linux) → `.dmg`/`.exe`+`.msi`/`.AppImage` via tauri-action + PyInstaller sidecar | — |
| **PWA manifest** | Installable from the browser too | — |

All offline tests (no network/secrets) pass: **35/35**. `next build` clean (13
routes). The Agent route also answered **live 200** against your Groq provider.

## v0.1 shell — complete
Chat · Agent · Compare · Documents · Notes · Tasks · Memory · Settings — every
one is functional and persisted in SQLite.

## What I could NOT finish (and why)
- **Email (IMAP/SMTP)** and **Calendar (CalDAV)** — require your account
  credentials. I deliberately did not build credential-entry (secrets are yours
  to handle). Parked.
- **Cookbook (model serving)** and **image editor** — heavy; not one-night work.
- **Code signing / notarization** for installers — needs certificates in repo
  secrets. The CI builds unsigned artifacts until then.
- A stretch of the night was lost to an **iCloud eviction** of
  `~/Desktop/minai`: the folder went "dataless" so file *contents* couldn't be
  read (git/build/edits all failed with EPERM). It has since recovered.

## Recommended: get the repo off iCloud
`~/Desktop` is iCloud-synced, which caused the eviction and a `.next` lock.
Move the repo to a non-synced path to avoid a repeat:
```bash
mv ~/Desktop/minai/lantern ~/dev/lantern   # example
```

## How to run it
```bash
# backend
cd apps/api && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8000
# frontend (separate terminal)
cd apps/web && npm install && npm run dev
# tests
cd apps/api && .venv/bin/pytest          # 35 passing
```
For Memory/RAG and Compare/Agent to use a real model, set a provider (and, for
RAG indexing, an embeddings-capable provider) in **Settings**, then click
**Re-index** on the Memory page.

## Windows `.exe`
Push a tag (`git tag v0.1.0 && git push --tags`) to trigger
`.github/workflows/desktop-build.yml` — it builds Windows `.exe`/`.msi` (plus
mac/linux) and drafts a Release. It's a first-run draft; expect to iterate once
in CI. Code signing is the remaining step.

## Suggested next steps
1. Move the repo off iCloud, `git pull`, verify tests/build.
2. Decide on embeddings provider for RAG (e.g. a free `/embeddings`-capable one,
   or local Ollama embeddings).
3. When you're ready: wire Email/Calendar with your credentials, and run the
   desktop build CI for real installers.
