import type { Point, Stroke, TouchRecord } from "./data";

/**
 * Collects live records per finger and hands over each stroke once its finger
 * lifts. The forms take one stroke at a time, and two fingers often move at once.
 */
export class LiveStrokes {
  private open = new Map<number, Stroke>();

  push(r: TouchRecord): Stroke | null {
    const p: Point = { t: r.t, x: r.x, y: r.y };
    const s = this.open.get(r.id);
    if (r.state === "down") {
      this.open.set(r.id, { id: r.id, points: [p] });
      return s ?? null;
    }
    if (r.state === "move") {
      if (s) s.points.push(p);
      else this.open.set(r.id, { id: r.id, points: [p] });
      return null;
    }
    if (!s) return null;
    s.points.push(p);
    this.open.delete(r.id);
    return s;
  }
}
