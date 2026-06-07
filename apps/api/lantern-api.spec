# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the Lantern API sidecar.
# Build with: pyinstaller lantern-api.spec
#
# Output: dist/lantern-api/   — a directory containing the launcher exe and
# its dependencies (the --onedir layout). The desktop app bundles this whole
# directory as a Tauri resource, so cold start is ~2-3s instead of the
# ~15-18s self-extract a --onefile build incurs every launch.

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        # FastAPI / Starlette internals that PyInstaller misses
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'starlette.responses',
        'starlette.background',
        'starlette.exceptions',
        'starlette.concurrency',
        'starlette.datastructures',
        # Uvicorn internals
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # httpx
        'httpx',
        'anyio',
        'anyio.abc',
        # pydantic
        'pydantic',
        'pydantic.v1',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

# Note: exclude_binaries=True keeps the launcher exe small; the libs go into
# COLLECT, which produces the dist/lantern-api/ directory we ship.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='lantern-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='lantern-api',
)
