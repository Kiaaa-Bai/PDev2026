// People and cars on the streets. What each of them is doing is worked out in crowd.ts (pure); this file turns that
// into positions on the road, and into instanced meshes: one per car model, and one for the bodies of the people with
// one for their heads. The heavy parts (who lives and works where, each person's day, the way along the road) run in
// tasks of their own, a few milliseconds at a time, and `update`, which the frame calls, only reads what they made.

import * as THREE from "three";
import type { CitySim, Dir } from "../sims/city";
import {
  buildPopulation,
  entriesFor,
  FLEET_REACH,
  fleetEntries,
  fleetWakeAt,
  planFor,
  strollLeg,
  STROLL_LEG_MS,
  STROLL_STEPS,
  type Entry,
  type IsRoad,
  type Mode,
  type Move,
  type PathOf,
  type Person,
  type Plan,
  type Population,
  type Stand,
  type StrollEntry,
  type Vehicle,
} from "../sims/crowd";
import { positionAt, residentsOf, roadPath, unit, WALK_SPEED, type Cell } from "../sims/people";
import { CAR_POOL, ROLLER } from "./pieces";

export { CAR_POOL };
export type { Mode };

/** At most this many cars and people are drawn. */
export const MAX_CARS = 400;
export const MAX_PEOPLE = 600;
/** At most this many people are drawn standing outside one shop or park, so a busy one is a few people, not a crowd. */
export const PER_PLACE = 4;

/** A car drives this far to the right of the road's middle, and a person walks this far from it (the road cell is 0.5 either side). */
export const CAR_LANE = 0.19;
export const KERB = 0.36;

/** Cars and people are drawn at these scales: a car (about 3 long at scale 1) is 0.8 of a cell, a person 0.4 tall. */
const CAR_SCALE = 0.26;
const PERSON_SCALE = 1.4;
/** Roads are 0.02 thick. */
const ROAD_TOP = 0.02;
/** A walker bobs this high with every step. */
const BOB = 0.012;

// ---------------------------------------------------------------------------------------------------------------
// where on the road

/** To the right of each heading (0 east, 1 south, 2 west, 3 north) on a map whose y runs down the screen. */
const RIGHT = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
] as const;

/**
 * How far to the side of the road's middle (dx, dy, in cells) somebody heading `heading` goes: to the right of their
 * way, a car in its lane and a walker out at the kerb (further, on the same side, so people going each way keep apart).
 */
export function laneOffset(heading: Dir, mode: Mode): [number, number] {
  const d = mode === "car" ? CAR_LANE : KERB;
  return [RIGHT[heading][0] * d, RIGHT[heading][1] * d];
}

const headingOf = (a: Cell, b: Cell): Dir => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
};

/** Somebody on a path: who, the road cells they pass, when they set off, how fast (cells a second) and how they go. */
export interface Mover {
  who: number;
  path: readonly Cell[];
  depart: number;
  speed: number;
  mode: Mode;
}

/** Somebody on screen. */
export interface Seen {
  who: number;
  mode: Mode;
  x: number;
  y: number;
  heading: Dir;
}

/**
 * Where a trip is at time `t`: its place on `path` (`positionAt`) moved over into the lane or kerb. Round a corner the
 * lane is blended over half a cell either side, so the car or walker does not jump across the road; at the end of a
 * path that turns back, it crosses the middle. Null before departing and after arriving.
 */
export function moverPoint(path: readonly Cell[], depart: number, speed: number, t: number, mode: Mode): { x: number; y: number; heading: Dir } | null {
  const p = positionAt(path, depart, speed, t);
  if (!p) return null;
  const cells = ((t - depart) / 1000) * speed;
  const i = Math.floor(cells);
  const f = cells - i;
  const [hx, hy] = laneOffset(p.heading, mode);
  let ox = hx;
  let oy = hy;
  if (f < 0.5 && i > 0) {
    const [px, py] = laneOffset(headingOf(path[i - 1], path[i]), mode);
    const w = 0.5 * (1 - 2 * f);
    ox += (px - hx) * w;
    oy += (py - hy) * w;
  } else if (f > 0.5 && i + 2 < path.length) {
    const [nx, ny] = laneOffset(headingOf(path[i + 1], path[i + 2]), mode);
    const w = 0.5 * (2 * f - 1);
    ox += (nx - hx) * w;
    oy += (ny - hy) * w;
  }
  return { x: p.x + ox, y: p.y + oy, heading: p.heading };
}

