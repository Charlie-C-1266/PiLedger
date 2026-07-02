"""
Tests for the JSON log formatter and request-ID contextvar in logging_config.py.
"""

import json
import logging

from logging_config import JsonFormatter, request_id_var


def _make_record(msg="hello", level=logging.INFO):
    return logging.LogRecord(
        name="piledger.test",
        level=level,
        pathname=__file__,
        lineno=1,
        msg=msg,
        args=(),
        exc_info=None,
    )


def test_json_formatter_produces_valid_json_with_expected_keys():
    formatter = JsonFormatter()
    record = _make_record("hello world")
    payload = json.loads(formatter.format(record))
    assert payload["msg"] == "hello world"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "piledger.test"
    assert "ts" in payload
    assert payload["request_id"] is None


def test_json_formatter_includes_current_request_id():
    formatter = JsonFormatter()
    token = request_id_var.set("abc123")
    try:
        payload = json.loads(formatter.format(_make_record()))
        assert payload["request_id"] == "abc123"
    finally:
        request_id_var.reset(token)


def test_json_formatter_includes_exception_info():
    formatter = JsonFormatter()
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _make_record("failed")
        record.exc_info = sys.exc_info()
        payload = json.loads(formatter.format(record))
        assert "ValueError: boom" in payload["exc_info"]
