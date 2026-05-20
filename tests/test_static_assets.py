"""
Static-asset hygiene checks. The CSP locks scripts down to ``'self'`` and
forbids ``'unsafe-inline'``, so any inline ``<script>`` block or ``on*=``
attribute in the served HTML, plus any leftover CDN ``<script>``/``<link>``
references, would silently break the dashboard at runtime. These tests
catch regressions at the static-file level before a browser would.
"""

import re
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# Matches ``on<word>="..."``` HTML event-handler attributes (onclick, onchange,
# onsubmit, onload, …). Lowercase-only is fine: HTML attributes are case-
# insensitive and the codebase uses lowercase consistently.
_INLINE_HANDLER = re.compile(r'\son[a-z]+\s*=\s*"')


def _read(name: str) -> str:
    return (STATIC_DIR / name).read_text(encoding="utf-8")


def test_index_has_no_inline_event_handlers():
    matches = _INLINE_HANDLER.findall(_read("index.html"))
    assert matches == [], f"inline handlers found in index.html: {matches}"


def test_login_has_no_inline_event_handlers():
    matches = _INLINE_HANDLER.findall(_read("login.html"))
    assert matches == [], f"inline handlers found in login.html: {matches}"


def test_app_js_does_not_render_inline_event_handlers():
    """Dynamic HTML built via template strings must not include on*= either."""
    matches = _INLINE_HANDLER.findall(_read("app.js"))
    assert matches == [], f"inline handlers rendered by app.js: {matches}"


def test_index_loads_only_local_scripts():
    html = _read("index.html")
    # Each <script src="..."> must point at /static
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
    for src in srcs:
        assert src.startswith("/static/"), f"non-local script: {src}"
    # No inline <script> blocks (i.e. <script> with no src= attribute)
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)
    assert inline == [], f"inline <script> blocks in index.html: {inline}"


def test_login_loads_only_local_scripts():
    html = _read("login.html")
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
    for src in srcs:
        assert src.startswith("/static/"), f"non-local script: {src}"
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)
    assert inline == [], f"inline <script> blocks in login.html: {inline}"


def test_no_cdn_links_remain():
    for name in ("index.html", "login.html"):
        html = _read(name)
        assert "cdn.jsdelivr.net" not in html, f"{name} still references jsdelivr"
        assert "fonts.googleapis.com" not in html, f"{name} still references Google Fonts"
        assert "fonts.gstatic.com" not in html, f"{name} still references Google Fonts CDN"


def test_vendored_assets_present():
    assert (STATIC_DIR / "vendor" / "chart.umd.min.js").exists()
    assert (STATIC_DIR / "vendor" / "inter" / "inter.css").exists()
    assert (STATIC_DIR / "vendor" / "inter" / "inter-latin.woff2").exists()
