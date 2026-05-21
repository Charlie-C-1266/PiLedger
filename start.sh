#!/bin/bash
cd "$(dirname "$0")"
# --app-dir src puts the source tree on sys.path so `app:app` resolves to
# src/app.py after the 2026 restructure. CWD stays at the project root
# so the default SQLite path (constants.DB) lands `piledger.db` alongside
# this script rather than inside src/.
./venv/bin/uvicorn --app-dir src app:app --host 0.0.0.0 --port 8080
