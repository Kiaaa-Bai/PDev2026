import { describe, expect, it } from "vitest";
import type { TouchRecord, TouchState } from "../src/data";
import { LiveStrokes } from "../src/live";

const rec = (t: number, id: number, state: TouchState, x = 0.5): TouchRecord => ({ t, id, x, y: 0.5, state });

describe("LiveStrokes", () => {
  it("hands over a stroke only when its finger lifts", () => {
    const live = new LiveStrokes();
    expect(live.push(rec(1, 1, "down", 0.1))).toBeNull();
    expect(live.push(rec(2, 1, "move", 0.2))).toBeNull();
    expect(live.push(rec(3, 1, "up", 0.2))).toEqual({
      id: 1,
      points: [
        { t: 1, x: 0.1, y: 0.5 },
        { t: 2, x: 0.2, y: 0.5 },
        { t: 3, x: 0.2, y: 0.5 },
      ],
    });
  });

  it("keeps two fingers apart while both are down", () => {
    const live = new LiveStrokes();
    live.push(rec(1, 1, "down"));
    live.push(rec(2, 2, "down"));
    live.push(rec(3, 1, "move"));
    expect(live.push(rec(4, 2, "up"))?.points.map((p) => p.t)).toEqual([2, 4]);
    expect(live.push(rec(5, 1, "up"))?.points.map((p) => p.t)).toEqual([1, 3, 5]);
  });

  it("starts a stroke on a move with no down and ignores an up with no stroke", () => {
    const live = new LiveStrokes();
    expect(live.push(rec(1, 1, "up"))).toBeNull();
    live.push(rec(2, 3, "move"));
    expect(live.push(rec(3, 3, "up"))?.points).toHaveLength(2);
  });

  it("hands over the old stroke when the same finger goes down again", () => {
    const live = new LiveStrokes();
    live.push(rec(1, 1, "down"));
    expect(live.push(rec(2, 1, "down"))?.points.map((p) => p.t)).toEqual([1]);
  });
});
