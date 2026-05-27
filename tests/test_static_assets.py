"""
Static-asset hygiene checks. The CSP locks scripts down to ``'self'`` and
forbids ``'unsafe-inline'``, so any inline ``<script>`` block or ``on*=``
attribute in the served HTML, plus any leftover CDN ``<script>``/``<link>``
references, would silently break at runtime. These tests catch regressions
at the static-file level before a browser would.

The old vanilla JS dashboard (index.html, app.js, style.css) has been
retired. The React SPA is served from dist/. These tests now verify the
login and guide pages (which are still standalone HTML).
"""

import re
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent / "src" / "static"

_INLINE_HANDLER = re.compile(r'\son[a-z]+\s*=\s*"')


def _read(name: str) -> str:
    return (STATIC_DIR / name).read_text(encoding="utf-8")


def test_login_has_no_inline_event_handlers():
    matches = _INLINE_HANDLER.findall(_read("login.html"))
    assert matches == [], f"inline handlers found in login.html: {matches}"


def test_login_loads_only_local_scripts():
    html = _read("login.html")
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
    for src in srcs:
        assert src.startswith("/static/"), f"non-local script: {src}"
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)
    assert inline == [], f"inline <script> blocks in login.html: {inline}"


def test_guide_has_no_inline_event_handlers():
    matches = _INLINE_HANDLER.findall(_read("guide.html"))
    assert matches == [], f"inline handlers found in guide.html: {matches}"


def test_guide_loads_only_local_scripts():
    html = _read("guide.html")
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
    for src in srcs:
        assert src.startswith("/static/"), f"non-local script: {src}"
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)
    assert inline == [], f"inline <script> blocks in guide.html: {inline}"


def test_vendored_marked_present():
    assert (STATIC_DIR / "vendor" / "marked.min.js").exists()


def test_no_cdn_links_remain():
    for name in ("login.html", "guide.html"):
        html = _read(name)
        assert "cdn.jsdelivr.net" not in html, f"{name} still references jsdelivr"
        assert "fonts.googleapis.com" not in html, (
            f"{name} still references Google Fonts"
        )
        assert "fonts.gstatic.com" not in html, (
            f"{name} still references Google Fonts CDN"
        )


def test_self_hosted_fonts_present():
    assert (STATIC_DIR / "fonts" / "plus-jakarta-sans-latin.woff2").exists()
    assert (STATIC_DIR / "fonts" / "jetbrains-mono-latin.woff2").exists()
