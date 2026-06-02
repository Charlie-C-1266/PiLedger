# PiLedger — Claude Instructions

## Changelog

**Always record meaningful changes in `CHANGELOG.md` before the work is considered done.** Version bumps are *decoupled* from individual PRs (see Releases) — a normal PR does **not** bump `VERSION` and does **not** add a version header. Instead it adds a concise entry under the `## [Unreleased]` section at the top of the file, in the subsection matching its type:

- New features → `### Added`
- Behaviour changes → `### Changed`
- Bug fixes → `### Fixed`
- Removals / breaking changes → `### Removed` (or `### Changed`)

If `## [Unreleased]` doesn't exist yet (the previous release just cut it away), create it at the top with the relevant subsection.

**Keep entries concise and user-facing — one line per change.** State *what* changed (the capability or the fixed symptom) and, only where it isn't obvious from that, a short clause on *why*. Do **not** list affected files, paste root-cause essays, or narrate the implementation: the commit diff and the originating PR already hold that detail, and duplicating it here is what bloated the old file. Aim for the tone of a release note a user would read, e.g. *"Goals can be linked to an account for automatic balance tracking."*

Use [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format. **Only touch the top of the file:** the `## [Unreleased]` block is the first section, so read just the opening lines (`Read` with a small `limit`, ~40 lines) to find and append to it — never read the whole `CHANGELOG.md` into context. Released history below `[Unreleased]` is closed; older releases live in `CHANGELOG-ARCHIVE.md`, which should not be read or edited during normal work.

## Releases

**`VERSION` is bumped and tagged only when cutting a release — never per-PR.** This keeps the version number from churning with every small change. Between releases, `src/constants.py`'s `VERSION` reflects the **last released version** while `main` accumulates work under `## [Unreleased]`. Cutting a release is a deliberate act the user requests explicitly; do not cut one proactively.

**Every release cut is tagged**, regardless of whether it lands on a patch, minor, or major version.

To cut a release (only on explicit user request), follow the standard PR workflow below — the version bump goes through a release PR, not a direct commit to `main`:

1. `git checkout main && git pull`, then branch (e.g. `release-X.Y.Z`).
2. Choose `X.Y.Z` per SemVer from the accumulated `## [Unreleased]` entries: any breaking change → major; otherwise any new feature → minor; otherwise (only fixes) → patch.
3. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it.
4. Keep the live `CHANGELOG.md` to just `[Unreleased]` + the release being cut: move the *previously* most-recent release section (now the second-newest) down to the top of `CHANGELOG-ARCHIVE.md`, directly under that file's `---` header. The archive stays newest-first.
5. Bump `VERSION` in `src/constants.py` to `X.Y.Z`.
6. Open the release PR. **After the user confirms it is merged**, `git checkout main && git pull`, then tag the merge commit:
   ```bash
   git tag -a vX.Y.Z -m "$(cat <<'EOF'
   vX.Y.Z release notes title

   <release notes body>
   EOF
   )"
   git push origin vX.Y.Z
   ```

Release notes should be concise — a short summary per changelog entry, not a copy-paste of the full changelog. Group by Added / Fixed / Changed if there are entries of multiple types.

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
- **Backend layout**: `app.py` is a thin (~100-line) wiring module — it builds the FastAPI app, registers middleware + the 422→400 exception handler, calls `init()`, and mounts every router. Each resource's HTTP handlers live in a per-resource `APIRouter` under `src/routers/` (`auth`, `accounts`, `transactions`, `dashboard`, `budget`, `goals`, `prefs`, `rates`, `categories`, `ops`, `pages`); business logic shared by two or more routers lives in `src/services/` (`currency` FX helpers, `accounts` balance helpers). Routers depend on `db`/`schemas`/`auth`/`constants`/`services`/`limiter` but **never import `app`** (that would cycle); `app.py` imports the routers last and includes them, with `pages` last so a page route can't shadow an API path. The shared `Limiter` lives in `src/limiter.py` so routers can rate-limit without importing `app`. `tests/test_route_table.py` snapshots every `(path, method)` pair as a guard against accidental route changes.
- **Frontend**: Vanilla JS, Chart.js 4.4 (vendored), Inter font (vendored)
- **Auth**: PBKDF2-SHA256 passwords, 30-day `HttpOnly` session cookies
- **Tests**: pytest 9, httpx, `starlette.testclient.TestClient`, Playwright
- **CI**: GitHub Actions — ruff check, ruff format, mypy, pytest + coverage, lockfile drift, pip-audit
