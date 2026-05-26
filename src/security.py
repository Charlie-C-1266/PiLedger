"""Security-headers middleware.

Sends a sensible set of defensive HTTP response headers on every request:
HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, a
Permissions-Policy disabling browser APIs the dashboard never uses, and a
strict Content-Security-Policy that locks scripts and connections to the
same origin.

The strict CSP (``script-src 'self'`` with no ``'unsafe-inline'``) only
works because every static page has been refactored to load JavaScript from
external files in /static and to use ``data-action`` attributes with
delegated event listeners instead of inline ``onclick=`` handlers. Adding
an inline ``<script>`` block or an ``on*`` attribute to the markup will be
silently blocked by the browser at runtime.

``setdefault`` is used throughout so individual routes can override a
header for a specific response (e.g. swap the Permissions-Policy on a
feature-gated route) without the middleware clobbering them on the way
out.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Headers that apply to every response. Concatenating CSP directives at
# import time (rather than inside the middleware) keeps the hot path
# allocation-free.
_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ]
)

DEFAULT_HEADERS: dict[str, str] = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
    "Content-Security-Policy": _CSP,
    "Cache-Control": "no-cache",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach default security headers to every outgoing response."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        for name, value in DEFAULT_HEADERS.items():
            response.headers.setdefault(name, value)
        return response
