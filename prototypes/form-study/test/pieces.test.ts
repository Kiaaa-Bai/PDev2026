import { describe, expect, it } from "vitest";
import {
  houseTurns,
  housePiece,
  HOUSE_POOLS,
  layoutCells,
  layoutKey,
  MODEL_NAMES,
  ROAD_BASE,
  roadPiece,
  ROLLER,
  rotMask,
} from "../src/render/pieces";
import { CitySim, DX, DY, cellKey, type CityConfig } from "../src/sims/city";

const baseOf = (model: string) => ROAD_BASE.find(([name]) => name === model)![1];

describe("roadPiece", () => {
  it("maps every road mask to a piece whose rotated base equals it", () => {
    for (let mask = 1; mask <= 15; mask++) {
      const { model, turns } = roadPiece(mask);
      let m = baseOf(model);
      for (let k = 0; k < turns; k++) m = rotMask(m);
      expect(m, `mask ${mask} via ${model} x${turns}`).toBe(mask);
    }
  });

  it("uses the square for a road with no neighbours", () => {
    expect(roadPiece(0)).toEqual({ model: "roads/road-square", turns: 0 });
  });

  it("picks the piece by how many neighbours there are", () => {
    expect(roadPiece(1).model).toBe("roads/road-end");
    expect(roadPiece(5).model).toBe("roads/road-straight");
    expect(roadPiece(10).model).toBe("roads/road-straight");
    expect(roadPiece(3).model).toBe("roads/road-bend");
    expect(roadPiece(7).model).toBe("roads/road-intersection");
    expect(roadPiece(15).model).toBe("roads/road-crossroad");
  });

  it("leaves each piece unturned where it already fits, as the models are drawn", () => {
    // read off the Kenney models seen from above: the end opens east, the straight runs
    // east-west, the bend joins south and west, the T joins west, east and south
    expect(roadPiece(2)).toEqual({ model: "roads/road-end", turns: 0 });
    expect(roadPiece(10)).toEqual({ model: "roads/road-straight", turns: 0 });
    expect(roadPiece(12)).toEqual({ model: "roads/road-bend", turns: 0 });
    expect(roadPiece(14)).toEqual({ model: "roads/road-intersection", turns: 0 });
  });

  it("turns each +90 degrees from south to east to north to west", () => {
    expect(rotMask(0b0100)).toBe(0b0010); // S -> E
    expect(rotMask(0b0010)).toBe(0b0001); // E -> N
    expect(rotMask(0b0001)).toBe(0b1000); // N -> W
    expect(rotMask(0b1000)).toBe(0b0100); // W -> S
  });
});

describe("houseTurns", () => {
  const roadAt = (...cells: [number, number][]) => (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y);
  // the models' fronts face north at rotation 0, as read off them; rotMask turns a direction bit the same way the model turns
  const frontAfter = (turns: number) => {
    let front = 1; // N
    for (let k = 0; k < turns; k++) front = rotMask(front);
    return front;
  };

  it("faces the road: road only to the north leaves the house as it is drawn", () => {
    expect(houseTurns(roadAt([0, -1]), 0, 0)).toBe(0);
  });

  it("turns the front to a road on each other side", () => {
    expect(houseTurns(roadAt([0, 1]), 0, 0)).toBe(2); // south
    expect(houseTurns(roadAt([1, 0]), 0, 0)).toBe(3); // east
    expect(houseTurns(roadAt([-1, 0]), 0, 0)).toBe(1); // west
  });

  it("points the turned front at the road for every side", () => {
    const sides: [number, number, number][] = [
      [0, -1, 1], // N
      [1, 0, 2], // E
      [0, 1, 4], // S
      [-1, 0, 8], // W
    ];
    for (const [dx, dy, bit] of sides) expect(frontAfter(houseTurns(roadAt([dx, dy]), 0, 0))).toBe(bit);
  });

  it("takes the first road in the order south, east, north, west", () => {
    expect(frontAfter(houseTurns(roadAt([0, 1], [1, 0], [0, -1], [-1, 0]), 0, 0))).toBe(4);
    expect(frontAfter(houseTurns(roadAt([1, 0], [0, -1], [-1, 0]), 0, 0))).toBe(2);
    expect(frontAfter(houseTurns(roadAt([0, -1], [-1, 0]), 0, 0))).toBe(1);
  });
});

