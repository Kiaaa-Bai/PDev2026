import type { TouchRecord } from "../data";
import { Rng } from "../rng";

/**
 * A generated pointer wander, so a city can be measured and photographed without anyone's own data.
 * Pure: the same seed gives the same records. The pointer lives in screen points, like the capture
 * source's: y down, one finger (id 0), a sample about every 38 ms while it moves.
 */

/** A typical laptop screen, in points. */
export const SCREEN = { w: 1728, h: 1117 };

/** The pointer is only used between these local hours. */
const ACTIVE_HOURS = [9, 18] as const;
/** Points in one stroke, down and up included. */
const STROKE_POINTS = [20, 400] as const;
/** Milliseconds between two samples. */
const SAMPLE_MS = [33, 45] as const;
/** Seconds the pointer rests between two strokes of a burst. */
const PAUSE_S = [1, 40] as const;
/** A burst of strokes lasts this many minutes, then the pointer rests (reading, typing, a meeting) this many. */
const BURST_MIN = [3, 15] as const;
const REST_MIN = [15, 75] as const;
/** Screen points the pointer covers between two samples, drifting within this range. */
const STEP_PT = [4, 30] as const;
/** The most the heading can turn between two samples, radians. */
const TURN = 0.35;

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng.next() * (hi - lo);
const intBetween = (rng: Rng, [lo, hi]: readonly [number, number]) => Math.floor(between(rng, [lo, hi + 1]));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** One stroke from `t0`: starts anywhere on the screen heading anywhere, curving and bouncing off the edges. */
function stroke(rng: Rng, t0: number): TouchRecord[] {
  const n = intBetween(rng, STROKE_POINTS);
  let x = rng.next() * SCREEN.w;
  let y = rng.next() * SCREEN.h;
  let heading = rng.next() * 2 * Math.PI;
  let step = between(rng, STEP_PT);
  let t = t0;
  const out: TouchRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t, id: 0, x: round1(x), y: round1(y), state: i === 0 ? "down" : i === n - 1 ? "up" : "move" });
    t += intBetween(rng, SAMPLE_MS);
    heading += (rng.next() - 0.5) * 2 * TURN;
    step = Math.min(STEP_PT[1], Math.max(STEP_PT[0], step + (rng.next() - 0.5) * 8));
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    if (x < 0 || x > SCREEN.w) {
      x = x < 0 ? -x : 2 * SCREEN.w - x;
      heading = Math.PI - heading;
    }
    if (y < 0 || y > SCREEN.h) {
      y = y < 0 ? -y : 2 * SCREEN.h - y;
      heading = -heading;
    }
  }
  return out;
}

/**
 * `days` working days of a wandering pointer, the first on the local date of `startMs`, then the days
 * after it. Each day it works in bursts of strokes with pauses between them, resting between bursts,
 * from 09:00 to 18:00 local time.
 */
export function testCityRecords(seed: number, days: number, startMs: number): TouchRecord[] {
  const rng = new Rng(seed);
  const first = new Date(startMs);
  const out: TouchRecord[] = [];
  for (let day = 0; day < days; day++) {
    const at = (hour: number) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + day, hour).getTime();
    const end = at(ACTIVE_HOURS[1]);
    let t = at(ACTIVE_HOURS[0]) + between(rng, [0, 10 * 60_000]);
    while (t < end) {
      const burstEnd = t + between(rng, BURST_MIN) * 60_000;
      while (t < burstEnd) {
        const s = stroke(rng, Math.round(t));
        if (s[s.length - 1].t > end) break;
        out.push(...s);
        t = s[s.length - 1].t + between(rng, PAUSE_S) * 1000;
      }
      t = Math.max(t, burstEnd) + between(rng, REST_MIN) * 60_000;
    }
  }
  return out;
}

const two = (n: number) => String(n).padStart(2, "0");

/** The name the capture source gives the day file of the local day `t` falls in. */
function dayFileName(t: number): string {
  const d = new Date(t);
  return `cursor-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.jsonl`;
}

/** The records as day files, one `cursor-YYYY-MM-DD.jsonl` per local day, a record to a line, in date order. */
export function testCityDayFiles(records: TouchRecord[]): { name: string; text: string }[] {
  const lines = new Map<string, string[]>();
  for (const r of records) {
    const name = dayFileName(r.t);
    const day = lines.get(name) ?? [];
    day.push(JSON.stringify(r));
    lines.set(name, day);
  }
  return [...lines].map(([name, day]) => ({ name, text: day.join("\n") + "\n" }));
}
