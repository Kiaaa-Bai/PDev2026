import { describe, expect, it } from "vitest";
import type { Point, TouchRecord, TouchState } from "../src/data";
import { attachLive, Feeder, inputSims, LIVE_LAG_MS, liveTime } from "../src/drive";
import { CitySim, type CityConfig } from "../src/sims/city";
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

describe("liveTime", () => {
  it("runs the live city LIVE_LAG_MS behind the clock", () => {
    expect(liveTime(10_000)).toBe(10_000 - LIVE_LAG_MS);
  });
});

describe("a live city behind a record's delay", () => {
  const cfg: CityConfig = {
    speed: 1,
    steerMin: 40,
    idleStopMs: 300_000,
    slowMs: 10_000,
    lotDelayMs: [20_000, 20_000],
    lotChance: 1,
    tierAgesMs: [300_000, 1_200_000],
    wideRoadAt: 3,
    seed: 1,
  };
  /** A record reaches the window this long after the moment it records. */
  const DELAY_MS = 7;
  const at = (t: number, id: number, state: TouchState, x = 500, y = 500): TouchRecord => ({ t, id, x, y, state });
  // The roller enters a cell a second after it last turned (or began). Each turn here is recorded just before
  // that, so a city that had run on to the clock would be in the next cell by the time the turn arrived.
  const records = [
    at(1000, 1, "down"),
    at(1998, 1, "move", 600, 450), // north
    at(1998, 1, "up", 600, 450),
    at(3000, 2, "down"),
    at(3995, 2, "move", 400, 450), // west
    at(3995, 2, "up", 400, 450),
    at(5000, 3, "down"),
    at(5992, 3, "move", 400, 550), // south
    at(5992, 3, "up", 400, 550),
  ];
  const end = 9000;

  /** The city as a snapshot, with the roller's progress rounded: advancing in many small steps adds up differently in the last digits. */
  const state = (sim: CitySim) => {
    const s = sim.snapshot();
    return { ...s, roller: { ...s.roller, progress: Math.round(s.roller.progress * 1e6) / 1e6 } };
  };

  /** The records in order on their own time, the way a file is replayed. */
  function replay(): CitySim {
    const sim = new CitySim(cfg);
    const feeder = new Feeder(() => [sim]);
    for (const r of records) feeder.push(r);
    sim.advanceTo(end);
    return sim;
  }

  /** The window's way: a frame every millisecond advances the city to `to(now)`, and each record arrives DELAY_MS late. */
  function live(to: (now: number) => number): CitySim {
    const sim = new CitySim(cfg);
    const feeder = new Feeder(() => [sim]);
    for (let now = 0; now <= end; now++) {
      for (const r of records) if (r.t + DELAY_MS === now) feeder.push(r);
      sim.advanceTo(to(now));
    }
    sim.advanceTo(end);
    return sim;
  }

  it("grows the city a replay of the same records grows", () => {
    const replayed = replay();
    expect(replayed.road.size).toBeGreaterThan(5); // it did drive, and turn
    expect(state(live(liveTime))).toEqual(state(replayed));
  });

  it("would not if it ran on to the clock: a turn that arrives late finds the roller a cell further on", () => {
    expect(state(live((now) => now))).not.toEqual(state(replay()));
  });
});