/**
 * Of the movers, those under way at `now` and within `radius` cells (along either axis) of `centre`, with their places,
 * cars and walkers each held to their cap: if there are more, the ones nearest the centre are kept. Cars come first,
 * then people, nearest first; the same movers give the same answer whatever order they come in.
 */
export function visibleTrips(
  movers: readonly Mover[],
  now: number,
  centre: readonly [number, number],
  radius: number,
  caps: { cars: number; people: number } = { cars: MAX_CARS, people: MAX_PEOPLE },
): Seen[] {
  const cars: { s: Seen; d: number }[] = [];
  const walkers: { s: Seen; d: number }[] = [];
  for (const m of movers) {
    const p = moverPoint(m.path, m.depart, m.speed, now, m.mode);
    if (!p) continue;
    const d = Math.max(Math.abs(p.x - centre[0]), Math.abs(p.y - centre[1]));
    if (d > radius) continue;
    (m.mode === "car" ? cars : walkers).push({ s: { who: m.who, mode: m.mode, x: p.x, y: p.y, heading: p.heading }, d });
  }
  const nearest = (list: { s: Seen; d: number }[], cap: number) =>
    list
      .sort((a, b) => a.d - b.d || a.s.who - b.s.who)
      .slice(0, cap)
      .map((e) => e.s);
  return [...nearest(cars, caps.cars), ...nearest(walkers, caps.people)];
}

/** The side of a lot that faces the street, in the order its house picks one: south, east, north, west. */
const FRONT = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

/**
 * Where `who` stands to wait outside the shop or park at `place`: on the kerb of the road cell beside its front, at a
 * spot along the frontage that is theirs alone. Null when no road touches the lot.
 */
export function standingSpot(isRoad: IsRoad, place: Cell, who: number, seed: number): { x: number; y: number } | null {
  for (const [dx, dy] of FRONT) {
    const rx = place[0] + dx;
    const ry = place[1] + dy;
    if (!isRoad(rx, ry)) continue;
    const along = (unit(seed, who, 7) - 0.5) * 0.7;
    return { x: rx - dx * KERB - dy * along, y: ry - dy * KERB + dx * along };
  }
  return null;
}

const SERVICE_CARS = ["car/taxi", "car/van", "car/delivery", "car/truck"];
const PRIVATE_CARS = ["car/sedan", "car/suv", "car/hatchback-sports", "car/sedan"];

/** The car model for somebody: a service vehicle (a negative id) is a taxi, van, delivery van or truck, a resident's car a sedan, SUV or hatchback. */
export function carModelFor(who: number, seed: number): string {
  const pool = who < 0 ? SERVICE_CARS : PRIVATE_CARS;
  return pool[Math.min(pool.length - 1, Math.floor(unit(seed, who, 61) * pool.length))];
}

/**
 * How many cells around the camera to draw traffic for a view `halfHeight` tiles tall: the picture's corners
 * (`viewRadius` is 2.55 x that), but not under 14 and, zoomed far out, not over 40: people are specks by then, and a bigger
 * view would mean thousands of people to look after.
 */
export const trafficRadius = (halfHeight: number): number => Math.min(40, Math.max(14, Math.ceil(halfHeight * 2.55) + 2));

// ---------------------------------------------------------------------------------------------------------------
// finding the way, a little at a time

/** A stretch of time to spend: `exhausted` once `ms` have gone by on `now`'s clock. */
export class Budget {
  private start: number;
  constructor(
    private ms: number,
    private now: () => number = () => performance.now(),
  ) {
    this.start = now();
  }
  get exhausted(): boolean {
    return this.now() - this.start >= this.ms;
  }
}

/** A budget that never runs out. */
const UNLIMITED = new Budget(Infinity, () => 0);

interface Found {
  path: Cell[] | null;
  /** The city's road version when this was searched. */
  version: number;
}

/** The cache is emptied when it reaches this many ways, which is a few megabytes of paths. */
const MAX_PATHS = 12_000;

