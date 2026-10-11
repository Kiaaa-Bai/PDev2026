import { cellOf } from "./grid";

/** Touch points per cell, for the heat map view. */
export class Heat {
  readonly counts: Uint32Array;
  max = 1;
  total = 0;
  version = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.counts = new Uint32Array(cols * rows);
  }

  add(x: number, y: number): void {
    const i = cellOf(x, y, this.cols, this.rows);
    this.counts[i] += 1;
    if (this.counts[i] > this.max) this.max = this.counts[i];
    this.total += 1;
    this.version++;
  }
}
