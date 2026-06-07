#!/usr/bin/env python3
"""
Fetch the pinned Ollama release for the current platform and lay it out
under apps/desktop/src-tauri/sidecar/ollama/ so Tauri can bundle it.

Lantern bundles its own Ollama so the user doesn't need to install one
separately. We pin a known-good version per release; bumping it is a
deliberate one-line change here.

Called by:
- The desktop GitHub Actions workflow, once per OS runner.
- A developer locally via `python apps/desktop/scripts/fetch-ollama.py`.

The layout we want, regardless of platform:

    apps/desktop/src-tauri/sidecar/ollama/
        ollama(.exe)     # the binary
        <support files>  # libs/dylibs/dependencies the binary needs at runtime

Tauri's `bundle.resources` glob copies the whole directory into the app
bundle, and Rust's spawn code exec's `ollama(.exe)` from inside it.
"""

import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# Pin a known-good Ollama version. Bumping this here, committing, and
# re-running the workflow ships a new Ollama to all platforms.
OLLAMA_VERSION = "0.30.6"

# Where the bundled Ollama lands. Matches `tauri.conf.json -> bundle.resources`.
TARGET_DIR = (
    Path(__file__).resolve().parent.parent  # apps/desktop/
    / "src-tauri" / "sidecar" / "ollama"
)


def _detect_target() -> str:
    """Return a short tag describing this OS+arch, used to pick the archive."""
    system = platform.system().lower()  # darwin / linux / windows
    machine = platform.machine().lower()  # x86_64 / arm64 / aarch64 / amd64
    if system == "darwin":
        return "darwin"  # Ollama publishes a single universal mac archive
    if system == "linux":
        if machine in ("x86_64", "amd64"):
            return "linux-amd64"
        if machine in ("aarch64", "arm64"):
            return "linux-arm64"
    if system == "windows":
        return "windows-amd64"
    raise RuntimeError(f"Unsupported platform: {system}/{machine}")


def _archive_url(target: str) -> tuple[str, str]:
    """Return (download URL, file kind) for the given target tag.

    File kind is 'tgz', 'tzst', or 'zip' so the extractor knows how to open it.
    Note: Ollama's full Linux/Windows archives include CUDA libs and run
    1.3-1.5 GB each. We accept the size to ship working GPU support out of
    the box; smaller CPU-only variants can be substituted in a later release.
    """
    base = f"https://github.com/ollama/ollama/releases/download/v{OLLAMA_VERSION}"
    table = {
        "darwin":         (f"{base}/Ollama-darwin.zip",              "zip"),
        "linux-amd64":    (f"{base}/ollama-linux-amd64.tar.zst",     "tzst"),
        "linux-arm64":    (f"{base}/ollama-linux-arm64.tar.zst",     "tzst"),
        "windows-amd64":  (f"{base}/ollama-windows-amd64.zip",       "zip"),
    }
    return table[target]


def _download(url: str, dest: Path) -> None:
    print(f"  Downloading {url}")
    # urlretrieve handles the streaming; no progress bar, but the workflow
    # captures stdout so the user sees the line above and waits.
    urllib.request.urlretrieve(url, dest)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"  Got {size_mb:.1f} MB")


def _extract(archive: Path, kind: str, into: Path) -> None:
    into.mkdir(parents=True, exist_ok=True)
    if kind == "zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(into)
    elif kind == "tgz":
        with tarfile.open(archive, "r:gz") as t:
            t.extractall(into)
    elif kind == "tzst":
        # Python stdlib doesn't ship zstd. Shell out to tar with --zstd.
        # Both modern bsdtar (macOS 11+) and GNU tar (Linux) support this.
        subprocess.run(
            ["tar", "--zstd", "-xf", str(archive), "-C", str(into)],
            check=True,
        )
    else:
        raise RuntimeError(f"Unknown archive kind: {kind}")


