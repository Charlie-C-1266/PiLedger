"""Structured logging setup.

Uvicorn's default access log is plain text with no request correlation, which
makes multi-line stack traces and concurrent requests hard to grep in
production. ``configure_logging()`` installs a JSON formatter (no new
dependency — ``JsonFormatter`` below is a ~15-line ``logging.Formatter``
subclass) and every request gets a ``request_id`` attached via
``RequestIdMiddleware`` in ``security.py``, so every log line emitted while
handling a request can be correlated back to it.

Level and rendering are env-gated the same way ``COOKIE_SECURE`` and
``PILEDGER_LOGIN_RATE_LIMIT`` are in ``constants.py``:
``PILEDGER_LOG_LEVEL`` (default ``INFO``) and ``PILEDGER_LOG_FORMAT``
(``json`` default, or ``text`` for a friendlier local `./start.sh`).
"""

from __future__ import annotations

import json
import logging
import logging.config
from contextvars import ContextVar

from constants import LOG_FORMAT, LOG_LEVEL

# Holds the current request's ID so any log call made while handling that
# request — in a router, a service, anywhere — can be tagged without
# threading the value through every function signature. `None` outside a
# request (e.g. startup logging).
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

ACCESS_LOGGER_NAME = "piledger.access"


class JsonFormatter(logging.Formatter):
    """Render each log record as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialize `record` to a single-line JSON string."""
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging() -> None:
    """Install the JSON (or plain-text) formatter on the root logger.

    Called once at app startup, before ``init()``, so that startup-time log
    messages are already formatted consistently.
    """
    if LOG_FORMAT == "text":
        formatter: dict = {
            "format": "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s",
        }
        # `request_id` isn't a stdlib LogRecord attribute, so the text
        # formatter needs it injected via a filter; the JSON formatter reads
        # the contextvar directly instead.
        filters: dict = {
            "request_id": {"()": "logging_config._RequestIdFilter"},
        }
        handler_filters = ["request_id"]
    else:
        formatter = {"()": "logging_config.JsonFormatter"}
        filters = {}
        handler_filters = []

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": filters,
            "formatters": {"default": formatter},
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "filters": handler_filters,
                }
            },
            "root": {"handlers": ["console"], "level": LOG_LEVEL},
        }
    )


class _RequestIdFilter(logging.Filter):
    """Inject the current request ID as a record attribute for the text formatter."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True
