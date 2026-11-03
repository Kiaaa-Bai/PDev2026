// Which moment the City tab's sky follows. Pure, so it can be tested in node.

/** `?hour=22` (or `?hour=19.5`) from a page's query string, as hours; null when absent or not a number. */
export function hourParam(search: string): number | null {
  const hour = parseFloat(new URLSearchParams(search).get("hour") ?? "");
  return Number.isFinite(hour) ? hour : null;
}

const DAY_MS = 24 * 3_600_000;
/** Holding the fast-forward key this long runs the sky through one whole day. */
const FAST_DAY_MS = 12_000;

/** How far ahead of now the sky is shown after holding the fast-forward key for `heldMs`; wraps after a day. */
export function fastForward(heldMs: number): number {
  return ((heldMs / FAST_DAY_MS) * DAY_MS) % DAY_MS;
}

/**
 * The moment the sky follows: today at `hour` when that is given (the dev override), else a replayed
 * recording's own time (`replayed`, ms, null when nothing is being replayed), else `now`.
 */
export function skyTime(hour: number | null, replayed: number | null, now: Date = new Date()): Date {
  if (hour !== null) {
    const d = new Date(now);
    d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    return d;
  }
  return replayed !== null ? new Date(replayed) : now;
}

/**
 * The clock the people and cars follow: with an `hour` (the dev override) it starts there today and runs on as time
 * passes, so traffic moves on the page; without, it is `now` itself.
 */
export function runningClock(hour: number | null, now: () => Date = () => new Date()): () => Date {
  if (hour === null) return now;
  const offset = skyTime(hour, null, now()).getTime() - now().getTime();
  return () => new Date(now().getTime() + offset);
}
