import { describe, expect, it } from "vitest";
import { Heat } from "../src/heat";

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
});
