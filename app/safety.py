# app/safety.py — account-safety throttles for the personal Telegram account.
#
# Everything here takes its clock / sleep / randomness as an injectable dependency
# so the behaviour can be tested with faked time.
import time
import random
import asyncio
import logging
from typing import Awaitable, Callable

log = logging.getLogger("safety")

# ── FloodWait gate ────────────────────────────────────────────────────
FLOOD_NOTIFY_SECONDS = 600          # notify when a single wait exceeds ten minutes
FLOOD_MAX_BACKOFF_SECONDS = 2 * 3600
FLOOD_STREAK_RESET_SECONDS = 30 * 60  # quiet time after which back-off starts over

Notifier = Callable[[float], Awaitable[None]]


class FloodGate:
    """Global gate shared by every download sender.

    A FloodWait closes the gate for at least the seconds Telegram asked for; repeats
    within FLOOD_STREAK_RESET_SECONDS double the wait (capped). Floods reported while
    the gate is already closed belong to the same event (several senders hit it at once).
    """

    def __init__(self, clock: Callable[[], float] = time.time,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 notifier: Notifier | None = None):
        self._clock = clock
        self._sleep = sleep
        self._notifier = notifier
        self._until = 0.0
        self._streak = 0

    @property
    def closed_until(self) -> float:
        return self._until

    def _backoff(self, seconds: float) -> float:
        grown = seconds * 2 ** (self._streak - 1)
        return max(seconds, min(grown, FLOOD_MAX_BACKOFF_SECONDS))

    async def trip(self, seconds: float) -> float:
        """Record a FloodWait of `seconds`; returns the wait the gate now enforces."""
        now = self._clock()
        if now < self._until:                       # same flood event, another sender
            self._until = max(self._until, now + seconds)
            return self._until - now
        if now - self._until > FLOOD_STREAK_RESET_SECONDS:
            self._streak = 0
        self._streak += 1
        wait = self._backoff(seconds)
        self._until = now + wait
        log.warning("FloodWait %ss (repeat %d) — pausing senders for %.0fs", seconds, self._streak, wait)
        if wait > FLOOD_NOTIFY_SECONDS and self._notifier:
            try:
                await self._notifier(wait)
            except Exception as e:
                log.warning("flood notification failed: %s", e)
        return wait

    async def wait(self) -> None:
        """Sleep until the gate is open."""
        remaining = self._until - self._clock()
        if remaining > 0:
            log.info("flood gate: sleeping %.0fs", remaining)
            await self._sleep(remaining)


# ── channel polling ───────────────────────────────────────────────────
POLL_FLOOR_MINUTES = 15
POLL_JITTER_FRACTION = 0.2          # up to +20% of the interval, so scans never align


def effective_poll_minutes(poll_minutes) -> int:
    """A channel's poll interval with the account-safety floor applied."""
    try:
        return max(POLL_FLOOR_MINUTES, int(poll_minutes or 0))
    except (TypeError, ValueError):
        return POLL_FLOOR_MINUTES


class PollScheduler:
    """Decides when a channel is due for a scan: floor + one jitter draw per scan."""

    def __init__(self, rng: Callable[[], float] = random.random):
        self._rng = rng
        self._jitter: dict[int, tuple[int, float]] = {}   # channel_id -> (last_scanned_at, jitter s)

    def _jitter_for(self, channel_id: int, last_scanned_at: int, interval: float) -> float:
        known = self._jitter.get(channel_id)
        if known and known[0] == last_scanned_at:
            return known[1]
        jitter = self._rng() * POLL_JITTER_FRACTION * interval
        self._jitter = {**self._jitter, channel_id: (last_scanned_at, jitter)}
        return jitter

    def is_due(self, channel_id: int, last_scanned_at: int, poll_minutes, now: float) -> bool:
        if not last_scanned_at:
            return True
        interval = effective_poll_minutes(poll_minutes) * 60
        return now >= last_scanned_at + interval + self._jitter_for(channel_id, last_scanned_at, interval)
