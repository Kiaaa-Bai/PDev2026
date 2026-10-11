import { describe, expect, it } from "vitest";
import type { Point } from "../src/data";
import { FarmSim, RIPE, type FarmConfig } from "../src/sims/farm";

const cfg: FarmConfig = { cols: 4, rows: 2, waterPerStage: 2 };
const across: Point[] = [
  { t: 0, x: 0.05, y: 0.25 },
  { t: 1, x: 0.95, y: 0.25 },
];

function strokes(sim: FarmSim, n: number, points = across) {
  for (let i = 0; i < n; i++) {
    sim.beginStroke(1, points[0].t);
    sim.addPoints(1, points);
    sim.endStroke(1);
  }
}

describe("FarmSim", () => {
  it("grows a stage every waterPerStage strokes", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 1);
    expect([...sim.stage.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...sim.water.slice(0, 4)]).toEqual([1, 1, 1, 1]);
    strokes(sim, 1);
    expect([...sim.stage.slice(0, 4)]).toEqual([1, 1, 1, 1]);
  });

  it("harvests by itself on ripening and replants on the next watering", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 6);
    expect([...sim.stage.slice(0, 4)]).toEqual([RIPE, RIPE, RIPE, RIPE]);
    expect(sim.harvested).toBe(4);
    strokes(sim, 1);
    expect([...sim.stage.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...sim.water.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(sim.harvested).toBe(4);
  });

  it("waters a plot once per stroke", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 1, [...across, { t: 2, x: 0.05, y: 0.25 }]);
    expect([...sim.water.slice(0, 4)]).toEqual([1, 1, 1, 1]);
  });

  it("leaves untouched plots alone", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 6);
    expect([...sim.stage.slice(4)]).toEqual([0, 0, 0, 0]);
    expect([...sim.water.slice(4)]).toEqual([0, 0, 0, 0]);
  });

  it("keeps two fingers that are down at once apart", () => {
    const sim = new FarmSim(cfg);
    sim.beginStroke(1, 0);
    sim.addPoints(1, [{ t: 0, x: 0.05, y: 0.25 }]);
    sim.beginStroke(2, 1);
    sim.addPoints(2, [{ t: 1, x: 0.05, y: 0.75 }]);
    sim.addPoints(1, [{ t: 2, x: 0.95, y: 0.25 }]);
    sim.endStroke(1);
    sim.endStroke(2);
    expect([...sim.water]).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
  });
});
