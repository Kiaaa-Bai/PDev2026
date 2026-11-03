import { describe, expect, it } from "vitest";
import { Heat, type Bounds } from "../src/heat";

describe("Heat", () => {
  it("counts points per cell and tracks the busiest cell", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0);
    heat.add(1, 1);
    heat.add(0.99, 0.99);
    expect([...heat.counts]).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
    expect(heat.max).toBe(2);
    expect(heat.total).toBe(3);
  });

  it("bumps version on every add", () => {
    const heat = new Heat(4, 2);
    const v = heat.version;
    heat.add(0.5, 0.5);
    expect(heat.version).toBe(v + 1);
  });

  it("addPoint maps points into the grid and clamps outside ones", () => {
    const heat = new Heat(4, 2);
    const bounds: Bounds = [0, 0, 400, 200];
    heat.addPoint(399, 199, bounds);
    heat.addPoint(-50, 500, bounds);
    expect([...heat.counts]).toEqual([0, 0, 0, 0, 1, 0, 0, 1]);
    expect(heat.total).toBe(2);
    expect(heat.version).toBe(2);
  });

  it("addPoint follows a bounds origin that is not zero", () => {
    const heat = new Heat(4, 2);
    // a second display sits left of the main one, so the union starts at a negative x
    heat.addPoint(-100, 0, [-1000, 0, 2000, 200]);
    expect(heat.counts[0]).toBe(0);
    expect(heat.counts[1]).toBe(1);
  });
});
