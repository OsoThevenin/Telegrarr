"""Tests for app.settings — DB-backed runtime settings (sqlite only)."""
import pytest

from app import settings


# --------------------------------------------------------------------------
# WRITABLE coercers clamp to their allowed ranges
# --------------------------------------------------------------------------
@pytest.mark.parametrize("value, expected", [
    (0, "1"), (-10, "1"),      # below min -> 1
    (100, "32"), (999, "32"),  # above max -> 32
    (4, "4"), ("8", "8"),      # in range (and string input)
    (4.9, "4"),                # float truncates
])
def test_dl_workers_clamped_1_32(value, expected):
    assert settings.WRITABLE["dl_workers"](value) == expected


@pytest.mark.parametrize("value, expected", [
    (0, "1"), (50, "8"), (3, "3"), ("2", "2"),
])
def test_max_concurrent_clamped_1_8(value, expected):
    assert settings.WRITABLE["max_concurrent"](value) == expected


@pytest.mark.parametrize("value, expected", [
    (-5, "0"), (0, "0"), (7, "7"),
])
def test_min_free_gb_min_zero(value, expected):
    assert settings.WRITABLE["min_free_gb"](value) == expected


@pytest.mark.parametrize("value, expected", [
    (0.1, "0.25"), (0.0, "0.25"),   # below min -> 0.25
    (100, "10.0"),                  # above max -> 10.0
    (2, "2.0"), ("1.5", "1.5"),     # in range
])
def test_progress_interval_clamped(value, expected):
    assert settings.WRITABLE["progress_interval"](value) == expected


def test_plex_url_trailing_slash_stripped():
    assert settings.WRITABLE["plex_url"]("http://plex:32400/") == "http://plex:32400"


# --------------------------------------------------------------------------
# get_int / get_float / get_bool parse safely
# --------------------------------------------------------------------------
def test_get_int_missing_key_returns_default(fresh_db):
    assert settings.get_int("does_not_exist", 9) == 9


def test_get_int_garbage_returns_default(fresh_db):
    settings.set("junk", "not-a-number")
    assert settings.get_int("junk", 3) == 3


def test_get_int_parses_float_string(fresh_db):
    settings.set("num", "7.9")
    assert settings.get_int("num", 0) == 7


def test_get_float_garbage_returns_default(fresh_db):
    settings.set("junkf", "abc")
    assert settings.get_float("junkf", 1.5) == 1.5


def test_get_float_parses(fresh_db):
    settings.set("f", "2.5")
    assert settings.get_float("f", 0.0) == 2.5


@pytest.mark.parametrize("stored, expected", [
    ("1", True), ("true", True), ("YES", True), ("on", True),
    ("0", False), ("false", False), ("nope", False), ("", False),
])
def test_get_bool_parses(fresh_db, stored, expected):
    settings.set("b", stored)
    assert settings.get_bool("b", False) is expected


def test_get_bool_missing_uses_default(fresh_db):
    assert settings.get_bool("missing_b", True) is True
    assert settings.get_bool("missing_b2", False) is False


# --------------------------------------------------------------------------
# apply() persists and returns public()
# --------------------------------------------------------------------------
def test_apply_persists_and_clamps(fresh_db):
    pub = settings.apply({"dl_workers": 999})
    assert pub["dl_workers"] == 32
    # persisted: a fresh read agrees
    assert settings.get_int("dl_workers", 0) == 32


def test_apply_ignores_unknown_keys(fresh_db):
    pub = settings.apply({"totally_bogus": "x"})
    assert "totally_bogus" not in pub


def test_apply_ignores_none_values(fresh_db):
    settings.set("dl_workers", "5")
    settings.apply({"dl_workers": None})
    assert settings.get_int("dl_workers", 0) == 5


def test_apply_returns_public_view(fresh_db):
    pub = settings.apply({"max_concurrent": 2})
    assert pub == settings.public()


# --------------------------------------------------------------------------
# public() never leaks the plex_token secret
# --------------------------------------------------------------------------
def test_public_never_leaks_plex_token(fresh_db):
    settings.apply({"plex_token": "super-secret-token"})
    pub = settings.public()
    assert "plex_token" not in pub
    assert pub["plex_token_set"] is True
    # the raw value must not appear anywhere in the exposed view
    assert "super-secret-token" not in repr(pub)


def test_public_token_not_set_reports_false(fresh_db):
    pub = settings.public()
    assert pub["plex_token_set"] is False


# --------------------------------------------------------------------------
# *arr layout defaults: homelab /downloads/telegram, *arr mode
# --------------------------------------------------------------------------
def test_arr_layout_defaults_to_downloads_telegram_in_arr_mode(fresh_db):
    public = settings.public()

    assert public["downloads_dir"] == "/downloads"
    assert settings.arr_root() == "/downloads/telegram"
    assert public["operating_mode"] == "arr"


def test_unknown_operating_mode_is_rejected(fresh_db):
    assert settings.apply({"operating_mode": "bogus"})["operating_mode"] == "arr"
