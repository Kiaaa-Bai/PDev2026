// The people of the city, from its lots: who lives where, who works where, when each of them leaves and where
// they walk or drive. All of it is pure and seeded, so a city's people are a function of (lots, seed, the clock)
// and nothing has to be simulated frame by frame: a trip's position is a function of (path, departure, speed, now).
//
// Nothing here draws. A view asks `residentsOf` and `jobsOf` when the city changes, pairs them once with
// `assignJobs`, asks `tripsForDay` for the day of each resident it shows, turns the trips into paths with
// `routeTrips` (cache them until the road changes) and asks `positionAt` where each one is now.

import type { CitySim, Dir } from "./city";
import { JOBS, RESIDENTS, JOB_CAPACITY } from "./kinds";

export { JOBS, RESIDENTS };

/** A cell of the city, [x, y]; lots and road cells both. */
export type Cell = readonly [number, number];

/** What people.ts reads of a city: its lots, their kinds and how old their houses are. */
/** What people read of a city: its lots, their kinds and tiers, and (when the city zones) the zone each lot holds now. */
export type CityLots = Pick<CitySim, "lots" | "kinds" | "houseTier"> & Partial<Pick<CitySim, "lotZone">>;

export interface Resident {
  /** The same for this person as the house grows, and different for everyone in the city (a safe integer). */
  id: number;
  home: Cell;
}

export interface Job {
  /** Different for every job in the city (a safe integer). */
  id: number;
  work: Cell;
}

export interface Trip {
  from: Cell;
  to: Cell;
  /** When it sets off, ms since the epoch. A late outing's way home departs on the next day, after midnight. */
  depart: number;
  /** "work" is a trip to work, "home" a trip home, "errand" the trip out to a shop or park. */
  purpose: "work" | "home" | "errand";
}

/** Cells a second on foot and by car (the roller drives one). */
export const WALK_SPEED = 1.2;
export const DRIVE_SPEED = 4;
/** A path of this many cells or fewer is walked; a longer one is driven. */
export const WALK_MAX_CELLS = 8;

// ---------------------------------------------------------------------------------------------------------------
// who lives and works where

/** Ids are `cell * SLOTS + slot`; a home holds at most 20 residents and a workplace 30 jobs. Cells must lie within ±1,000,000. */
const SLOTS = 32;
const CELL_OFFSET = 1_000_000;
const CELL_SPAN = 2_000_001;
const cellId = (x: number, y: number) => (x + CELL_OFFSET) * CELL_SPAN + (y + CELL_OFFSET);

