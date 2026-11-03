import { describe, expect, it } from "vitest";
import { CitySim, roadMaskAt, type CityConfig } from "../src/sims/city";

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

let nextId = 1;

/** A pointer touches at t and moves by (dx, dy) screen points; (0, 0) is a plain tap. */
function swipe(sim: CitySim, t: number, dx = 0, dy = 0) {
  const id = nextId++;
  sim.advanceTo(t);
  sim.beginStroke(id, t);
  sim.addPoints(id, [{ t, x: 500, y: 500 }]);
  if (dx || dy) sim.addPoints(id, [{ t, x: 500 + dx, y: 500 + dy }]);
  sim.endStroke(id);
}

/** Pushes that point exactly along each heading on screen: E ↘, S ↙, W ↖, N ↗. */
const PUSH = { E: [100, 50], S: [-100, 50], W: [-100, -50], N: [100, -50] } as const;

const roads = (sim: CitySim) => [...sim.road.keys()].sort();

describe("CitySim roller", () => {
  it("stays parked until the first touch", () => {
    const sim = new CitySim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(60_000);
    expect(sim.driven).toBe(0);
    expect(sim.road.size).toBe(0);
  });

  it("drives east one tile a second after a touch, paving as it goes", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(4000);
    expect(sim.driven).toBe(3);
    expect(roads(sim)).toEqual(["0,0", "1,0", "2,0", "3,0"]);
  });

  it("turns at once to the direction the finger moves", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    swipe(sim, 1500, ...PUSH.N);
    sim.advanceTo(4500);
    expect(roads(sim)).toEqual(["0,-1", "0,-2", "0,-3", "0,0"]);
  });

  it("ignores finger jitter smaller than steerMin", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    swipe(sim, 1000, 10, -20);
    sim.advanceTo(3000);
    expect(roads(sim)).toEqual(["0,0", "1,0", "2,0"]);
  });

  it("keeps its heading on a tie between diagonals and never U-turns on one", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    swipe(sim, 1000, 100, 0); // right while heading ↘: east and north tie, east is kept
    expect(sim.roller.dir).toBe(0);
    swipe(sim, 1000, 0, 100); // down: east and south tie, east is kept
    expect(sim.roller.dir).toBe(0);
    swipe(sim, 1000, 0, -100); // up: north and west tie, west is the U-turn
    expect(sim.roller.dir).toBe(3);
  });

  it("steers from points far outside 0–1", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000, ...PUSH.S);
    expect(sim.roller.dir).toBe(1);
    const id = nextId++;
    sim.beginStroke(id, 2000);
    sim.addPoints(id, [{ t: 2000, x: 3000, y: -500 }]);
    sim.addPoints(id, [{ t: 2000, x: 3100, y: -450 }]);
    expect(sim.roller.dir).toBe(0);
  });

  it("parks five minutes after the last touch and moves again on the next", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(1000 + 600_000);
    // 290 tiles at full speed, then 5 while slowing over the last 10 seconds
    expect(sim.driven).toBe(295);
    expect(sim.parked()).toBe(true);
    swipe(sim, 1000 + 700_000);
    sim.advanceTo(1000 + 702_000);
    expect(sim.driven).toBe(297);
    expect(sim.parked()).toBe(false);
  });

  it("slows down over the last slowMs before it parks", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(1000 + 290_000);
    expect(sim.driven).toBe(290);
    sim.advanceTo(1000 + 295_000); // 290 + 5 - 25/20 = 293.75 tiles
    expect(sim.driven).toBe(293);
    expect(sim.parked()).toBe(false);
  });

  it("stops dead at idleStopMs when slowMs is 0", () => {
    const sim = new CitySim({ ...cfg, slowMs: 0 });
    swipe(sim, 1000);
    sim.advanceTo(1000 + 600_000);
    expect(sim.driven).toBe(300);
  });

  it("covers half the distance when it slows for the whole wait", () => {
    const sim = new CitySim({ ...cfg, idleStopMs: 30_000, slowMs: 30_000 });
    swipe(sim, 0);
    sim.advanceTo(15_000); // 15 - 225/60 = 11.25 tiles
    expect(sim.driven).toBe(11);
    sim.advanceTo(60_000);
    expect(sim.driven).toBe(15);
    expect(sim.parked()).toBe(true);
  });

  it("times each paved cell by when the slowing roller reached it", () => {
    const sim = new CitySim({ ...cfg, idleStopMs: 30_000, slowMs: 30_000 });
    swipe(sim, 0);
    sim.advanceTo(2000);
    // (1,0) is reached at 30000 * (1 - sqrt(1 - 2/30)) ≈ 1017 ms, so its lot at (1,1) is ready 20 s later
    expect(sim.houseTier(1, 1, 21_010)).toBe(0);
    expect(sim.houseTier(1, 1, 21_020)).toBe(1);
  });

  const sameCityAnyFrameRate = (over: Partial<CityConfig>) => {
    const run = (step: number) => {
      const sim = new CitySim({ ...cfg, lotChance: 0.5, lotDelayMs: [20_000, 120_000], seed: 9, ...over });
      const turns: [number, readonly [number, number]][] = [
        [1000, [0, 0]],
        [3200, PUSH.S],
        [5700, PUSH.W],
        [9100, PUSH.N],
      ];
      let t = 0;
      for (const [tt, [dx, dy]] of turns) {
        for (; t < tt; t += step) sim.advanceTo(t);
        swipe(sim, tt, dx, dy);
      }
      for (; t < 20_000; t += step) sim.advanceTo(t);
      sim.advanceTo(20_000);
      return { roads: roads(sim), lots: [...sim.lots.entries()].sort() };
    };
    expect(run(16)).toEqual(run(5000));
  };

  it("grows the same city whatever the frame rate", () => sameCityAnyFrameRate({}));

  it("grows the same city whatever the frame rate while slowing", () =>
    sameCityAnyFrameRate({ idleStopMs: 4000, slowMs: 4000 }));
});

