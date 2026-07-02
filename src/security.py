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

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from logging_config import ACCESS_LOGGER_NAME, request_id_var

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
        """Run the request, then fill in any default header the route didn't
        already set (``setdefault`` lets a route override per-response)."""
        response: Response = await call_next(request)
        for name, value in DEFAULT_HEADERS.items():
            response.headers.setdefault(name, value)
        return response


_access_logger = logging.getLogger(ACCESS_LOGGER_NAME)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Tag every request with a unique ID and log one access line for it.

    The ID is always generated server-side rather than trusted from an
    incoming ``X-Request-Id`` header — this app has no configured-trusted
    reverse proxy that strips/sets that header, so honouring a client-supplied
    value would let a caller inject arbitrary IDs into the logs. The ID is
    echoed back on the response (``setdefault``, so a route can still override
    it) and stashed in a contextvar so any log line emitted anywhere while
    handling this request can be correlated to it.
    """

    async def dispatch(self, request: Request, call_next):
        """Generate a request ID, run the request under it, then log and
        echo the ID back on the response."""
        req_id = uuid.uuid4().hex
        token = request_id_var.set(req_id)
        started = time.monotonic()
        try:
            response: Response = await call_next(request)
            duration_ms = round((time.monotonic() - started) * 1000, 2)
            response.headers.setdefault("X-Request-Id", req_id)
            _access_logger.info(
                "%s %s %s %sms",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        finally:
            request_id_var.reset(token)
        return response
