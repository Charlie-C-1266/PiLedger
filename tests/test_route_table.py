"""Route-table snapshot — the safety net for the src/app.py → routers refactor.

The split moves each route handler out of app.py into a per-resource APIRouter
one PR at a time. A code-move must not add, drop, or rename any route, so this
test freezes the full set of registered (path, method) pairs and fails loudly
if the surface changes. Update EXPECTED_ROUTES only for a *deliberate* route
change, never to paper over an accidental one during the migration.

HEAD is excluded: FastAPI auto-pairs it with every GET, so tracking it adds
noise without catching anything a GET wouldn't already catch.
"""

import app

# (path, method) pairs. Each @app.get/@router.post/etc. registers one Route, so
# a path serving two verbs appears as two entries. Generated from app.app.routes.
EXPECTED_ROUTES = {
    ("/", "GET"),
    ("/accounts", "GET"),
    ("/api/accounts", "GET"),
    ("/api/accounts", "POST"),
    ("/api/accounts/{aid}", "DELETE"),
    ("/api/accounts/{aid}", "PUT"),
    ("/api/accounts/{aid}/balance", "POST"),
    ("/api/accounts/{aid}/history", "GET"),
    ("/api/auth/login", "POST"),
    ("/api/auth/logout", "POST"),
    ("/api/auth/me", "DELETE"),
    ("/api/auth/me", "GET"),
    ("/api/auth/password", "PUT"),
    ("/api/auth/register", "POST"),
    ("/api/categories", "GET"),
    ("/api/categories", "POST"),
    ("/api/categories/{cid}", "DELETE"),
    ("/api/docs/{slug}", "GET"),
    ("/api/export", "GET"),
    ("/api/goals", "GET"),
    ("/api/goals", "POST"),
    ("/api/goals/{gid}", "DELETE"),
    ("/api/goals/{gid}", "PUT"),
    ("/api/history/all", "GET"),
    ("/api/history/networth", "GET"),
    ("/api/openapi.json", "GET"),
    ("/api/prefs", "GET"),
    ("/api/prefs", "PUT"),
    ("/api/projections", "GET"),
    ("/api/rates", "GET"),
    ("/api/rates", "PUT"),
    ("/api/summary", "GET"),
    ("/api/transactions", "GET"),
    ("/api/transactions", "POST"),
    ("/api/transactions/{tid}", "DELETE"),
    ("/api/transactions/{tid}", "PUT"),
    ("/api/transfers", "POST"),
    ("/docs", "GET"),
    ("/goals", "GET"),
    ("/guide", "GET"),
    ("/healthz", "GET"),
    ("/icons/{name}", "GET"),
    ("/login", "GET"),
    ("/manifest.json", "GET"),
    ("/overview", "GET"),
    ("/redoc", "GET"),
    ("/settings", "GET"),
    ("/transactions", "GET"),
}


def _registered_routes() -> set[tuple[str, str]]:
    return {
        (r.path, m)
        for r in app.app.routes
        if getattr(r, "methods", None)
        for m in r.methods
        if m != "HEAD"
    }


def test_route_table_matches_snapshot() -> None:
    assert _registered_routes() == EXPECTED_ROUTES
