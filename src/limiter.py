"""Shared rate-limiter instance.

Lives in its own module so routers can apply ``@limiter.limit(...)`` without
importing ``app`` — that would create an import cycle, since ``app`` imports the
routers. ``app.py`` re-exports this instance so existing references (and the
test suite's ``app.limiter``) keep resolving.

Login rate limiter. Key function is the socket peer IP (slowapi default),
which means behind a reverse proxy every client shares a single bucket — the
README directs internet-exposed deployments to add nginx ``limit_req`` /
Caddy ``rate_limit`` at the proxy layer where real client IPs are visible.
This app-layer limit is defence-in-depth for LAN deployments. Configurable
via the PILEDGER_LOGIN_RATE_LIMIT env var (see constants.py).
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