/**
 * The ways along road between lots, kept. Searched only while a `Budget` has time (a frame's share goes to at most one
 * search over it), so a crowd's worth of new trips is found over some frames, not in one. A way found stays good:
 * roads are only ever added, never taken away, so what `sync` changes is the answer "no way", which may have been built
 * since and is asked again. A return trip is the way out reversed and is not searched for.
 */
export class PathCache {
  private found = new Map<string, Found>();
  private version = 0;

  constructor(
    private isRoad: IsRoad,
    private maxNodes = 2500,
  ) {}

  /** The city's road is now at `version` (any number that grows when roads are added): every "no way" is asked again. */
  sync(version: number): void {
    this.version = version;
  }

  clear(): void {
    this.found.clear();
  }

  get size(): number {
    return this.found.size;
  }

  /** The way from lot `from` to lot `to` (a path of road cells), null for none, or undefined when it is not known and `budget` has run out. */
  resolve(from: Cell, to: Cell, budget: Budget): Cell[] | null | undefined {
    const key = `${from[0]},${from[1]}>${to[0]},${to[1]}`;
    const hit = this.found.get(key);
    if (hit && (hit.path !== null || hit.version === this.version)) return hit.path;
    if (budget.exhausted) return hit ? hit.path : undefined;
    const path = roadPath(this.isRoad, from, to, this.maxNodes);
    if (this.found.size > MAX_PATHS) this.found.clear();
    this.found.set(key, { path, version: this.version });
    this.found.set(`${to[0]},${to[1]}>${from[0]},${from[1]}`, { path: path && [...path].reverse(), version: this.version });
    return path;
  }
}

/**
 * A fault that keeps coming is said once, not at every frame: `fail` tells whether this one is worth saying (its message
 * is not the one just before), `ok` forgets the last, so that the same fault coming back after a good look is said again.
 */
export class FaultOnce {
  private last: string | null = null;

  fail(e: unknown): boolean {
    const message = e instanceof Error ? e.message : String(e);
    if (message === this.last) return false;
    this.last = message;
    return true;
  }

