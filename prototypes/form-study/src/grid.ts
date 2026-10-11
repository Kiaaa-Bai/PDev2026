import type { Point } from "./data";

export function cellOf(x: number, y: number, cols: number, rows: number): number {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)));
  return r * cols + c;
}

/** Cells a segment passes through, in order, sampled every quarter cell. */
export function segmentCells(ax: number, ay: number, bx: number, by: number, cols: number, rows: number): number[] {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax) * cols, Math.abs(by - ay) * rows) * 4));
  const out: number[] = [];
  let last = -1;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const c = cellOf(ax + (bx - ax) * f, ay + (by - ay) * f, cols, rows);
    if (c !== last) {
      out.push(c);
      last = c;
    }
  }
  return out;
}

/** Tracks one stroke at a time and reports the cells it enters for the first time. */
export class StrokeCells {
  private visited = new Set<number>();
  private last: Point | null = null;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {}

  begin(): void {
    this.visited.clear();
    this.last = null;
  }

  push(points: Point[]): number[] {
    const fresh: number[] = [];
    for (const p of points) {
      const cells = this.last
        ? segmentCells(this.last.x, this.last.y, p.x, p.y, this.cols, this.rows)
        : [cellOf(p.x, p.y, this.cols, this.rows)];
      for (const c of cells) {
        if (!this.visited.has(c)) {
          this.visited.add(c);
          fresh.push(c);
        }
      }
      this.last = p;
    }
    return fresh;
  }
}
