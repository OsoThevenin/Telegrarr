"""Optional daily download budget, reset at local midnight (faked time)."""
import datetime

from app import safety, settings

GB = 1024 ** 3
# a fixed local afternoon, so the tests do not depend on the machine's timezone
NOON = datetime.datetime(2026, 3, 10, 14, 0).timestamp()
NEXT_MIDNIGHT = datetime.datetime(2026, 3, 11, 0, 0).timestamp()


def test_budget_is_unlimited_by_default(fresh_db):
    safety.record_download(500 * GB, now=NOON)
    status = safety.budget_status(now=NOON)
    assert status["limit_gb"] == 0
    assert status["exhausted"] is False


def test_budget_not_exhausted_below_limit(fresh_db):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(GB // 2, now=NOON)
    status = safety.budget_status(now=NOON)
    assert status["used_bytes"] == GB // 2
    assert status["exhausted"] is False


def test_budget_exhausted_once_limit_reached(fresh_db):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(GB // 2, now=NOON)
    safety.record_download(GB // 2, now=NOON + 60)
    assert safety.budget_exhausted(now=NOON + 60) is True


def test_budget_resets_at_next_local_midnight(fresh_db):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(2 * GB, now=NOON)
    assert safety.budget_status(now=NOON)["resets_at"] == NEXT_MIDNIGHT
    assert safety.budget_exhausted(now=NEXT_MIDNIGHT - 1) is True
    status = safety.budget_status(now=NEXT_MIDNIGHT)
    assert status["exhausted"] is False
    assert status["used_bytes"] == 0


def test_usage_after_rollover_counts_from_zero(fresh_db):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(2 * GB, now=NOON)
    safety.record_download(GB // 4, now=NEXT_MIDNIGHT + 3600)
    assert safety.budget_status(now=NEXT_MIDNIGHT + 3600)["used_bytes"] == GB // 4


def test_fractional_budget_supported(fresh_db):
    settings.apply({"daily_budget_gb": 0.5})
    safety.record_download(GB // 2, now=NOON)
    assert safety.budget_exhausted(now=NOON) is True


def test_raising_the_limit_lifts_the_pause(fresh_db):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(GB, now=NOON)
    settings.apply({"daily_budget_gb": 0})
    assert safety.budget_exhausted(now=NOON) is False
