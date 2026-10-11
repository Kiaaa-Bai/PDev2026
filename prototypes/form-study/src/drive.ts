import type { Point, TouchRecord } from "./data";
import type { Sim } from "./sims/types";

/** Feeds touch records to the sims as they arrive, one open stroke per finger. */
export class Feeder {
  private open = new Set<number>();

  constructor(private sims: () => Sim[]) {}

  push(r: TouchRecord): void {
    const sims = this.sims();
    const p: Point = { t: r.t, x: r.x, y: r.y };
    for (const sim of sims) sim.advanceTo(r.t);
    if (r.state === "up") {
      if (!this.open.delete(r.id)) return;
      for (const sim of sims) {
        sim.addPoints(r.id, [p]);
        sim.endStroke(r.id);
      }
      return;
    }
    const isOpen = this.open.has(r.id);
    if (r.state === "down" && isOpen) for (const sim of sims) sim.endStroke(r.id);
    if (r.state === "down" || !isOpen) {
      this.open.add(r.id);
      for (const sim of sims) sim.beginStroke(r.id, r.t);
    }
    for (const sim of sims) sim.addPoints(r.id, [p]);
  }
}

/** A loaded day runs on the recording's clock; mouse strokes would jump it to now. */
export function inputSims(mode: "live" | "file", sims: Sim[]): Sim[] {
  return mode === "live" ? sims : [];
}

/** Mouse drags on any target become touch records for finger 0. */
export function attachLive(targets: HTMLElement[], onRecord: (r: TouchRecord) => void, now: () => number = Date.now): void {
  let down = false;
  const record = (e: PointerEvent, el: HTMLElement, state: TouchRecord["state"]): TouchRecord => {
    const rect = el.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      t: now(),
      id: 0,
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
      state,
    };
  };
  for (const el of targets) {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      down = true;
      onRecord(record(e, el, "down"));
    });
    el.addEventListener("pointermove", (e) => {
      if (down) onRecord(record(e, el, "move"));
    });
    const end = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      onRecord(record(e, el, "up"));
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
}
