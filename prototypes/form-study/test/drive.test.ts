import { describe, expect, it } from "vitest";
import type { Point, TouchRecord, TouchState } from "../src/data";
import { attachLive, Feeder, inputSims } from "../src/drive";
import type { Sim } from "../src/sims/types";

class Spy implements Sim {
  log: string[] = [];
  beginStroke(id: number, t: number) {
    this.log.push(`begin ${id}@${t}`);
  }
  addPoints(id: number, points: Point[]) {
    this.log.push(`add ${id}:${points.map((p) => p.t).join(",")}`);
  }
  endStroke(id: number) {
    this.log.push(`end ${id}`);
  }
  advanceTo(t: number) {
    this.log.push(`advance ${t}`);
  }
}

const rec = (t: number, id: number, state: TouchState): TouchRecord => ({ t, id, x: 0.5, y: 0.5, state });

describe("Feeder", () => {
  it("feeds every record as it arrives, one stroke per finger", () => {
    const spy = new Spy();
    const feeder = new Feeder(() => [spy]);
    for (const r of [rec(1, 1, "down"), rec(2, 2, "down"), rec(3, 1, "move"), rec(4, 2, "up")]) feeder.push(r);
    expect(spy.log).toEqual([
      "advance 1", "begin 1@1", "add 1:1",
      "advance 2", "begin 2@2", "add 2:2",
      "advance 3", "add 1:3",
      "advance 4", "add 2:4", "end 2",
    ]);
  });

  it("starts a stroke on a move with no down and ignores an up with no stroke", () => {
    const spy = new Spy();
    const feeder = new Feeder(() => [spy]);
    feeder.push(rec(1, 7, "up"));
    feeder.push(rec(2, 7, "move"));
    expect(spy.log).toEqual(["advance 1", "advance 2", "begin 7@2", "add 7:2"]);
  });

  it("closes the old stroke when the same finger goes down again", () => {
    const spy = new Spy();
    const feeder = new Feeder(() => [spy]);
    feeder.push(rec(1, 1, "down"));
    feeder.push(rec(2, 1, "down"));
    expect(spy.log.slice(3)).toEqual(["advance 2", "end 1", "begin 1@2", "add 1:2"]);
  });
});

describe("inputSims", () => {
  it("lets the mouse drive sims only in live mode", () => {
    const sims = [new Spy()];
    expect(inputSims("live", sims)).toBe(sims);
    expect(inputSims("file", sims)).toEqual([]);
  });
});

describe("attachLive", () => {
  it("live mouse records are page pixels", () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const el = {
      addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
      getBoundingClientRect: () => ({ left: 100, top: 20, width: 512, height: 320 }),
      setPointerCapture: () => {},
    } as unknown as HTMLElement;
    const records: TouchRecord[] = [];
    attachLive([el], (r) => records.push(r), () => 5);
    handlers.get("pointerdown")!({ clientX: 300, clientY: 120, pointerId: 1 });
    expect(records).toEqual([{ t: 5, id: 0, x: 200, y: 100, state: "down" }]);
  });
});