describe("housePiece", () => {
  it("draws a tier's house from that tier's pool", () => {
    for (const tier of [1, 2, 3] as const) {
      for (let i = 0; i < 50; i++) expect(HOUSE_POOLS[tier - 1]).toContain(housePiece(tier, i, -i * 3));
    }
  });

  it("picks the same house for the same cell every time", () => {
    expect(housePiece(2, 14, -7)).toBe(housePiece(2, 14, -7));
  });

  it("varies from cell to cell", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(housePiece(3, i, 2 * i + 1));
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("ROLLER", () => {
  it("turns the model's +z front to the way each heading drives", () => {
    for (let dir = 0; dir < 4; dir++) {
      const yaw = ROLLER.yaw[dir];
      // rotation.y = yaw sends +z to (sin yaw, cos yaw) in (x, z)
      expect(Math.sin(yaw), `heading ${dir} x`).toBeCloseTo(DX[dir]);
      expect(Math.cos(yaw), `heading ${dir} z`).toBeCloseTo(DY[dir]);
    }
  });
});

describe("models", () => {
  // keys only: the glob is lazy, so no model is loaded
  const files = import.meta.glob("../src/assets/kenney/**/*.glb", { query: "?url", import: "default" });

  it("has a file for every model the city draws", () => {
    expect(MODEL_NAMES.length).toBeGreaterThan(20);
    for (const name of MODEL_NAMES) expect(files, name).toHaveProperty([`../src/assets/kenney/${name}.glb`]);
  });
});

describe("layoutCells and layoutKey", () => {
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
  /** A straight road of three cells with one lot beside it that is ready at time 0. */
  function town() {
    const sim = new CitySim(cfg);
    for (const x of [0, 1, 2]) sim.road.set(cellKey(x, 0), 1);
    sim.lots.set(cellKey(1, -1), 0);
    return sim;
  }
  const layout = (sim: CitySim, t: number) =>
    layoutCells((x, y) => sim.hasRoad(x, y), (x, y) => sim.houseTier(x, y, t), 1, 0, 3);

  it("places joined road pieces and a house turned to face the road", () => {
    const placed = layout(town(), 1000);
    const at = (x: number, y: number) => placed.find((p) => p.x === x && p.y === y);
    expect(at(0, 0)).toMatchObject({ model: "roads/road-end", turns: 0 }); // joins east, as drawn
    expect(at(1, 0)).toMatchObject({ model: "roads/road-straight", turns: 0 }); // runs east-west, as drawn
    expect(at(2, 0)).toMatchObject({ model: "roads/road-end", turns: 2 }); // joins west
    // road is to the south of the lot, so the north-facing front turns round
    expect(at(1, -1)).toMatchObject({ turns: 2, scale: 0.7 });
    expect(placed).toHaveLength(4);
  });

  it("stays the same while time passes and no house changes tier", () => {
    const sim = town();
    // 5 s buckets apart, all inside tier 1 (it ripens to tier 2 at 300 s)
    const keys = [1000, 6000, 11_000, 120_000, 290_000].map((t) => layoutKey(layout(sim, t)));
    expect(new Set(keys).size).toBe(1);
  });

  it("changes when a house ages into the next tier, and when a road is added", () => {
    const sim = town();
    const before = layoutKey(layout(sim, 299_000));
    expect(layoutKey(layout(sim, 301_000))).not.toBe(before);
    sim.road.set(cellKey(3, 0), 1);
    expect(layoutKey(layout(sim, 299_000))).not.toBe(before);
  });
});
