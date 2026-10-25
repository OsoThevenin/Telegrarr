# app/settings.py — DB-backed runtime settings with env-based defaults.
# Anything here can be changed from the UI and takes effect live (no rebuild).
from . import db
from . import config

DEFAULTS = {
    "dl_workers": config.DL_WORKERS,
    "max_concurrent": config.MAX_CONCURRENT_DOWNLOADS,
    "min_free_gb": config.MIN_FREE_SPACE_GB,
    "progress_interval": config.PROGRESS_MIN_INTERVAL,
    "plex_url": config.PLEX_URL,
    "plex_token": config.PLEX_TOKEN,
    "notify_webhook": config.NOTIFY_WEBHOOK,
    "notify_telegram": "0",        # DM completed downloads to the account's Saved Messages
    "default_poll_minutes": 10,
    "history_limit_per_show": 0,   # 0 = keep every completed record
    "tmdb_key": "",                # optional TMDB api key for poster artwork
    "paused": "0",
    # Connect page (*arr registration). Keys are secrets: exposed only as *_key_set.
    "prowlarr_url": "",
    "prowlarr_key": "",
    "sonarr_url": "",
    "sonarr_key": "",
    "radarr_url": "",
    "radarr_key": "",
    "telegrarr_url": "",           # how Prowlarr/Sonarr/Radarr reach Telegrarr, e.g. http://telegrarr:8790
}

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
        "default_poll_minutes": get_int("default_poll_minutes", 10),
        "history_limit_per_show": get_int("history_limit_per_show", 0),
        "plex_url": get("plex_url", DEFAULTS["plex_url"]),
        "plex_token_set": bool(get("plex_token", "")),
        "tmdb_key_set": bool(get("tmdb_key", "")),
        "notify_webhook": get("notify_webhook", DEFAULTS["notify_webhook"]),
        "notify_telegram": get_bool("notify_telegram", False),
        "paused": get_bool("paused", False),
        "proxy_set": bool(get("tg_proxy", "")),
        **_arr_public(),
    }


def _arr_public() -> dict:
    view = {"telegrarr_url": get("telegrarr_url", "")}
    for name in ARR_APPS:
        view[f"{name}_url"] = get(f"{name}_url", "")
        view[f"{name}_key_set"] = bool(get(f"{name}_key", ""))
    return view


def _http_url(value) -> str:
    """Normalise a base URL; empty clears it, anything but http(s) is rejected."""
    url = str(value).strip().rstrip("/")
    if url and not url.lower().startswith(("http://", "https://")):
        raise ValueError(f"not an http(s) URL: {url!r}")
    return url


# keys the UI is allowed to write, with a coercer for each
WRITABLE = {
    "dl_workers": lambda v: str(max(1, min(32, int(float(v))))),
    "max_concurrent": lambda v: str(max(1, min(8, int(float(v))))),
    "min_free_gb": lambda v: str(max(0, int(float(v)))),
    "progress_interval": lambda v: str(max(0.25, min(10.0, float(v)))),
    "default_poll_minutes": lambda v: str(max(1, int(float(v)))),
    "history_limit_per_show": lambda v: str(max(0, int(float(v)))),
    "plex_url": lambda v: str(v).rstrip("/"),
    "plex_token": lambda v: str(v),
    "notify_webhook": lambda v: str(v),
    "notify_telegram": lambda v: "1" if str(v).strip().lower() in ("1", "true", "yes", "on") else "0",
    "tmdb_key": lambda v: str(v).strip(),
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
    """Validate + persist a settings patch; returns the new public view."""
    for k, v in payload.items():
        if k in WRITABLE and v is not None:
            try:
                set(k, WRITABLE[k](v))
            except (TypeError, ValueError):
                pass
    return public()
