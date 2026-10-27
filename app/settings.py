# app/settings.py — DB-backed runtime settings with env-based defaults.
# Anything here can be changed from the UI and takes effect live (no rebuild).
import os

from . import db
from . import config
from .i18n import DEFAULT_LANG, LANGS, KeyedError


class SettingRejected(KeyedError, ValueError):
    """A settings value the user must fix (reported as HTTP 400), not silently clamped."""


def poll_minutes(v) -> int:
    """Validate a channel poll interval against the account-safety floor."""
    try:
        minutes = int(float(v))
    except (TypeError, ValueError):
        raise SettingRejected("err.settings.poll_number")
    if minutes < config.POLL_FLOOR_MINUTES:
        raise SettingRejected("err.settings.poll_floor", floor=config.POLL_FLOOR_MINUTES)
    return minutes


def _budget_gb(v) -> str:
    gb = float(v)
    if gb < 0:
        raise SettingRejected("err.settings.budget")
    return str(gb)


DEFAULTS = {
    "dl_workers": config.DL_WORKERS,
    "max_concurrent": config.MAX_CONCURRENT_DOWNLOADS,
    "min_free_gb": config.MIN_FREE_SPACE_GB,
    "progress_interval": config.PROGRESS_MIN_INTERVAL,
    "plex_url": config.PLEX_URL,
    "plex_token": config.PLEX_TOKEN,
    "notify_webhook": config.NOTIFY_WEBHOOK,
    "notify_telegram": "0",        # DM completed downloads to the account's Saved Messages
    "default_poll_minutes": config.POLL_FLOOR_MINUTES,
    "history_limit_per_show": 0,   # 0 = keep every completed record
    "tmdb_key": "",                # optional TMDB api key for poster artwork
    "paused": "0",
    "ui_lang": DEFAULT_LANG,       # UI + notification language: "ca" or "en"
    "daily_budget_gb": 0,          # account safety: max GB downloaded per day, 0 = unlimited
    # *arr integration (Telegrarr): "arr" = scans only index releases, Sonarr/Radarr
    # grab them into the flat downloads layout; "standalone" = upstream auto-download
    # into the library layout.
    "operating_mode": "arr",
    "downloads_dir": config.DOWNLOADS_DIR,
    # Connect page (*arr registration). Keys are secrets: exposed only as *_key_set.
    "prowlarr_url": "",
    "prowlarr_key": "",
    "sonarr_url": "",
    "sonarr_key": "",
    "radarr_url": "",
    "radarr_key": "",
    "telegrarr_url": "",           # how Prowlarr/Sonarr/Radarr reach Telegrarr, e.g. http://telegrarr:8790
}

OPERATING_MODES = ("arr", "standalone")
ARR_APPS = ("prowlarr", "sonarr", "radarr")


def get(key, default=None):
    with db.conn() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if r is not None:
        return r["value"]
    if default is not None:
        return default
    d = DEFAULTS.get(key)
    return "" if d is None else str(d)


def set(key, value):
    with db.conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def get_int(key, default):
    try:
        return int(float(get(key, str(default))))
    except (TypeError, ValueError):
        return default


def get_float(key, default):
    try:
        return float(get(key, str(default)))
    except (TypeError, ValueError):
        return default


def get_bool(key, default=False):
    return str(get(key, "1" if default else "0")).strip().lower() in ("1", "true", "yes", "on")


def public() -> dict:
    """Settings safe to expose to the UI (secrets reported as booleans only)."""
    return {
        "dl_workers": get_int("dl_workers", DEFAULTS["dl_workers"]),
        "max_concurrent": get_int("max_concurrent", DEFAULTS["max_concurrent"]),
        "min_free_gb": get_int("min_free_gb", DEFAULTS["min_free_gb"]),
        "progress_interval": get_float("progress_interval", DEFAULTS["progress_interval"]),
        "default_poll_minutes": max(config.POLL_FLOOR_MINUTES,
                                    get_int("default_poll_minutes", config.POLL_FLOOR_MINUTES)),
        "poll_floor_minutes": config.POLL_FLOOR_MINUTES,
        "history_limit_per_show": get_int("history_limit_per_show", 0),
        "plex_url": get("plex_url", DEFAULTS["plex_url"]),
        "plex_token_set": bool(get("plex_token", "")),
        "tmdb_key_set": bool(get("tmdb_key", "")),
        "notify_webhook": get("notify_webhook", DEFAULTS["notify_webhook"]),
        "notify_telegram": get_bool("notify_telegram", False),
        "paused": get_bool("paused", False),
        "ui_lang": ui_lang(),
        "proxy_set": bool(get("tg_proxy", "")),
        "daily_budget_gb": get_float("daily_budget_gb", 0.0),
        "operating_mode": operating_mode(),
        "downloads_dir": get("downloads_dir"),
        **_arr_public(),
    }


