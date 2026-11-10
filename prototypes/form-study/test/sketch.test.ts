import { describe, expect, it } from "vitest";
import { CITY } from "../src/config";
import { cellKey, CitySim } from "../src/sims/city";
import type { Kind } from "../src/sims/kinds";
import { sketchItems, SKETCH_ROADS } from "../src/render/sketch";

/** A city with exactly these roads (cell → times driven) and lots (cell → kind), and the roller at rest at (0, 0). */
function cityOf(roads: [number, number, number][], lots: [number, number, Kind][]): CitySim {
  const sim = new CitySim(CITY);
  for (const [x, y, n] of roads) sim.road.set(cellKey(x, y), n);
  for (const [x, y, kind] of lots) {
    sim.lots.set(cellKey(x, y), 0);
    sim.kinds.set(cellKey(x, y), kind);
  }
  return sim;
}

const byCell = <T extends { x: number; y: number }>(list: T[]) => [...list].sort((a, b) => a.x - b.x || a.y - b.y);

describe("sketchItems", () => {
  it("lists only cells within the radius, roads joined to their neighbours with their grade, lots with their kind", () => {
    const sim = cityOf(
      [
        [0, 0, 1], // a lane
        [1, 0, 3], // an avenue running east...
        [2, 0, 3],
        [3, 0, 3], // ... past the edge of the radius
        [4, 0, 3],
        [0, 1, 2], // a street south of the lane
        [-2, -2, 2], // a cell on its own
        [9, 9, 3], // far away
      ],
      [
        [1, 1, "shop"],
        [-1, 0, "park"],
        [0, -3, "office"], // just outside
        [8, 8, "landmark"], // far away
      ],
    );
    const items = sketchItems(sim, { x: 0, y: 0 }, 2);
    expect(byCell(items.roads)).toEqual(
      byCell([
        // each pair of neighbours once, west or north end first; a lane joined to anything is drawn as a lane
        { x: 0, y: 0, nx: 1, ny: 0, grade: 1 },
        { x: 1, y: 0, nx: 2, ny: 0, grade: 3 },
        { x: 0, y: 0, nx: 0, ny: 1, grade: 1 },
        // a road with no neighbour is a segment to itself, so it still shows
        { x: -2, y: -2, nx: -2, ny: -2, grade: 2 },
      ]),
    );
    expect(byCell(items.lots)).toEqual(
      byCell([
        { x: 1, y: 1, kind: "shop" },
        { x: -1, y: 0, kind: "park" },
      ]),
    );
    expect(items.roller).toEqual({ x: 0, y: 0 });
  });

  it("an empty city lists just the roller", () => {
    const sim = new CitySim(CITY);
    sim.roller.x = 5;
    sim.roller.y = -3;
    expect(sketchItems(sim, { x: 5, y: -3 }, 15)).toEqual({ roads: [], lots: [], water: [], roller: { x: 5, y: -3 } });
  });

  it("is centred where it is asked, not at the origin", () => {
    const sim = cityOf(
      [
        [0, 0, 3],
        [20, 20, 3],
        [21, 20, 1],
      ],
      [[20, 21, "house"]],
    );
    const items = sketchItems(sim, { x: 20, y: 20 }, 3);
    expect(items.roads).toEqual([{ x: 20, y: 20, nx: 21, ny: 20, grade: 1 }]);
    expect(items.lots).toEqual([{ x: 20, y: 21, kind: "house" }]);
  });
});

describe("sketch road looks by grade", () => {
  const lum = (c: number) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
  it("has a shade and a width for each of the five grades: darker and wider by day as the grade rises, lighter by night", () => {
    expect(SKETCH_ROADS.day).toHaveLength(5);
    expect(SKETCH_ROADS.night).toHaveLength(5);
    expect(SKETCH_ROADS.width).toHaveLength(5);
    for (let g = 1; g < 5; g++) {
      expect(lum(SKETCH_ROADS.day[g]), `day ${g + 1}`).toBeLessThan(lum(SKETCH_ROADS.day[g - 1]));
      expect(lum(SKETCH_ROADS.night[g]), `night ${g + 1}`).toBeGreaterThan(lum(SKETCH_ROADS.night[g - 1]));
      expect(SKETCH_ROADS.width[g]).toBeGreaterThan(SKETCH_ROADS.width[g - 1]);
    }
  });
});

describe("sketch water", () => {
  it("lists the river cells within the radius when the city has a world", () => {
    const wetCity = new CitySim({ ...CITY, worldSeed: 7 });
    let y = 1;
    while (!wetCity.isWater(0, y)) y++;
    const items = sketchItems(wetCity, { x: 0, y }, 3);
    expect(items.water.some((c) => c.x === 0 && c.y === y)).toBe(true);
    for (const c of items.water) expect(wetCity.isWater(c.x, c.y)).toBe(true);
    expect(sketchItems(new CitySim(CITY), { x: 0, y }, 3).water).toEqual([]);
  });
});
