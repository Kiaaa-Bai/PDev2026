import type { Point } from "../data";
import { StrokeCells } from "../grid";
import { mulberry32 } from "../rng";
import type { Sim } from "./types";

export interface CityConfig {
  cols: number;
  rows: number;
  /** Strokes through a cell before it becomes road. */
  roadThreshold: number;
  /** Traffic at which a road is drawn wide. */
  wideRoadAt: number;
  /** Build chance per crossing = min(1, buildChance × road traffic). */
  buildChance: number;
  /** Road traffic for building tiers 1, 2, 3. */
  tierThresholds: [number, number, number];
  seed: number;
}

export function tierFor(traffic: number, [a, b, c]: [number, number, number]): 0 | 1 | 2 | 3 {
  if (traffic >= c) return 3;
  if (traffic >= b) return 2;
  if (traffic >= a) return 1;
  return 0;
}

export function neighbors4(i: number, cols: number, rows: number): number[] {
  const c = i % cols;
  const r = Math.floor(i / cols);
  const out: number[] = [];
  if (r > 0) out.push(i - cols);
  if (c < cols - 1) out.push(i + 1);
  if (r < rows - 1) out.push(i + cols);
  if (c > 0) out.push(i - 1);
  return out;
}

export function roadMask(road: Uint8Array, cols: number, rows: number, i: number): number {
  const c = i % cols;
  const r = Math.floor(i / cols);
  let m = 0;
  if (r > 0 && road[i - cols]) m |= 1;
  if (c < cols - 1 && road[i + 1]) m |= 2;
  if (r < rows - 1 && road[i + cols]) m |= 4;
  if (c > 0 && road[i - 1]) m |= 8;
  return m;
}

export class CitySim implements Sim {
  readonly traffic: Uint32Array;
  readonly road: Uint8Array;
  readonly building: Uint8Array;
  version = 0;
  private cells: StrokeCells;
  private rand: () => number;

  constructor(readonly cfg: CityConfig) {
    const n = cfg.cols * cfg.rows;
    this.traffic = new Uint32Array(n);
    this.road = new Uint8Array(n);
    this.building = new Uint8Array(n);
    this.cells = new StrokeCells(cfg.cols, cfg.rows);
    this.rand = mulberry32(cfg.seed);
  }

  beginStroke(_t: number): void {
    this.cells.begin();
  }

  addPoints(points: Point[]): void {
    for (const i of this.cells.push(points)) {
      this.traffic[i] += 1;
      if (!this.road[i] && this.traffic[i] >= this.cfg.roadThreshold) {
        this.road[i] = 1;
        this.building[i] = 0;
      }
      if (this.road[i]) this.growAround(i);
      this.version++;
    }
  }

  endStroke(): void {}

  advanceTo(_t: number): void {}

  private growAround(i: number): void {
    const tier = tierFor(this.traffic[i], this.cfg.tierThresholds);
    const chance = Math.min(1, this.cfg.buildChance * this.traffic[i]);
    for (const n of neighbors4(i, this.cfg.cols, this.cfg.rows)) {
      if (this.road[n]) continue;
      if (tier > this.building[n] && this.rand() < chance) this.building[n] = tier;
    }
  }
}
