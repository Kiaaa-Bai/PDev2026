// What the people of the city are doing at a moment, drawn out of people.ts: who is on the road (and in what), who is
// standing at a shop or park, who is strolling the pavements. All of it is pure and seeded, like people.ts; nothing here
// draws or keeps time. A view builds the `Population` when the city changes, a `Plan` for each person near the camera,
// and asks `entriesFor` what that person is doing in a stretch of time.

import { JOBS } from "./kinds";
import { assignJobs, DRIVE_SPEED, jobsOf, placesOf, residentsOf, travelOf, tripsForDay, unit, WALK_SPEED, type Cell, type CityLots, type Trip } from "./people";

/** How a person goes: in a car, or on foot at the kerb. */
export type Mode = "car" | "walk";

export type IsRoad = (x: number, y: number) => boolean;

/** A resident with the workplace their job is at, or none. */
export interface Person {
  id: number;
  home: Cell;
  work: Cell | null;
}

export interface Population {
  people: Person[];
  /** Shops and parks, which errands go to. */
  places: Cell[];
  /** The service vehicles that drive between the workplaces. */
  fleet: Vehicle[];
}

/**
 * Everyone in the city at time `t` (ids and houses as `residentsOf`), each with the workplace `assignJobs` gave them
 * (null when the jobs ran out). Seconds of work on a big city (assignJobs is 35 ms on 26,000 residents): not for a frame.
 */
export function buildPopulation(sim: CityLots, t: number, seed: number): Population {
  const residents = residentsOf(sim, t);
  const jobs = jobsOf(sim);
  const given = assignJobs(residents, jobs, seed);
  const where = new Map<number, Cell>();
  for (const j of jobs) where.set(j.id, j.work);
  const people = residents.map((r): Person => {
    const job = given.get(r.id);
    return { id: r.id, home: r.home, work: job === null || job === undefined ? null : (where.get(job) ?? null) };
  });
  return { people, places: placesOf(sim), fleet: buildFleet(workplacesOf(sim), seed) };
}

