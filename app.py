from fastapi import FastAPI, HTTPException, Cookie, Response, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional
import sqlite3, os, math, hashlib, secrets
from datetime import datetime, timedelta, timezone

app = FastAPI(title="FinDash")

DB = os.environ.get(
    "FINDASH_DB",
    os.path.join(os.path.dirname(__file__), "findash.db"),
)
SESSION_COOKIE = "findash_session"
SESSION_DAYS = 30
# Set COOKIE_SECURE=true in production when serving over HTTPS
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")

FREQ_TO_MONTHLY = {
    "weekly":    52 / 12,
    "monthly":   1.0,
    "quarterly": 1 / 3,
    "annually":  1 / 12,
}


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init():
    conn = db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            type          TEXT    NOT NULL CHECK(type IN ('current','savings')),
            interest_rate REAL    DEFAULT 0,
            color         TEXT    DEFAULT '#6366f1',
            created_at    TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS balance_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            balance     REAL    NOT NULL,
            notes       TEXT,
            recorded_at TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS budget_items (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            name       TEXT    NOT NULL,
            amount     REAL    NOT NULL,
            frequency  TEXT    NOT NULL
                CHECK(frequency IN ('weekly','monthly','quarterly','annually')),
            created_at TEXT    DEFAULT (datetime('now'))
        );
    """)
    # Migrate: add user_id to accounts if missing (pre-auth schema)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    if "user_id" not in cols:
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"
        )
        conn.commit()
    conn.close()


init()


# ─── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}:{key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, key_hex = stored.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


def make_session(user_id: int) -> str:
    token = secrets.token_hex(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = db()
    conn.execute(
        "INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)",
        (token, user_id, expires),
    )
    conn.commit()
    conn.close()
    return token


def session_uid(token: str) -> Optional[int]:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = db()
    row = conn.execute(
        "SELECT user_id FROM sessions WHERE token=? AND expires_at>?", (token, now)
    ).fetchone()
    conn.close()
    return row["user_id"] if row else None


def require_auth(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)) -> int:
    uid = session_uid(session or "")
    if not uid:
        raise HTTPException(401, "Not authenticated")
    return uid


# ─── Schemas ──────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    username: str
    password: str


class RegisterIn(BaseModel):
    username: str
    password: str


class AccountIn(BaseModel):
    name: str
    type: str
    interest_rate: float = 0.0
    color: str = "#6366f1"


class AccountPatch(BaseModel):
    name: Optional[str] = None
    interest_rate: Optional[float] = None
    color: Optional[str] = None


class BalanceIn(BaseModel):
    balance: float
    notes: Optional[str] = None
    recorded_at: Optional[str] = None


class BudgetItemIn(BaseModel):
    account_id: int
    name: str
    amount: float
    frequency: str


class BudgetItemPatch(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    frequency: Optional[str] = None


# ─── Auth routes ──────────────────────────────────────────────────────────────

@app.get("/login")
def login_page():
    return FileResponse("static/login.html")


@app.post("/api/auth/register", status_code=201)
def register(data: RegisterIn):
    username = data.username.strip()
    if len(username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(data.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO users(username, password_hash) VALUES(?,?)",
            (username, hash_password(data.password)),
        )
        conn.commit()
        return {"id": cur.lastrowid, "username": username}
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Username already taken")
    finally:
        conn.close()


@app.post("/api/auth/login")
def login(data: LoginIn, response: Response):
    username = data.username.strip()
    conn = db()
    user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    token = make_session(user["id"])
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        path="/",
        secure=COOKIE_SECURE,
    )
    return {"ok": True, "username": user["username"]}


@app.post("/api/auth/logout")
def logout(response: Response, session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    if session:
        conn = db()
        conn.execute("DELETE FROM sessions WHERE token=?", (session,))
        conn.commit()
        conn.close()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def get_me(uid: int = Depends(require_auth)):
    conn = db()
    user = conn.execute("SELECT id, username FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(404)
    return dict(user)


# ─── Accounts ─────────────────────────────────────────────────────────────────

@app.get("/api/accounts")
def list_accounts(uid: int = Depends(require_auth)):
    conn = db()
    rows = conn.execute("""
        SELECT a.*,
               b.balance     AS current_balance,
               b.recorded_at AS last_updated
        FROM accounts a
        LEFT JOIN balance_history b ON b.id = (
            SELECT id FROM balance_history WHERE account_id = a.id
            ORDER BY recorded_at DESC, id DESC LIMIT 1
        )
        WHERE a.user_id = ?
        ORDER BY a.created_at
    """, (uid,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/accounts", status_code=201)
def create_account(data: AccountIn, uid: int = Depends(require_auth)):
    if data.type not in ("current", "savings"):
        raise HTTPException(400, "type must be 'current' or 'savings'")
    conn = db()
    cur = conn.execute(
        "INSERT INTO accounts(user_id, name, type, interest_rate, color) VALUES(?,?,?,?,?)",
        (uid, data.name, data.type, data.interest_rate, data.color),
    )
    conn.commit()
    row = dict(conn.execute("SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)).fetchone())
    conn.close()
    return {**row, "current_balance": None, "last_updated": None}


@app.put("/api/accounts/{aid}")
def update_account(aid: int, data: AccountPatch, uid: int = Depends(require_auth)):
    conn = db()
    if not conn.execute("SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)).fetchone():
        conn.close()
        raise HTTPException(404, "Not found")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE accounts SET {sets} WHERE id=?", [*updates.values(), aid])
        conn.commit()
    row = dict(conn.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone())
    conn.close()
    return row


@app.delete("/api/accounts/{aid}")
def delete_account(aid: int, uid: int = Depends(require_auth)):
    conn = db()
    if not conn.execute("SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)).fetchone():
        conn.close()
        raise HTTPException(404, "Not found")
    conn.execute("DELETE FROM accounts WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─── Balance history ──────────────────────────────────────────────────────────

@app.post("/api/accounts/{aid}/balance")
def record_balance(aid: int, data: BalanceIn, uid: int = Depends(require_auth)):
    conn = db()
    if not conn.execute("SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)).fetchone():
        conn.close()
        raise HTTPException(404, "Not found")
    ts = data.recorded_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        "INSERT INTO balance_history(account_id, balance, notes, recorded_at) VALUES(?,?,?,?)",
        (aid, data.balance, data.notes, ts),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/accounts/{aid}/history")
def get_history(aid: int, days: int = 90, uid: int = Depends(require_auth)):
    conn = db()
    if not conn.execute("SELECT 1 FROM accounts WHERE id=? AND user_id=?", (aid, uid)).fetchone():
        conn.close()
        raise HTTPException(404, "Not found")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = conn.execute(
        "SELECT balance, notes, recorded_at FROM balance_history"
        " WHERE account_id=? AND recorded_at>=? ORDER BY recorded_at",
        (aid, since),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Dashboard APIs ────────────────────────────────────────────────────────────

@app.get("/api/summary")
def get_summary(uid: int = Depends(require_auth)):
    conn = db()
    rows = conn.execute("""
        SELECT a.type, b.balance
        FROM accounts a
        LEFT JOIN balance_history b ON b.id = (
            SELECT id FROM balance_history WHERE account_id=a.id ORDER BY recorded_at DESC, id DESC LIMIT 1
        )
        WHERE a.user_id = ?
    """, (uid,)).fetchall()
    conn.close()
    current = sum(r["balance"] or 0 for r in rows if r["type"] == "current")
    savings = sum(r["balance"] or 0 for r in rows if r["type"] == "savings")
    return {
        "total": current + savings,
        "total_current": current,
        "total_savings": savings,
        "account_count": len(rows),
    }


@app.get("/api/history/all")
def all_history(days: int = 90, uid: int = Depends(require_auth)):
    conn = db()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    accounts = conn.execute(
        "SELECT id, name, color, type FROM accounts WHERE user_id=?", (uid,)
    ).fetchall()
    result = []
    for a in accounts:
        hist = conn.execute(
            "SELECT balance, recorded_at FROM balance_history"
            " WHERE account_id=? AND recorded_at>=? ORDER BY recorded_at",
            (a["id"], since),
        ).fetchall()
        if hist:
            result.append({
                "id": a["id"], "name": a["name"], "color": a["color"], "type": a["type"],
                "history": [{"balance": h["balance"], "date": h["recorded_at"]} for h in hist],
            })
    conn.close()
    return result


@app.get("/api/projections")
def get_projections(months: int = 24, uid: int = Depends(require_auth)):
    conn = db()
    rows = conn.execute("""
        SELECT a.id, a.name, a.interest_rate, a.color, b.balance
        FROM accounts a
        LEFT JOIN balance_history b ON b.id = (
            SELECT id FROM balance_history WHERE account_id=a.id ORDER BY recorded_at DESC, id DESC LIMIT 1
        )
        WHERE a.type = 'savings' AND a.user_id = ?
    """, (uid,)).fetchall()
    conn.close()

    now = datetime.now(timezone.utc)
    projections = []
    for row in rows:
        bal = row["balance"] or 0
        mr = (row["interest_rate"] / 100) / 12
        points = [
            {
                "date": (now + timedelta(days=m * 30.44)).strftime("%Y-%m-%d"),
                "balance": round(bal * math.pow(1 + mr, m), 2),
            }
            for m in range(months + 1)
        ]
        projections.append({
            "id": row["id"], "name": row["name"], "color": row["color"],
            "initial_balance": bal,
            "interest_rate": row["interest_rate"],
            "1yr":  round(bal * math.pow(1 + mr, 12), 2),
            "2yr":  round(bal * math.pow(1 + mr, 24), 2),
            "5yr":  round(bal * math.pow(1 + mr, 60), 2),
            "points": points,
        })
    return projections


# ─── Budget items ──────────────────────────────────────────────────────────────

@app.get("/api/budget")
def list_budget_items(uid: int = Depends(require_auth)):
    conn = db()
    rows = conn.execute(
        "SELECT * FROM budget_items WHERE user_id=? ORDER BY account_id, created_at",
        (uid,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/budget", status_code=201)
def create_budget_item(data: BudgetItemIn, uid: int = Depends(require_auth)):
    if data.frequency not in FREQ_TO_MONTHLY:
        raise HTTPException(400, f"frequency must be one of {list(FREQ_TO_MONTHLY)}")
    conn = db()
    if not conn.execute(
        "SELECT 1 FROM accounts WHERE id=? AND user_id=?", (data.account_id, uid)
    ).fetchone():
        conn.close()
        raise HTTPException(404, "Account not found")
    cur = conn.execute(
        "INSERT INTO budget_items(user_id, account_id, name, amount, frequency) VALUES(?,?,?,?,?)",
        (uid, data.account_id, data.name, data.amount, data.frequency),
    )
    conn.commit()
    row = dict(conn.execute("SELECT * FROM budget_items WHERE id=?", (cur.lastrowid,)).fetchone())
    conn.close()
    return row


@app.put("/api/budget/{bid}")
def update_budget_item(bid: int, data: BudgetItemPatch, uid: int = Depends(require_auth)):
    conn = db()
    if not conn.execute(
        "SELECT 1 FROM budget_items WHERE id=? AND user_id=?", (bid, uid)
    ).fetchone():
        conn.close()
        raise HTTPException(404, "Not found")
    if data.frequency is not None and data.frequency not in FREQ_TO_MONTHLY:
        raise HTTPException(400, "Invalid frequency")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE budget_items SET {sets} WHERE id=?", [*updates.values(), bid])
        conn.commit()
    row = dict(conn.execute("SELECT * FROM budget_items WHERE id=?", (bid,)).fetchone())
    conn.close()
    return row


@app.delete("/api/budget/{bid}")
def delete_budget_item(bid: int, uid: int = Depends(require_auth)):
    conn = db()
    if not conn.execute(
        "SELECT 1 FROM budget_items WHERE id=? AND user_id=?", (bid, uid)
    ).fetchone():
        conn.close()
        raise HTTPException(404, "Not found")
    conn.execute("DELETE FROM budget_items WHERE id=?", (bid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/budget/projection")
def budget_projection(months: int = 6, uid: int = Depends(require_auth)):
    if months not in (3, 6, 12):
        raise HTTPException(400, "months must be 3, 6, or 12")

    conn = db()
    accounts = conn.execute("""
        SELECT a.id, a.name, a.type, a.interest_rate, a.color,
               b.balance AS current_balance
        FROM accounts a
        LEFT JOIN balance_history b ON b.id = (
            SELECT id FROM balance_history WHERE account_id=a.id
            ORDER BY recorded_at DESC, id DESC LIMIT 1
        )
        WHERE a.user_id = ?
        ORDER BY a.created_at
    """, (uid,)).fetchall()

    items = conn.execute(
        "SELECT * FROM budget_items WHERE user_id=?", (uid,)
    ).fetchall()
    conn.close()

    # Sum all budget items into a monthly net flow per account
    monthly_net: dict[int, float] = {}
    for item in items:
        flow = item["amount"] * FREQ_TO_MONTHLY[item["frequency"]]
        monthly_net[item["account_id"]] = monthly_net.get(item["account_id"], 0.0) + flow

    now = datetime.now(timezone.utc)
    result = []
    for acc in accounts:
        bal = acc["current_balance"] or 0.0
        monthly_rate = (acc["interest_rate"] / 100) / 12
        net = monthly_net.get(acc["id"], 0.0)

        # Month 0 = today
        points = [{"month": 0, "balance": round(bal, 2), "date": now.strftime("%Y-%m-%d")}]

        for m in range(1, months + 1):
            # Cash flow at start of period, then interest compounds on the full balance
            bal = (bal + net) * (1 + monthly_rate)
            bal = round(bal, 2)
            date = (now + timedelta(days=m * 30.44)).strftime("%Y-%m-%d")
            points.append({"month": m, "balance": bal, "date": date})

        result.append({
            "id":              acc["id"],
            "name":            acc["name"],
            "type":            acc["type"],
            "color":           acc["color"],
            "current_balance": acc["current_balance"],
            "monthly_net":     round(net, 2),
            "points":          points,
            "final_balance":   points[-1]["balance"],
        })

    return {"months": months, "accounts": result}


# ─── Serve SPA ─────────────────────────────────────────────────────────────────

@app.get("/")
def root(session: Optional[str] = Cookie(None, alias=SESSION_COOKIE)):
    if not session_uid(session or ""):
        return RedirectResponse("/login", status_code=302)
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
