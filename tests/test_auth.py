"""Tests for password hashing/verification.

``app.auth`` imports ``itsdangerous`` and ``fastapi`` at module top, which may
not be installed in a minimal dev env. So the app-level tests are guarded with
``pytest.importorskip`` and skip cleanly when those deps are missing. The pure
bcrypt roundtrip below mirrors the exact implementation in ``app.auth`` and
always runs (bcrypt is a hard runtime dependency).
"""
import pytest

bcrypt = pytest.importorskip("bcrypt")


# --------------------------------------------------------------------------
# Standalone bcrypt roundtrip mirroring app.auth._hash / _check.
# --------------------------------------------------------------------------
def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def _check(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], h.encode())
    except Exception:
        return False


def test_bcrypt_roundtrip_correct_password():
    h = _hash("correct horse battery staple")
    assert _check("correct horse battery staple", h) is True


def test_bcrypt_roundtrip_wrong_password():
    h = _hash("correct horse battery staple")
    assert _check("wrong password", h) is False


def test_bcrypt_empty_hash_fails_gracefully():
    assert _check("anything", "") is False


def test_bcrypt_garbage_hash_fails_gracefully():
    assert _check("anything", "not-a-valid-bcrypt-hash") is False


def test_bcrypt_hashes_are_salted_and_unique():
    # same password hashed twice -> different digests, both verify
    h1, h2 = _hash("samepw"), _hash("samepw")
    assert h1 != h2
    assert _check("samepw", h1) and _check("samepw", h2)


def test_bcrypt_long_password_truncated_to_72_bytes():
    # bcrypt only considers the first 72 bytes; app.auth truncates explicitly.
    base = "a" * 72
    h = _hash(base)
    assert _check(base + "extra-ignored-tail", h) is True


# --------------------------------------------------------------------------
# App-level helpers — only when optional web deps are importable.
# --------------------------------------------------------------------------
def test_app_auth_hash_check_roundtrip():
    pytest.importorskip("itsdangerous")
    pytest.importorskip("fastapi")
    from app import auth

    h = auth._hash("s3cret")
    assert auth._check("s3cret", h) is True
    assert auth._check("nope", h) is False
    assert auth._check("s3cret", "") is False


# --------------------------------------------------------------------------
# Login throttling — protects /login from password guessing.
# --------------------------------------------------------------------------
@pytest.fixture()
def auth_mod():
    pytest.importorskip("itsdangerous")
    pytest.importorskip("fastapi")
    from app import auth

    # Each test starts from a clean throttle state.
    auth._attempts.clear()
    auth._locked_until.clear()
    yield auth
    auth._attempts.clear()
    auth._locked_until.clear()


def test_throttle_allows_attempts_below_the_limit(auth_mod):
    for _ in range(auth_mod.MAX_ATTEMPTS - 1):
        auth_mod.record_failure("10.0.0.1")
    assert auth_mod.throttle_retry_after("10.0.0.1") == 0


def test_throttle_locks_out_at_the_limit(auth_mod):
    for _ in range(auth_mod.MAX_ATTEMPTS):
        auth_mod.record_failure("10.0.0.2")
    wait = auth_mod.throttle_retry_after("10.0.0.2")
    assert wait > 0
    assert wait <= auth_mod.LOCKOUT_SECONDS + 1


def test_throttle_is_per_client(auth_mod):
    for _ in range(auth_mod.MAX_ATTEMPTS):
        auth_mod.record_failure("10.0.0.3")
    assert auth_mod.throttle_retry_after("10.0.0.3") > 0
    assert auth_mod.throttle_retry_after("10.0.0.4") == 0


def test_successful_login_clears_the_counter(auth_mod):
    for _ in range(auth_mod.MAX_ATTEMPTS - 1):
        auth_mod.record_failure("10.0.0.5")
    auth_mod.record_success("10.0.0.5")
    # The earlier failures are forgotten, so the budget is whole again.
    for _ in range(auth_mod.MAX_ATTEMPTS - 1):
        auth_mod.record_failure("10.0.0.5")
    assert auth_mod.throttle_retry_after("10.0.0.5") == 0


def test_lockout_expires(auth_mod, monkeypatch):
    for _ in range(auth_mod.MAX_ATTEMPTS):
        auth_mod.record_failure("10.0.0.6")
    assert auth_mod.throttle_retry_after("10.0.0.6") > 0

    real = auth_mod.time.monotonic
    monkeypatch.setattr(auth_mod.time, "monotonic",
                        lambda: real() + auth_mod.LOCKOUT_SECONDS + 1)
    assert auth_mod.throttle_retry_after("10.0.0.6") == 0


def test_old_failures_fall_out_of_the_window(auth_mod, monkeypatch):
    for _ in range(auth_mod.MAX_ATTEMPTS - 1):
        auth_mod.record_failure("10.0.0.7")

    real = auth_mod.time.monotonic
    monkeypatch.setattr(auth_mod.time, "monotonic",
                        lambda: real() + auth_mod.ATTEMPT_WINDOW + 1)
    # The stale failures are discarded, so this one does not trip the lock.
    auth_mod.record_failure("10.0.0.7")
    assert auth_mod.throttle_retry_after("10.0.0.7") == 0


def test_verify_rejects_unknown_user_without_raising(auth_mod, fresh_db):
    assert auth_mod.verify("no-such-user", "whatever") is False


def test_app_auth_username_change(fresh_db):
    pytest.importorskip("itsdangerous")
    pytest.importorskip("fastapi")
    from app import auth, db

    with db.conn() as c:
        c.execute("INSERT INTO users(username, pw_hash) VALUES(?,?)",
                  ("alice", auth._hash("pw123456")))
    assert auth.verify("alice", "pw123456")
    assert auth.username_exists("alice")
    assert not auth.username_exists("newname")

    auth.set_username("alice", "newname")
    assert auth.username_exists("newname")
    assert not auth.username_exists("alice")
    # the password still verifies under the new username
    assert auth.verify("newname", "pw123456")
