# PiLedger — Claude Instructions

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

## Branching and pull requests

**Every change must be delivered as a pull request — never commit directly to `main`.** This applies to all changes: features, fixes, refactors, doc updates, and changes to this file itself. The PR workflow gives the user a chance to review the diff in GitHub's UI before anything lands on `main`.

1. **Create a topic branch from `main` before making changes.** Use short, descriptive kebab-case names (`fix-test-suite`, `loan-min-payment`, `update-readme`). `git checkout main && git checkout -b <branch-name>`.
2. **Commit the work on the branch** following the existing commit-message style: imperative subject under ~70 characters, blank line, prose body explaining the *why*, `Co-Authored-By` trailer. If a single PR has two unrelated logical changes (e.g. a bug fix and a feature), split them into separate commits in dependency order.
3. **Push the branch with `git push -u origin <branch-name>`** so it tracks the remote.
4. **Open a PR targeting `main`.** Use `gh pr create --title ... --body ...` if `gh` is installed. If `gh` is not available, surface the PR-creation URL that `git push` prints (`https://github.com/Charlie-C-1266/PiLedger/pull/new/<branch-name>`) so the user can open it in the browser — do **not** consider the work delivered until that URL has been shared.
5. **Do not merge the PR.** Leave it open for the user's review and merge — even if all tests pass and the diff looks trivial.

PR titles should be short and imperative (<70 chars). PR bodies should include a 1-3 bullet summary of what changed and why, plus a test-plan checklist if applicable.

Exceptions: none by default. If a change genuinely needs to go straight to `main` (e.g. a hotfix the user explicitly asks for), get explicit confirmation from the user first.

## Running the app

```bash
./start.sh          # serves on 0.0.0.0:8080
```

## Pre-PR checks

**Run all CI checks locally before committing and raising a PR.** This avoids round-tripping on CI failures. The full local check sequence:

```bash
uv run ruff check .                        # lint
uv run ruff format --check .               # formatting
uv run mypy                                # type check (strict on schemas, auth, db, constants)
uv run pytest                              # unit + API suite
uv run pytest tests/e2e                    # end-to-end browser suite (Playwright + Chromium)
```

All five must pass before a change is considered complete. If any check fails, fix the code — do not skip or delete tests, and do not bypass lint/format/type errors.

The default `pytest` invocation runs only the unit/API suite because `pytest.ini` adds `--ignore=tests/e2e`. The e2e suite is excluded from CI, so a regression there will not block merge — a broken e2e test has slipped past review in the past for exactly this reason, and that should not happen again. If Playwright's browser is missing, install it once with `uv run playwright install chromium`.

## Stack

- **Backend**: Python 3.12, FastAPI, SQLite (`piledger.db`), Uvicorn
- **Frontend**: Vanilla JS, Chart.js 4.4 (vendored), Inter font (vendored)
- **Auth**: PBKDF2-SHA256 passwords, 30-day `HttpOnly` session cookies
- **Tests**: pytest 9, httpx, `starlette.testclient.TestClient`, Playwright
- **CI**: GitHub Actions — ruff check, ruff format, mypy, pytest + coverage, lockfile drift, pip-audit
