import type { Point } from "../data";
import { StrokeCells } from "../grid";
import type { Sim } from "./types";

export interface FarmConfig {
  cols: number;
  rows: number;
  /** Waterings per growth stage. */
  waterPerStage: number;
}

/** Stages: 0 seed, 1 sprout, 2 growing, 3 ripe. */
export const RIPE = 3;

export class FarmSim implements Sim {
  readonly water: Uint16Array;
  readonly stage: Uint8Array;
  harvested = 0;
  version = 0;
  /** One stroke per finger that is down. */
  private strokes = new Map<number, StrokeCells>();

  constructor(readonly cfg: FarmConfig) {
    const n = cfg.cols * cfg.rows;
    this.water = new Uint16Array(n);
    this.stage = new Uint8Array(n);
  }

  beginStroke(id: number, _t: number): void {
    const cells = new StrokeCells(this.cfg.cols, this.cfg.rows);
    cells.begin();
    this.strokes.set(id, cells);
  }

  addPoints(id: number, points: Point[]): void {
    const cells = this.strokes.get(id);
    if (!cells) return;
    for (const i of cells.push(points)) this.waterPlot(i);
  }

  endStroke(id: number): void {
    this.strokes.delete(id);
  }

  advanceTo(_t: number): void {}

  private waterPlot(i: number): void {
    this.version++;
    if (this.stage[i] === RIPE) {
      this.stage[i] = 0;
      this.water[i] = 0;
      return;
    }
    this.water[i] += 1;
    if (this.water[i] >= this.cfg.waterPerStage) {
      this.water[i] = 0;
      this.stage[i] += 1;
      if (this.stage[i] === RIPE) this.harvested += 1;
    }
  }
}
