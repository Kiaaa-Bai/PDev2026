import { CITY_RULES_VERSION } from "../config";
import type { Point } from "../data";
import { Rng } from "../rng";
import { isSnapshot, type CitySnapshot } from "./city-snapshot";
import { isUnlocked, JOBS, kindFor, neighboursAt, RESIDENTS, type Demand, type Kind } from "./kinds";
import { headingFor } from "./steer";
import type { Sim } from "./types";

export interface CityConfig {
  /** Tiles per second while driving. */
  speed: number;
  /** How far a pointer must move, in screen points, before it steers. */
  steerMin: number;
  /** The roller parks this long after the last touch. */
  idleStopMs: number;
  /** Over this last stretch before parking it slows evenly to a stop. */
  slowMs: number;
  /** A lot beside new road gets its house after a delay in this range. */
  lotDelayMs: [number, number];
  /** Chance that a free cell beside new road becomes a lot. */
  lotChance: number;
  /** House age at which it grows to tier 2 and tier 3. */
  tierAgesMs: [number, number];
  /** Times a cell must be driven before its road is drawn wide. */
  wideRoadAt: number;
  seed: number;
}

/** Headings: 0 east, 1 south, 2 west, 3 north. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export const cellKey = (x: number, y: number) => `${x},${y}`;

/** Road neighbours as a bitmask: N=1, E=2, S=4, W=8. */
export function roadMaskAt(has: (x: number, y: number) => boolean, x: number, y: number): number {
  let m = 0;
  if (has(x, y - 1)) m |= 1;
  if (has(x + 1, y)) m |= 2;
  if (has(x, y + 1)) m |= 4;
  if (has(x - 1, y)) m |= 8;
  return m;
}

/**
 * A steamroller on an endless map. It keeps driving while touches keep coming,
 * turns to the direction a finger moves, paves every cell it enters, and houses
 * grow on lots beside new road.
 */
export class CitySim implements Sim {
  /** Times each cell has been driven. */
  readonly road = new Map<string, number>();
  /** Lots beside road, mapped to the time their house appears. */
  readonly lots = new Map<string, number>();
  /** The kind of building on each lot, fixed when the lot was made and never changed after. */
  readonly kinds = new Map<string, Kind>();
  /** True while the one landmark stands; the roller flattening it clears this, so a later lot can be the landmark. */
  landmarkPlaced = false;
  /**
   * Residents and jobs of every lot there is, at tier-3 capacity. Kept as the lots come and go, so a new lot
   * costs nothing to compare; a restored city counts it again from the kinds.
   */
  private need: Demand = { residents: 0, jobs: 0 };
  readonly roller = { x: 0, y: 0, dir: 0 as Dir, progress: 0 };
  driven = 0;
  /** Length of the pointer's path in screen points, summed over every stroke. */
  distance = 0;
  version = 0;
  private rng: Rng;
  private msPerCell: number;
  private clock: number | null = null;
  private lastInput = -Infinity;
  private started = false;
  /** Where each finger last steered from. */
  private anchors = new Map<number, Point>();
  /** Where each finger was at its previous point, for the distance. */
  private lastPoints = new Map<number, Point>();

  constructor(readonly cfg: CityConfig) {
    this.rng = new Rng(cfg.seed);
    this.msPerCell = 1000 / cfg.speed;
  }

  beginStroke(id: number, t: number): void {
    this.touch(t);
    this.anchors.delete(id);
    this.lastPoints.delete(id);
  }

  addPoints(id: number, points: Point[]): void {
    for (const p of points) {
      this.advanceTo(p.t);
      this.touch(p.t);
      const prev = this.lastPoints.get(id);
      if (prev) this.distance += Math.hypot(p.x - prev.x, p.y - prev.y);
      this.lastPoints.set(id, p);
      const from = this.anchors.get(id);
      if (!from) {
        this.anchors.set(id, p);
        continue;
      }
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      if (Math.hypot(dx, dy) < this.cfg.steerMin) continue;
      this.anchors.set(id, p);
      const dir = headingFor(dx, dy, this.roller.dir);
      if (dir !== this.roller.dir) {
        this.roller.dir = dir;
        this.roller.progress = 0;
        this.version++;
      }
    }
  }

