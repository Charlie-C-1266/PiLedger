"""Guard against the institution catalogue drifting across the stack.

The set of institutions an account can be held with is maintained by hand in two
places and two languages: the ``InstitutionSlug`` literal in ``constants.py``,
and the ``INSTITUTIONS`` table in ``frontend/src/lib/institutions.ts``. Nothing
at runtime ties them together, so adding an institution to one side and
forgetting the other would either offer a value the API rejects, or store a slug
the UI can't name or draw a mark for.

The display names, brand colours and monograms stay frontend-owned (the backend
only stores the slug) — these tests check the *keys* stay in lock-step and that
every entry actually carries the presentation fields the UI relies on.
"""

import re
from pathlib import Path
from typing import get_args

from constants import INSTITUTION_OTHER, INSTITUTION_SLUGS, InstitutionSlug

_CATALOGUE = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "src"
    / "lib"
    / "institutions.ts"
)


def _entries() -> list[dict[str, str]]:
    """Parse the frontend ``INSTITUTIONS`` array into a list of field maps.

    Each entry is a flat one-line object literal, so a per-line scan is enough —
    no brace matching required.
    """
    text = _CATALOGUE.read_text(encoding="utf-8")
    match = re.search(
        r"export const INSTITUTIONS[^=]*=\s*\[(.*?)\n\];", text, re.DOTALL
    )
    assert match, f"Could not find `INSTITUTIONS` in {_CATALOGUE.name}"
    entries = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        fields = dict(re.findall(r'(\w+):\s*"([^"]*)"', line))
        # The catch-all entry keys off the exported OTHER constant rather than a
        # string literal, so fill its slug in from the backend's own value.
        fields.setdefault("slug", INSTITUTION_OTHER)
        entries.append(fields)
    return entries


def test_frontend_catalogue_matches_backend_slugs() -> None:
    assert {e["slug"] for e in _entries()} == set(INSTITUTION_SLUGS)


def test_backend_slug_set_matches_the_literal() -> None:
    assert INSTITUTION_SLUGS == frozenset(get_args(InstitutionSlug))


def test_other_is_in_the_catalogue() -> None:
    """``INSTITUTION_OTHER`` is the only slug that takes a free-text name, so it
    has to be offered in the picker like any other."""
    assert INSTITUTION_OTHER in INSTITUTION_SLUGS


def test_every_institution_has_the_fields_the_ui_draws() -> None:
    missing = [
        e.get("slug")
        for e in _entries()
        if not {"name", "group", "color", "mark"} <= set(e)
    ]
    assert not missing, f"institutions missing presentation fields: {missing}"


def test_marks_fit_the_badge() -> None:
    """``InstitutionMark`` only scales text down to four characters; a longer
    monogram would overflow its badge."""
    too_long = [e["slug"] for e in _entries() if len(e["mark"]) > 4]
    assert not too_long, f"institution marks longer than 4 characters: {too_long}"


def test_colors_are_hex() -> None:
    bad = [
        e["slug"]
        for e in _entries()
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", e["color"])
    ]
    assert not bad, f"institutions without a 6-digit hex colour: {bad}"
