# app/i18n.py — UI language: translation dictionaries and keyed messages.
#
# The dictionaries live in app/static/i18n/{lang}.json (flat key → text, with
# {name} placeholders) and are shared with the SPA, which translates the
# {"key", "params"} messages the API returns. The server only renders text
# itself where no browser is involved: notifications, the login page and
# rows stored for later display.
import json
import logging
import re
from functools import lru_cache
from pathlib import Path

LANGS = ("ca", "en")
DEFAULT_LANG = "ca"
_LOG_LANG = "en"
_DIR = Path(__file__).resolve().parent / "static" / "i18n"
_PLACEHOLDER = re.compile(r"\{(\w+)\}")

log = logging.getLogger("i18n")


@lru_cache(maxsize=None)
def load(lang: str) -> dict:
    """The dictionary for `lang` (cached; {} if missing or unreadable)."""
    try:
        return json.loads((_DIR / f"{lang}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.error("cannot load i18n dictionary %s: %s", lang, e)
        return {}


def ui_lang() -> str:
    """The persisted UI language (Catalan unless switched)."""
    from . import settings   # settings imports this module, so import lazily

    return settings.ui_lang()


def translate(key: str, lang: str | None = None, **params) -> str:
    """Render `key` in `lang` (default: the UI language). Unknown keys render
    as themselves so stored or future keys never break the display."""
    text = load(lang or ui_lang()).get(key, key)
    return _PLACEHOLDER.sub(lambda m: str(params.get(m.group(1), m.group(0))), text)


def message(key: str, **params) -> dict:
    """A message the UI translates: {"key": ..., "params": {...}}."""
    return {"key": key, "params": params}


class KeyedError(Exception):
    """An error whose user-facing text is a dictionary key plus params.

    str() is the English rendering, for logs."""

    def __init__(self, key: str, **params):
        self.key = key
        self.params = params
        super().__init__(translate(key, _LOG_LANG, **params))

    def message(self) -> dict:
        return message(self.key, **self.params)
