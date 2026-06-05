"""
Lantern API sidecar entrypoint — used by PyInstaller.

Runs the FastAPI app via uvicorn programmatically so it can be packaged
as a single-file binary by PyInstaller (--onefile).

The sidecar listens on port 8000 by default; set LANTERN_API_PORT to override.
LANTERN_WEB_ORIGIN can be set to restrict CORS (defaults to Tauri localhost).
"""

import os
import sys

# When running as a PyInstaller bundle, adjust the working directory so that
# relative paths in main.py (e.g. data/ for SQLite) resolve correctly.
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle — set cwd to the binary's directory
    # so that data/ is created next to the binary (or inside the app bundle).
    os.chdir(os.path.dirname(sys.executable))

import uvicorn
from main import app  # noqa: E402 — must come after sys.path setup

if __name__ == "__main__":
    port = int(os.environ.get("LANTERN_API_PORT", "8000"))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )
