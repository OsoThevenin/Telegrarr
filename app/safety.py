# app/safety.py — account-safety throttles for the personal Telegram account.
#
# Everything here takes its clock / sleep / randomness as an injectable dependency
# so the behaviour can be tested with faked time.
import time
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