describe("CitySim distance", () => {
  const stroke = (sim: CitySim, id: number, t: number, pts: [number, number][]) =>
    sim.addPoints(id, pts.map(([x, y]) => ({ t, x, y })));

  it("sums pointer distance in points", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    stroke(sim, 1, 0, [[0, 0], [30, 40], [30, 100]]);
    sim.endStroke(1);
    expect(sim.distance).toBe(110);
  });

  it("counts moves too short to steer", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    stroke(sim, 1, 0, [[0, 0], [10, 0], [20, 0], [30, 0]]);
    expect(sim.distance).toBe(30);
    expect(sim.roller.dir).toBe(0);
  });

  it("adds nothing for the first point of a stroke, and starts over on a new stroke", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    stroke(sim, 1, 0, [[0, 0], [3, 4]]);
    expect(sim.distance).toBe(5);
    sim.endStroke(1);
    sim.beginStroke(1, 100);
    stroke(sim, 1, 100, [[900, 900], [900, 910]]); // far from the old stroke's end
    expect(sim.distance).toBe(15);
    sim.beginStroke(1, 200); // a stroke that never ended
    stroke(sim, 1, 200, [[0, 0], [0, 7]]);
    expect(sim.distance).toBe(22);
  });

  it("keeps each pointer's path apart", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    sim.beginStroke(2, 0);
    stroke(sim, 1, 0, [[0, 0]]);
    stroke(sim, 2, 0, [[1000, 1000]]);
    stroke(sim, 1, 1, [[30, 40]]);
    stroke(sim, 2, 1, [[1000, 1010]]);
    stroke(sim, 1, 2, [[30, 100]]);
    expect(sim.distance).toBe(50 + 10 + 60);
  });
});

describe("CitySim houses", () => {
  it("puts a house beside new road once its delay has passed", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(2500);
    expect(sim.houseTier(0, 1, 20_999)).toBe(0);
    expect(sim.houseTier(0, 1, 21_000)).toBe(1);
  });

  it("grows a house with age", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(2500);
    expect(sim.houseTier(0, -1, 21_000 + 300_000)).toBe(2);
    expect(sim.houseTier(0, -1, 21_000 + 1_200_000)).toBe(3);
  });

  it("paves over a house in its way", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000, ...PUSH.S); // south at once, through the lot at (0,1)
    sim.advanceTo(2500);
    expect(sim.road.has("0,1")).toBe(true);
    expect(sim.houseTier(0, 1, 100_000)).toBe(0);
  });

  it("grows houses faster beside road that was driven twice", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000); // east to (2,0) by 3000
    swipe(sim, 3000, ...PUSH.S); // south to (2,1)
    swipe(sim, 4000, ...PUSH.W); // west to (1,1)
    swipe(sim, 5000, ...PUSH.N); // north, back over (1,0) at 6000
    sim.advanceTo(6500);
    expect(sim.road.get("1,0")).toBe(2);
    // (1,-1) sits beside the twice-driven (1,0); (0,-1) only beside (0,0)
    expect(sim.houseTier(1, -1, 122_000)).toBe(2);
    expect(sim.houseTier(0, -1, 122_000)).toBe(1);
  });

  it("counts the houses that are up", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(2500);
    expect(sim.houses(21_000)).toBe(3);
  });
});

describe("roadMaskAt", () => {
  it("encodes road neighbours as N=1 E=2 S=4 W=8", () => {
    const set = new Set(["0,-1", "1,0", "0,1", "-1,0", "0,0"]);
    const has = (x: number, y: number) => set.has(`${x},${y}`);
    expect(roadMaskAt(has, 0, 0)).toBe(15);
    expect(roadMaskAt(has, 0, -1)).toBe(4);
    expect(roadMaskAt(has, 5, 5)).toBe(0);
  });
});
