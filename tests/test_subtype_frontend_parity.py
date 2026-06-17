"""Guard against the account sub-type taxonomy drifting across the stack.

The valid sub-types per account type are maintained by hand in two places and
two languages: ``constants.SUBTYPES_BY_TYPE`` / the ``AccountSubtype`` literal on
the backend, and ``SUBTYPES_BY_TYPE`` / ``SUBTYPE_LABELS`` in the add-account
modal on the frontend. Nothing at runtime ties them together, so adding a
sub-type to one side and forgetting the other would silently let the UI offer a
value the API rejects (or hide a valid one). These tests parse the frontend
constants out of the modal and assert they stay in lock-step with the backend.

The human-readable *labels* remain frontend-owned (the backend only stores the
snake_case key); we just check every offered key has one.
"""

import re
from pathlib import Path
from typing import get_args

from constants import AccountSubtype, SUBTYPES_BY_TYPE

_MODAL = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "src"
    / "components"
    / "AddAccountModal.tsx"
)


def _object_body(name: str) -> str:
    """Return the text between the braces of a ``const <name> ... = { ... };``."""
    text = _MODAL.read_text(encoding="utf-8")
    match = re.search(rf"const {name}\b[^=]*=\s*\{{(.*?)\n\}};", text, re.DOTALL)
    assert match, f"Could not find `{name}` in {_MODAL.name}"
    return match.group(1)


def _frontend_subtypes_by_type() -> dict[str, set[str]]:
    """Parse the frontend ``SUBTYPES_BY_TYPE`` into {type: {subtype, ...}}."""
    body = _object_body("SUBTYPES_BY_TYPE")
    out: dict[str, set[str]] = {}
    # Each entry is `type: [ "a", "b", ... ]`; the array is flat (no nesting),
    # so a non-greedy match up to the first `]` captures it across newlines.
    for entry in re.finditer(r"(\w+):\s*(\[.*?\])", body, re.DOTALL):
        out[entry.group(1)] = set(re.findall(r'"([a-z_]+)"', entry.group(2)))
    return out


def _frontend_label_keys() -> set[str]:
    """The keys defined in the frontend ``SUBTYPE_LABELS`` map."""
    return set(re.findall(r'(\w+):\s*"', _object_body("SUBTYPE_LABELS")))


def test_frontend_subtypes_match_backend() -> None:
    backend = {k: set(v) for k, v in SUBTYPES_BY_TYPE.items()}
    assert _frontend_subtypes_by_type() == backend


def test_backend_subtypes_cover_the_account_subtype_literal() -> None:
    offered = set().union(*SUBTYPES_BY_TYPE.values())
    assert offered == set(get_args(AccountSubtype))


def test_every_offered_subtype_has_a_frontend_label() -> None:
    offered = set().union(*_frontend_subtypes_by_type().values())
    missing = offered - _frontend_label_keys()
    assert not missing, f"sub-types offered with no SUBTYPE_LABELS entry: {missing}"
