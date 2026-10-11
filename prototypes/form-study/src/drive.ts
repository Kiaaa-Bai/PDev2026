import type { Point, Stroke } from "./data";
import type { Sim } from "./sims/types";

/** Feed a recorded day to the sims in time order. */
export function replay(strokes: Stroke[], sims: Sim[]): void {
  if (strokes.length === 0) return;
  let end = -Infinity;
  for (const s of strokes) {
    const t0 = s.points[0].t;
    for (const sim of sims) {
      sim.advanceTo(t0);
      sim.beginStroke(t0);
      sim.addPoints(s.points);
      sim.endStroke();
    }
    end = Math.max(end, s.points[s.points.length - 1].t);
  }
  for (const sim of sims) sim.advanceTo(end);
}

/** A loaded day runs on the recording's clock; mouse strokes would jump it to now. */
export function inputSims(mode: "live" | "file", sims: Sim[]): Sim[] {
  return mode === "live" ? sims : [];
}

function toPoint(e: PointerEvent, el: HTMLElement, t: number): Point {
  const rect = el.getBoundingClientRect();
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { t, x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
}

/** Mouse drags on any target become live strokes for every sim. */
export function attachLive(targets: HTMLElement[], getSims: () => Sim[], now: () => number = Date.now): void {
  let down = false;
  for (const el of targets) {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      down = true;
      const p = toPoint(e, el, now());
      for (const sim of getSims()) {
        sim.advanceTo(p.t);
        sim.beginStroke(p.t);
        sim.addPoints([p]);
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!down) return;
      const p = toPoint(e, el, now());
      for (const sim of getSims()) sim.addPoints([p]);
    });
    const end = () => {
      if (!down) return;
      down = false;
      for (const sim of getSims()) sim.endStroke();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
}
