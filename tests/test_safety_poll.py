"""Channel polling: 15-minute floor plus bounded random jitter (faked time and randomness)."""
from app.safety import POLL_FLOOR_MINUTES, POLL_JITTER_FRACTION, PollScheduler

LAST = 1_000_000


def _rng(*values):
    seq = iter(values)
    return lambda: next(seq)


def test_floor_is_fifteen_minutes():
    assert POLL_FLOOR_MINUTES == 15


def test_never_scanned_channel_is_due_immediately():
    sched = PollScheduler(rng=_rng(0.5))
    assert sched.is_due(1, 0, 60, now=LAST)


def test_interval_below_floor_is_raised_to_floor():
    sched = PollScheduler(rng=lambda: 0.0)
    assert not sched.is_due(1, LAST, 5, now=LAST + 15 * 60 - 1)
    assert sched.is_due(1, LAST, 5, now=LAST + 15 * 60)


def test_interval_above_floor_is_respected():
    sched = PollScheduler(rng=lambda: 0.0)
    assert not sched.is_due(1, LAST, 60, now=LAST + 59 * 60)
    assert sched.is_due(1, LAST, 60, now=LAST + 60 * 60)


def test_jitter_upper_bound():
    sched = PollScheduler(rng=lambda: 0.999999)
    interval = 30 * 60
    max_due = LAST + interval * (1 + POLL_JITTER_FRACTION)
    assert not sched.is_due(1, LAST, 30, now=LAST + interval)
    assert sched.is_due(1, LAST, 30, now=max_due)


def test_jitter_is_a_fifth_of_the_interval():
    assert POLL_JITTER_FRACTION == 0.2


def test_jitter_is_drawn_once_per_scan_not_per_check():
    sched = PollScheduler(rng=_rng(0.9, 0.0))
    check_at = LAST + 15 * 60 + 1          # due only if the second draw (0.0) were used
    assert not sched.is_due(1, LAST, 15, now=check_at)
    assert not sched.is_due(1, LAST, 15, now=check_at)


def test_new_scan_draws_new_jitter():
    sched = PollScheduler(rng=_rng(0.9, 0.0))
    assert not sched.is_due(1, LAST, 15, now=LAST + 15 * 60)
    later = LAST + 10_000
    assert sched.is_due(1, later, 15, now=later + 15 * 60)


def test_channels_have_independent_jitter():
    sched = PollScheduler(rng=_rng(0.9, 0.0))
    assert not sched.is_due(1, LAST, 15, now=LAST + 15 * 60)
    assert sched.is_due(2, LAST, 15, now=LAST + 15 * 60)
