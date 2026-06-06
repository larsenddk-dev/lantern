Artifacts:
- apps/api/dist/lantern-api.exe (~20 MB)
- apps/desktop/src-tauri/binaries/lantern-api-x86_64-pc-windows-msvc.exe (~21 MB)
- apps/web/out/ (static export, 127.0.0.1:8000 baked)
- apps/desktop/src-tauri/target/release/lantern-desktop.exe (4.8 MB)
- apps/desktop/src-tauri/target/release/bundle/msi/Lantern_0.1.0_x64_en-US.msi (22.55 MB)
- apps/desktop/src-tauri/target/release/bundle/nsis/Lantern_0.1.0_x64-setup.exe (21.94 MB)
Blocker: app panics on launch (plugins.shell.scope invalid for tauri-plugin-shell 2.3.5).