  ok(): void {
    this.last = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the view

/** A roster is made again when it is this old, ms of the clock (unless nobody is out: see MAX_SLEEP_MS)... */
const REFRESH_MS = 1500;
/** ... when the camera has moved this many cells ... */
const MOVE_CELLS = 5;
/** The roster covers this far ahead of its moment, so a trip that departs between two refreshes is there on time. */
const HORIZON_MS = 4000;
/**
 * A roster with nobody in it is not made again until the first departure of the people and vehicles that could be seen
 * is this close (its horizon, less a second for the work to be done in time): a parked city at night then costs nothing.
 */
const WAKE_LEAD_MS = HORIZON_MS - 1000;
/** ... and a sleeping roster is made again at the latest after this long, so a city that has grown meanwhile is looked at. */
const MAX_SLEEP_MS = 60_000;
/** People are considered when their home or work is within the view plus this many cells, and kept when something of theirs is within the view plus the second. */
const CANDIDATE_MARGIN = 24;
const KEEP_MARGIN = 12;
/** The tail of yesterday is needed only just after midnight. */
const TAIL_UNTIL_MS = 90 * 60_000;
/**
 * Who lives where is rebuilt after the city changes, not more often than this, and not more often than keeps the
 * rebuilding under one part in REBUILD_DUTY of the time (a big city takes 100 ms: it waits ten seconds). The city is
 * looked at for changes (a house built or grown into a bigger one, a shop or office more) this often.
 */
const MIN_REBUILD_MS = 6000;
const REBUILD_DUTY = 100;
const TIER_CHECK_MS = 5000;
/**
 * While the roller drives the city changes every moment, and in a big city rebuilding for each house would take a hundred
 * milliseconds out of a frame every few seconds for nothing anybody sees: there it waits until the people and jobs have
 * changed by this share of the people, and otherwise for the roller to park. A city that builds in less than CHEAP_BUILD_MS
 * (a young one, where every new house is news) is rebuilt as soon as it changes.
 */
const STALE_SHARE = 0.03;
const CHEAP_BUILD_MS = 20;
/** A slice of background work. */
const SLICE_MS = 5;
/** After the background work throws, it is tried again no sooner than this. */
const RETRY_MS = 10_000;
const MAX_PLANS = 10_000;

interface StandSpot extends Stand {
  x: number;
  y: number;
}
interface Walk extends StrollEntry {
  /** The leg being walked, and the mover that walks it. */
  leg: { j: number; mover: Mover | null } | null;
}
interface Roster {
  /** The moment and view it was made for. */
  at: number;
  day: number;
  centre: readonly [number, number];
  radius: number;
  /** Not made again before this moment, unless the view or the day changes: `at` and REFRESH_MS, or later when nobody is out. */
  wake: number;
  moves: Move[];
  walks: Walk[];
  stands: StandSpot[];
}
interface Job {
  list: Person[];
  i: number;
  vehicles: Vehicle[];
  v: number;
  t0: number;
  day: number;
  tail: boolean;
  centre: readonly [number, number];
  radius: number;
  /** The soonest that anybody of the list begins something more, past the roster's horizon (Infinity: nobody does). */
  wake: number;
  moves: Move[];
  walks: Walk[];
  stands: StandSpot[];
}

export interface TrafficOptions {
  /** Runs `fn` as a task of its own, later (default `setTimeout`). A test queues them and runs them when it chooses. */
  later?: (fn: () => void) => void;
  /** A clock in ms for the slices of work (default `performance.now`). */
  perf?: () => number;
  caps?: { cars: number; people: number };
}

interface ModelParts {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

const CLOTHES = [0xe9b44c, 0xe0703a, 0x8e6bbe, 0x3e6fb0, 0xd94f4f, 0x4aa36b, 0xf2f2f2, 0x44474f].map((h) => new THREE.Color(h));
const SKIN = [0xf2c9a0, 0xd9a272, 0xa8714a, 0x6b4430].map((h) => new THREE.Color(h));

const dayStartOf = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/**
 * The people and cars of a city, on the streets near the camera. `update` is for the frame: it draws what the last
 * background pass found, and says whether anything moved. The passes (building the population, each near person's
 * day, finding their ways) are tasks of their own, five milliseconds at a time.
 */
export class Traffic {
  private carMeshes: THREE.InstancedMesh[];
  private carIndex = new Map(CAR_POOL.map((name, i) => [name, i]));
  private bodies: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private caps: { cars: number; people: number };
  private later: (fn: () => void) => void;
  private perf: () => number;

  private sim: CitySim | null = null;
  private want: { centre: readonly [number, number]; radius: number } = { centre: [0, 0], radius: 0 };
  /** The clock of the last `update`, which the background work reads. */
  private t = 0;
  private scheduled = false;
  /** After a failure in the background work, not before this moment (ms of the clock). */
  private retryAt = -Infinity;
  private job: Job | null = null;
  private roster: Roster | null = null;

  private pop: Population | null = null;
  /** The city's jobs when the population was built, which `sim.demand()` counts the way `jobsOf` does, and how long it took (ms). */
  private popJobs = 0;
  private popCost = 0;
  private popBuiltAt = -Infinity;
  private popGap = MIN_REBUILD_MS;
  private tierCheckedAt = -Infinity;
  private builds = 0;
  private plans = new Map<number, Plan>();
  private planDay = NaN;
  private planTail = false;
  private paths: PathCache | null = null;

  private movers: Mover[] = [];
  private drawnCars = 0;
  private drawnPeople = 0;
  private drawnStanding = 0;
  private sig = "0/0";

  private m4 = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private turn = ROLLER.yaw.map((yaw) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  private still = new THREE.Quaternion();

  constructor(scene: THREE.Scene, models: ReadonlyMap<string, ModelParts>, options: TrafficOptions = {}) {
    this.caps = options.caps ?? { cars: MAX_CARS, people: MAX_PEOPLE };
    this.later = options.later ?? ((fn) => void setTimeout(fn, 0));
    this.perf = options.perf ?? (() => performance.now());
    this.carMeshes = CAR_POOL.map((name) => {
      const model = models.get(name);
      if (!model) throw new Error(`missing car model ${name}`);
      const mesh = new THREE.InstancedMesh(model.geo, model.mat, this.caps.cars);
      return this.add(scene, mesh);
    });
    const material = new THREE.MeshLambertMaterial();
    this.bodies = this.add(scene, new THREE.InstancedMesh(bodyGeometry(), material, this.caps.people));
    this.heads = this.add(scene, new THREE.InstancedMesh(headGeometry(), material, this.caps.people));
    this.heads.instanceMatrix = this.bodies.instanceMatrix; // one place for both, so a person is one set of matrices
  }

  private add(scene: THREE.Scene, mesh: THREE.InstancedMesh): THREE.InstancedMesh {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  /** How many cars and people were drawn by the last `update`. */
  drawn(): { cars: number; people: number } {
    return { cars: this.drawnCars, people: this.drawnPeople };
  }

  /** How many of those people stand outside a shop or park. */
  standing(): number {
    return this.drawnStanding;
  }

  /** What the last roster holds, for a look at what the background work found. */
  info(): { people: number; fleet: number; moves: number; walks: number; stands: number; age: number } | null {
    const r = this.roster;
    if (!r || !this.pop) return null;
    return { people: this.pop.people.length, fleet: this.pop.fleet.length, moves: r.moves.length, walks: r.walks.length, stands: r.stands.length, age: this.t - r.at };
  }

  /** How many times the population has been built (who lives and works where). */
  populationBuilds(): number {
    return this.builds;
  }

  /**
   * Draws the cars and people on the streets within `radius` cells of `centre` at the moment `now`, and returns
   * whether anything moved or changed since the last call, so the view knows to draw. Does no searching and no
   * pairing of people with jobs: when the background work is due it asks for a task and goes on with what it has.
   */
  update(sim: CitySim, now: Date, centre: readonly [number, number], radius: number): boolean {
    const t = now.getTime();
    if (this.sim !== sim) this.reset(sim);
    this.t = t;
    this.want = { centre, radius };
    if (this.retryAt - t > RETRY_MS) this.retryAt = t + RETRY_MS; // the clock went back since the failure: wait a pause from now, not until it catches up
    if (!this.scheduled && t >= this.retryAt && this.due(t, centre, radius)) {
      this.scheduled = true;
      this.later(this.work);
    }
    return this.draw(sim, t, centre, radius);
  }

  /** Forget everything and start on another city. */
  private reset(sim: CitySim): void {
    this.sim = sim;
    this.pop = null;
    this.popBuiltAt = -Infinity;
    this.tierCheckedAt = -Infinity;
    this.plans.clear();
    this.planDay = NaN;
    this.paths = new PathCache((x, y) => sim.hasRoad(x, y));
    this.roster = null;
    this.job = null;
    this.retryAt = -Infinity;
  }

  /** Whether the roster is missing, past its wake (old, or the time of the next departure is near), made for another day, or for a view the camera has left. */
  private due(t: number, centre: readonly [number, number], radius: number): boolean {
    const r = this.roster;
    if (!r) return true;
    if (t >= r.wake || t < r.at) return true;
    if (Math.max(Math.abs(centre[0] - r.centre[0]), Math.abs(centre[1] - r.centre[1])) >= MOVE_CELLS) return true;
    return radius > r.radius || dayStartOf(t) !== r.day;
  }

  // ---- the background work: a task, then more tasks until the roster is done ----

  /**
   * One task of the background work. Whatever happens in it, `scheduled` is cleared unless another task follows: a throw
   * in the middle (the job is dropped, the last roster kept, the error left to show in the console) must not leave the
   * traffic waiting for a task that will never come. It tries again after RETRY_MS, not on every frame.
   */
  private work = (): void => {
    let more = false;
    try {
      const sim = this.sim;
      if (!sim) return;
      if (!this.job) {
        this.refreshPopulation(sim, this.t);
        this.job = this.startJob(sim, this.t, this.want.centre, this.want.radius);
      }
      const job = this.job;
      this.step(sim, job, new Budget(SLICE_MS, this.perf));
      if (job.i < job.list.length || job.v < job.vehicles.length) {
        more = true;
        this.later(this.work);
        return;
      }
      this.roster = this.finish(job);
      this.job = null;
    } catch (e) {
      this.job = null;
      this.retryAt = this.t + RETRY_MS;
      throw e;
    } finally {
      if (!more) this.scheduled = false;
    }
  };

  /**
   * Builds who lives and works where the first time, then again after the city has changed, and not more often than every
   * few seconds. A change that does not touch the people (the roads, a park) rebuilds nothing; one that does, in a city
   * that takes long to build, waits for the roller to park, or, while it drives, for the change to be a good share of the
   * city (STALE_SHARE).
   */
  private refreshPopulation(sim: CitySim, t: number): void {
    if (this.pop) {
      if (t - this.popBuiltAt < this.popGap || t - this.tierCheckedAt < TIER_CHECK_MS) return;
      this.tierCheckedAt = t;
      const change = Math.abs(residentsOf(sim, sim.time()).length - this.pop.people.length) + Math.abs(sim.demand().jobs - this.popJobs);
      if (change === 0) return;
      if (!sim.parked() && this.popCost >= CHEAP_BUILD_MS && change < STALE_SHARE * this.pop.people.length) return;
    }
    const began = this.perf();
    this.pop = buildPopulation(sim, sim.time(), sim.cfg.seed);
    this.popCost = this.perf() - began;
    this.popGap = Math.max(MIN_REBUILD_MS, REBUILD_DUTY * this.popCost);
    this.popJobs = sim.demand().jobs;
    this.popBuiltAt = t;
    this.tierCheckedAt = t;
    this.builds++;
    this.plans.clear();
  }

  private startJob(sim: CitySim, t: number, centre: readonly [number, number], radius: number): Job {
    const day = dayStartOf(t);
    const tail = t - day < TAIL_UNTIL_MS;
    if (day !== this.planDay || tail !== this.planTail || this.plans.size > MAX_PLANS) {
      this.plans.clear();
      this.planDay = day;
      this.planTail = tail;
    }
    this.paths!.sync(sim.road.size);
    const reach = radius + CANDIDATE_MARGIN;
    const near = ([x, y]: Cell) => Math.abs(x - centre[0]) <= reach && Math.abs(y - centre[1]) <= reach;
    const list = this.pop!.people.filter((p) => near(p.home) || (p.work !== null && near(p.work)));
    const far = radius + KEEP_MARGIN + FLEET_REACH[1];
    const vehicles = this.pop!.fleet.filter((v) => Math.abs(v.depot[0] - centre[0]) <= far && Math.abs(v.depot[1] - centre[1]) <= far);
    return { list, i: 0, vehicles, v: 0, t0: t, day, tail, centre, radius, wake: Infinity, moves: [], walks: [], stands: [] };
  }

  /**
   * Works through the people, then the vehicles, for as long as `budget` lasts. The first of a slice is always finished,
   * whatever the clock says, so every slice gets somewhere.
   */
  private step(sim: CitySim, job: Job, budget: Budget): void {
    const pop = this.pop!;
    const seed = sim.cfg.seed;
    const paths = this.paths!;
    let first = true;
    const pathOf: PathOf = (a, b) => paths.resolve(a, b, first ? UNLIMITED : budget);
    const isRoad: IsRoad = (x, y) => sim.hasRoad(x, y);
    const keep = job.radius + KEEP_MARGIN;
    const within = (x: number, y: number, slack = 0) => Math.abs(x - job.centre[0]) <= keep + slack && Math.abs(y - job.centre[1]) <= keep + slack;
    while (job.i < job.list.length && (first || !budget.exhausted)) {
      const person = job.list[job.i];
      let plan = this.plans.get(person.id);
      if (!plan) this.plans.set(person.id, (plan = planFor(person, job.day, seed, pop.places, job.tail)));
      const found = entriesFor(person, plan, job.t0, job.t0 + HORIZON_MS, seed, pathOf);
      if (found.pending) return; // out of time to look for a way: this person again in the next slice
      for (const e of found.entries) this.keepEntry(e, job, seed, isRoad, within);
      if (found.wake < job.wake) job.wake = found.wake;
      job.i++;
      first = false;
    }
    while (job.i >= job.list.length && job.v < job.vehicles.length && (first || !budget.exhausted)) {
      const found = fleetEntries([job.vehicles[job.v]], job.t0, job.t0 + HORIZON_MS, seed, pathOf, ([x, y]) => within(x, y));
      if (found.pending) return;
      for (const e of found.entries) this.keepEntry(e, job, seed, isRoad, within);
      job.v++;
      first = false;
    }
  }

  private keepEntry(e: Entry, job: Job, seed: number, isRoad: IsRoad, within: (x: number, y: number, slack?: number) => boolean): void {
    if (e.type === "move") {
      if (!e.path.some(([x, y]) => within(x, y))) return;
      job.moves.push(e);
    } else if (e.type === "stand") {
      const spot = standingSpot(isRoad, e.place, e.who, seed);
      if (spot && within(spot.x, spot.y)) job.stands.push({ ...e, x: spot.x, y: spot.y });
    } else if (within(e.stroll.base[0], e.stroll.base[1], STROLL_STEPS)) {
      job.walks.push({ ...e, leg: null });
    }
  }

  /** The roster of a finished job: movers, strollers, and at most PER_PLACE people standing at each place, the same ones each time. */
  private finish(job: Job): Roster {
    const seed = this.sim!.cfg.seed;
    const byPlace = new Map<string, StandSpot[]>();
    for (const s of job.stands) {
      const key = `${s.place[0]},${s.place[1]}`;
      const list = byPlace.get(key);
      if (list) list.push(s);
      else byPlace.set(key, [s]);
    }
    const stands: StandSpot[] = [];
    for (const list of byPlace.values()) {
      // the same people each time: the ones whose rank (a fixed number of their own) is lowest
      list.sort((a, b) => unit(seed, a.who, 33) - unit(seed, b.who, 33) || a.who - b.who);
      stands.push(...list.slice(0, PER_PLACE));
    }
    // Nobody out: the roster stays empty until somebody sets off, so there is no need to look again before then
    let wake = job.t0 + REFRESH_MS;
    if (job.moves.length === 0 && job.walks.length === 0 && stands.length === 0) {
      const soonest = Math.min(job.wake, job.vehicles.length > 0 ? fleetWakeAt(job.t0 + HORIZON_MS) : Infinity);
      wake = Math.min(Math.max(wake, soonest - WAKE_LEAD_MS), job.t0 + MAX_SLEEP_MS);
    }
    return { at: job.t0, day: job.day, centre: job.centre, radius: job.radius, wake, moves: job.moves, walks: job.walks, stands };
  }

  // ---- the frame ----

  /** The mover that walks the stroll `w` at time `t`: its leg, found when the leg changes. Null when no road touches its base. */
  private strollerAt(w: Walk, t: number, isRoad: IsRoad, seed: number): Mover | null {
    const j = Math.floor((t - w.stroll.start) / STROLL_LEG_MS);
    if (w.leg === null || w.leg.j !== j) {
      const path = strollLeg(isRoad, w.stroll.base, seed, w.who, w.stroll.key, j);
      w.leg = { j, mover: path && { who: w.who, path, depart: w.stroll.start + j * STROLL_LEG_MS, speed: WALK_SPEED, mode: "walk" } };
    }
    return w.leg.mover;
  }

  private draw(sim: CitySim, t: number, centre: readonly [number, number], radius: number): boolean {
    const roster = this.roster;
    if (!roster) return this.hide();
    const seed = sim.cfg.seed;
    const isRoad: IsRoad = (x, y) => sim.hasRoad(x, y);

    const movers = this.movers;
    movers.length = 0;
    for (const m of roster.moves) if (m.from <= t && t < m.until) movers.push(m);
    const reach = radius + STROLL_STEPS + 1; // a stroll stays within its steps of its base
    for (const w of roster.walks) {
      if (w.from > t || t >= w.until) continue;
      if (Math.abs(w.stroll.base[0] - centre[0]) > reach || Math.abs(w.stroll.base[1] - centre[1]) > reach) continue;
      const m = this.strollerAt(w, t, isRoad, seed);
      if (m) movers.push(m);
    }
    const seen = visibleTrips(movers, t, centre, radius, this.caps);
    let cars = 0;
    for (const s of seen) if (s.mode === "car") cars++;
    const walking = seen.length - cars;

    const room = Math.max(0, this.caps.people - walking);
    let stands: StandSpot[] = [];
    for (const s of roster.stands) {
      if (s.from <= t && t < s.until && Math.abs(s.x - centre[0]) <= radius && Math.abs(s.y - centre[1]) <= radius) stands.push(s);
    }
    if (stands.length > room) {
      const far = (s: StandSpot) => Math.max(Math.abs(s.x - centre[0]), Math.abs(s.y - centre[1]));
      stands = stands.sort((a, b) => far(a) - far(b) || a.who - b.who).slice(0, room);
    }

    // what is on screen, counting only what stays still by who: anything moving is a change by itself
    let sig = `${cars}/${walking}`;
    for (const s of stands) sig += `,${s.who}`;
    const moving = seen.length > 0;
    if (!moving && sig === this.sig) return false;
    this.sig = sig;

    this.write(seen, stands, t, seed);
    return true;
  }

  private write(seen: Seen[], stands: StandSpot[], t: number, seed: number): void {
    const { m4, pos, scale } = this;
    const perModel = new Array<number>(this.carMeshes.length).fill(0);
    let people = 0;
    scale.setScalar(CAR_SCALE);
    for (const s of seen) {
      if (s.mode !== "car") continue;
      const k = this.carIndex.get(carModelFor(s.who, seed))!;
      const mesh = this.carMeshes[k];
      mesh.setMatrixAt(perModel[k]++, m4.compose(pos.set(s.x, ROAD_TOP, s.y), this.turn[s.heading], scale));
    }
    scale.setScalar(PERSON_SCALE);
    const put = (who: number, x: number, y: number, bob: number) => {
      this.bodies.setMatrixAt(people, m4.compose(pos.set(x, ROAD_TOP + bob, y), this.still, scale));
      this.bodies.setColorAt(people, CLOTHES[Math.floor(unit(seed, who, 62) * CLOTHES.length)]);
      this.heads.setColorAt(people, SKIN[Math.floor(unit(seed, who, 63) * SKIN.length)]);
      people++;
    };
    for (const s of seen) {
      if (s.mode === "walk") put(s.who, s.x, s.y, BOB * Math.abs(Math.sin((t / 1000) * 9 + (s.who % 7))));
    }
    for (const s of stands) put(s.who, s.x, s.y, 0);

    this.carMeshes.forEach((mesh, k) => {
      mesh.count = perModel[k];
      uploadUsed(mesh.instanceMatrix, perModel[k] * 16);
    });
    this.bodies.count = this.heads.count = people;
    uploadUsed(this.bodies.instanceMatrix, people * 16); // the heads share it
    if (this.bodies.instanceColor) uploadUsed(this.bodies.instanceColor, people * 3);
    if (this.heads.instanceColor) uploadUsed(this.heads.instanceColor, people * 3);
    this.drawnCars = perModel.reduce((a, b) => a + b, 0);
    this.drawnPeople = people;
    this.drawnStanding = stands.length;
  }

  /** Nothing to draw (no roster yet): empties the meshes if they had something, and says whether that was a change. */
  private hide(): boolean {
    if (this.drawnCars === 0 && this.drawnPeople === 0) return false;
    for (const m of this.carMeshes) m.count = 0;
    this.bodies.count = this.heads.count = 0;
    this.drawnCars = this.drawnPeople = this.drawnStanding = 0;
    this.sig = "0/0";
    return true;
  }
}

/**
 * Has the renderer upload only the first `n` numbers of an instance attribute the next time it draws: the instances in
 * use, not the whole capacity (a couple of hundred kilobytes for the cars and people, where a few kilobytes are in use).
 * Nothing is uploaded for none.
 */
function uploadUsed(attribute: THREE.BufferAttribute, n: number): void {
  attribute.clearUpdateRanges();
  if (n === 0) return;
  attribute.addUpdateRange(0, n);
  attribute.needsUpdate = true;
}

/** A person: a body from the waist up to the shoulders (6-sided, a little wider at the bottom), and a head, 0.3 tall together at scale 1. */
function bodyGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.035, 0.045, 0.15, 6);
  g.translate(0, 0.075, 0);
  return g;
}
function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.042, 6, 4);
  g.translate(0, 0.19, 0);
  return g;
}
