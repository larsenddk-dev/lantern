---
schema: nogra.brief.v1
releaseVersion: v1.0.0
briefId: brief-lantern-v1-phase-3a-tauri-desktop-spike-prove-packaging-with-python-side-2026-06-05-21afee
workspaceId: lantern
title: "Lantern v1 — Phase 3a: Tauri desktop spike (prove packaging with Python sidecar)"
createdAt: 2026-06-05T15:18:22.865Z
updatedAt: 2026-06-05T15:18:22.911Z
status: ready
owner: ""
targetRole: ""
targetModel: anthropic:sonnet
evidenceRequired: reported
---

# Lantern v1 — Phase 3a: Tauri desktop spike (prove packaging with Python sidecar)

## Intent

De-risk shipping Lantern as a desktop app before building more v1 features. Prove the architecture end to end: a Tauri native shell that loads the Lantern web UI and runs the existing FastAPI backend as a bundled sidecar, with chat/notes/tasks working against that sidecar. This is a spike — the goal is a proven, runnable desktop build and a documented approach, not polished installers or auto-update.

## Context Handoff

Lantern is a Next.js (apps/web) + Python FastAPI (apps/api) monorepo; Phases 1, 2a, 2b are done and verified (chat, multi-provider, notes, tasks, all SQLite-backed). Direction is now: build to v1 AND ship as an installable DESKTOP app via Tauri + a Python sidecar (see .nogra/state/DECISIONS.md — Direction 2026-06-05). Keep Python (it is best for the later AI roadmap: RAG, agents, Cookbook model-serving). Toolchain already present on this machine: node v24, npm 11, python3 3.9.6, Rust+cargo 1.95, Xcode CLT, Homebrew. The Tauri CLI and PyInstaller are NOT yet installed — installing them is the explicit subject of this brief (Tauri CLI as a dev tool in the desktop app; PyInstaller into the apps/api venv), so they are in-scope, not surprise deps. The web frontend is client-heavy (most pages are 'use client') and talks to the backend over HTTP at NEXT_PUBLIC_LANTERN_API_URL (default http://localhost:8000), which makes a Next.js static export (output: 'export') the preferred way for Tauri to load the UI; confirm static export is viable and report if it is not. FIRST ACTION: read CLAUDE.md, README.md, apps/web/AGENTS.md, .nogra/state/*, apps/web/next.config.ts, apps/web/package.json, apps/api/main.py and apps/api/requirements.txt before changing anything.

## Decisions

- Desktop strategy is Tauri + Python sidecar (locked); this brief proves it works before more v1 features are built.
- Prefer Next.js static export (output: 'export') loaded by Tauri; only fall back to a Next Node sidecar if static export is proven non-viable, and report that finding.
- Bundle the FastAPI backend as a single-file sidecar binary via PyInstaller and have Tauri launch/own its lifecycle.
- This is a de-risking spike: prove buildability + sidecar + UI load. Do not build installers, auto-update, code signing, tray, or multi-platform packaging yet.

## Rejected

- Electron (heavier) and a pure-JavaScript backend rewrite (loses the Python ecosystem the AI roadmap needs) — already decided against.
- Jumping straight to production installers/signing before the core packaging is proven.

## Known Gaps

- Verifying that a native window actually opens and renders is hard for a headless executor; the executor should prove build/compile success and that the sidecar binary serves /health, and leave the visual 'window opens and shows Lantern' confirmation to the Manager/user via the produced dev build.
- Final installers, code signing, auto-update, app icon/tray, and Windows/Linux builds are out of scope for this spike (later desktop-polish phase).

## Scope

In:

- Add a Tauri app to the monorepo (suggested apps/desktop/ with its src-tauri/ Rust project), wired so `cargo tauri` / the Tauri CLI can build and run it.
- Install the Tauri CLI as a dev tool for the desktop app and PyInstaller into the apps/api venv; record exact versions/commands.
- Package the FastAPI backend (apps/api) as a single-file sidecar binary with PyInstaller, and configure Tauri to launch it as a managed sidecar (start on app launch, stop on exit), serving on a local port.
- Configure the Next.js frontend for desktop: attempt a static export (output: 'export') that Tauri loads as its frontend, with client API calls pointing at the sidecar's local port; if static export is non-viable, document why and implement the minimal viable alternative (e.g. Next as a second sidecar) instead.
- Produce a runnable desktop dev build (e.g. `cargo tauri dev` and/or a debug `cargo tauri build`) in which the Lantern UI loads and chat/notes/tasks work against the sidecar backend.
- Write apps/desktop/README.md (or DESKTOP.md) documenting the architecture, the exact build/run commands, the static-export decision, and any gotchas discovered.
- Update README, .nogra/state/SESSION-CHECKPOINT.md and CURRENT-TASKS.md to record that the desktop spike landed and name the next phase.

Out:

- Production installers, code signing/notarization, auto-update, app icon/tray polish.
- Windows and Linux builds (this spike targets the current macOS dev machine).
- Any new product feature (Documents, Memory/RAG, agents, etc.) — features come in later phases on top of the proven shell.
- Changing existing chat/provider/notes/tasks behavior beyond what is strictly required to load the UI in Tauri and reach the sidecar.
- Refactoring the FastAPI backend to non-Python.

Files:

- apps/desktop/ (NEW — Tauri app: src-tauri/ Rust project, tauri.conf, sidecar config, package.json for the Tauri CLI dev tool)
- apps/web/next.config.ts (EDIT — enable static export / desktop build mode if viable)
- apps/api/ (EDIT — PyInstaller spec/entry or build script for the sidecar binary; requirements/dev note for pyinstaller)
- apps/desktop/README.md or DESKTOP.md (NEW — architecture + build/run docs + findings)
- README.md (EDIT — desktop dev instructions)
- .nogra/state/SESSION-CHECKPOINT.md (EDIT — spike done, name next phase)
- .nogra/state/CURRENT-TASKS.md (EDIT — record spike, queue next)

## Success Criteria

- The repo contains a Tauri desktop app that builds: the Tauri CLI is installed and a debug build/compile of the Tauri Rust shell completes without errors.
- The FastAPI backend is packaged as a runnable sidecar binary via PyInstaller, and running that binary directly serves GET /health with an ok response (no separate venv/python invocation needed).
- Tauri is configured to launch the sidecar on app start and load the Lantern frontend; the frontend build it loads (static export if viable) completes cleanly.
- Running the desktop app in dev (`cargo tauri dev` or equivalent) opens a Lantern window whose chat/notes/tasks operate against the sidecar — evidenced by build/run logs and the sidecar handling requests; the visual window confirmation is handed to the Manager/user.
- apps/desktop documentation explains the architecture, exact build/run commands, the static-export decision (viable or not, with reason), and any gotchas.
- README and .nogra/state files are updated to record the desktop spike and name the next phase.

## Stop Criteria

- First action: read the files listed in context, then verify toolchain: run `node --version`, `npm --version`, `python3 --version`, `cargo --version`, `rustc --version`. If node, python3, or the Rust toolchain (cargo/rustc) is missing, status: blocked, name what is missing, and do not install a language toolchain. (Installing the Tauri CLI and PyInstaller IS in scope; installing Rust/Node/Python is NOT.)
- Keep this a spike: do NOT build production installers, code signing, notarization, auto-update, tray, or Windows/Linux builds.
- Do NOT add product features or change chat/provider/notes/tasks behavior beyond the minimum needed to load the UI in Tauri and reach the sidecar. Keep the existing pytest suite green; if a change would break it, stop and report.
- If static export of the Next.js app is non-viable, do not silently re-architect the whole frontend — implement the minimal documented fallback and report it as a finding for approval before going further.
- If a build step (Tauri compile, PyInstaller, Next build) exits non-zero and cannot proceed cleanly, stop with the exact command output rather than hand-patching a broken toolchain setup.
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
