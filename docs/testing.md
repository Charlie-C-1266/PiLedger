# Testing

## Automated test suite

PiLedger ships with three test suites. All must pass before any change is considered complete.

```bash
uv run pytest                 # backend unit + API suite (isolated SQLite DB per test, runs in seconds)
uv run pytest tests/e2e       # end-to-end browser suite (Playwright + Chromium, ~30s)
( cd frontend && npm test )   # frontend unit suite (Vitest + React Testing Library + jsdom)
```

If Playwright's browser is missing, install it once with `uv run playwright install chromium`.

The backend unit/API suite and the frontend Vitest suite both run in CI on every PR; the e2e suite runs in CI too (the `E2E (Playwright)` job builds the SPA, installs Chromium, and runs `pytest tests/e2e`). Frontend tests live next to the code they cover as `Foo.test.tsx` / `useFoo.test.ts` — see [Frontend](frontend.md) and the "Testing requirements" section of `CLAUDE.md`.

The unit/API tests run against an isolated SQLite database per test (set up by `tests/conftest.py:app`, which monkeypatches `constants.DB` to a fresh `tmp_path` file and re-runs `init()`). All API access goes through `starlette.testclient.TestClient`, so the tests exercise the real FastAPI app end-to-end without binding a network port.

```bash
uv run pytest tests/test_loans.py     # one file
uv run pytest -q -k "isolation"       # name-filtered subset
```

The two shared fixtures `alice` and `bob` both depend on a single per-test `app` fixture instance, so they share one database — which is what the isolation tests need (one user must not see another's data).

## Manual smoke tests (curl)

The pytest suite is the source of truth; the curl recipes below remain useful for spot-checking a running deployment from another host.

```bash
uv run uvicorn --app-dir src app:app --host 0.0.0.0 --port 8080 &
sleep 2
```

### Auth smoke tests

**Unauthenticated request to `/` redirects to `/login`**
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:8080/
# Expected: 302 http://localhost:8080/login
```

**Unauthenticated API request returns 401**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/accounts
# Expected: 401
```

**Register a new user**
```bash
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"hunter99!"}'
# Expected: {"id":1,"username":"alice"}
```

**Register with duplicate username returns 409**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"another123"}'
# Expected: 409
```

**Register with short password returns 400**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"short"}'
# Expected: 400
```

**Login and capture session token**
```bash
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"hunter99!"}'
TOKEN=$(grep piledger_session "$COOKIE_JAR" | awk '{print $NF}')
# Expected response body: {"ok":true,"username":"alice"}
# Expected: TOKEN is a 64-character hex string
```

**Login with wrong password returns 401**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"wrongpass"}'
# Expected: 401
```

**Authenticated request to `/api/auth/me`**
```bash
curl -s http://localhost:8080/api/auth/me -H "Cookie: piledger_session=$TOKEN"
# Expected: {"id":1,"username":"alice"}
```

**Logout invalidates the token**
```bash
curl -s -X POST http://localhost:8080/api/auth/logout -H "Cookie: piledger_session=$TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/accounts \
  -H "Cookie: piledger_session=$TOKEN"
# Expected second request: 401
```

### Account isolation smoke tests

**Accounts created by alice are not visible to bob**
```bash
# Register bob
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}'

# Login as alice, create an account
curl -s -X POST http://localhost:8080/api/auth/login ... # (capture ALICE_TOKEN)
curl -s -X POST http://localhost:8080/api/accounts \
  -H "Cookie: piledger_session=$ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Savings","type":"savings","interest_rate":4.0}'

# Login as bob, list accounts — must be empty
curl -s -X POST http://localhost:8080/api/auth/login ... # (capture BOB_TOKEN)
curl -s http://localhost:8080/api/accounts -H "Cookie: piledger_session=$BOB_TOKEN"
# Expected: []
```

**Cross-user account access returns 404**
```bash
# Attempt to update alice's account (id=1) as bob
curl -s -o /dev/null -w "%{http_code}\n" \
  -X PUT http://localhost:8080/api/accounts/1 \
  -H "Cookie: piledger_session=$BOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Stolen"}'
# Expected: 404
```

### Data flow smoke tests

**Create account, record balance, verify summary**
```bash
ACC=$(curl -s -X POST http://localhost:8080/api/accounts \
  -H "Cookie: piledger_session=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Monzo","type":"current","color":"#f97316"}')
AID=$(echo $ACC | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s -X POST http://localhost:8080/api/accounts/$AID/balance \
  -H "Cookie: piledger_session=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"balance":1500.00}'

curl -s http://localhost:8080/api/summary -H "Cookie: piledger_session=$TOKEN"
# Expected: {"total":1500.0,"total_current":1500.0,"total_savings":0.0,"account_count":1}
```

**Compound interest projection**
```bash
curl -s "http://localhost:8080/api/projections?months=12" \
  -H "Cookie: piledger_session=$TOKEN"
# For a savings account with £8000 at 4.1% AER:
# Expected 1yr ≈ £8334.23  (8000 × (1 + 0.041/12)^12)
```

### Static asset tests

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/static/login.css
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/static/login.js
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/guide
# All expected: 200
# The SPA bundle under /static/dist/ uses content-hashed filenames; check it
# via a route instead, e.g. an authenticated GET /overview (200), or /login
# when signed out (302 → /login).
```
