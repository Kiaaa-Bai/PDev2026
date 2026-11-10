import { describe, expect, it } from "vitest";
import { isWater, RIVER_SPACING } from "../src/sims/world";

/** The water runs down column x from y0 to y1: [start, length] of each. */
function runsDown(seed: number, x: number, y0: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) {
    if (!isWater(seed, x, y)) continue;
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === y) last[1]++;
    else out.push([y, 1]);
  }
  return out;
}

describe("isWater", () => {
  it("is the same for the same seed, and differs between seeds", () => {
    let same = true;
    let differs = false;
    for (let x = -200; x <= 200; x += 7) {
      for (let y = -300; y <= 300; y++) {
        if (isWater(11, x, y) !== isWater(11, x, y)) same = false;
        if (isWater(11, x, y) !== isWater(12, x, y)) differs = true;
      }
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
  });

  it("runs rivers 2 or 3 cells wide, 60 to 120 cells apart, down every column", () => {
    expect(RIVER_SPACING).toBe(90);
    for (const seed of [1, 2, 3]) {
      for (const x of [-500, -37, 0, 41, 999]) {
        const runs = runsDown(seed, x, -1000, 1000);
        expect(runs.length, `seed ${seed} x ${x}`).toBeGreaterThan(14);
        for (const [, len] of runs) expect([2, 3]).toContain(len);
        for (let i = 1; i < runs.length; i++) {
          const gap = runs[i][0] - runs[i - 1][0];
          expect(gap).toBeGreaterThanOrEqual(57);
          expect(gap).toBeLessThanOrEqual(123);
        }
      }
    }
  });

  it("meanders: a river's line moves up and down along the map", () => {
    const first = (x: number) => runsDown(5, x, 0, 200)[0][0];
    const ys = new Set([0, 40, 80, 120, 160, 200].map(first));
    expect(ys.size).toBeGreaterThan(2);
  });

  it("never floods the cell the roller starts on", () => {
    for (let seed = 0; seed < 200; seed++) expect(isWater(seed, 0, 0), `seed ${seed}`).toBe(false);
  });
});
