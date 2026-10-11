import { describe, expect, it } from "vitest";
import type { Point } from "../src/data";
import { CitySim, roadMask, tierFor, type CityConfig } from "../src/sims/city";

const cfg: CityConfig = {
  cols: 4,
  rows: 2,
  roadThreshold: 2,
  wideRoadAt: 99,
  buildChance: 1,
  tierThresholds: [2, 3, 4],
  seed: 1,
};

// Left to right along row 0.
const across: Point[] = [
  { t: 0, x: 0.05, y: 0.25 },
  { t: 1, x: 0.95, y: 0.25 },
];

function stroke(sim: CitySim, points: Point[]) {
  sim.beginStroke(points[0].t);
  sim.addPoints(points);
  sim.endStroke();
}

describe("CitySim", () => {
  it("adds one traffic per stroke and paves a road at the threshold", () => {
    const sim = new CitySim(cfg);
    stroke(sim, across);
    expect([...sim.traffic]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect([...sim.road]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    stroke(sim, across);
    expect([...sim.road]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("counts a cell once when one stroke crosses it twice", () => {
    const sim = new CitySim(cfg);
    stroke(sim, [...across, { t: 2, x: 0.05, y: 0.25 }]);
    expect([...sim.traffic]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("builds next to roads and never on them", () => {
    const sim = new CitySim(cfg);
    stroke(sim, across);
    stroke(sim, across);
    expect([...sim.building]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("upgrades buildings as the road gets busier", () => {
    const sim = new CitySim(cfg);
    for (let i = 0; i < 4; i++) stroke(sim, across);
    expect([...sim.building.slice(4)]).toEqual([3, 3, 3, 3]);
  });

  it("grows the same city from the same strokes and seed", () => {
    const loose = { ...cfg, buildChance: 0.3, seed: 5 };
    const a = new CitySim(loose);
    const b = new CitySim(loose);
    for (let i = 0; i < 6; i++) {
      stroke(a, across);
      stroke(b, across);
    }
    expect([...a.building]).toEqual([...b.building]);
  });

  it("bumps version only when something changes", () => {
    const sim = new CitySim(cfg);
    const v = sim.version;
    sim.advanceTo(1000);
    expect(sim.version).toBe(v);
    stroke(sim, across);
    expect(sim.version).toBeGreaterThan(v);
  });
});

describe("tierFor", () => {
  it("steps through the thresholds", () => {
    expect([1, 2, 3, 4, 9].map((t) => tierFor(t, [2, 3, 4]))).toEqual([0, 1, 2, 3, 3]);
  });
});

describe("roadMask", () => {
  it("encodes road neighbours as N=1 E=2 S=4 W=8", () => {
    // 3×3 plus sign
    const road = Uint8Array.from([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    expect(roadMask(road, 3, 3, 4)).toBe(15);
    expect(roadMask(road, 3, 3, 1)).toBe(4);
    expect(roadMask(Uint8Array.from([1, 0, 0, 0]), 2, 2, 0)).toBe(0);
  });
});
