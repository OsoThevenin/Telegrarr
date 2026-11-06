# app/auth.py — bcrypt credentials + signed, expiring, revocable session cookie.
import time
import secrets
import threading
import bcrypt as _bcrypt
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from fastapi import Request, HTTPException
from . import db, settings
from .config import SECRET_KEY, DEFAULT_USER, DEFAULT_PASS

MAX_AGE = 7 * 86400   # cookies expire server-side after 7 days
MIN_PASSWORD_LEN = 12
_signer = URLSafeTimedSerializer(SECRET_KEY or secrets.token_hex(32), salt="telearr-session")

# ── login throttling ──────────────────────────────────────────────────
# Telearr is commonly published to a LAN (and sometimes past the router),
# so an unthrottled /login is a standing password-guessing target. Track
# recent failures per client and lock the source out for a spell once it
# trips the limit. In-process state is enough: the app runs single-worker.
MAX_ATTEMPTS = 8            # failures allowed inside the window
ATTEMPT_WINDOW = 300.0      # seconds the failures are counted over
LOCKOUT_SECONDS = 900.0     # how long a tripped client stays locked out

_attempts: dict[str, list[float]] = {}
_locked_until: dict[str, float] = {}
_throttle_lock = threading.Lock()

# A real bcrypt hash of a throwaway value. Verifying against it when the
# username does not exist keeps the response time of "no such user" and
# "wrong password" comparable, so login cannot be used to enumerate names.
_DUMMY_HASH = _bcrypt.hashpw(secrets.token_bytes(16), _bcrypt.gensalt()).decode()


def client_key(request: Request) -> str:
    """Identify the caller for throttling purposes."""
    return (request.client.host if request.client else "unknown") or "unknown"


def throttle_retry_after(key: str) -> int:
    """Seconds the caller must wait, or 0 when it may attempt a login."""
    now = time.monotonic()
    with _throttle_lock:
        until = _locked_until.get(key, 0.0)
        if until > now:
            return int(until - now) + 1
        if until:
            del _locked_until[key]
        return 0


def record_failure(key: str) -> None:
    now = time.monotonic()
    with _throttle_lock:
        hits = [t for t in _attempts.get(key, []) if now - t < ATTEMPT_WINDOW]
        hits.append(now)
        _attempts[key] = hits
        if len(hits) >= MAX_ATTEMPTS:
            _locked_until[key] = now + LOCKOUT_SECONDS
            _attempts.pop(key, None)


def record_success(key: str) -> None:
    with _throttle_lock:
        _attempts.pop(key, None)
        _locked_until.pop(key, None)


def _hash(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode()[:72], _bcrypt.gensalt()).decode()


def _check(pw: str, h: str) -> bool:
    try:
        return _bcrypt.checkpw(pw.encode()[:72], h.encode())
    except Exception:
        return False


def _epoch() -> str:
    # bumped on password change → all previously-issued cookies become invalid
    return str(settings.get("session_epoch", "0"))


def ensure_default_user():
    if not DEFAULT_PASS:
        return
    with db.conn() as c:
        if c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            return
        c.execute("INSERT INTO users(username, pw_hash) VALUES(?,?)",
                  (DEFAULT_USER, _hash(DEFAULT_PASS)))


def verify(username: str, password: str) -> bool:
    with db.conn() as c:
        r = c.execute("SELECT pw_hash FROM users WHERE username=?", (username,)).fetchone()
    if not r:
        # Spend the same bcrypt time as a real check so an unknown username
        # is not distinguishable from a wrong password by response latency.
        _check(password, _DUMMY_HASH)
        return False
    return _check(password, r["pw_hash"])


def set_password(username: str, password: str):
    with db.conn() as c:
        c.execute("UPDATE users SET pw_hash=? WHERE username=?", (_hash(password), username))
    # revoke every existing session
    settings.set("session_epoch", str(int(_epoch() or 0) + 1))


def username_exists(username: str) -> bool:
    with db.conn() as c:
        return c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone() is not None


def set_username(old: str, new: str):
    with db.conn() as c:
        c.execute("UPDATE users SET username=? WHERE username=?", (new, old))
    # revoke every existing session (the caller re-issues a fresh cookie)
    settings.set("session_epoch", str(int(_epoch() or 0) + 1))


def make_cookie(username: str) -> str:
    return _signer.dumps({"u": username, "e": _epoch()})


def cookie_user(request: Request):
    tok = request.cookies.get("telearr_sess")
    if not tok:
        return None
    try:
        data = _signer.loads(tok, max_age=MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    if str(data.get("e")) != _epoch():   # revoked by a password change
        return None
    return data.get("u")


def require_user(request: Request):
    u = cookie_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    return u
