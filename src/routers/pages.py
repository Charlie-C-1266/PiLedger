"""SPA shell + PWA assets.

Serves the built single-page app for the in-app routes (gated behind a session,
redirecting to /login otherwise) plus the public PWA manifest and icons. No
business logic — just static delivery of the frontend build.
"""

import os
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Response
from fastapi.responses import FileResponse, RedirectResponse

from constants import SESSION_COOKIE, STATIC_DIR
from auth import session_uid

router = APIRouter()

_DIST_DIR = os.path.join(STATIC_DIR, "dist")
_DIST_INDEX = os.path.join(_DIST_DIR, "index.html")

# PWA icons live in the Vite build output (frontend/public/ → dist/). Served at
# stable root paths the manifest references; a fixed whitelist avoids any path
# traversal via the {name} segment.
_PWA_ICONS = frozenset({"icon-192.png", "icon-512.png", "icon-512-maskable.png"})


def _serve_spa(session: Optional[str]) -> Response:
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    if not os.path.isfile(_DIST_INDEX):
        raise HTTPException(
            503,
            "Frontend not built. Run: cd frontend && npm ci && npm run build",
        )
    return FileResponse(_DIST_INDEX)


@router.get("/")
def root(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    return _serve_spa(session)


@router.get("/overview")
@router.get("/accounts")
@router.get("/transactions")
@router.get("/goals")
@router.get("/settings")
def spa_routes(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    return _serve_spa(session)


# PWA manifest + icons are public (no auth): the OS fetches them to install the
# app, and they're referenced from the login page too. 404 until the frontend
# is built, mirroring the SPA's missing-dist behaviour.
@router.get("/manifest.json", include_in_schema=False)
def manifest() -> FileResponse:
    path = os.path.join(_DIST_DIR, "manifest.json")
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path, media_type="application/manifest+json")


@router.get("/icons/{name}", include_in_schema=False)
def pwa_icon(name: str) -> FileResponse:
    if name not in _PWA_ICONS:
        raise HTTPException(404)
    path = os.path.join(_DIST_DIR, "icons", name)
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path, media_type="image/png")
