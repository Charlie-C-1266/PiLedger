"""PiLedger — self-hosted finance dashboard.

Money is stored as integer cents in SQLite; the JSON API exposes plain
floating-point dollars to keep the frontend contract unchanged.

This is the thin wiring module: it constructs the FastAPI app, registers the
middleware and the 422→400 validation handler, runs init(), and includes every
router. No HTTP handlers live here. Supporting code lives in:
    routers/     — one APIRouter per resource (the HTTP handlers)
    services/    — business logic shared across routers (currency, accounts)
    limiter.py   — the shared rate limiter (kept separate to avoid an app cycle)
    constants.py — bounds, type aliases, cookie + path settings
    db.py        — connection, schema init/migrations, money helpers
    auth.py      — password hashing, sessions, require_auth dependency
    schemas.py   — Pydantic request/response models
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from constants import (
    STATIC_DIR,
    VERSION,
)
from db import (
    init,
)
from security import SecurityHeadersMiddleware
from limiter import limiter

from routers import auth as auth_router
from routers import (
    accounts,
    budget,
    categories,
    dashboard,
    goals,
    ops,
    pages,
    prefs,
    rates,
    transactions,
)


# `docs_url=None` / `redoc_url=None` / `openapi_url=None` disable FastAPI's
# default unauthenticated mounts. The replacements below (`/docs`, `/redoc`,
# `/api/openapi.json`) all gate on the session cookie, so an anonymous scanner
# cannot fingerprint the API surface — only logged-in users see Swagger /
# ReDoc. This matches the P0-10 design (path 2: gate rather than fully
# disable, because self-hosters routinely log in to inspect their own API).
app = FastAPI(
    title="PiLedger",
    version=VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)
init()


# Pydantic validation failures default to 422, but the public contract documented
# in README + CHANGELOG returns 400 for bad input. Translate them so callers see
# the documented status code.
@app.exception_handler(RequestValidationError)
def _validation_to_400(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Re-emit Pydantic's 422 validation errors as 400 to match the documented
    public contract, with the error payload coerced to a JSON-safe shape."""
    # Pydantic puts the raw exception in `ctx` for model-level validators; that
    # object is not JSON-serializable, so coerce ctx values to strings before
    # returning.
    safe = []
    for err in exc.errors():
        e = dict(err)
        if "ctx" in e and isinstance(e["ctx"], dict):
            e["ctx"] = {k: str(v) for k, v in e["ctx"].items()}
        safe.append(e)
    return JSONResponse(status_code=400, content={"detail": safe})


# ─── API routers ──────────────────────────────────────────────────────────────
#
# Every route lives in a per-resource router under src/routers/. `pages` (the
# SPA shell + PWA assets) is included last so a page route can never shadow an
# API path.
app.include_router(auth_router.router)
app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(dashboard.router)
app.include_router(budget.router)
app.include_router(goals.router)
app.include_router(prefs.router)
app.include_router(rates.router)
app.include_router(categories.router)
app.include_router(ops.router)
app.include_router(pages.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
