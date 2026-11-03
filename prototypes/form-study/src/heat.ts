import { cellOf } from "./grid";

/** The local date of a time (epoch ms), like `2026-11-03`; later days sort after earlier ones. */
export function dayOf(t: number): string {
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The smallest area, in screen points, a day's points are scaled to, so a single tap does not fill the whole panel. */
const MIN_SPAN = 100;

/**
 * Touch points per cell, for the heat map view: today's points only. The grid covers the area the pointer
 * has been in today (the box round its points, in the same proportions as the screen), so a second display
 * docked later in the day makes the picture rescale to include it. The points are kept so the cells can be
 * counted again whenever that area grows.
 */
export class Heat {
  total = 0;
  version = 0;
  /** The local day the points are from (see `dayOf`), or null before the first point or clock reading. */
  day: string | null = null;

  private peak = 1;
  private bins: Uint32Array;
  /** Today's points as x, y pairs; float32 is plenty for screen points. */
  private pts = new Float32Array(2048);
  private n = 0;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  /** True when the area has grown since the cells were last counted, so they are counted again on the next read. */
  private dirty = false;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.bins = new Uint32Array(cols * rows);
  }

  /** Points per cell, row by row. */
  get counts(): Uint32Array {
    this.settle();
    return this.bins;
  }

  /** The most points in any one cell (at least 1). */
  get max(): number {
    this.settle();
    return this.peak;
  }

  /**
   * Adds a point, in screen points, made at time `t` (epoch ms). A point from a later day than the one shown
   * starts the heat over; one from an earlier day is not today's and is left out.
   */
  add(x: number, y: number, t: number): void {
    const day = dayOf(t);
    if (this.day !== null && day < this.day) return;
    if (day !== this.day) this.reset(day);
    x = Math.fround(x);
    y = Math.fround(y);
    if (this.n * 2 === this.pts.length) {
      const bigger = new Float32Array(this.pts.length * 2);
      bigger.set(this.pts);
      this.pts = bigger;
    }
    this.pts[this.n * 2] = x;
    this.pts[this.n * 2 + 1] = y;
    this.n++;
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) {
      this.minX = Math.min(this.minX, x);
      this.maxX = Math.max(this.maxX, x);
      this.minY = Math.min(this.minY, y);
      this.maxY = Math.max(this.maxY, y);
      this.dirty = true;
    } else if (!this.dirty) {
      this.count(x, y);
    }
    this.total += 1;
    this.version++;
  }

  /** Starts over for the day of time `t` if that is later than the one shown (also the first reading). It never goes back a day. */
  rollTo(t: number): void {
    const day = dayOf(t);
    if (this.day === null || day > this.day) {
      this.reset(day);
      this.version++;
    }
  }

  /** Where a screen point sits on the grid, as fractions of its width and height (0 to 1, clamped). */
  toUnit(x: number, y: number): [u: number, v: number] {
    if (this.n === 0) return [0.5, 0.5];
    const { cx, cy, s } = this.frame();
    const clamp = (f: number) => Math.min(1, Math.max(0, f));
    return [clamp(((x - cx) * s + this.cols / 2) / this.cols), clamp(((y - cy) * s + this.rows / 2) / this.rows)];
  }

  private reset(day: string): void {
    this.day = day;
    this.n = 0;
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
    this.bins.fill(0);
    this.peak = 1;
    this.total = 0;
    this.dirty = false;
  }

  /** The middle of the area covered and the cells per screen point, the same in both directions. */
  private frame(): { cx: number; cy: number; s: number } {
    const spanX = Math.max(this.maxX - this.minX, MIN_SPAN);
    const spanY = Math.max(this.maxY - this.minY, MIN_SPAN);
    return { cx: (this.minX + this.maxX) / 2, cy: (this.minY + this.maxY) / 2, s: Math.min(this.cols / spanX, this.rows / spanY) };
  }

  private count(x: number, y: number): void {
    const [u, v] = this.toUnit(x, y);
    const i = cellOf(u, v, this.cols, this.rows);
    this.bins[i] += 1;
    if (this.bins[i] > this.peak) this.peak = this.bins[i];
  }

  /** Counts every point again for the area as it is now. */
  private settle(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.bins.fill(0);
    this.peak = 1;
    for (let i = 0; i < this.n; i++) this.count(this.pts[i * 2], this.pts[i * 2 + 1]);
  }
}
