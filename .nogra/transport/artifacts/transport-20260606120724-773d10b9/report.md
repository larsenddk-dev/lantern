# Run Report — Lantern Windows desktop installer build

## Outcome: partial — installers built; app-launch blocked by a pre-existing, out-of-scope config bug

## Execution note
The dispatched executor (Executor · Sonnet, background) stalled at its turn limit (~2.7 min, 26 tool calls) while polling a long Rust/Tauri compile; its background build was killed when the subagent exited (a subagent cannot outlive its turn budget for a multi-minute build). Manager completed the remaining build as a persistent main-session background task (recovery), preserving the approved scope and stop criteria.

## Built & verified
- [SC1 OK] Sidecar apps/api/dist/lantern-api.exe (~20 MB, PyInstaller onefile) serves /health -> 200 {"status":"ok","service":"lantern-api"} standalone.
- [SC2 OK] Sidecar copy apps/desktop/src-tauri/binaries/lantern-api-x86_64-pc-windows-msvc.exe (~21 MB).
- [SC3 OK] Static export apps/web/out/index.html rebuilt with NEXT_PUBLIC_LANTERN_API_URL=http://127.0.0.1:8000 baked (default localhost risked IPv6 ::1 vs the IPv4-only sidecar).
- [SC4 OK] Installers via tauri build: bundle/msi/Lantern_0.1.0_x64_en-US.msi (22.55 MB, WiX) and bundle/nsis/Lantern_0.1.0_x64-setup.exe (21.94 MB, NSIS).
- [SC6 OK] Backend pytest 37/37 green. No secrets bundled (PyInstaller spec datas=[]; only the non-secret API URL string baked into the web assets).

## Build-environment fixes (build-invocation only; no system changes, nothing installed)
- Built from a VS Developer Shell (VS 18 / MSVC 14.50). The pre-flagged 'Git link.exe shadows MSVC' risk did NOT occur — cargo used the real MSVC linker.
- LNK1181 'legacy_stdio_definitions.lib' not found: this MSVC 14.50 toolset ships that CRT shim only under lib\onecore\x64, not lib\x64. Appended lib\onecore\x64 to LIB for the build invocation only.

## Blocker — SC5 (app launches + renders natively): FAILED
The built app target/release/lantern-desktop.exe launches then panics immediately (captured via redirected stderr):
  thread 'main' panicked at src/lib.rs:15: error while running tauri application: PluginInitialization("shell", "Error deserializing 'plugins.shell' within your Tauri configuration: unknown field `scope`, expected `open`")
Root cause: tauri.conf.json plugins.shell contains scope (and sidecar) fields that tauri-plugin-shell v2.3.5 does not accept; Tauri v2 moved sidecar permissions to the capabilities system. The config is compiled into the binary via generate_context!(), so the INSTALLED app crashes identically. Pre-existing since Phase 3a (which verified compile + standalone sidecar but never launched the window — the 'open visual check' was always pending). There is also no capabilities/ directory.

## Deviation / decision required
Fix: remove plugins.shell.scope and plugins.shell.sidecar from tauri.conf.json (keep "open": false). No capability file is required because the sidecar is spawned Rust-side in setup(), which is not gated by the webview permission system; the Lantern UI reaches the sidecar via plain browser fetch, also un-gated. This is a tauri.conf.json edit, OUTSIDE the approved build-only scope (which scoped out app/config edits). Manager did NOT apply it. Recommend a small follow-up: fix + rebuild + re-run the launch smoke test.

## Next Owner: Manager -> user decision (approve the config fix + rebuild?)
