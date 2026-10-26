"""Tests for when auto-post runs (``autopost.py`` + the app lifespan): the
``PILEDGER_AUTOPOST_TIME`` setting, the next-run arithmetic, the startup
catch-up, and that ``off`` starts nothing. The suite runs with ``off``
(conftest), so these tests switch it back on explicitly.
"""

import asyncio
import logging
import os
import subprocess
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import autopost
import constants
from db import db


# ── PILEDGER_AUTOPOST_TIME ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value, expected",
    [
        ("00:05", time(0, 5)),
        ("23:30", time(23, 30)),
        (" 7:15 ", time(7, 15)),
        ("", time(0, 5)),
        (None, time(0, 5)),
        ("off", None),
        ("OFF", None),
    ],
)
def test_parse_autopost_time(value, expected):
    assert autopost.parse_autopost_time(value) == expected


@pytest.mark.parametrize("value", ["24:00", "7pm", "00:05:00", "noon", "-1:00"])
def test_parse_autopost_time_rejects_garbage(value):
    with pytest.raises(ValueError, match="PILEDGER_AUTOPOST_TIME"):
        autopost.parse_autopost_time(value)


def test_default_setting_is_five_past_midnight():
    """With the variable unset, constants falls back to 00:05. Checked in a
    fresh interpreter so the suite's own "off" can't leak in."""
    env = {k: v for k, v in os.environ.items() if k != "PILEDGER_AUTOPOST_TIME"}
    env["PYTHONPATH"] = str(Path(constants.__file__).parent)
    out = subprocess.run(
        [sys.executable, "-c", "import constants; print(constants.AUTOPOST_TIME)"],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    assert out.stdout.strip() == "00:05"


# ── next_run_at ──────────────────────────────────────────────────────────────

AT = time(0, 5)


@pytest.mark.parametrize(
    "now, expected",
    [
        # Just before the slot: later today.
        (datetime(2026, 10, 26, 0, 4), datetime(2026, 10, 26, 0, 5)),
        # Exactly on it (a run that just finished): tomorrow, not again now.
        (datetime(2026, 10, 26, 0, 5), datetime(2026, 10, 27, 0, 5)),
        # Mid-day and last thing at night: across midnight to tomorrow.
        (datetime(2026, 10, 26, 13, 0), datetime(2026, 10, 27, 0, 5)),
        (datetime(2026, 10, 26, 23, 59, 59), datetime(2026, 10, 27, 0, 5)),
        # Across month, year and leap-day boundaries.
        (datetime(2026, 10, 31, 22, 0), datetime(2026, 11, 1, 0, 5)),
        (datetime(2026, 12, 31, 23, 0), datetime(2027, 1, 1, 0, 5)),
        (datetime(2028, 2, 28, 1, 0), datetime(2028, 2, 29, 0, 5)),
    ],
)
def test_next_run_at(now, expected):
    assert autopost.next_run_at(now, AT) == expected


def test_next_run_at_late_evening_slot():
    at = time(23, 30)
    assert autopost.next_run_at(datetime(2026, 10, 26, 23, 0), at) == datetime(
        2026, 10, 26, 23, 30
    )
    assert autopost.next_run_at(datetime(2026, 10, 26, 23, 45), at) == datetime(
        2026, 10, 27, 23, 30
    )


# ── Lifespan ─────────────────────────────────────────────────────────────────


@pytest.fixture
def spy(monkeypatch):
    calls = []
    monkeypatch.setattr(autopost, "post_due_for_everyone", lambda: calls.append(1))
    return calls


def test_off_runs_no_catch_up_and_starts_no_daily_task(app, monkeypatch, spy):
    monkeypatch.setattr(constants, "AUTOPOST_TIME", "off")
    with TestClient(app) as c:
        assert c.get("/healthz").status_code == 200
        assert app.state.autopost_task is None
    assert spy == []


def test_on_runs_catch_up_then_starts_daily_task(app, monkeypatch, spy):
    monkeypatch.setattr(constants, "AUTOPOST_TIME", "00:05")
    with TestClient(app):
        task = app.state.autopost_task
        assert task is not None
        assert not task.done()
        assert spy == [1]  # the startup catch-up ran before serving
    assert task.cancelled()  # shutdown stopped the timer


def test_bad_setting_fails_startup(app, monkeypatch, spy):
    monkeypatch.setattr(constants, "AUTOPOST_TIME", "half past")
    with pytest.raises(ValueError, match="PILEDGER_AUTOPOST_TIME"):
        with TestClient(app):
            pass
    assert spy == []


def test_startup_catch_up_posts_what_is_owed(app, monkeypatch):
    """End to end through the real job: an auto-posting item that fell due
    while the server was off is posted before the first request."""
    today = date.today()
    with db() as conn:
        uid = conn.execute(
            "INSERT INTO users(username, password_hash) VALUES('alice', 'x')"
        ).lastrowid
        aid = conn.execute(
            "INSERT INTO accounts(user_id, name, type) VALUES(?, 'Current', 'current')",
            (uid,),
        ).lastrowid
        conn.execute(
            "INSERT INTO subscriptions(user_id, name, amount_cents, account_id,"
            " frequency, start_date, auto_post, auto_post_from)"
            " VALUES(?, 'Gym', 2500, ?, 'weekly', ?, 1, ?)",
            (
                uid,
                aid,
                (today - timedelta(days=14)).isoformat(),
                (today - timedelta(days=14)).isoformat(),
            ),
        )
        conn.commit()

    monkeypatch.setattr(constants, "AUTOPOST_TIME", "00:05")
    with TestClient(app):
        pass

    with db() as conn:
        dates = [
            r[0]
            for r in conn.execute(
                "SELECT occurred_at FROM transactions ORDER BY occurred_at"
            ).fetchall()
        ]
    assert dates == [
        f"{(today - timedelta(days=d)).isoformat()}T00:00:00Z" for d in (14, 7, 0)
    ]


# ── The timer loop ───────────────────────────────────────────────────────────


def test_daily_runs_the_job_each_time_the_slot_arrives(monkeypatch):
    calls = []
    monkeypatch.setattr(
        autopost, "next_run_at", lambda now, at: now + timedelta(milliseconds=20)
    )

    async def main():
        task = asyncio.create_task(autopost._daily(AT, lambda: calls.append(1)))
        while len(calls) < 2:
            await asyncio.sleep(0.01)
        await autopost.stop(task)
        return task

    task = asyncio.run(asyncio.wait_for(main(), timeout=5))
    assert len(calls) >= 2
    assert task.cancelled()


def test_a_failing_run_is_logged_and_the_timer_survives(monkeypatch, caplog):
    calls = []

    def job():
        calls.append(1)
        raise RuntimeError("database is locked")

    monkeypatch.setattr(
        autopost, "next_run_at", lambda now, at: now + timedelta(milliseconds=20)
    )

    async def main():
        task = asyncio.create_task(autopost._daily(AT, job))
        while len(calls) < 2:
            await asyncio.sleep(0.01)
        await autopost.stop(task)

    with caplog.at_level(logging.ERROR, logger="piledger.autopost"):
        asyncio.run(asyncio.wait_for(main(), timeout=5))
    assert len(calls) >= 2
    assert "auto-post run failed" in caplog.text


def test_stop_without_a_task_is_a_no_op():
    asyncio.run(autopost.stop(None))