/** Parses a lot's key, "x,y". */
function cellOf(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

const isHome = (kind: string): kind is keyof typeof RESIDENTS => kind in RESIDENTS;
const isWorkplace = (kind: string): kind is keyof typeof JOBS => kind in JOBS;

/**
 * Everyone who lives in the city at time `t`: each home holds as many people as its kind and its house's tier at `t`
 * allow, none before the house has appeared. Ids are stable: a person stays the same person while the house grows.
 */
export function residentsOf(sim: CityLots, t: number): Resident[] {
  const out: Resident[] = [];
  for (const [key, kind] of sim.kinds) {
    if (!isHome(kind)) continue;
    const [x, y] = cellOf(key);
    if (sim.lotZone && sim.lotZone(x, y) !== "residential") continue; // a home its avenue turned into a shop or an office
    const tier = sim.houseTier(x, y, t);
    if (tier === 0) continue;
    const n = RESIDENTS[kind][tier - 1];
    const base = cellId(x, y) * SLOTS;
    for (let i = 0; i < n; i++) out.push({ id: base + i, home: [x, y] });
  }
  return out;
}

/**
 * Every job in the city: a workplace holds the same number from the lot's first moment, whatever its age (a shop
 * 4, an office 12, the landmark 30). Counts lots that exist, as `CitySim.demand` does, so a workplace whose building
 * is a few seconds from appearing already has people assigned to it.
 */
export function jobsOf(sim: CityLots, t?: number): Job[] {
  const out: Job[] = [];
  for (const [key, kind] of sim.kinds) {
    const [x, y] = cellOf(key);
    // a lot works as the zone it holds now: a rezoned home has a shop's or an office's jobs
    const zone = sim.lotZone?.(x, y);
    const as = zone === "commercial" ? "shop" : zone === "office" ? "office" : kind;
    if (!isWorkplace(as)) continue;
    const base = cellId(x, y) * SLOTS;
    // at a time, as many as the building's density holds (a lot whose building is still to come counts as low)
    const n = t === undefined ? JOBS[as] : JOB_CAPACITY[as][Math.max(1, sim.houseTier(x, y, t)) - 1];
    for (let i = 0; i < n; i++) out.push({ id: base + i, work: [x, y] });
  }
  return out;
}

/** The lots people run errands to: shops and parks. */
export function placesOf(sim: Pick<CitySim, "kinds">): [number, number][] {
  const out: [number, number][] = [];
  for (const [key, kind] of sim.kinds) if (kind === "shop" || kind === "park") out.push(cellOf(key));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// seeded randomness

const mix = (h: number, v: number): number => {
  h = Math.imul(h ^ v, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
};
/** Folds a whole number of up to 53 bits into a hash. */
const mixNum = (h: number, v: number): number => mix(mix(h, v >>> 0), Math.trunc(v / 4294967296) | 0);

/** A number in [0, 1) that is a fixed function of the seed and up to three whole numbers. */
export function unit(seed: number, a: number, b = 0, c = 0): number {
  let h = mixNum(0x2545f491, seed);
  h = mixNum(h, a);
  h = mixNum(h, b);
  h = mixNum(h, c);
  return (mix(h, 0x9e3779b9) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------------------
// jobs for residents

/** Workplaces are filed into square buckets of this many cells, to look for the nearest free one ring by ring. */
const BUCKET = 8;
const BUCKET_OFFSET = 1 << 20;
const BUCKET_SPAN = 1 << 21;
const bucketKey = (bx: number, by: number) => (bx + BUCKET_OFFSET) * BUCKET_SPAN + (by + BUCKET_OFFSET);

interface Workplace {
  x: number;
  y: number;
  /** For the last tie-break: the lot's own number. */
  cell: number;
  /** Its jobs still free, highest id first, so `pop` takes the lowest. */
  free: number[];
}

/**
 * Pairs residents with jobs: each resident, taken in a seeded order, gets a free job at the nearest workplace by
 * grid distance (|dx| + |dy|); of equally near workplaces the seed picks. A job goes to one resident at most,
 * jobs of a workplace go lowest id first, and a resident left over when every job is taken maps to null. The grid
 * distance, not the road's, is the cost (it is cheap, and the road is not known to the pairing). Pure: the same
 * residents, jobs and seed give the same map, whatever order the lists come in.
 */
export function assignJobs(residents: readonly Resident[], jobs: readonly Job[], seed: number): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const r of residents) out.set(r.id, null);
  if (residents.length === 0 || jobs.length === 0) return out;

  const places = new Map<number, Workplace>();
  for (const j of jobs) {
    const id = cellId(j.work[0], j.work[1]);
    let w = places.get(id);
    if (!w) places.set(id, (w = { x: j.work[0], y: j.work[1], cell: id, free: [] }));
    w.free.push(j.id);
  }
  const buckets = new Map<number, Workplace[]>();
  let minBx = Infinity;
  let maxBx = -Infinity;
  let minBy = Infinity;
  let maxBy = -Infinity;
  for (const w of places.values()) {
    w.free.sort((a, b) => b - a);
    const bx = Math.floor(w.x / BUCKET);
    const by = Math.floor(w.y / BUCKET);
    const k = bucketKey(bx, by);
    const list = buckets.get(k);
    if (list) list.push(w);
    else buckets.set(k, [w]);
    minBx = Math.min(minBx, bx);
    maxBx = Math.max(maxBx, bx);
    minBy = Math.min(minBy, by);
    maxBy = Math.max(maxBy, by);
  }

  // residents are served in a seeded order, so nobody is always first by where they live
  const order = residents
    .map((r) => ({ r, turn: unit(seed, r.id, 1) }))
    .sort((a, b) => a.turn - b.turn || a.r.id - b.r.id);

  for (const { r } of order) {
    if (buckets.size === 0) break; // every job is taken: the rest have none
    const [hx, hy] = r.home;
    // the best workplace so far; its tie-break number is worked out only if another one is as near
    const pick: { w: Workplace | null; dist: number; tie: number } = { w: null, dist: Infinity, tie: -1 };
    const tieOf = (w: Workplace) => unit(seed, r.id, w.cell, 2);
    const consider = (w: Workplace) => {
      const d = Math.abs(w.x - hx) + Math.abs(w.y - hy);
      if (d > pick.dist) return;
      if (d < pick.dist) {
        pick.w = w;
        pick.dist = d;
        pick.tie = -1;
        return;
      }
      if (pick.tie < 0) pick.tie = tieOf(pick.w!);
      const tie = tieOf(w);
      if (tie < pick.tie || (tie === pick.tie && w.cell < pick.w!.cell)) {
        pick.w = w;
        pick.tie = tie;
      }
    };

    const bx = Math.floor(hx / BUCKET);
    const by = Math.floor(hy / BUCKET);
    const lastRing = Math.max(bx - minBx, maxBx - bx, by - minBy, maxBy - by);
    for (let ring = 0; ring <= lastRing; ring++) {
      if (buckets.size <= 8 * ring) {
        // fewer buckets left than this ring has: look at all of them, starting over so each is seen once
        pick.w = null;
        pick.dist = Infinity;
        pick.tie = -1;
        for (const list of buckets.values()) for (const w of list) consider(w);
        break;
      }
      if (ring === 0) {
        for (const w of buckets.get(bucketKey(bx, by)) ?? []) consider(w);
      } else {
        for (let dx = -ring; dx <= ring; dx++) {
          for (const w of buckets.get(bucketKey(bx + dx, by - ring)) ?? []) consider(w);
          for (const w of buckets.get(bucketKey(bx + dx, by + ring)) ?? []) consider(w);
        }
        for (let dy = -ring + 1; dy <= ring - 1; dy++) {
          for (const w of buckets.get(bucketKey(bx - ring, by + dy)) ?? []) consider(w);
          for (const w of buckets.get(bucketKey(bx + ring, by + dy)) ?? []) consider(w);
        }
      }
      // a bucket in any ring beyond this one is at least ring * BUCKET + 1 cells away
      if (pick.w !== null && pick.dist <= ring * BUCKET) break;
    }

    const w = pick.w;
    if (w === null) continue; // unreachable: some workplace has a free job, and every ring was searched
    out.set(r.id, w.free.pop()!);
    if (w.free.length === 0) {
      const k = bucketKey(Math.floor(w.x / BUCKET), Math.floor(w.y / BUCKET));
      const list = buckets.get(k)!;
      list.splice(list.indexOf(w), 1);
      if (list.length === 0) buckets.delete(k);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the day

/** Local clock windows, in minutes after midnight. */
const OUT = [7 * 60, 9.5 * 60] as const; // to work
const BACK = [16.5 * 60, 19 * 60] as const; // home from work
/**
 * Daytime errands: three a day, starting 110 minutes apart from a resident's own phase. Each takes 20 to 35 minutes
 * (27.5 on average), so 27.5 / 110 = a quarter of everyone is out at any moment between about 10:40 and 15:40, and no
 * two of one resident's errands meet. The last is back by 16:15, before anyone leaves work at 16:30.
 */
const ERRANDS = 3;
const ERRAND_FIRST = 605;
const ERRAND_PERIOD = 110;
const ERRAND_JITTER = 10;
const DWELL = [20, 35] as const;
/** A share of residents go out once more in the evening, so the night is never quite empty: it may run past midnight. */
const EVENING_SHARE = 0.08;
const EVENING = [19.5 * 60, 23.75 * 60] as const;
/** An errand goes to one of this many nearest places. */
const NEAREST_PLACES = 4;

const between = (u: number, [lo, hi]: readonly [number, number]) => lo + u * (hi - lo);

/** The `n` places nearest `base` by grid distance, never `base` itself; ties go by position, so the order of `places` does not matter. */
function nearestPlaces(places: readonly Cell[], base: Cell, n: number): Cell[] {
  const best: { cell: Cell; d: number }[] = [];
  for (const cell of places) {
    if (cell[0] === base[0] && cell[1] === base[1]) continue;
    const d = Math.abs(cell[0] - base[0]) + Math.abs(cell[1] - base[1]);
    if (best.length === n) {
      const last = best[n - 1];
      if (d > last.d || (d === last.d && (cell[0] > last.cell[0] || (cell[0] === last.cell[0] && cell[1] >= last.cell[1])))) continue;
    }
    let i = best.length;
    while (i > 0 && (best[i - 1].d > d || (best[i - 1].d === d && (best[i - 1].cell[0] > cell[0] || (best[i - 1].cell[0] === cell[0] && best[i - 1].cell[1] > cell[1]))))) i--;
    best.splice(i, 0, { cell, d });
    if (best.length > n) best.pop();
  }
  return best.map((b) => b.cell);
}

/**
 * One resident's day on the local clock of the day starting at `dayStartMs` (local midnight), in the order the trips
 * depart. An employed resident goes to work between 07:00 and 09:30 and home between 16:30 and 19:00. Everyone,
 * employed or not, runs three errands to the nearest shops and parks in the daytime (from work if they work, else from
 * home), each there and back, spaced so that about a quarter of the residents are out at any moment from 10:00 to
 * 16:00; and about one in twelve goes out once more in the evening, from home, between 19:30 and 23:45, so a few are
 * about after 21:00 and a late one's way home departs on the next day. Without `places` (shops and parks), or with no
 * place but the lot itself, nobody has an errand. Everyone is home at the end of the day. A function of its arguments
 * alone: the same resident gets a different day on another date or under another seed.
 */
export function tripsForDay(
  residentId: number,
  home: Cell,
  work: Cell | null,
  dayStartMs: number,
  seed: number,
  places: readonly Cell[] = [],
): Trip[] {
  const d = new Date(dayStartMs);
  const [year, month, date] = [d.getFullYear(), d.getMonth(), d.getDate()];
  const day = year * 10_000 + (month + 1) * 100 + date;
  // wall-clock times, so a day with a clock change still leaves at 07:00 by the clock; past 24:00 is the next day
  const at = (minutes: number) => new Date(year, month, date, 0, 0, Math.round(minutes * 60)).getTime();
  const rnd = (n: number) => unit(seed, residentId, day, n);
  const trips: Trip[] = [];

  if (work) {
    trips.push({ from: home, to: work, depart: at(between(rnd(1), OUT)), purpose: "work" });
    trips.push({ from: work, to: home, depart: at(between(rnd(2), BACK)), purpose: "home" });
  }

  /** Out to one of the nearest places and back `dwell` minutes later, as the errand number `n`. */
  const errand = (base: Cell, back: Trip["purpose"], near: readonly Cell[], n: number, start: number, dwell: number) => {
    if (near.length === 0) return;
    const place = near[Math.min(near.length - 1, Math.floor(rnd(40 + n) * near.length))];
    trips.push({ from: base, to: place, depart: at(start), purpose: "errand" });
    trips.push({ from: place, to: base, depart: at(start + dwell), purpose: back });
  };

  if (places.length > 0) {
    const base = work ?? home;
    const near = nearestPlaces(places, base, NEAREST_PLACES);
    const phase = rnd(3);
    for (let k = 0; k < ERRANDS; k++) {
      const start = ERRAND_FIRST + (phase + k) * ERRAND_PERIOD + (rnd(10 + k) - 0.5) * ERRAND_JITTER;
      errand(base, work ? "work" : "home", near, k, start, between(rnd(20 + k), DWELL));
    }
    if (rnd(4) < EVENING_SHARE) {
      const nearHome = work ? nearestPlaces(places, home, NEAREST_PLACES) : near;
      errand(home, "home", nearHome, ERRANDS, between(rnd(5), EVENING), between(rnd(6), DWELL));
    }
  }

  return trips.sort((a, b) => a.depart - b.depart);
}

/**
 * The place a resident is out at on an errand at time `t`, or null: from the errand's departure to the trip back,
 * which takes in the time spent at the shop or park. `trips` is a day from `tripsForDay`. A trip is over in seconds
 * (a path of some tens of cells at 1.2 or 4 cells a second), so the people on errands are mostly *at* their place, not
 * on the road: this is where a view finds them.
 */
export function errandAt(trips: readonly Trip[], t: number): Cell | null {
  for (let i = 0; i + 1 < trips.length; i++) {
    if (trips[i].purpose === "errand" && trips[i].depart <= t && t < trips[i + 1].depart) return trips[i].to;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// the way there

const KEY_OFFSET = 1 << 20;
const KEY_SPAN = 1 << 21;
const keyOf = (x: number, y: number) => (x + KEY_OFFSET) * KEY_SPAN + (y + KEY_OFFSET);
const stepsE = [1, 0, -1, 0] as const;
const stepsS = [0, 1, 0, -1] as const;

/**
 * The shortest way along road from the lot `from` to the lot `to`, as the road cells to pass: the first is beside
 * `from`, the last beside `to`. A breadth-first search from every road cell beside the origin lot at once, so it
 * starts from whichever gives the shortest way, and ends at the first road cell beside the destination lot it
 * reaches. Null when there is no road beside either lot, when no road joins them, or when more than `maxNodes` road
 * cells are searched before it finds the way. The same inputs give the same path, whichever of equal paths it takes
 * (it tries east, south, west, north in turn).
 */
export function roadPath(
  isRoad: (x: number, y: number) => boolean,
  from: Cell,
  to: Cell,
  maxNodes = 4000,
): [number, number][] | null {
  const goals = new Set<number>();
  for (let d = 0; d < 4; d++) {
    const x = to[0] + stepsE[d];
    const y = to[1] + stepsS[d];
    if (isRoad(x, y)) goals.add(keyOf(x, y));
  }
  if (goals.size === 0) return null;

  const parent = new Map<number, number>();
  const queue: number[] = [];
  for (let d = 0; d < 4; d++) {
    const x = from[0] + stepsE[d];
    const y = from[1] + stepsS[d];
    if (!isRoad(x, y)) continue;
    const k = keyOf(x, y);
    if (parent.has(k)) continue;
    parent.set(k, -1);
    queue.push(k);
  }
  for (let head = 0; head < queue.length; head++) {
    if (head >= maxNodes) return null;
    const k = queue[head];
    if (goals.has(k)) {
      const path: [number, number][] = [];
      for (let at = k; at !== -1; at = parent.get(at)!) {
        path.push([Math.floor(at / KEY_SPAN) - KEY_OFFSET, (at % KEY_SPAN) - KEY_OFFSET]);
      }
      return path.reverse();
    }
    const x = Math.floor(k / KEY_SPAN) - KEY_OFFSET;
    const y = (k % KEY_SPAN) - KEY_OFFSET;
    for (let d = 0; d < 4; d++) {
      const nx = x + stepsE[d];
      const ny = y + stepsS[d];
      const nk = keyOf(nx, ny);
      if (parent.has(nk) || !isRoad(nx, ny)) continue;
      parent.set(nk, k);
      queue.push(nk);
    }
  }
  return null;
}

/** On foot (up to WALK_MAX_CELLS cells) or by car, and how fast, in cells a second. */
export function travelOf(path: readonly Cell[]): { walking: boolean; speed: number } {
  const walking = path.length <= WALK_MAX_CELLS;
  return { walking, speed: walking ? WALK_SPEED : DRIVE_SPEED };
}

/**
 * Where a trip is at time `t`: along `path` at `speed` cells a second from `depart`, between cell centres, facing the
 * way it is going (0 east, 1 south, 2 west, 3 north, as the roller). Null before it departs and from the moment it
 * arrives, so a path of one cell, which takes no time, is never seen. It depends on nothing but its arguments, so
 * it does not care what day it is: a trip begun before midnight is still under way after.
 */
export function positionAt(
  path: readonly Cell[],
  depart: number,
  speed: number,
  t: number,
): { x: number; y: number; heading: Dir } | null {
  const cells = ((t - depart) / 1000) * speed;
  if (!(cells >= 0) || cells >= path.length - 1) return null;
  const i = Math.floor(cells);
  const f = cells - i;
  const [ax, ay] = path[i];
  const [bx, by] = path[i + 1];
  const dx = bx - ax;
  const dy = by - ay;
  const heading: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
  return { x: ax + dx * f, y: ay + dy * f, heading };
}

/** A trip with its way: what a view draws. */
export interface Route {
  trip: Trip;
  path: [number, number][];
  /** Cells a second: walking or driving, by the path's length. */
  speed: number;
  /** When it arrives, ms since the epoch. */
  arrive: number;
}

/** The trips that have a way along road, in their order, each with its path, speed and arrival; the rest are dropped. */
export function routeTrips(isRoad: (x: number, y: number) => boolean, trips: readonly Trip[], maxNodes = 4000): Route[] {
  const out: Route[] = [];
  for (const trip of trips) {
    const path = roadPath(isRoad, trip.from, trip.to, maxNodes);
    if (path === null) continue;
    const { speed } = travelOf(path);
    out.push({ trip, path, speed, arrive: trip.depart + ((path.length - 1) / speed) * 1000 });
  }
  return out;
}
