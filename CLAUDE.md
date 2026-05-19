# FinDash — Claude Instructions

## Changelog

**Always update `CHANGELOG.md` when making code changes.**

Every meaningful change must be recorded before the work is considered done:

- Bug fixes → add a `### Fixed` entry under a new patch version (e.g. `0.5.1 → 0.5.2`)
- New features → add an `### Added` entry under a new minor version (e.g. `0.5.x → 0.6.0`)
- Breaking changes → add a `### Changed` or `### Removed` entry under a new major version

Each entry must include:
1. What changed (the symptom or capability)
2. Why it changed or what caused it (root cause for fixes, motivation for features)
3. Which files were affected

Use [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format. New versions go at the top of the file.

## Running the app

```bash
./start.sh          # serves on 0.0.0.0:8080
```

## Running tests

```bash
./venv/bin/pytest   # all 112 tests, isolated SQLite DB per test
```

Tests must pass before any change is considered complete. If a code change causes a test failure, fix the test or the code — do not skip or delete tests.

## Stack

- **Backend**: Python 3.12, FastAPI, SQLite (`findash.db`), Uvicorn
- **Frontend**: Vanilla JS, Chart.js 4.4 (CDN), Inter font (Google Fonts)
- **Auth**: PBKDF2-SHA256 passwords, 30-day `HttpOnly` session cookies
- **Tests**: pytest 9, httpx, `starlette.testclient.TestClient`