  endStroke(id: number): void {
    this.anchors.delete(id);
    this.lastPoints.delete(id);
  }

  advanceTo(t: number): void {
    if (this.clock === null) {
      this.clock = t;
      return;
    }
    if (t <= this.clock) return;
    const until = Math.min(t, this.lastInput + this.cfg.idleStopMs);
    if (this.started && until > this.clock) this.drive(this.clock, until);
    this.clock = t;
  }

  snapshot(): CitySnapshot {
    return {
      rules: CITY_RULES_VERSION,
      road: [...this.road],
      lots: [...this.lots],
      kinds: [...this.kinds],
      landmark: this.landmarkPlaced,
      roller: { ...this.roller },
      driven: this.driven,
      distance: this.distance,
      clock: this.clock,
      lastInput: Number.isFinite(this.lastInput) ? this.lastInput : null,
      started: this.started,
      rng: this.rng.state,
    };
  }

  /** The city a snapshot describes, or null for another rules version or a snapshot of the wrong shape. */
  static restore(cfg: CityConfig, s: unknown): CitySim | null {
    if (!isSnapshot(s)) return null;
    const sim = new CitySim(cfg);
    for (const [k, n] of s.road) sim.road.set(k, n);
    for (const [k, t] of s.lots) sim.lots.set(k, t);
    for (const [k, kind] of s.kinds) {
      sim.kinds.set(k, kind);
      sim.count(kind, 1);
    }
    sim.landmarkPlaced = s.landmark;
    sim.roller.x = s.roller.x;
    sim.roller.y = s.roller.y;
    sim.roller.dir = s.roller.dir;
    sim.roller.progress = s.roller.progress;
    sim.driven = s.driven;
    sim.distance = s.distance;
    sim.clock = s.clock;
    sim.lastInput = s.lastInput ?? -Infinity;
    sim.started = s.started;
    sim.rng.state = s.rng;
    return sim;
  }

  /** The city's clock: the time of the last advance (the recording's time when replaying). */
  time(): number {
    return this.clock ?? 0;
  }

  /** True while the roller waits for the next touch. */
  parked(): boolean {
    return !this.started || this.clock === null || this.clock >= this.lastInput + this.cfg.idleStopMs;
  }

  /** The roller's position in tiles, between cells while it moves. */
  rollerAt(): { x: number; y: number } {
    const { x, y, dir, progress } = this.roller;
    return { x: x + DX[dir] * progress, y: y + DY[dir] * progress };
  }

  hasRoad(x: number, y: number): boolean {
    return this.road.has(cellKey(x, y));
  }

  /** The kind of building on the lot at (x, y), or undefined where there is no lot. */
  lotKind(x: number, y: number): Kind | undefined {
    return this.kinds.get(cellKey(x, y));
  }

  /**
   * The city's residents and jobs, each lot counted at its tier-3 capacity so the sum does not drift as houses
   * age. A copy: the city keeps counting as lots are made and flattened.
   */
  demand(): Demand {
    return { ...this.need };
  }

  /** 0 for no house yet, else the house's tier at time t. */
  houseTier(x: number, y: number, t: number): 0 | 1 | 2 | 3 {
    const ready = this.lots.get(cellKey(x, y));
    if (ready === undefined || t < ready) return 0;
    let age = t - ready;
    if (this.besideBusyRoad(x, y)) age *= 3;
    const [two, three] = this.cfg.tierAgesMs;
    return age >= three ? 3 : age >= two ? 2 : 1;
  }

  /** Houses standing at time t. */
  houses(t: number): number {
    let n = 0;
    for (const ready of this.lots.values()) if (ready <= t) n++;
    return n;
  }

  private touch(t: number): void {
    if (t > this.lastInput) this.lastInput = t;
    if (!this.started) {
      this.started = true;
      this.pave(this.roller.x, this.roller.y, t);
    }
  }

  /**
   * Distance in full-speed milliseconds covered `u` ms after the last touch:
   * full speed until the slowing stretch, then slowing evenly to zero.
   */
  private reach(u: number): number {
    const full = this.cfg.idleStopMs - this.cfg.slowMs;
    if (u <= full) return u;
    const s = Math.min(u, this.cfg.idleStopMs) - full;
    return full + s - (s * s) / (2 * this.cfg.slowMs);
  }