/** The lots people work at: shops, offices and the landmark. */
export function workplacesOf(sim: Pick<CityLots, "kinds">): Cell[] {
  const out: Cell[] = [];
  for (const [key, kind] of sim.kinds) {
    if (!(kind in JOBS)) continue;
    const comma = key.indexOf(",");
    out.push([Number(key.slice(0, comma)), Number(key.slice(comma + 1))]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// strolls

/** A stroll is made of legs: out along the pavements this many cells, and back the way it came. */
export const STROLL_STEPS = 10;
/** One leg takes this long on foot; a stroll is a whole number of them, so it ends where it began. */
export const STROLL_LEG_MS = ((2 * STROLL_STEPS) / WALK_SPEED) * 1000;
/** A stroll is 36 to 144 legs: 10 to 40 minutes. */
const STROLL_LEGS = [36, 144] as const;
/** A trip is looked for on the road this long after it departs; a longer one (a path over 480 cells) is let go. */
export const MAX_TRANSIT_MS = 120_000;
/** A resident goes back indoors this long before their next departure. */
const BACK_INSIDE_MS = 30_000;

const E = [1, 0, -1, 0] as const;
const S = [0, 1, 0, -1] as const;

/**
 * One leg of a stroll around the lot `base`: from a road cell beside it, `STROLL_STEPS` cells along the road, and back
 * the same way (21 cells, the first and last the same). Each step takes a seeded choice among the road cells around,
 * not the one it came from, which it turns back to only at a dead end; a lone road cell is walked on the spot. The
 * start cell is fixed for the stroll (`who` and `key`), the way round differs by `leg`, so successive legs begin where
 * the last ended. Null when no road touches the lot. The same arguments give the same leg.
 */
export function strollLeg(isRoad: IsRoad, base: Cell, seed: number, who: number, key: number, leg: number): Cell[] | null {
  const starts: Cell[] = [];
  for (let d = 0; d < 4; d++) {
    const x = base[0] + E[d];
    const y = base[1] + S[d];
    if (isRoad(x, y)) starts.push([x, y]);
  }
  if (starts.length === 0) return null;
  const out: Cell[] = [starts[Math.floor(unit(seed, who, key, 999_999) * starts.length)]];
  let prev: Cell | null = null;
  for (let step = 1; step <= STROLL_STEPS; step++) {
    const cur = out[out.length - 1];
    const options: Cell[] = [];
    for (let d = 0; d < 4; d++) {
      const x = cur[0] + E[d];
      const y = cur[1] + S[d];
      if (isRoad(x, y) && !(prev !== null && prev[0] === x && prev[1] === y)) options.push([x, y]);
    }
    if (options.length === 0) options.push(prev ?? cur); // a dead end: turn round
    const next = options[Math.floor(unit(seed, who, key, leg * 32 + step) * options.length)];
    prev = cur;
    out.push(next);
  }
  return [...out, ...out.slice(0, -1).reverse()];
}

/** A stroll around the lot `base`: from `start` to `end` (ms), in whole legs. `key` tells one of a person's strolls from another. */
export interface Stroll {
  key: number;
  base: Cell;
  start: number;
  end: number;
}

/** Three strolls a day, one in each of these local windows (minutes after midnight): morning, afternoon, evening. */
const IDLE_WINDOWS = [
  [7 * 60, 12 * 60],
  [12 * 60, 17 * 60],
  [17 * 60, 21.5 * 60],
] as const;
const IDLE_ATTEMPTS = 3;

/**
 * A person's strolls on the day starting at `dayStartMs`: one in the morning, one in the afternoon and one in the evening, each
 * 10 to 40 minutes, around wherever they are at the time: work between getting there and leaving it, home otherwise.
 * `trips` is their day (with the tail of yesterday): a stroll that would cross a trip, run into the stay at an errand,
 * or keep them out when they are due to leave is tried at two other times and dropped if none fits. So the people of a
 * city are out and about even where there is no shop or park to go to. Pure.
 */
export function idleStrolls(trips: readonly Trip[], person: Person, dayStartMs: number, seed: number): Stroll[] {
  const d = new Date(dayStartMs);
  const [year, month, date] = [d.getFullYear(), d.getMonth(), d.getDate()];
  const day = year * 10_000 + (month + 1) * 100 + date;
  const at = (minutes: number) => new Date(year, month, date, 0, 0, Math.round(minutes * 60)).getTime();

  const busy: [number, number][] = [];
  for (let i = 0; i < trips.length; i++) {
    busy.push([trips[i].depart, trips[i].depart + MAX_TRANSIT_MS]);
    if (trips[i].purpose === "errand" && i + 1 < trips.length) busy.push([trips[i].depart, trips[i + 1].depart]);
  }
  const whereAt = (t: number): Cell => {
    let cell = person.home;
    for (const trip of trips) {
      if (trip.depart > t) break;
      cell = trip.to;
    }
    return cell;
  };

  const out: Stroll[] = [];
  IDLE_WINDOWS.forEach(([lo, hi], k) => {
    const [from, to] = [at(lo), at(hi)];
    const legs = Math.round(STROLL_LEGS[0] + unit(seed, person.id, day, 70 + k) * (STROLL_LEGS[1] - STROLL_LEGS[0]));
    const length = legs * STROLL_LEG_MS;
    for (let attempt = 0; attempt < IDLE_ATTEMPTS; attempt++) {
      // it may start any time in its window and run on past the end of it, so the people out are as many at its edges as inside
      const start = from + unit(seed, person.id, day, 80 + k * IDLE_ATTEMPTS + attempt) * (to - from);
      const end = start + length;
      if (busy.some(([a, b]) => start < b && end + BACK_INSIDE_MS > a)) continue;
      out.push({ key: day * 10 + k, base: whereAt(start), start, end });
      busy.push([start, end + BACK_INSIDE_MS]);
      return;
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// a person's day

/** What one person does on one day: their trips (the tail of yesterday first) and their idle strolls. */
export interface Plan {
  trips: Trip[];
  strolls: Stroll[];
}

/** How much of yesterday evening a plan reaches back: an errand begun at 23:45 is back after midnight. */
const TAIL_MS = 6 * 3_600_000;

/**
 * The plan of `person` for the day starting at `dayStartMs` (local midnight). With `tail`, yesterday's trips from 18:00
 * on come first, so somebody still out at a place after midnight is found there and their way home is seen.
 */
export function planFor(person: Person, dayStartMs: number, seed: number, places: readonly Cell[], tail: boolean): Plan {
  const today = tripsForDay(person.id, person.home, person.work, dayStartMs, seed, places);
  let trips = today;
  if (tail) {
    const d = new Date(dayStartMs);
    const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
    const cut = dayStartMs - TAIL_MS;
    trips = [...tripsForDay(person.id, person.home, person.work, yesterday, seed, places).filter((t) => t.depart >= cut), ...today];
  }
  return { trips, strolls: idleStrolls(trips, person, dayStartMs, seed) };
}

interface Timed {
  who: number;
  /** The entry counts from this moment (ms) up to `until`. */
  from: number;
  until: number;
}

/** On the road: along `path` from `depart` at `speed` cells a second (`positionAt`). */
export interface Move extends Timed {
  type: "move";
  path: readonly Cell[];
  depart: number;
  speed: number;
  mode: Mode;
}
/** Standing outside the shop or park `place`. */
export interface Stand extends Timed {
  type: "stand";
  place: Cell;
}
/** Strolling the pavements round `stroll.base`. */
export interface StrollEntry extends Timed {
  type: "stroll";
  stroll: Stroll;
}
export type Entry = Move | Stand | StrollEntry;

/** The way from one lot to another: a path, null for none, undefined when it is not known yet (out of time to look). */
export type PathOf = (from: Cell, to: Cell) => Cell[] | null | undefined;

/** Of the people at an errand's place this share stroll round it and the rest stand outside. */
export const STROLL_SHARE = 0.5;

/**
 * What `person` is doing between `from` and `to` (ms), as entries: each trip under way, the stay at the place of each
 * errand (as standing outside or strolling round it) and each idle stroll, the ones that overlap the window. A trip,
 * and the stay at the end of an errand's trip out, count only when `pathOf` knows a way: nobody who could not get there
 * is drawn there. `pending` is true when `pathOf` did not know yet for some trip; the entries are then missing that one.
 */
export function entriesFor(
  person: Person,
  plan: Plan,
  from: number,
  to: number,
  seed: number,
  pathOf: PathOf,
): { entries: Entry[]; pending: boolean } {
  const entries: Entry[] = [];
  let pending = false;
  const { trips } = plan;
  const who = person.id;
  for (let k = 0; k < trips.length; k++) {
    const trip = trips[k];
    const next = k + 1 < trips.length ? trips[k + 1] : null;
    const underWay = trip.depart <= to && trip.depart + MAX_TRANSIT_MS > from;
    const stay = trip.purpose === "errand" && next !== null && trip.depart <= to && next.depart > from;
    if (!underWay && !stay) continue;
    const path = pathOf(trip.from, trip.to);
    if (path === undefined) {
      pending = true;
      continue;
    }
    if (path === null) continue; // no way: the trip is never made
    const { walking, speed } = travelOf(path);
    const arrive = trip.depart + ((path.length - 1) / speed) * 1000;
    if (underWay && path.length > 1 && arrive > from) {
      entries.push({ type: "move", who, path, depart: trip.depart, speed, mode: walking ? "walk" : "car", from: trip.depart, until: arrive });
    }
    if (stay && next !== null && next.depart > arrive && arrive < to) {
      const key = Math.floor(trip.depart / 1000);
      const legs = Math.floor((next.depart - arrive) / STROLL_LEG_MS);
      if (legs >= 1 && unit(seed, who, key, 51) < STROLL_SHARE) {
        const stroll: Stroll = { key, base: trip.to, start: arrive, end: arrive + legs * STROLL_LEG_MS };
        entries.push({ type: "stroll", who, stroll, from: stroll.start, until: stroll.end });
      } else {
        entries.push({ type: "stand", who, place: trip.to, from: arrive, until: next.depart });
      }
    }
  }
  for (const stroll of plan.strolls) {
    if (stroll.start <= to && stroll.end > from) entries.push({ type: "stroll", who, stroll, from: stroll.start, until: stroll.end });
  }
  return { entries, pending };
}

// ---------------------------------------------------------------------------------------------------------------
// the service fleet

/**
 * Residents drive only seconds a day, so a city of homes alone would show a car or two at a time. Its workplaces keep
 * vans, taxis and delivery trucks that run between them all day: one vehicle for every workplace, each
 * driving out from its workplace (its depot) to one of a few others some way off and back, a trip a slot.
 */
export const FLEET_SHARE = 1;
/** A vehicle makes one trip in each slot of this length: out in an even one, back in the odd one after it. */
export const FLEET_SLOT_MS = 20_000;
/** Its stops are workplaces this many cells away (by grid distance), at least and at most: far enough to be seen driving. */
export const FLEET_REACH = [12, 48] as const;
const FLEET_STOPS = 6;
/** A trip is looked for on the road this long after it departs (a path of 180 cells at the driving speed). */
const FLEET_TRANSIT_MS = 45_000;
/** It departs in the first half of its slot, at a moment of its own. */
const FLEET_DEPART_SPREAD = 0.5;
const FLEET_BUCKET = 16;

/** A service vehicle: a number that is negative (no resident's is), the workplace it sets out from and the ones it drives to. */
export interface Vehicle {
  id: number;
  depot: Cell;
  stops: Cell[];
}

const cellNumber = (c: Cell) => (c[0] + 1_000_000) * 2_000_001 + (c[1] + 1_000_000);
const bucketKey = (bx: number, by: number) => (bx + 1_048_576) * 2_097_152 + (by + 1_048_576);

/**
 * The fleet of a city's workplaces: each keeps a vehicle, whose stops are the (up to six) nearest
 * workplaces between `FLEET_REACH` cells away. A workplace with none that far has no vehicle. A function of the
 * workplaces' cells and the seed, whatever order they come in.
 */
export function buildFleet(workplaces: readonly Cell[], seed: number): Vehicle[] {
  const buckets = new Map<number, Cell[]>();
  for (const w of workplaces) {
    const k = bucketKey(Math.floor(w[0] / FLEET_BUCKET), Math.floor(w[1] / FLEET_BUCKET));
    const list = buckets.get(k);
    if (list) list.push(w);
    else buckets.set(k, [w]);
  }
  const reach = Math.ceil(FLEET_REACH[1] / FLEET_BUCKET);
  const fleet: Vehicle[] = [];
  for (const depot of workplaces) {
    if (unit(seed, depot[0], depot[1], 91) >= FLEET_SHARE) continue; // below 1, only that share of workplaces keep one
    const bx = Math.floor(depot[0] / FLEET_BUCKET);
    const by = Math.floor(depot[1] / FLEET_BUCKET);
    const found: { cell: Cell; d: number }[] = [];
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const cell of buckets.get(bucketKey(bx + dx, by + dy)) ?? []) {
          const d = Math.abs(cell[0] - depot[0]) + Math.abs(cell[1] - depot[1]);
          if (d >= FLEET_REACH[0] && d <= FLEET_REACH[1]) found.push({ cell, d });
        }
      }
    }
    if (found.length === 0) continue;
    found.sort((a, b) => a.d - b.d || a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1]);
    fleet.push({ id: -1 - cellNumber(depot), depot, stops: found.slice(0, FLEET_STOPS).map((f) => f.cell) });
  }
  return fleet;
}

/** The share of the fleet that makes a trip in a slot by day and at night. */
const FLEET_DAY = 0.9;
const FLEET_NIGHT = 0.02;

/** The share of the fleet on the road at the local time `t`: most of it in the working day, a few at night, none quite gone. */
export function fleetActivity(t: number): number {
  const d = new Date(t);
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 5 || h >= 22) return FLEET_NIGHT;
  if (h < 7) return FLEET_NIGHT + ((h - 5) / 2) * (FLEET_DAY - FLEET_NIGHT);
  if (h < 19) return FLEET_DAY;
  return FLEET_DAY - ((h - 19) / 3) * (FLEET_DAY - FLEET_NIGHT);
}

/**
 * The fleet's trips under way between `from` and `to` (ms), as entries (always in a car, at the driving speed). A
 * vehicle makes a trip in a slot with the chance `fleetActivity` gives for the hour; a trip is looked at only when
 * `wanted` says one of its ends is in the part of town that matters, and counts only when `pathOf` knows a way. `pending`
 * is true when it did not know yet for some trip. Pure: the same slot gives the same trips whenever it is asked.
 */
export function fleetEntries(
  fleet: readonly Vehicle[],
  from: number,
  to: number,
  seed: number,
  pathOf: PathOf,
  wanted: (cell: Cell) => boolean,
): { entries: Move[]; pending: boolean } {
  const entries: Move[] = [];
  let pending = false;
  const firstSlot = Math.floor((from - FLEET_TRANSIT_MS) / FLEET_SLOT_MS);
  const lastSlot = Math.floor(to / FLEET_SLOT_MS);
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    const start = slot * FLEET_SLOT_MS;
    const busy = fleetActivity(start);
    for (const v of fleet) {
      if (unit(seed, v.id, slot, 7) >= busy) continue;
      const depart = start + unit(seed, v.id, slot, 6) * FLEET_SLOT_MS * FLEET_DEPART_SPREAD;
      if (depart > to || depart + FLEET_TRANSIT_MS <= from) continue;
      const stop = v.stops[Math.floor(unit(seed, v.id, Math.floor(slot / 2), 5) * v.stops.length)];
      const [a, b] = slot % 2 === 0 ? [v.depot, stop] : [stop, v.depot];
      if (!wanted(a) && !wanted(b)) continue;
      const path = pathOf(a, b);
      if (path === undefined) {
        pending = true;
        continue;
      }
      if (path === null || path.length < 2) continue;
      const until = depart + ((path.length - 1) / DRIVE_SPEED) * 1000;
      if (until <= from) continue;
      entries.push({ type: "move", who: v.id, path, depart, speed: DRIVE_SPEED, mode: "car", from: depart, until });
    }
  }
  return { entries, pending };
}
