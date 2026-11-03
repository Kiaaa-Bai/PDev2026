import { describe, expect, it } from "vitest";
import { dayOf, Heat } from "../src/heat";

/** A moment in a local day, whatever the machine's time zone. */
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const T = at(3);

describe("Heat", () => {
  it("counts points per cell over the area they cover, and tracks the busiest cell", () => {
    const heat = new Heat(4, 2);
    // the corners of a 400 x 200 area, so a cell is 100 x 100 points
    heat.add(0, 0, T);
    heat.add(399, 199, T);
    heat.add(400, 200, T);
    expect([...heat.counts]).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
    expect(heat.max).toBe(2);
    expect(heat.total).toBe(3);
  });

  it("bumps version on every add", () => {
    const heat = new Heat(4, 2);
    const v = heat.version;
    heat.add(0.5, 0.5, T);
    expect(heat.version).toBe(v + 1);
    heat.add(0.5, 0.5, T);
    expect(heat.version).toBe(v + 2);
  });

  it("scales to the area the points cover, wherever it is on the screen", () => {
    const near = new Heat(4, 2);
    const far = new Heat(4, 2);
    for (const p of [[0, 0], [400, 200], [100, 50]]) near.add(p[0], p[1], T);
    for (const p of [[-3000, 900], [-2600, 1100], [-2900, 950]]) far.add(p[0], p[1], T); // a second display to the left
    expect([...far.counts]).toEqual([...near.counts]);
    expect(far.counts[0]).toBe(1);
    expect(far.counts[7]).toBe(1);
  });

  it("re-bins everything already counted when the area grows", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0, T);
    heat.add(200, 100, T);
    // the area is 200 x 100 so far: the two points are opposite corners
    expect([...heat.counts]).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
    heat.add(400, 200, T); // another display: the area is twice as wide and tall, so the second point is now mid-grid
    expect([...heat.counts]).toEqual([1, 0, 0, 0, 0, 0, 1, 1]);
    expect(heat.total).toBe(3);
  });

  it("ends up the same however the points arrived: one by one with reads between, or all at once", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    // a pointer wandering further out, so the area grows many times
    const points = Array.from({ length: 400 }, (_, i) => [rand() * (200 + i * 5) - 100, rand() * (100 + i * 3)]);
    const oneByOne = new Heat(16, 10);
    for (const [x, y] of points) {
      oneByOne.add(x, y, T);
      void oneByOne.counts;
    }
    const allAtOnce = new Heat(16, 10);
    for (const [x, y] of points) allAtOnce.add(x, y, T);
    expect([...oneByOne.counts]).toEqual([...allAtOnce.counts]);
    expect(oneByOne.max).toBe(allAtOnce.max);
    expect(oneByOne.total).toBe(400);
  });

  it("keeps the area's proportions: a strip along the screen stays a strip", () => {
    const heat = new Heat(10, 10);
    for (const [x, y] of [[0, 500], [1000, 500], [500, 510]]) heat.add(x, y, T);
    const rows = new Set([...heat.counts].flatMap((n, i) => (n ? [Math.floor(i / 10)] : [])));
    expect([...rows].sort()).toEqual([4, 5]);
  });

  it("gives a single tap a small area to sit in rather than the whole panel", () => {
    const heat = new Heat(16, 10);
    heat.add(700, 400, T);
    expect(heat.total).toBe(1);
    expect([...heat.counts].filter((n) => n).length).toBe(1);
    expect(Number.isFinite(heat.toUnit(700, 400)[0])).toBe(true);
  });

  it("puts a point on the grid as a fraction of it, clamped, for the fingers that are down", () => {
    const heat = new Heat(4, 2);
    expect(heat.toUnit(5, 5)).toEqual([0.5, 0.5]); // nothing counted yet
    heat.add(0, 0, T);
    heat.add(400, 200, T);
    expect(heat.toUnit(0, 0)).toEqual([0, 0]);
    expect(heat.toUnit(400, 200)).toEqual([1, 1]);
    expect(heat.toUnit(200, 100)).toEqual([0.5, 0.5]);
    expect(heat.toUnit(9000, -9000)).toEqual([1, 0]);
  });
});

describe("Heat days", () => {
  it("names the local day of a time", () => {
    expect(dayOf(new Date(2026, 10, 3, 0, 0, 1).getTime())).toBe("2026-11-03");
    expect(dayOf(new Date(2026, 10, 3, 23, 59, 59).getTime())).toBe("2026-11-03");
    expect(dayOf(new Date(2026, 0, 9, 12).getTime())).toBe("2026-01-09");
  });

  it("starts over when a record falls on a later day, so it only shows today", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0, at(3, 23));
    heat.add(400, 200, at(3, 23));
    expect(heat.total).toBe(2);
    const v = heat.version;
    heat.add(50, 50, at(4, 0));
    expect(heat.total).toBe(1);
    expect(heat.day).toBe(dayOf(at(4, 0)));
    expect([...heat.counts].reduce((a, b) => a + b, 0)).toBe(1);
    expect(heat.max).toBe(1);
    expect(heat.version).toBeGreaterThan(v);
  });

  it("scales a new day to its own points, not yesterday's area", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0, at(3));
    heat.add(4000, 2000, at(3)); // yesterday: a huge area
    heat.add(0, 0, at(4));
    heat.add(400, 200, at(4)); // today: a small one
    expect([...heat.counts]).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("keeps counting within the day", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0, at(3, 0));
    heat.add(400, 200, at(3, 23));
    expect(heat.total).toBe(2);
  });

  it("ignores a record from an earlier day than the one it shows", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0, at(4));
    const v = heat.version;
    heat.add(400, 200, at(3, 23)); // a late arrival from before midnight
    expect(heat.total).toBe(1);
    expect(heat.version).toBe(v);
  });

  it("rolls over to the new day by the clock alone, before any record of it", () => {
    const heat = new Heat(4, 2);
    heat.add(0, 0, at(3, 22));
    heat.rollTo(at(3, 23));
    expect(heat.total).toBe(1);
    const v = heat.version;
    heat.rollTo(at(4, 8));
    expect(heat.total).toBe(0);
    expect(heat.day).toBe(dayOf(at(4)));
    expect(heat.version).toBeGreaterThan(v);
    heat.rollTo(at(3, 8)); // the clock never takes it back
    expect(heat.day).toBe(dayOf(at(4)));
  });
});
