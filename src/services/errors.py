"""Errors services raise when a request breaks a rule.

Services stay free of HTTP so non-HTTP callers (the scheduled-item poster, the
auto-post timer) can apply the same rules and read the same messages.
``app.py`` turns them into responses with the message as ``detail``:
``NotFoundError`` → 404, ``RuleError`` → 400.
"""


class NotFoundError(LookupError):
    """What the request names doesn't exist or isn't the user's (404)."""


class RuleError(ValueError):
    """The request breaks a business rule (400). The message is user-facing."""
