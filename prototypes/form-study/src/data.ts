export type TouchState = "down" | "move" | "up";

export interface TouchRecord {
  t: number;
  id: number;
  x: number;
  y: number;
  state: TouchState;
}

export interface Point {
  t: number;
  x: number;
  y: number;
}

export interface Stroke {
  id: number;
  points: Point[];
}

const STATES = new Set<string>(["down", "move", "up"]);

function toRecord(value: unknown): TouchRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.t !== "number" || typeof r.id !== "number") return null;
  if (typeof r.x !== "number" || typeof r.y !== "number") return null;
  if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return null;
  if (typeof r.state !== "string" || !STATES.has(r.state)) return null;
  return { t: r.t, id: r.id, x: r.x, y: r.y, state: r.state as TouchState };
}

/** One record per line; broken or foreign lines are skipped. Sorted by time. */
export function parseJsonl(text: string): TouchRecord[] {
  const out: TouchRecord[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let value: unknown;
    try {
      value = JSON.parse(s);
    } catch {
      continue;
    }
    const r = toRecord(value);
    if (r) out.push(r);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A stroke is one finger from down to up. Ordered by start time. */
export function toStrokes(records: TouchRecord[]): Stroke[] {
  const open = new Map<number, Stroke>();
  const done: Stroke[] = [];
  for (const r of records) {
    const p: Point = { t: r.t, x: r.x, y: r.y };
    const s = open.get(r.id);
    if (r.state === "down") {
      if (s) done.push(s);
      open.set(r.id, { id: r.id, points: [p] });
    } else if (r.state === "move") {
      if (s) s.points.push(p);
      else open.set(r.id, { id: r.id, points: [p] });
    } else if (s) {
      s.points.push(p);
      done.push(s);
      open.delete(r.id);
    }
  }
  done.push(...open.values());
  return done.sort((a, b) => a.points[0].t - b.points[0].t);
}
