# Open questions — Wave 7 (bundled Ollama)

Decisions I had to make while you were AFK so I could keep moving. Each
shipped with a sensible default; flagging them here so you can override
when you're back.

## 1. Ollama version pin → `0.30.6`
**Where:** `apps/desktop/scripts/fetch-ollama.py`
**Default:** Pinned to whatever was current when I built (v0.30.6 — same as
your local install).
**Rationale:** Reproducible builds. Pinning means a CI run today and one in
six months produce identical Ollama versions. Bumping is a one-line change.
**Override:** Edit `OLLAMA_VERSION` in the script and re-run CI.

## 2. Bundle full Ollama archive (~1.4GB on Windows/Linux)
**Where:** `apps/desktop/scripts/fetch-ollama.py` → `_archive_url()`
**Default:** Use `ollama-windows-amd64.zip` (1.4 GB) and `ollama-linux-amd64.tar.zst`
(1.3 GB). These include CUDA libs for NVIDIA GPU acceleration.
**Tradeoff:** Big installer (~1.6 GB total on Windows) but GPU works out of
the box. Alternatives: ROCm-only variants (~280 MB) sacrifice NVIDIA users;
CPU-only doesn't exist as a separate archive.
**Override:** Switch the URL strings to the rocm or smaller variants if you
want a smaller download.

## 3. Models live in app data dir, not `~/.ollama`
**Where:** `apps/desktop/src-tauri/src/lib.rs` → `spawn_ollama()`
**Default:** `OLLAMA_MODELS = <app data dir>/ollama-models`. On macOS that's
`~/Library/Application Support/com.lantern.app/ollama-models/`.
**Rationale:** Cleanly isolated from a separately-installed Ollama, and
uninstalling Lantern can later remove its own models.
**Tradeoff:** Power users with an existing `ollama pull`-ed model library
will need to re-download them in Lantern's directory. A symlink works as a
workaround until we add an explicit "share with system Ollama" toggle.

## 4. Step aside if user already has Ollama on :11434
**Where:** `apps/desktop/src-tauri/src/lib.rs` → setup hook
**Default:** Before spawning bundled Ollama we TCP-check port 11434. If
something already answers, we skip our spawn and let Cookbook talk to the
user's existing daemon.
**Why:** Two daemons can't bind the same port, and starting and immediately
crashing would look like a Lantern bug. This way both states "fresh user"
and "Ollama power-user" Just Work.

## 5. First-launch wait on macOS (~30-45s)
**Where:** Inherent to macOS Gatekeeper, not our code.
**What happens:** First time the user launches the unsigned `.app`,
Gatekeeper scans every file in the bundle (now ~500 MB with Ollama) and
verifies hashes. After that, launches are sub-2s.
**Fix:** Apple Developer ID + notarization ($99/year). Parked until you
decide. In the meantime I should add a splash screen explaining the wait —
flagged as a v1 polish item.

## 6. Tag the v1?
Not me. Once you've verified the Windows installer with this bundled Ollama
setup, you tag `v1.0.0`. Until then we stay on `main`.

## 7. README + screenshots
Not done yet. Needs the v1 build to actually exist with all the new pieces
working on Windows. I'll write it once you've verified the Windows side.

## 8. Linux ARM (Raspberry Pi etc.)
**Default:** Script supports `linux-arm64`. CI matrix does NOT build it
(only `ubuntu-latest` x86_64). Adding aarch64 Linux to CI requires either
a self-hosted runner or QEMU emulation. Parked unless someone asks.

## 9. Intel Mac
**Default:** The `Ollama-darwin.zip` is a universal binary, so Intel Mac
users get Ollama support automatically. CI matrix only builds for
`aarch64-apple-darwin` though. Adding `x86_64-apple-darwin` is one matrix
entry. Worth doing for v1.0 distribution? Defer to you.
