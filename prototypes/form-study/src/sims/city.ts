import { CITY_RULES_VERSION } from "../config";
import type { Point } from "../data";
import { Rng } from "../rng";
import { isSnapshot, type CitySnapshot } from "./city-snapshot";
import { BUFFER, isUnlocked, JOBS, kindFor, neighboursAt, RESIDENTS, RESIDENTS_PER_SHOP_JOB, zoneNow, zoneOf, type Demand, type Kind, type LotContext, type Zone } from "./kinds";
import { gradeOfPasses, runGrade, runThrough, type Grade } from "./grades";
import { headingFor } from "./steer";
import type { Sim } from "./types";

export interface CityConfig {
  /**
   * Tiles per second while driving: the speed it always drives at, or, with `ptPerTile`, its top speed, the most a
   * fast cursor can push it to.
   */
  speed: number;
  /**
   * When set, the roller's speed follows the pointer's: a tile for every this many screen points the pointer moves,
   * so a still pointer leaves it standing. Left out, the roller drives at `speed` after any touch.
   */
  ptPerTile?: number;
  /** With `ptPerTile`: over about how long (ms) the pointer's speed is averaged, so its jitter does not jolt the roller. */
  smoothMs?: number;
  /**
   * When set, the roller never paves new ground right beside a road running the same way: it merges onto that road
   * instead (a lane change), so passes widen one road rather than laying a second one next to it.
   */
  mergeBeside?: boolean;
  /** How far a pointer must move, in screen points, before it steers. */
  steerMin: number;
  /** The roller parks this long after the last touch. */
  idleStopMs: number;
  /** Over this last stretch before parking it slows evenly to a stop. */
  slowMs: number;
  /**
   * When set, the city's shape stretches or shortens that slowing stretch (and so the coast), judged at each touch: in
   * a city wider on screen than `aspect` × its height, a coast further out along the long axis (left or right) is
   * shortened and one back along it lengthened, by (width / height / aspect) ^ strength, kept within [min, max]; a
   * city too tall the same way up and down. So the roller still goes only where the cursor sent it, but the city
   * evens itself out.
   */
  shapeCoast?: { aspect: number; strength: number; min: number; max: number };
  /**
   * When set, a new lot's kind also reads its surroundings (`LotContext`: the commercial target, industry in the outer
   * ring and kept `BUFFER` cells from homes, clustering along the street, highway frontage), and a lot's zone follows
   * its road's grade (`zoneNow`). Left out, lots are chosen and zoned as before.
   */
  zoning?: boolean;
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
  /**
   * With `ptPerTile`: the roller's speed at the last touch, in tiles a second, from the pointer's averaged speed and
   * at most `speed`. From the last touch it holds it, then slows to a stop as `reach` says.
   */
  pace = 0;
  /** With `shapeCoast`: how much the city's shape stretched the coast from the last touch (1 = not at all). */
  coast = 1;
  /**
   * The road's spread on screen, for `shapeCoast`: counts and sums of u = x − y (across) and v = (x + y) / 2 (down)
   * over the road cells. Every term is a whole or half number, so the sums are exact whatever order they are added in.
   */
  private spread = { n: 0, u: 0, uu: 0, v: 0, vv: 0 };
  /** Each lot's own roll, drawn when it was made, which later decisions about it (rezoning) read instead of drawing. */
  private rolls = new Map<string, number>();
  /** Jobs in shops, counted at full capacity like `need`. */
  private shopJobs = 0;
  /** Count and sums over the homes' cells (x, y, x² + y²): the centroid of homes and their spread, exactly. */
  private homes = { n: 0, x: 0, y: 0, sq: 0 };
  /** Each road cell's grade: the highest its straight runs have ever reached, so it never falls (see `regrade`). */
  private grades = new Map<string, Grade>();
  private clock: number | null = null;
  private lastInput = -Infinity;
  private started = false;
  /** Where each finger last steered from. */
  private anchors = new Map<number, Point>();
  /** Where each finger was at its previous point, for the distance. */
  private lastPoints = new Map<number, Point>();

  constructor(readonly cfg: CityConfig) {
    this.rng = new Rng(cfg.seed);
  }

  beginStroke(id: number, t: number): void {
    this.advanceTo(t);
    this.settlePace(t);
    this.touch(t);
    this.anchors.delete(id);
    this.lastPoints.delete(id);
    this.judgeCoast();
  }

