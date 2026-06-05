# Lantern Desktop (Tauri)

This is the **desktop shell** for Lantern. It packages the existing web app
into a native, installable desktop application using **Tauri v2**, with the
Python/FastAPI backend running as a **bundled sidecar**.

> **Status:** Phase 3a spike — the architecture is **proven** (Tauri compiles,
> the sidecar serves `/health` standalone, the Next.js static export loads).
> Production installers, code signing, auto-update, tray, and Windows/Linux
> builds are intentionally **out of scope** for this spike (later phase).

## Architecture

```
┌──────────────────────────── Tauri app (native window) ────────────────────────────┐
│                                                                                    │
│   Rust shell (src-tauri/)                                                           │
│   ├─ loads the frontend from  apps/web/out/   (Next.js static export)              │
│   └─ on startup, spawns the sidecar and owns its lifecycle (kills it on exit)      │
│                                                                                    │
│        ▼ spawns                                                                     │
│   lantern-api  (PyInstaller --onefile binary of apps/api, FastAPI + uvicorn)       │
│        listens on 127.0.0.1:8000  ·  serves /chat, /sessions, /providers,          │
│        /notes, /tasks, /health  ·  SQLite stored next to the binary (data/)        │
│                                                                                    │
│   Frontend (static) calls the sidecar over HTTP at NEXT_PUBLIC_LANTERN_API_URL.    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Three pieces, three build outputs:

| Piece | Source | Build output | Wired via |
|---|---|---|---|
| Native shell | `src-tauri/` (Rust) | `target/…/lantern-desktop` | `cargo tauri` |
| Frontend | `apps/web` | `apps/web/out/` (static) | `tauri.conf.json` → `build.frontendDist` |
| Backend sidecar | `apps/api` (`run.py`) | `dist/lantern-api` → `src-tauri/binaries/lantern-api-<triple>` | `tauri.conf.json` → `bundle.externalBin` + `src/lib.rs` |

## Prerequisites

Already present on the dev machine; listed for a fresh setup:

- Node ≥ 20, npm
- Python 3.9+ and the `apps/api` venv (`apps/api/.venv`)
- Rust toolchain (`cargo`, `rustc`) + platform build tools (Xcode CLT on macOS)
- Tauri CLI (`@tauri-apps/cli`, a devDependency here) and **PyInstaller**
  (`pip install pyinstaller` inside `apps/api/.venv`)

## Build & run (dev)

From the repo root, in order:

```bash
# 1. Build the backend sidecar binary (PyInstaller --onefile)
cd apps/api
source .venv/bin/activate
pyinstaller lantern-api.spec            # → apps/api/dist/lantern-api

# 2. Copy it where Tauri expects it, with the target-triple suffix
TRIPLE=$(rustc -vV | sed -n 's/host: //p')   # e.g. aarch64-apple-darwin
mkdir -p ../desktop/src-tauri/binaries
cp dist/lantern-api ../desktop/src-tauri/binaries/lantern-api-$TRIPLE
chmod +x ../desktop/src-tauri/binaries/lantern-api-$TRIPLE

# 3. Build the frontend static export (bakes the API URL in at build time)
cd ../web
NEXT_PUBLIC_LANTERN_API_URL=http://127.0.0.1:8000 npm run build   # → apps/web/out

# 4. Run / build the desktop app
cd ../desktop
npm run dev        # cargo tauri dev — opens the native Lantern window
# or, to produce a debug app bundle:
npm run build -- --debug
```

`npm run dev` uses the live web dev server (`devUrl` = `http://localhost:3001`)
for fast iteration; the packaged app uses the static export in `frontendDist`.

## Findings (Phase 3a spike)

- **Static export is viable.** The web app is client-heavy (`'use client'`) and
  fetches everything from the API over HTTP at runtime, so `output: 'export'`
  works. `next.config.ts` sets `output: 'export'`, `images.unoptimized: true`,
  and `trailingSlash: true` (so `file://` index resolution works).
- **The API base URL is baked at build time.** Because the frontend is static,
  `NEXT_PUBLIC_LANTERN_API_URL` must be set when running `npm run build`, not at
  runtime. Keep the sidecar port consistent with it (default `127.0.0.1:8000`).
- **Sidecar cold start ≈ 15–18 s on first launch.** PyInstaller `--onefile`
  unpacks itself to a temp dir before uvicorn starts, so `/health` is not ready
  immediately. Options for a later phase: switch to PyInstaller `--onedir`
  (much faster start, more files), or show a "starting…" splash while polling
  `/health`.
- **Sidecar binary is per-architecture** and named `lantern-api-<target-triple>`
  (Tauri's `externalBin` convention). It is **gitignored** (large + platform
  specific) and rebuilt via the steps above; cross-platform builds will each
  produce their own.
- **Icons** were generated from the brand logo with
  `npx tauri icon apps/web/public/lantern-logo.png`.
- **Dev port collision:** the app's spawned sidecar binds `127.0.0.1:8000`,
  the same port the web dev API uses. Before `npm run dev` here, **stop the
  standalone dev API** (or set `LANTERN_API_PORT` for one of them) so the
  sidecar can bind. In a packaged app there is no dev server, so no collision.

## Out of scope (later "desktop polish" phase)

Production installers (`.dmg`/`.msi`/`.AppImage`), code signing & notarization,
auto-update, app menu/tray, faster sidecar start, and Windows/Linux builds.
