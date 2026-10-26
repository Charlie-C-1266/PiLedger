"""When auto-post runs: a catch-up at startup, then once a day.

``app.py``'s lifespan calls ``start()`` on startup and ``stop()`` on shutdown.
The posting itself is ``services.posting.post_due_for_everyone`` — synchronous
SQLite work, so it runs in a worker thread (``asyncio.to_thread``) and never
blocks the event loop. Runs are idempotent (the posting log's unique key), so a
run that overlaps a ``POST /api/subscriptions/post-due`` or a clock jump that
fires one twice can't post a date twice.

The daily time is ``PILEDGER_AUTOPOST_TIME`` (``constants.AUTOPOST_TIME``):
server-local ``HH:MM``, default ``00:05``, or ``off`` to run neither the
catch-up nor the timer.
"""

import asyncio
import contextlib
import logging
from datetime import datetime, time, timedelta
from typing import Callable, Optional

import constants
from services.posting import post_due_for_everyone

log = logging.getLogger("piledger.autopost")

# The timer re-checks the clock at least this often while waiting, so a
# suspended Pi or a clock change (DST, NTP catching up) delays a run by at most
# this long instead of a whole day.
_MAX_SLEEP_S = 3600.0


def parse_autopost_time(value: Optional[str]) -> Optional[time]:
    """``PILEDGER_AUTOPOST_TIME`` as a wall-clock time, or None for ``off``.
    Empty or unset means the default ``00:05``. Anything else that isn't a
    24-hour ``HH:MM`` raises ``ValueError``, so a typo fails at startup rather
    than silently never posting."""
    raw = (value or "").strip().lower()
    if raw == "off":
        return None
    if not raw:
        raw = "00:05"
    try:
        return datetime.strptime(raw, "%H:%M").time()
    except ValueError:
        raise ValueError(
            f"PILEDGER_AUTOPOST_TIME must be HH:MM (24-hour) or 'off', got {value!r}"
        ) from None


def next_run_at(now: datetime, at: time) -> datetime:
    """The first moment strictly after ``now`` whose wall-clock time is ``at``
    — later today, or tomorrow once today's slot has passed (so a run that
    finishes inside its own minute isn't repeated)."""
    candidate = datetime.combine(now.date(), at)
    if candidate <= now:
        candidate = datetime.combine(now.date() + timedelta(days=1), at)
    return candidate


def _run_once(job: Callable[[], object]) -> None:
    """Run one posting pass, logging (not raising) a failure so the timer and
    startup survive it; the next run retries anything left undone."""
    try:
        job()
    except Exception:
        log.exception("auto-post run failed")


async def _daily(at: time, job: Callable[[], object]) -> None:
    """Run ``job`` in a worker thread every day at ``at``, server-local time,
    until cancelled. The wait is chunked (see ``_MAX_SLEEP_S``) and re-checked
    against the wall clock, so it neither drifts nor fires early."""
    while True:
        target = next_run_at(datetime.now(), at)
        while (remaining := (target - datetime.now()).total_seconds()) > 0:
            await asyncio.sleep(min(remaining, _MAX_SLEEP_S))
        await asyncio.to_thread(_run_once, job)


async def start(
    job: Optional[Callable[[], object]] = None,
) -> Optional["asyncio.Task[None]"]:
    """Startup: run the catch-up for every user (awaited, so balances are
    current before the first request), then start the daily timer. Returns the
    timer task, or None when auto-post is ``off``. ``job`` defaults to
    ``post_due_for_everyone``, looked up at call time."""
    if job is None:
        job = post_due_for_everyone
    at = parse_autopost_time(constants.AUTOPOST_TIME)
    if at is None:
        log.info("auto-post is off (PILEDGER_AUTOPOST_TIME=off)")
        return None
    await asyncio.to_thread(_run_once, job)
    log.info("auto-post runs daily at %s server time", at.strftime("%H:%M"))
    return asyncio.create_task(_daily(at, job), name="piledger-autopost")


async def stop(task: Optional["asyncio.Task[None]"]) -> None:
    """Shutdown: cancel the daily timer (if any) and wait for it to finish."""
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
