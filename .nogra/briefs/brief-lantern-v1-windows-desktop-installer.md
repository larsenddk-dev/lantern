---
schema: nogra.brief.v1
releaseVersion: v1.0.0
briefId: brief-lantern-v1-windows-desktop-installer
workspaceId: lantern
title: "Lantern v1 — Windows desktop installer (.exe/.msi) build"
createdAt: 2026-06-06T12:00:00Z
updatedAt: 2026-06-06T12:06:18.221Z
status: ready
owner: ""
targetRole: ""
targetModel: anthropic:sonnet
evidenceRequired: verified
---

# Lantern v1 — Windows desktop installer (.exe/.msi) build

## Intent

Produce a working Lantern Windows desktop installer (.exe via NSIS and/or .msi via WiX) on this Windows host from the existing Tauri v2 + Python FastAPI sidecar architecture, so Lantern installs and runs natively on Windows. This realizes the locked decision to ship Lantern as a desktop app, now that the build is finally possible on a Windows machine.

## Context Handoff

Repo: C:/Users/larse/Desktop/pew (workspace Lantern, branch main, synced to origin/main 42bbf4b). Verified this session: backend pytest 37/37 green; web `next build` clean (13 routes); Rust 1.95 (cargo+rustc) installed; Node 24; Python 3.11.9 (Windows venv at apps/api/.venv, Scripts/python.exe — note `python` on PATH is the dead MS Store alias; use the venv python or the `py` launcher); .env present at repo root; apps/web/node_modules installed. NOT yet done: PyInstaller is not in apps/api/.venv; apps/desktop/node_modules is missing; apps/desktop/src-tauri/binaries/ does not exist (it was built on Mac and is gitignored). Key files: apps/api/lantern-api.spec is cross-platform (onefile, console=True) and yields dist/lantern-api.exe on Windows; apps/api/run.py binds 127.0.0.1:8000 (LANTERN_API_PORT override) and is PyInstaller-frozen-aware (chdir to exe dir); apps/desktop/src-tauri/tauri.conf.json has externalBin ["binaries/lantern-api"] which Tauri resolves on Windows to binaries/lantern-api-x86_64-pc-windows-msvc.exe, bundle.targets "all" with an .ico icon (-> NSIS .exe + WiX .msi), frontendDist ../../web/out; apps/web/next.config.ts already has output:'export' + images.unoptimized + trailingSlash (static export to apps/web/out/ is configured); apps/desktop/package.json scripts: dev=`tauri dev`, build=`tauri build`, devDep @tauri-apps/cli ^2.5.0. Risks: Git's link.exe (C:/Program Files/Git/usr/bin/link.exe) is first on PATH and can shadow the MSVC linker during the Rust build; WebView2 runtime was not confirmed via registry (Windows 11 normally bundles the Evergreen runtime). Note: apps/web/AGENTS.md says this Next.js has breaking changes — read node_modules/next/dist/docs/ before editing any web code (this brief is build-only and should avoid web code edits).

## Decisions

- Ship Lantern as a desktop app (Tauri v2 + Python sidecar) — locked in .nogra/state/DECISIONS.md.
- Build only on this Windows host this pass; no code signing/notarization (no certificate).
- Keep the PyInstaller --onefile sidecar for now; the --onedir cold-start speedup is deferred.

## Rejected

- Installing Visual Studio C++ Build Tools or the WebView2 runtime system-wide as part of this run (requires explicit user approval).
- Code signing / notarization this pass (no certificate available).

## Known Gaps

- WebView2 runtime presence not yet confirmed via registry; Win11 usually bundles the Evergreen runtime, but a render failure could trace to a missing runtime.
- MSVC linker presence is inferred from the working Rust install, not directly verified; the first pre-flight check covers it.

## Scope

In:

- PRE-FLIGHT FIRST ACTION: run `rustc -vV` and a trivial cargo build/check; confirm host triple is x86_64-pc-windows-msvc and the MSVC linker resolves. If not, stop blocked (see stop criteria) — do not install build tools.
- Install PyInstaller into apps/api/.venv (venv pip), then build the sidecar from apps/api with `pyinstaller lantern-api.spec` -> dist/lantern-api.exe.
- Verify dist/lantern-api.exe standalone: start it, GET http://127.0.0.1:8000/health expecting HTTP 200, then stop it.
- Create apps/desktop/src-tauri/binaries/ and copy dist/lantern-api.exe to binaries/lantern-api-x86_64-pc-windows-msvc.exe.
- Build the Next static export from apps/web with NEXT_PUBLIC_LANTERN_API_URL=http://127.0.0.1:8000 set, via npm run build -> apps/web/out/ (index.html present, API URL baked).
- Run npm install in apps/desktop, then npm run build (tauri build) -> installer bundles under apps/desktop/src-tauri/target/release/bundle/ (NSIS .exe and/or WiX .msi).
- Smoke-verify: confirm the bundle artifact(s) exist and report their paths/sizes; launch the built Lantern app (or `npm run dev`) and confirm the window renders the UI and the sidecar answers /health. Final visual native-render sign-off is left to the user.

