# app/log_redaction.py — keeps credentials out of the container logs.
import copy
import logging
import re

MASK = "***"

_ENCODED_EQUALS = r"%(?:25)*3D"     # `=` after one or more rounds of URL-encoding
_ENCODED_AMPERSAND = r"%(?:25)*26"
_KEY_PARAM = re.compile(
    rf"(api_?key(?:=|{_ENCODED_EQUALS}))(?:(?!&|{_ENCODED_AMPERSAND})[^\s'\"])*",
    re.IGNORECASE,
)


def redact(value: object) -> str:
    """``value`` as text, with every ``apikey`` / ``api_key`` parameter's value masked.

    Covers parameters nested URL-encoded in another one: Sonarr and Radarr hand an
    NZB link, key included, back to the SABnzbd API as its ``name`` parameter."""
    return _KEY_PARAM.sub(rf"\g<1>{MASK}", str(value))


class _RedactArgs(logging.Filter):
    """Redacts a record's string args. uvicorn's formatter unpacks them, so their shape stays."""

    def filter(self, record: logging.LogRecord) -> logging.LogRecord | bool:
        if not isinstance(record.args, tuple):
            return True
        redacted = copy.copy(record)
        redacted.args = tuple(redact(arg) if isinstance(arg, str) else arg for arg in record.args)
        return redacted


def protect_logs() -> None:
    """Keep credentials out of the loggers that print request URLs.

    Runs at import of app.main: uvicorn configures its loggers before importing the app."""
    logging.getLogger("uvicorn.access").addFilter(_RedactArgs())
    # Silenced, not redacted: its INFO line prints every outbound URL, and a webhook's
    # secret sits in the path, where no parameter name marks it.
    logging.getLogger("httpx").setLevel(logging.WARNING)