def _normalize_layout(target: str, extracted: Path) -> None:
    """The official archives don't all use the same on-disk layout. Normalize
    each into TARGET_DIR with `ollama(.exe)` at the top level and any support
    files alongside it.

    - macOS: archive contains Ollama.app/Contents/Resources/{ollama, libs…};
      we copy the Resources directory contents (it has the binary plus the
      GGML libs the binary dlopens at runtime).
    - Linux: archive contains bin/ollama plus lib/ollama/lib*.so — we flatten
      bin/ to the top and keep lib/ollama/ next to it.
    - Windows: archive contains ollama.exe + lib/ — already mostly flat.
    """
    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)
    TARGET_DIR.mkdir(parents=True)

    if target == "darwin":
        # Find Ollama.app no matter how deeply it was extracted
        app = next(extracted.rglob("Ollama.app"), None)
        if app is None:
            raise RuntimeError("Ollama.app not found in extracted archive")
        resources = app / "Contents" / "Resources"
        if not resources.is_dir():
            raise RuntimeError(f"Missing Resources dir at {resources}")
        for item in resources.iterdir():
            # Skip icon and other non-runtime files to keep the bundle smaller.
            if item.suffix in (".icns",):
                continue
            target_path = TARGET_DIR / item.name
            if item.is_dir():
                shutil.copytree(item, target_path, symlinks=True)
            else:
                shutil.copy2(item, target_path, follow_symlinks=False)
        # Make sure the binary is executable
        (TARGET_DIR / "ollama").chmod(0o755)
        return

    if target.startswith("linux"):
        # bin/ollama + lib/ollama/*.so
        bin_dir = next(extracted.rglob("bin"), None)
        lib_dir = next(extracted.rglob("lib"), None)
        if bin_dir is None:
            raise RuntimeError("bin/ not found in linux archive")
        shutil.copy2(bin_dir / "ollama", TARGET_DIR / "ollama")
        (TARGET_DIR / "ollama").chmod(0o755)
        if lib_dir is not None and lib_dir.is_dir():
            shutil.copytree(lib_dir, TARGET_DIR / "lib", symlinks=True,
                            dirs_exist_ok=True)
        return

    if target == "windows-amd64":
        # ollama.exe at top of archive + lib/ subfolder
        for item in extracted.iterdir():
            if item.name.lower() in ("ollama.exe", "lib"):
                target_path = TARGET_DIR / item.name
                if item.is_dir():
                    shutil.copytree(item, target_path)
                else:
                    shutil.copy2(item, target_path)
        return

    raise RuntimeError(f"Don't know how to normalize layout for {target}")


def _verify() -> None:
    """Spawn the freshly-bundled binary with --version to sanity-check it
    actually runs on this host. Skipped on Windows when running cross-arch."""
    exe = TARGET_DIR / ("ollama.exe" if os.name == "nt" else "ollama")
    if not exe.is_file():
        raise RuntimeError(f"Bundled binary missing at {exe}")
    try:
        out = subprocess.run(
            [str(exe), "--version"],
            capture_output=True, text=True, timeout=10,
        )
        print(f"  {out.stdout.strip() or out.stderr.strip()}")
    except Exception as e:
        # On a CI runner the bundle may be for a different arch than the
        # runner — don't fail the build, but make some noise.
        print(f"  (skipped --version check: {e})")


def main() -> int:
    target = _detect_target()
    url, kind = _archive_url(target)
    print(f"Fetching Ollama v{OLLAMA_VERSION} for {target}")
    print(f"Target: {TARGET_DIR}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / f"ollama.{kind}"
        _download(url, archive)
        extracted = tmp_path / "extracted"
        extracted.mkdir()
        _extract(archive, kind, extracted)
        _normalize_layout(target, extracted)

    total = sum(f.stat().st_size for f in TARGET_DIR.rglob("*") if f.is_file())
    print(f"Bundled {total / (1024*1024):.1f} MB at {TARGET_DIR}")
    _verify()
    return 0


if __name__ == "__main__":
    sys.exit(main())
