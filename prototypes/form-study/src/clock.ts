// Which moment the City tab's sky follows. Pure, so it can be tested in node.

/** `?hour=22` (or `?hour=19.5`) from a page's query string, as hours; null when absent or not a number. */
export function hourParam(search: string): number | null {
  const hour = parseFloat(new URLSearchParams(search).get("hour") ?? "");
  return Number.isFinite(hour) ? hour : null;
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