  addPoints(id: number, points: Point[]): void {
    for (const p of points) {
      this.advanceTo(p.t);
      this.settlePace(p.t);
      this.touch(p.t);
      const prev = this.lastPoints.get(id);
      if (prev) {
        const moved = Math.hypot(p.x - prev.x, p.y - prev.y);
        this.distance += moved;
        this.followPointer(moved, p.t - prev.t);
      }
      this.lastPoints.set(id, p);
      const from = this.anchors.get(id);
      if (!from) this.anchors.set(id, p);
      else {
        const dx = p.x - from.x;
        const dy = p.y - from.y;
        if (Math.hypot(dx, dy) >= this.cfg.steerMin) {
          this.anchors.set(id, p);
          const dir = headingFor(dx, dy, this.roller.dir);
          if (dir !== this.roller.dir) {
            this.roller.dir = dir;
            this.roller.progress = 0;
            this.version++;
          }
        }
      }
      // the coast from this touch on is judged with the heading it leaves the roller on
      this.judgeCoast();
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
    const until = Math.min(t, this.lastInput + this.idleMs());
    if (this.started && until > this.clock) this.drive(this.clock, until);
    this.clock = t;
  }

  snapshot(): CitySnapshot {
    return {
      rules: CITY_RULES_VERSION,
      road: [...this.road],
      rolls: [...this.rolls],
      grades: [...this.grades],
      lots: [...this.lots],
      kinds: [...this.kinds],
      landmark: this.landmarkPlaced,
      roller: { ...this.roller },
      driven: this.driven,
      distance: this.distance,
      pace: this.pace,
      coast: this.coast,
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
    for (const [k, n] of s.road) {
      sim.road.set(k, n);
      const [x, y] = k.split(",").map(Number);
      sim.addSpread(x, y);
    }
    for (const [k, g] of s.grades) sim.grades.set(k, g);
    for (const [k, r] of s.rolls) sim.rolls.set(k, r);
    for (const [k, t] of s.lots) sim.lots.set(k, t);
    for (const [k, kind] of s.kinds) {
      sim.kinds.set(k, kind);
      const [x, y] = k.split(",").map(Number);
      sim.count(kind, 1, x, y);
    }
    sim.landmarkPlaced = s.landmark;
    sim.roller.x = s.roller.x;
    sim.roller.y = s.roller.y;
    sim.roller.dir = s.roller.dir;
    sim.roller.progress = s.roller.progress;
    sim.driven = s.driven;
    sim.distance = s.distance;
    sim.pace = s.pace;
    sim.coast = s.coast;
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
    return !this.started || this.clock === null || this.clock >= this.lastInput + this.idleMs();
  }

  /** The roller's position in tiles, between cells while it moves (sliding sideways too while it merges). */
  rollerAt(): { x: number; y: number } {
    const { x, y, progress } = this.roller;
    const next = this.nextCell();
    return { x: x + (next.x - x) * progress, y: y + (next.y - y) * progress };
  }

  /**
   * The cell the roller drives into next: straight ahead, unless (with `mergeBeside`) that is new ground right beside a
   * road running the same way. Then it is that road's cell: the roller merges onto it. A road only counts as running the
   * same way if it goes on along the heading from that cell; one that merely ends there is joined, not merged into. Of
   * two such roads, the more driven one, and on a tie the one on its left. It only reads the road, which nothing else
   * changes while the roller is between cells, so the drawing and the driving agree on where it is going.
   */
  private nextCell(): { x: number; y: number } {
    const { x, y, dir } = this.roller;
    const nx = x + DX[dir];
    const ny = y + DY[dir];
    if (!this.cfg.mergeBeside || this.road.has(cellKey(nx, ny))) return { x: nx, y: ny };
    let best: { x: number; y: number } | null = null;
    let bestDriven = 0;
    for (const side of [(dir + 3) % 4, (dir + 1) % 4]) {
      const sx = nx + DX[side];
      const sy = ny + DY[side];
      const driven = this.road.get(cellKey(sx, sy)) ?? 0;
      if (driven <= bestDriven) continue;
      const runsAlong = this.road.has(cellKey(sx - DX[dir], sy - DY[dir])) || this.road.has(cellKey(sx + DX[dir], sy + DY[dir]));
      if (!runsAlong) continue;
      best = { x: sx, y: sy };
      bestDriven = driven;
    }
    return best ?? { x: nx, y: ny };
  }

  hasRoad(x: number, y: number): boolean {
    return this.road.has(cellKey(x, y));
  }

  /** The road's grade at (x, y), 1 dirt to 5 highway, or 0 where there is no road. */
  gradeAt(x: number, y: number): Grade | 0 {
    return this.grades.get(cellKey(x, y)) ?? 0;
  }

  /**
   * After the cell at (x, y) was driven: grade the two straight runs through it again (only they can have changed) and
   * raise every cell of each to its run's grade, never lowering one. A cell on no run of two or more cells takes the
   * grade of its own passes.
   */
  private regrade(x: number, y: number): void {
    const has = (cx: number, cy: number) => this.road.has(cellKey(cx, cy));
    let onRun = false;
    for (const axis of ["x", "y"] as const) {
      const run = runThrough(has, x, y, axis);
      if (run.length < 2) continue;
      onRun = true;
      const g = runGrade(run.map(([cx, cy]) => this.road.get(cellKey(cx, cy)) ?? 0));
      for (const [cx, cy] of run) this.raiseGrade(cellKey(cx, cy), g);
    }
    if (!onRun) this.raiseGrade(cellKey(x, y), gradeOfPasses(this.road.get(cellKey(x, y)) ?? 0));
  }

  private raiseGrade(k: string, g: Grade): void {
    if (g > (this.grades.get(k) ?? 0)) this.grades.set(k, g);
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

  /**
   * 0 for no building yet, else its density at time t (1 low, 2 medium, 3 high): it grows with age (three times as fast
   * beside a busy road), and with `zoning` no denser than the best road it touches allows — a street (grade 1–2) low,
   * a lit street (3) medium, an avenue or highway (4–5) high — catching up at once when that road is upgraded.
   */
  houseTier(x: number, y: number, t: number): 0 | 1 | 2 | 3 {
    const ready = this.lots.get(cellKey(x, y));
    if (ready === undefined || t < ready) return 0;
    let age = t - ready;
    if (this.besideBusyRoad(x, y)) age *= 3;
    const [two, three] = this.cfg.tierAgesMs;
    const byAge = age >= three ? 3 : age >= two ? 2 : 1;
    if (!this.cfg.zoning) return byAge;
    let grade = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const n = this.road.get(cellKey(nx, ny));
      if (n !== undefined) grade = Math.max(grade, this.gradeAt(nx, ny) || gradeOfPasses(n));
    }
    const cap = grade >= 4 ? 3 : grade === 3 ? 2 : 1;
    return Math.min(byAge, cap) as 1 | 2 | 3;
  }

  /** What the lot at (x, y) is drawn as: its kind, or a shop or an office where its road rezoned a home. */
  lotForm(x: number, y: number): Kind | undefined {
    const kind = this.kinds.get(cellKey(x, y));
    if (kind === undefined) return undefined;
    const zone = this.lotZone(x, y);
    if (zone === zoneOf(kind)) return kind;
    return zone === "commercial" ? "shop" : zone === "office" ? "office" : kind;
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

  /** The roller's speed from the last touch on, in tiles a second, before it slows: `speed`, or with `ptPerTile` its pace. */
  private rate(): number {
    return this.cfg.ptPerTile ? this.pace : this.cfg.speed;
  }

  /**
   * With `ptPerTile`, before a touch at t: bring the pace down to the speed the roller has slowed to since the last
   * touch, so a pointer that moves again after resting starts the roller from there, not from its old speed.
   */
  private settlePace(t: number): void {
    if (!this.cfg.ptPerTile || this.pace === 0) return;
    const full = this.cfg.idleStopMs - this.cfg.slowMs;
    const slow = this.slowMs();
    const u = t - this.lastInput;
    if (u <= full) return;
    const left = slow > 0 ? 1 - (u - full) / slow : 0;
    this.pace = left > 0 ? this.pace * left : 0;
  }

  /**
   * With `ptPerTile`: a pointer moved `moved` points in `dt` ms. The pace goes toward the speed that would pave a tile
   * per `ptPerTile` points (at most `speed`), averaged over about `smoothMs`: a sample `dt` long moves it
   * dt / (smoothMs + dt) of the way. Only plain arithmetic, so a replay in any engine paves exactly the same cells.
   */
  private followPointer(moved: number, dt: number): void {
    const per = this.cfg.ptPerTile;
    if (!per || dt <= 0) return;
    const target = Math.min(this.cfg.speed, ((moved / per) * 1000) / dt);
    this.pace += ((target - this.pace) * dt) / ((this.cfg.smoothMs ?? 0) + dt);
  }

  /** The slowing stretch from the last touch on, as stretched by the city's shape. */
  private slowMs(): number {
    return this.cfg.slowMs * this.coast;
  }

  /** How long after the last touch the roller parks: the full-speed hold, then the stretched slowing. */
  private idleMs(): number {
    return this.cfg.idleStopMs - this.cfg.slowMs + this.slowMs();
  }

  private addSpread(x: number, y: number): void {
    const u = x - y;
    const v = (x + y) / 2;
    const s = this.spread;
    s.n++;
    s.u += u;
    s.uu += u * u;
    s.v += v;
    s.vv += v * v;
  }

  /**
   * With `shapeCoast`, at a touch: how much the city's shape stretches the coast that follows, from the heading the
   * roller is left on and where it stands. On screen a heading always moves one step across (u) and half a step down
   * or up (v); only the city's long axis is judged. If the road is wider than `aspect` × its height (by standard
   * deviation, each at least half a cell), a coast that takes the roller further from the middle across is divided by
   * (width / height / aspect) ^ strength and one that brings it back is multiplied by it; standing exactly at the
   * middle counts as going out. A city too tall is judged the same way up and down. The result is kept in [min, max].
   */
  private judgeCoast(): void {
    const sc = this.cfg.shapeCoast;
    if (!sc) return;
    const s = this.spread;
    if (s.n < 2) {
      this.coast = 1;
      return;
    }
    const mu = s.u / s.n;
    const mv = s.v / s.n;
    const su = Math.max(0.5, Math.sqrt(Math.max(0, s.uu / s.n - mu * mu)));
    const sv = Math.max(0.5, Math.sqrt(Math.max(0, s.vv / s.n - mv * mv)));
    const { x, y, dir } = this.roller;
    const ratio = su / sv / sc.aspect;
    let away: boolean;
    let factor: number;
    if (ratio >= 1) {
      const step = DX[dir] - DY[dir]; // u moves by ±1
      away = (x - y - mu) * step >= 0;
      factor = ratio ** sc.strength;
    } else {
      const step = (DX[dir] + DY[dir]) / 2; // v moves by ±0.5
      away = ((x + y) / 2 - mv) * step >= 0;
      factor = (1 / ratio) ** sc.strength;
    }
    const m = away ? 1 / factor : factor;
    this.coast = Math.min(sc.max, Math.max(sc.min, m));
  }

  /**
   * Distance in full-speed milliseconds covered `u` ms after the last touch:
   * full speed until the slowing stretch, then slowing evenly to zero.
   */
  private reach(u: number): number {
    const full = this.cfg.idleStopMs - this.cfg.slowMs;
    if (u <= full) return u;
    const slow = this.slowMs();
    const s = Math.min(u - full, slow);
    return full + s - (s * s) / (2 * slow);
  }

  /** The inverse of reach: how long after the last touch a distance is covered. */
  private reachedAt(d: number): number {
    const full = this.cfg.idleStopMs - this.cfg.slowMs;
    if (d <= full) return d;
    const w = this.slowMs();
    return full + w * (1 - Math.sqrt(Math.max(0, 1 - (2 * (d - full)) / w)));
  }

  private drive(from: number, until: number): void {
    const rate = this.rate();
    if (!(rate > 0)) return;
    const msPerCell = 1000 / rate;
    const last = this.lastInput;
    let d = this.reach(Math.max(0, from - last));
    const end = this.reach(until - last);
    for (;;) {
      const toNext = (1 - this.roller.progress) * msPerCell;
      if (d + toNext > end) {
        this.roller.progress += (end - d) / msPerCell;
        return;
      }
      d += toNext;
      const t = last + this.reachedAt(d);
      const next = this.nextCell();
      this.roller.progress = 0;
      this.roller.x = next.x;
      this.roller.y = next.y;
      this.driven++;
      this.pave(this.roller.x, this.roller.y, t);
    }
  }

  private pave(x: number, y: number, t: number): void {
    const k = cellKey(x, y);
    if (!this.road.has(k)) this.addSpread(x, y);
    this.road.set(k, (this.road.get(k) ?? 0) + 1);
    this.regrade(x, y);
    this.lots.delete(k);
    const flattened = this.kinds.get(k);
    if (flattened !== undefined) {
      if (flattened === "landmark") this.landmarkPlaced = false;
      this.count(flattened, -1, x, y);
    }
    this.kinds.delete(k);
    this.rolls.delete(k);
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
      this.rolls.set(nk, roll);
      this.count(kind, 1, lx, ly);
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
    return kindFor(n, this.distance, roll, this.need, this.besideWideRoad(x, y), this.cfg.zoning ? this.lotContext(x, y) : {});
  }

  /**
   * What the city says about a lot about to be made at (x, y), for `kindFor` (see `LotContext`). The outer ring is the
   * cells further from the centroid of homes than the homes' spread (the root mean square of their distances), once there
   * are five homes; a cluster neighbour is the nearest lot along the lot's street (the line across its front), within
   * `BUFFER` cells, the west or north one first.
   */
  private lotContext(x: number, y: number): LotContext {
    const kindAt = (cx: number, cy: number) => this.kinds.get(cellKey(cx, cy));
    const isHome = (k: Kind | undefined) => k !== undefined && k in RESIDENTS;
    let nearHome = false;
    let nearIndustry = false;
    for (let dy = -BUFFER; dy <= BUFFER; dy++) {
      for (let dx = -BUFFER; dx <= BUFFER; dx++) {
        const k = kindAt(x + dx, y + dy);
        if (isHome(k)) nearHome = true;
        if (k === "industrial") nearIndustry = true;
      }
    }
    let touchesIndustry = false;
    let highwayFrontage = false;
    for (let d = 0; d < 4; d++) {
      if (kindAt(x + DX[d], y + DY[d]) === "industrial") touchesIndustry = true;
      if (this.gradeAt(x + DX[d], y + DY[d]) === 5) highwayFrontage = true;
    }
    const h = this.homes;
    let outer = false;
    if (h.n >= 5) {
      const cx = h.x / h.n;
      const cy = h.y / h.n;
      const spread = h.sq / h.n - cx * cx - cy * cy;
      outer = (x - cx) ** 2 + (y - cy) ** 2 > spread;
    }
    // along the street: the street is the first road among S, E, N, W (the side the lot faces), "along" at right angles
    const road = (cx: number, cy: number) => this.road.has(cellKey(cx, cy));
    const eastWest = road(x, y + 1) || (!road(x + 1, y) && road(x, y - 1));
    const [ax, ay] = eastWest ? [1, 0] : [0, 1];
    let clusterKind: Kind | null = null;
    for (let i = 1; i <= BUFFER && !clusterKind; i++) clusterKind = kindAt(x - ax * i, y - ay * i) ?? kindAt(x + ax * i, y + ay * i) ?? null;
    return {
      commercialShort: this.shopJobs < this.need.residents / RESIDENTS_PER_SHOP_JOB,
      outer,
      nearHome,
      nearIndustry,
      touchesIndustry,
      clusterKind,
      highwayFrontage,
    };
  }

  /**
   * The zone the lot at (x, y) holds now (undefined where there is no lot): its kind's zone, and with `zoning`, rezoned
   * by its own roll and the best grade of the roads it touches (`zoneNow`).
   */
  lotZone(x: number, y: number): Zone | undefined {
    const k = cellKey(x, y);
    const kind = this.kinds.get(k);
    if (kind === undefined) return undefined;
    const born = zoneOf(kind);
    if (!this.cfg.zoning) return born;
    let best = 0;
    for (let d = 0; d < 4; d++) best = Math.max(best, this.gradeAt(x + DX[d], y + DY[d]));
    return zoneNow(born, this.rolls.get(k) ?? 0, best);
  }

  /** Adds (`sign` 1) or takes away (-1) a lot of `kind` at (x, y) from the residents and jobs, the shops and the homes. */
  private count(kind: Kind, sign: 1 | -1, x: number, y: number): void {
    if (kind === "shop") this.shopJobs += sign * JOBS.shop;
    if (kind in RESIDENTS) {
      this.homes.n += sign;
      this.homes.x += sign * x;
      this.homes.y += sign * y;
      this.homes.sq += sign * (x * x + y * y);
    }
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
