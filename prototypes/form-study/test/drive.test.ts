import { describe, expect, it } from "vitest";
import type { Point, Stroke } from "../src/data";
import { replay } from "../src/drive";
import type { Sim } from "../src/sims/types";

class Spy implements Sim {
  log: string[] = [];
  beginStroke(t: number) {
    this.log.push(`begin ${t}`);
  }
  addPoints(points: Point[]) {
    this.log.push(`add ${points.length}`);
  }
  endStroke() {
    this.log.push("end");
  }
  advanceTo(t: number) {
    this.log.push(`advance ${t}`);
  }
}

const p = (t: number): Point => ({ t, x: 0.5, y: 0.5 });

describe("replay", () => {
  it("advances time, then feeds each whole stroke, then advances to the last point", () => {
    const spy = new Spy();
    const strokes: Stroke[] = [
      { id: 1, points: [p(5), p(9)] },
      { id: 2, points: [p(7)] },
    ];
    replay(strokes, [spy]);
    expect(spy.log).toEqual(["advance 5", "begin 5", "add 2", "end", "advance 7", "begin 7", "add 1", "end", "advance 9"]);
  });

  it("does nothing for no strokes", () => {
    const spy = new Spy();
    replay([], [spy]);
    expect(spy.log).toEqual([]);
  });
});
