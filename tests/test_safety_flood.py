"""Global FloodWait gate: exponential back-off and long-wait notification (faked time)."""
import pytest

from app.safety import FloodGate


class FakeTime:
    """A clock plus an async sleep that advances it instead of waiting."""

    def __init__(self, start=1_000_000.0):
        self.now = start
        self.slept = []

    def clock(self):
        return self.now

    async def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def _gate(t, notes):
    async def notifier(seconds):
        notes.append(seconds)
    return FloodGate(clock=t.clock, sleep=t.sleep, notifier=notifier)


@pytest.mark.asyncio
async def test_open_gate_does_not_sleep():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    await gate.wait()
    assert t.slept == []


@pytest.mark.asyncio
async def test_first_flood_waits_the_requested_seconds():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    assert await gate.trip(30) == 30
    await gate.wait()
    assert sum(t.slept) >= 30
    await gate.wait()                     # gate re-opened, no extra sleep
    assert len(t.slept) == 1


@pytest.mark.asyncio
async def test_backoff_doubles_between_repeats():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    waits = []
    for _ in range(3):
        waits.append(await gate.trip(20))
        await gate.wait()
    assert waits == [20, 40, 80]


@pytest.mark.asyncio
async def test_backoff_resets_after_a_quiet_period():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    await gate.trip(20)
    await gate.wait()
    await gate.trip(20)
    await gate.wait()
    t.now += 31 * 60                      # 31 quiet minutes
    assert await gate.trip(20) == 20


@pytest.mark.asyncio
async def test_backoff_is_capped_but_never_below_telegram_request():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    for _ in range(12):
        w = await gate.trip(3000)
        await gate.wait()
    assert w == 7200
    assert await _gate(FakeTime(), []).trip(9000) == 9000


@pytest.mark.asyncio
async def test_concurrent_trips_while_closed_count_as_one_event():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    await gate.trip(700)
    t.now += 1
    await gate.trip(700)                  # a second sender hits the same flood
    assert len(notes) == 1
    await gate.wait()
    assert await gate.trip(10) == 20      # streak is 2, not 3


@pytest.mark.asyncio
async def test_wait_over_ten_minutes_notifies():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    await gate.trip(601)
    assert notes == [601]


@pytest.mark.asyncio
async def test_wait_of_ten_minutes_or_less_is_silent():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    await gate.trip(600)
    assert notes == []


@pytest.mark.asyncio
async def test_backoff_growth_can_cross_the_notify_threshold():
    t, notes = FakeTime(), []
    gate = _gate(t, notes)
    for _ in range(3):                    # 200, 400, 800
        await gate.trip(200)
        await gate.wait()
    assert notes == [800]


@pytest.mark.asyncio
async def test_notifier_failure_does_not_break_the_gate():
    t = FakeTime()

    async def boom(_seconds):
        raise RuntimeError("webhook down")
    gate = FloodGate(clock=t.clock, sleep=t.sleep, notifier=boom)
    assert await gate.trip(900) == 900
