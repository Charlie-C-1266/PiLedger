"""Operational + documentation endpoints.

Liveness probe, the auth-gated OpenAPI spec / Swagger / ReDoc, and the public
documentation viewer. No business logic — just process health and docs serving.
"""

import os
import time
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, RedirectResponse

from constants import DOCS_DIR, DOC_SLUGS, SESSION_COOKIE, STATIC_DIR, VERSION
from auth import require_auth, session_uid

router = APIRouter(tags=["ops"])

# Monotonic clock so `/healthz` uptime never goes backwards on a wall-clock
# adjustment. Captured at import time, which (since app.py imports the routers
# during startup) is effectively process start.
_BOOT_MONOTONIC = time.monotonic()


@router.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    """Liveness + version probe for uptime monitors and the Docker healthcheck.

    Deliberately unauthenticated — uptime monitors (Uptime Kuma,
    Healthchecks.io, kube probes) need to poll without holding a session,
    and the response carries no sensitive information beyond the version
    string. Returns `uptime_s` as an int so log scrapers don't have to
    handle floats."""
    return {
        "ok": True,
        "version": VERSION,
        "uptime_s": int(time.monotonic() - _BOOT_MONOTONIC),
    }


@router.get("/api/openapi.json", include_in_schema=False)
def openapi_schema(request: Request, uid: int = Depends(require_auth)) -> dict:
    """Auth-gated OpenAPI spec. The default `/openapi.json` is disabled in
    the FastAPI constructor; this replacement is fed to the gated Swagger /
    ReDoc UIs below. `request.app.openapi()` is FastAPI's spec-builder method
    and works regardless of whether the default route is mounted — reached via
    `request.app` so this router never has to import `app`."""
    return request.app.openapi()


@router.get("/docs", include_in_schema=False)
def swagger_ui(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    """Swagger UI for logged-in users; redirects to /login for everyone else.

    Mirrors the behaviour of `GET /` rather than 401-ing — a browser user
    hitting /docs sees a familiar login page, not a JSON error blob."""
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title="PiLedger API docs",
    )


@router.get("/redoc", include_in_schema=False)
def redoc_ui(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    """ReDoc for logged-in users; redirects to /login for everyone else."""
    if not session_uid(session):
        return RedirectResponse("/login", status_code=302)
    return get_redoc_html(
        openapi_url="/api/openapi.json",
        title="PiLedger API docs",
    )


@router.get("/guide", include_in_schema=False)
def guide_page() -> FileResponse:
    """Public documentation viewer — accessible without authentication."""
    return FileResponse(os.path.join(STATIC_DIR, "guide.html"))


@router.get("/api/docs/{slug}", include_in_schema=False)
def get_doc(slug: str) -> FileResponse:
    """Serve a raw markdown doc file by slug. Public — no auth required.

    The slug is validated against a fixed allowlist to prevent path traversal.
    Returns text/markdown so the frontend can parse it client-side."""
    if slug not in DOC_SLUGS:
        raise HTTPException(404, "Document not found")
    path = os.path.join(DOCS_DIR, f"{slug}.md")
    if not os.path.isfile(path):
        raise HTTPException(404, "Document not found")
    return FileResponse(path, media_type="text/markdown")
