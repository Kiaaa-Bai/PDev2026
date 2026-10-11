import type { Point } from "../data";
import { StrokeCells } from "../grid";
import { mulberry32 } from "../rng";
import type { Sim } from "./types";

export interface MonsterConfig {
  cols: number;
  rows: number;
  spawnIntervalMs: number;
  /** Most monsters alive at once. */
  cap: number;
  /** Number of monster sprites. */
  kinds: number;
  seed: number;
}

export interface Poof {
  cell: number;
  t: number;
}

export class MonsterSim implements Sim {
  readonly monster: Uint8Array;
  readonly poofs: Poof[] = [];
  loot = 0;
  alive = 0;
  version = 0;
  /** One stroke per finger that is down. */
  private strokes = new Map<number, StrokeCells>();
  private rand: () => number;
  private clock: number | null = null;
  private nextSpawn = 0;

  constructor(readonly cfg: MonsterConfig) {
    this.monster = new Uint8Array(cfg.cols * cfg.rows);
    this.rand = mulberry32(cfg.seed);
  }

  advanceTo(t: number): void {
    if (this.clock === null) {
      this.clock = t;
      this.nextSpawn = t + this.cfg.spawnIntervalMs;
      return;
    }
    if (t <= this.clock) return;
    this.clock = t;
    if (t < this.nextSpawn) return;
    const due = Math.floor((t - this.nextSpawn) / this.cfg.spawnIntervalMs) + 1;
    this.nextSpawn += due * this.cfg.spawnIntervalMs;
    for (let k = 0; k < Math.min(due, this.cfg.cap); k++) this.spawnOne();
  }

  beginStroke(id: number, t: number): void {
    this.advanceTo(t);
    const cells = new StrokeCells(this.cfg.cols, this.cfg.rows);
    cells.begin();
    this.strokes.set(id, cells);
  }

  addPoints(id: number, points: Point[]): void {
    const cells = this.strokes.get(id);
    if (!cells || points.length === 0) return;
    this.advanceTo(points[points.length - 1].t);
    for (const i of cells.push(points)) {
      if (!this.monster[i]) continue;
      this.monster[i] = 0;
      this.alive -= 1;
      this.loot += 1;
      this.poofs.push({ cell: i, t: this.clock ?? points[0].t });
      this.version++;
    }
  }

  endStroke(id: number): void {
    this.strokes.delete(id);
  }

  private spawnOne(): void {
    if (this.alive >= this.cfg.cap) return;
    const empty: number[] = [];
    for (let i = 0; i < this.monster.length; i++) if (!this.monster[i]) empty.push(i);
    if (empty.length === 0) return;
    const cell = empty[Math.floor(this.rand() * empty.length)];
    this.monster[cell] = 1 + Math.floor(this.rand() * this.cfg.kinds);
    this.alive += 1;
    this.version++;
  }
}