Out:

- Code signing / notarization (no certificate).
- Validating the GitHub Actions desktop-build.yml via a pushed tag.
- macOS and Linux builds.
- Installing system-level toolchains (VS C++ Build Tools, WebView2 runtime, or WiX/NSIS beyond what the Tauri CLI auto-fetches) without explicit user approval.
- Editing Lantern application features or Next.js app code — this is a build-only pass; touch config only if the static export strictly requires it.

Files:

- apps/api/lantern-api.spec (read — PyInstaller build input)
- apps/api/run.py (read — sidecar entrypoint, port 8000)
- apps/api/.venv/ (pip install pyinstaller)
- apps/api/dist/lantern-api.exe (NEW — build artifact, gitignored)
- apps/desktop/src-tauri/binaries/lantern-api-x86_64-pc-windows-msvc.exe (NEW — copied sidecar, gitignored)
- apps/desktop/src-tauri/tauri.conf.json (read — externalBin/bundle config)
- apps/desktop/package.json (npm install + npm run build)
- apps/web/next.config.ts (read — output:'export' already set)
- apps/web/out/ (NEW — static export output, gitignored)
- apps/desktop/src-tauri/target/release/bundle/ (NEW — installer output, gitignored)

## Success Criteria

- dist/lantern-api.exe runs standalone and returns HTTP 200 on /health (evidence: command output).
- apps/desktop/src-tauri/binaries/lantern-api-x86_64-pc-windows-msvc.exe exists (the copied sidecar binary).
- apps/web/out/index.html is produced by the static export build with the sidecar API URL baked in.
- tauri build completes and emits at least one installer bundle (.exe via NSIS and/or .msi via WiX) under apps/desktop/src-tauri/target/release/bundle/, with exact path(s) reported.
- The built Lantern app launches and renders the UI natively (window opens with the nav shell) and the sidecar is reachable on /health.
- Backend pytest is still 37/37 green and no provider keys/secrets or .env are bundled into the artifacts.

## Stop Criteria

- FIRST-ACTION PRE-FLIGHT: if `rustc -vV` host is not x86_64-pc-windows-msvc, or a trivial cargo build fails with a linker/MSVC error, status: blocked, reason: MSVC build tools missing — do NOT install Visual Studio C++ Build Tools or modify the system; report and stop.
- If `pyinstaller lantern-api.spec` exits non-zero, or dist/lantern-api.exe does not serve /health 200, status: blocked — do not rewrite the spec beyond Windows path/name necessities; report the failure and the PyInstaller output.
- If `tauri build` fails specifically because Git's link.exe (C:/Program Files/Git/usr/bin/link.exe) shadows the MSVC linker, fix PATH for that build invocation only (prepend the MSVC bin); do not modify the system PATH permanently.
- If a bundle toolchain download fails (offline/network) for WiX (.msi) or NSIS (.exe), produce whichever bundle succeeds and report the other as not-built; a single missing bundle format is not total failure.
- If the WebView2 runtime is genuinely absent and the window cannot render, status: blocked, reason: WebView2 missing — do not silently install it system-wide without approval; report.
- Any need to install system-level tooling, sign code, or modify anything outside the repo -> stop and report.

## Execution Shape

Tool needs:

- command output (pip/pyinstaller/cargo/tauri build, exit codes)
- file checks (artifact existence + paths/sizes under dist/, binaries/, out/, bundle/)
- standalone local HTTP health check of the sidecar (/health 200)
- launch the built desktop app for a render smoke check (window opens, sidecar reachable)

Notes:

Build/command-heavy brief; evidence is native command output + artifact file checks, plus a local HTTP health probe and a window-launch smoke check. The final visual native-render confirmation is a user step, consistent with prior Lantern checkpoints.

## Max Output

Format: evidence-first state brief: what was built, exact artifact paths and sizes (sidecar exe, binaries copy, web/out, bundle/.exe/.msi), the /health result, the pytest result, and any blocked or partial-bundle outcomes with their cause
Limit: concise opening summary; include all evidence (commands run, exit results, artifact paths) needed to verify the build without re-running it