def ui_lang() -> str:
    lang = get("ui_lang")
    return lang if lang in LANGS else DEFAULT_LANG


def _coerce_lang(v) -> str:
    lang = str(v).strip().lower()
    if lang not in LANGS:
        raise SettingRejected("err.settings.ui_lang")
    return lang


def operating_mode() -> str:
    mode = get("operating_mode")
    return mode if mode in OPERATING_MODES else DEFAULTS["operating_mode"]


def is_arr_mode() -> bool:
    return operating_mode() == "arr"


def arr_root() -> str:
    """Where *arr grabs land: <downloads base>/telegram (category folders below)."""
    return os.path.join(get("downloads_dir"), "telegram")


def _coerce_mode(v) -> str:
    mode = str(v).strip().lower()
    if mode not in OPERATING_MODES:
        raise ValueError(f"unknown operating mode {v!r}")
    return mode


def _coerce_abs_dir(v) -> str:
    path = os.path.normpath(str(v).strip())
    if not os.path.isabs(path):
        raise ValueError(f"not an absolute path: {v!r}")
    return path


def _arr_public() -> dict:
    view = {"telegrarr_url": get("telegrarr_url", "")}
    for name in ARR_APPS:
        view[f"{name}_url"] = get(f"{name}_url", "")
        view[f"{name}_key_set"] = bool(get(f"{name}_key", ""))
    return view


def _http_url(value) -> str:
    """Normalise a base URL; empty clears it, anything but http(s) is rejected (HTTP 400)."""
    url = str(value).strip().rstrip("/")
    if url and not url.lower().startswith(("http://", "https://")):
        raise SettingRejected("err.settings.url_scheme")
    return url


# keys the UI is allowed to write, with a coercer for each
WRITABLE = {
    "dl_workers": lambda v: str(max(1, min(32, int(float(v))))),
    "max_concurrent": lambda v: str(max(1, min(8, int(float(v))))),
    "min_free_gb": lambda v: str(max(0, int(float(v)))),
    "progress_interval": lambda v: str(max(0.25, min(10.0, float(v)))),
    "default_poll_minutes": lambda v: str(poll_minutes(v)),
    "history_limit_per_show": lambda v: str(max(0, int(float(v)))),
    "plex_url": lambda v: str(v).rstrip("/"),
    "plex_token": lambda v: str(v),
    "notify_webhook": lambda v: str(v),
    "notify_telegram": lambda v: "1" if str(v).strip().lower() in ("1", "true", "yes", "on") else "0",
    "tmdb_key": lambda v: str(v).strip(),
    "daily_budget_gb": _budget_gb,
    "operating_mode": _coerce_mode,
    "ui_lang": _coerce_lang,
    "downloads_dir": _coerce_abs_dir,
    # Connect page
    "telegrarr_url": _http_url,
    "prowlarr_url": _http_url,
    "prowlarr_key": lambda v: str(v).strip(),
    "sonarr_url": _http_url,
    "sonarr_key": lambda v: str(v).strip(),
    "radarr_url": _http_url,
    "radarr_key": lambda v: str(v).strip(),
}


def apply(payload: dict) -> dict:
    """Validate + persist a settings patch; returns the new public view.

    Malformed values are skipped, but a SettingRejected aborts the whole patch
    (nothing is persisted) so the UI can show the reason."""
    coerced = {}
    for k, v in payload.items():
        if k in WRITABLE and v is not None:
            try:
                coerced[k] = WRITABLE[k](v)
            except SettingRejected:
                raise
            except (TypeError, ValueError):
                pass
    for k, v in coerced.items():
        set(k, v)
    return public()