  /** The inverse of reach: how long after the last touch a distance is covered. */
  private reachedAt(d: number): number {
    const full = this.cfg.idleStopMs - this.cfg.slowMs;
    if (d <= full) return d;
    const w = this.cfg.slowMs;
    return full + w * (1 - Math.sqrt(Math.max(0, 1 - (2 * (d - full)) / w)));
  }

  private drive(from: number, until: number): void {
    const last = this.lastInput;
    let d = this.reach(Math.max(0, from - last));
    const end = this.reach(until - last);
    for (;;) {
      const toNext = (1 - this.roller.progress) * this.msPerCell;
      if (d + toNext > end) {
        this.roller.progress += (end - d) / this.msPerCell;
        return;
      }
      d += toNext;
      const t = last + this.reachedAt(d);
      this.roller.progress = 0;
      this.roller.x += DX[this.roller.dir];
      this.roller.y += DY[this.roller.dir];
      this.driven++;
      this.pave(this.roller.x, this.roller.y, t);
    }
  }

  private pave(x: number, y: number, t: number): void {
    const k = cellKey(x, y);
    this.road.set(k, (this.road.get(k) ?? 0) + 1);
    this.lots.delete(k);
    const flattened = this.kinds.get(k);
    if (flattened !== undefined) {
      if (flattened === "landmark") this.landmarkPlaced = false;
      this.count(flattened, -1);
    }
    this.kinds.delete(k);
    const [lo, hi] = this.cfg.lotDelayMs;
    for (let d = 0; d < 4; d++) {
      const lx = x + DX[d];
      const ly = y + DY[d];
      const nk = cellKey(lx, ly);
      if (this.road.has(nk) || this.lots.has(nk)) continue;
      if (this.rng.next() >= this.cfg.lotChance) continue;
      // three draws for every new lot, whatever is unlocked, so what the draws decide never depends on the thresholds
      const ready = t + lo + this.rng.next() * (hi - lo);
      const roll = this.rng.next();
      const kind = this.kindOfNewLot(lx, ly, roll);
      this.kinds.set(nk, kind);
      this.count(kind, 1);
      this.lots.set(nk, ready);
    }
    this.version++;
  }

  /**
   * The kind of the lot about to be made at (x, y), from what is around it, the distance now and the city's
   * demand. Once it is unlocked, the first lot made beside road that was driven `wideRoadAt` times is the
   * landmark; there is at most one landmark at a time, and a flattened one can be replaced by a later lot.
   * Any other lot is `kindFor`'s: it reads the demand before this lot is counted, and an avenue is the same
   * road as the landmark's, driven `wideRoadAt` times.
   */
  private kindOfNewLot(x: number, y: number, roll: number): Kind {
    if (!this.landmarkPlaced && isUnlocked("landmark", this.distance) && this.besideWideRoad(x, y)) {
      this.landmarkPlaced = true;
      return "landmark";
    }
    const n = neighboursAt(
      (cx, cy) => this.road.has(cellKey(cx, cy)),
      (cx, cy) => this.lots.has(cellKey(cx, cy)),
      x,
      y,
    );
    return kindFor(n, this.distance, roll, this.need, this.besideWideRoad(x, y));
  }

  /** Adds (`sign` 1) or takes away (-1) a lot of `kind` from the residents and jobs. */
  private count(kind: Kind, sign: 1 | -1): void {
    if (kind in RESIDENTS) this.need.residents += sign * RESIDENTS[kind as keyof typeof RESIDENTS][2];
    if (kind in JOBS) this.need.jobs += sign * JOBS[kind as keyof typeof JOBS];
  }

  private besideWideRoad(x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      if ((this.road.get(cellKey(x + DX[d], y + DY[d])) ?? 0) >= this.cfg.wideRoadAt) return true;
    }
    return false;
  }

  private besideBusyRoad(x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      if ((this.road.get(cellKey(x + DX[d], y + DY[d])) ?? 0) >= 2) return true;
    }
    return false;
  }
}
