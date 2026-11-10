import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  APARTMENT_POOL,
  BLOCK_POOL,
  buildingPlacements,
  clampHalfHeight,
  COMMERCIAL_FOOTPRINT,
  COMMERCIAL_SCALE,
  commercialScale,
  EASE_BACK_MS,
  easeBackLeft,
  easeHalfHeight,
  ELEVATION,
  GARDEN_TREE,
  houseTurns,
  housePiece,
  HOUSE_POOLS,
  HOUSE_SCALE,
  lampHead,
  LAMP_HEAD,
  LANDMARK,
  LIGHT,
  layoutCells,
  layoutKey,
  LIGHT_SCALE,
  MAX_HALF_HEIGHT,
  MIN_HALF_HEIGHT,
  MODEL_NAMES,
  OFFICE_LOW_POOL,
  OFFICE_TOWER_POOL,
  panDelta,
  PARK_PLANTER,
  PARK_TREE,
  ROAD_BASE,
  roadPiece,
  ROLLER,
  rotMask,
  SHOP_POOL,
  viewRadius,
  VIEW_HOLD_MS,
  rebuildDue,
  REBUILD_EVERY_MS,
  WATER,
  WATER_COLOUR,
  waterPiece,
  ROUND,
  FILLET,
  wheelZoom,
  wheelZoomTarget,
  type Placement,
  type Turns,
} from "../src/render/pieces";
import { PANEL_H, PANEL_W } from "../src/render/panel";
import { LANE_COLOUR, ROOF_COLOURS, roofBand, roofColour, STREET_COLOUR, WHITE } from "../src/render/looks";
import { CitySim, DX, DY, cellKey, type CityConfig } from "../src/sims/city";
import type { Kind } from "../src/sims/kinds";

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

  it("draws every tier's house from the suburban set, so the roof can take the hour's colour", () => {
    for (const pool of HOUSE_POOLS) for (const m of pool) expect(m).toMatch(/^suburban\/building-type-[a-u]$/);
    expect(HOUSE_POOLS).toHaveLength(3);
    expect(HOUSE_SCALE).toHaveLength(3);
  });

  it("uses the o to u houses for tier 3, leaving out p and q, whose roofs have no recolourable part", () => {
    expect(HOUSE_POOLS[2]).toEqual(["o", "r", "s", "t", "u"].map((c) => `suburban/building-type-${c}`));
    expect(new Set(HOUSE_POOLS.flat()).size).toBe(HOUSE_POOLS.flat().length); // no house in two tiers
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

  it("lists every model a building kind can put down, once each", () => {
    for (const name of [LANDMARK, PARK_TREE, PARK_PLANTER, GARDEN_TREE, ...SHOP_POOL, ...BLOCK_POOL, ...HOUSE_POOLS.flat()]) {
      expect(MODEL_NAMES, name).toContain(name);
    }
    expect(LANDMARK).toBe("commercial/building-skyscraper-a");
    expect(new Set(MODEL_NAMES).size).toBe(MODEL_NAMES.length);
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
  const looksOf = (sim: CitySim) => ({
    driven: (x: number, y: number) => sim.road.get(cellKey(x, y)) ?? 0,
    built: (x: number, y: number) => sim.lots.get(cellKey(x, y)) ?? 0,
    kind: (x: number, y: number) => sim.lotKind(x, y),
  });
  const layout = (sim: CitySim, t: number) =>
    layoutCells((x, y) => sim.hasRoad(x, y), (x, y) => sim.houseTier(x, y, t), 1, 0, 3, looksOf(sim));

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

describe("layoutCells looks", () => {
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
  const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m).getTime();
  /** A straight road along y = 0 from x = 0 to 6, every cell driven `driven` times, and a house on the lot at (3, -1). */
  function street(driven: number, builtAt = at(9), kind?: Kind) {
    const sim = new CitySim(cfg);
    for (let x = 0; x <= 6; x++) sim.road.set(cellKey(x, 0), driven);
    sim.lots.set(cellKey(3, -1), builtAt);
    if (kind) sim.kinds.set(cellKey(3, -1), kind);
    return sim;
  }
  const layout = (sim: CitySim, t: number) =>
    layoutCells(
      (x, y) => sim.hasRoad(x, y),
      (x, y) => sim.houseTier(x, y, t),
      3,
      0,
      5,
      {
        driven: (x, y) => sim.road.get(cellKey(x, y)) ?? 0,
        built: (x, y) => sim.lots.get(cellKey(x, y)) ?? 0,
        kind: (x, y) => sim.lotKind(x, y),
      },
    );
  // road pieces only: a highway's barriers are laid over them as models of their own
  const roads = (placed: ReturnType<typeof layout>) => placed.filter((p) => p.model.startsWith("roads/road") && !p.model.endsWith("-barrier"));
  const lights = (placed: ReturnType<typeof layout>) => placed.filter((p) => p.model === "roads/light-square");

  it("gives a road driven once the lane's asphalt, and from twice the street's", () => {
    const once = roads(layout(street(1), at(9, 1)));
    expect(once).toHaveLength(7);
    for (const p of once) expect(p.colour).toBe(LANE_COLOUR);
    for (const driven of [2, 3, 9]) for (const p of roads(layout(street(driven), at(9, 1)))) expect(p.colour).toBe(STREET_COLOUR);
  });

  it("puts a streetlight on every other straight cell of a road driven 3 times, and nowhere else", () => {
    for (const driven of [1, 2]) expect(lights(layout(street(driven), at(9, 1)))).toHaveLength(0);
    const placed = layout(street(3), at(9, 1));
    // straights are x = 1..5 (the ends at 0 and 6 are end pieces); alternate cells are where x + y is even
    expect(lights(placed).map((p) => Math.floor(p.x))).toEqual([2, 4]);
    for (const p of lights(placed)) expect(p).toMatchObject({ turns: 0, scale: LIGHT_SCALE, colour: WHITE });
  });

  it("stands the pole on the south edge of an east-west street, its arm reaching over the road", () => {
    const [light] = lights(layout(street(3), at(9, 1)));
    expect(light.x).toBe(2);
    expect(light.y).toBeGreaterThan(0.3);
    expect(light.y).toBeLessThan(0.5); // inside the cell
  });

  it("stands it on the east edge of a north-south street, turned with the piece", () => {
    const sim = new CitySim(cfg);
    for (let y = 0; y <= 6; y++) sim.road.set(cellKey(0, y), 3);
    const placed = layoutCells((x, y) => sim.hasRoad(x, y), () => 0, 0, 3, 5, { driven: (x, y) => sim.road.get(cellKey(x, y)) ?? 0, built: () => 0, kind: () => undefined });
    const ls = lights(placed);
    expect(ls.map((p) => Math.floor(p.y))).toEqual([2, 4]);
    for (const p of ls) {
      expect(p.turns).toBe(1);
      expect(p.x).toBeGreaterThan(0.3);
      expect(p.x).toBeLessThan(0.5);
    }
  });

  it("gives no streetlight to ends, bends, junctions or lone squares", () => {
    const sim = new CitySim(cfg);
    // a plus of road, every cell driven 3 times: crossroad in the middle, an end on each arm
    for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) sim.road.set(cellKey(x, y), 3);
    sim.road.set(cellKey(5, 5), 3); // a lone square far away
    const placed = layoutCells((x, y) => sim.hasRoad(x, y), () => 0, 2, 2, 5, { driven: (x, y) => sim.road.get(cellKey(x, y)) ?? 0, built: () => 0, kind: () => undefined });
    expect(lights(placed)).toHaveLength(0);
  });

  it("colours a suburban roof by the hour its house appeared", () => {
    const house = (builtAt: number) => layout(street(2, builtAt), builtAt + 1000).find((p) => p.x === 3 && p.y === -1)!;
    expect(house(at(9)).colour).toBe(ROOF_COLOURS[0]);
    expect(house(at(13)).colour).toBe(ROOF_COLOURS[1]);
    expect(house(at(21)).colour).toBe(ROOF_COLOURS[2]);
    expect(house(at(2)).colour).toBe(ROOF_COLOURS[3]);
  });

  it("keeps the hour's roof colour on a tier 3 house, which is a suburban one now", () => {
    const sim = street(2, at(21));
    const old = at(21) + 4 * 3_600_000; // old enough to be tier 3
    expect(sim.houseTier(3, -1, old)).toBe(3);
    const house = layout(sim, old).find((p) => p.x === 3 && p.y === -1)!;
    expect(HOUSE_POOLS[2]).toContain(house.model);
    expect(house.colour).toBe(ROOF_COLOURS[2]);
  });

  describe("layoutKey", () => {
    /** The key a street gives while its house is brand new (tier 1, so the roof shows). */
    const key = (driven: number, builtAt = at(9)) => layoutKey(layout(street(driven, builtAt), builtAt + 1000));

    it("changes when only a roof band changes", () => {
      // the same house model, tier and cell, built a minute either side of noon
      expect(key(2, at(12, 1))).not.toBe(key(2, at(11, 59)));
    });

    it("stays when a roof's time changes within its band", () => {
      expect(key(2, at(9, 0))).toBe(key(2, at(10, 30)));
    });

    it("changes when only a road's tier changes: tinted to plain, then lit", () => {
      expect(new Set([key(1), key(2), key(3)]).size).toBe(3);
    });

    it("stays when a road is driven again beyond the top grade (a highway from 6 passes)", () => {
      expect(key(6)).toBe(key(40));
    });

    it("notices a roof band on a tier 3 house, which keeps its hour colour", () => {
      const tier3 = (builtAt: number) => layoutKey(layout(street(2, builtAt), builtAt + 4 * 3_600_000));
      expect(tier3(at(19))).toBe(tier3(at(23))); // both evening
      expect(tier3(at(13))).not.toBe(tier3(at(19)));
    });

    it("does not notice a roof band on a commercial building", () => {
      const shop = (builtAt: number) => layoutKey(layout(street(2, builtAt, "shop"), builtAt + 1000));
      expect(shop(at(7))).toBe(shop(at(13)));
    });

    it("changes with a streetlight placement alone", () => {
      const placed = layout(street(3), at(9, 1));
      const without = placed.filter((p) => p.model !== "roads/light-square");
      expect(layoutKey(placed)).not.toBe(layoutKey(without));
    });

    it("changes with scale alone", () => {
      const placed = layout(street(2), at(9, 1));
      const bigger = placed.map((p, i) => (i === 0 ? { ...p, scale: p.scale * 1.5 } : p));
      expect(layoutKey(bigger)).not.toBe(layoutKey(placed));
    });

    it("changes with colour alone", () => {
      const placed = layout(street(2), at(9, 1));
      const recoloured = placed.map((p, i) => (i === 0 ? { ...p, colour: 0x123456 } : p));
      expect(layoutKey(recoloured)).not.toBe(layoutKey(placed));
    });
  });
});

describe("building kinds", () => {
  const built = new Date(2026, 10, 3, 14, 0).getTime(); // afternoon
  const noon = ROOF_COLOURS[roofBand(built)];
  /** What kind `kind` puts on the cell (3, -1) beside a road along y = 0, at a tier, through layoutCells. */
  const lot = (kind: Kind | undefined, tier: 1 | 2 | 3, x = 3, y = -1): Placement[] =>
    layoutCells(
      (cx, cy) => cy === y + 1 && cx >= x - 3 && cx <= x + 3,
      (cx, cy) => (cx === x && cy === y ? tier : 0),
      x,
      y,
      4,
      { driven: () => 1, built: () => built, kind: () => kind },
    ).filter((p) => !p.model.startsWith("roads/"));
  const inside = (p: Placement, x = 3, y = -1) => Math.abs(p.x - x) <= 0.5 && Math.abs(p.y - y) <= 0.5;
  const TIERS = [1, 2, 3] as const;
  const KINDS: Kind[] = ["house", "row", "detached", "park", "shop", "apartment", "landmark"];
  const family = (m: string) => m.split("/")[0];

  it("draws a house, row house and detached house from the tier's suburban pool, with the hour's roof", () => {
    for (const kind of ["house", "row", "detached"] as const) {
      for (const tier of TIERS) {
        const [house] = lot(kind, tier);
        expect(HOUSE_POOLS[tier - 1], `${kind} tier ${tier}`).toContain(house.model);
        expect(house.colour).toBe(noon);
        expect(house.turns).toBe(2); // road to the south
      }
    }
  });

  it("draws a lot with no kind as a house", () => {
    for (const tier of TIERS) expect(lot(undefined, tier)).toEqual(lot("house", tier));
  });

  it("draws a plain house at the size it always was", () => {
    for (const tier of TIERS) expect(lot("house", tier)[0].scale).toBe(HOUSE_SCALE[tier - 1]);
  });

  it("draws a row house bigger than a house, so that neighbours meet, and a detached one smaller, in its garden", () => {
    for (const tier of TIERS) {
      expect(lot("row", tier)[0].scale).toBeGreaterThan(lot("house", tier)[0].scale);
      expect(lot("detached", tier)[0].scale).toBeLessThan(lot("house", tier)[0].scale);
    }
  });

  it("gives a detached house a garden: small trees inside its own cell, as well as the house", () => {
    for (const tier of TIERS) {
      const [house, ...garden] = lot("detached", tier);
      expect(HOUSE_POOLS[tier - 1]).toContain(house.model);
      expect(garden.length).toBeGreaterThan(0);
      for (const g of garden) {
        expect(g.model).toBe(GARDEN_TREE);
        expect(inside(g)).toBe(true);
        expect(g.colour).toBe(WHITE);
      }
    }
    expect(lot("house", 1)).toHaveLength(1);
    expect(lot("row", 1)).toHaveLength(1);
  });

  it("draws a shop from the commercial a to e models in its own colours, small at low density and full-size at medium", () => {
    for (const tier of [1, 2] as const) {
      const placed = lot("shop", tier);
      expect(placed).toHaveLength(1);
      expect(SHOP_POOL).toContain(placed[0].model);
      expect(placed[0].colour).toBe(WHITE);
    }
    expect(lot("shop", 1)[0].model).toBe(lot("shop", 2)[0].model);
    expect(SHOP_POOL).toEqual("abcde".split("").map((c) => `commercial/building-${c}`));
  });

  it("draws every shop and block no wider than its lot, and no bigger than the standard commercial size", () => {
    for (const model of [...SHOP_POOL, ...BLOCK_POOL]) {
      expect(COMMERCIAL_FOOTPRINT, model).toHaveProperty([model]);
      const scale = commercialScale(model);
      expect(scale, model).toBeLessThanOrEqual(COMMERCIAL_SCALE);
      expect(scale * COMMERCIAL_FOOTPRINT[model], model).toBeLessThanOrEqual(1 + 1e-9);
      expect(scale, model).toBeGreaterThan(0.4);
    }
    // narrow models keep the standard size, the widest are shrunk to fit
    expect(commercialScale("commercial/building-a")).toBe(COMMERCIAL_SCALE);
    expect(commercialScale("commercial/building-n")).toBeLessThan(0.5);
  });

  it("draws the shop and the tier 3 apartment at the size that fits their model", () => {
    for (let x = 0; x < 40; x++) {
      const shop = lot("shop", 2, x, -1)[0];
      expect(shop.scale).toBe(commercialScale(shop.model));
      const block = lot("apartment", 3, x, -1)[0];
      expect(block.scale).toBe(commercialScale(block.model));
    }
  });

  it("draws an apartment as a house at tiers 1 and 2, and as a commercial block of f to j at tier 3", () => {
    for (const tier of [1, 2] as const) expect(lot("apartment", tier)).toEqual(lot("house", tier));
    const [block] = lot("apartment", 3);
    expect(APARTMENT_POOL).toContain(block.model);
    expect(block.colour).toBe(WHITE);
    expect(APARTMENT_POOL).toEqual("fghij".split("").map((c) => `commercial/building-${c}`));
  });

  it("draws the landmark as the skyscraper, in its own colours, whatever the tier", () => {
    for (const tier of TIERS) {
      const placed = lot("landmark", tier);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ model: LANDMARK, colour: WHITE, turns: 2 });
    }
  });

  it("draws a park as a large tree and planters on its cell, the same at every tier", () => {
    const first = lot("park", 1);
    expect(first.filter((p) => p.model === PARK_TREE).length).toBeGreaterThan(0);
    expect(first.filter((p) => p.model === PARK_PLANTER).length).toBeGreaterThan(0);
    for (const p of first) {
      expect([PARK_TREE, PARK_PLANTER]).toContain(p.model);
      expect(inside(p)).toBe(true);
    }
    for (const tier of TIERS) expect(lot("park", tier)).toEqual(first);
  });

  it("sets the planters of a park on the road side, whichever side that is", () => {
    // (dx, dy) of the road side, and the turns that face it
    const sides: [number, number, Turns][] = [
      [0, 1, 2],
      [1, 0, 3],
      [0, -1, 0],
      [-1, 0, 1],
    ];
    for (const [dx, dy, turns] of sides) {
      const placed = layoutCells(
        (cx, cy) => cx === 10 + dx && cy === 10 + dy,
        (cx, cy) => (cx === 10 && cy === 10 ? 1 : 0),
        10,
        10,
        3,
        { driven: () => 1, built: () => built, kind: () => "park" },
      ).filter((p) => !p.model.startsWith("roads/"));
      const planters = placed.filter((p) => p.model === PARK_PLANTER);
      const trees = placed.filter((p) => p.model === PARK_TREE);
      const across = (p: Placement) => (p.x - 10) * dx + (p.y - 10) * dy; // how far towards the road
      expect(planters.every((p) => across(p) > 0), `planters, road at ${dx},${dy}`).toBe(true);
      expect(Math.min(...trees.map(across)), `trees, road at ${dx},${dy}`).toBeLessThan(Math.min(...planters.map(across)));
      expect(houseTurns((cx, cy) => cx === 10 + dx && cy === 10 + dy, 10, 10)).toBe(turns);
    }
  });

  it("puts nothing down before the lot's house has appeared", () => {
    for (const kind of KINDS) expect(lot(kind, 0 as unknown as 1)).toEqual([]);
  });

  it("draws only models the city loads, and every colour as a whole 24-bit number", () => {
    for (const kind of KINDS) {
      for (const tier of TIERS) {
        for (const [x, y] of [[3, -1], [-7, 12], [100, -50]]) {
          for (const p of lot(kind, tier, x, y)) {
            expect(MODEL_NAMES, `${kind} ${tier} ${p.model}`).toContain(p.model);
            expect(Number.isInteger(p.colour) && p.colour >= 0 && p.colour <= 0xffffff).toBe(true);
          }
        }
      }
    }
  });

  it("uses commercial models only for shops, offices, tier 3 apartments and the landmark", () => {
    for (const kind of [...KINDS, "office" as const]) {
      for (const tier of TIERS) {
        const commercial = lot(kind, tier).some((p) => family(p.model) === "commercial");
        const should = kind === "shop" || kind === "office" || kind === "landmark" || (kind === "apartment" && tier === 3);
        expect(commercial, `${kind} ${tier}`).toBe(should);
      }
    }
  });

  it("draws an office low (the commercial a to e models) at density 1, the slab at 2 and a tower (l to n) at 3", () => {
    for (let x = 0; x < 40; x++) {
      const low = lot("office", 1, x, -1);
      expect(low).toHaveLength(1);
      expect(OFFICE_LOW_POOL, `x ${x}`).toContain(low[0].model);
      expect(lot("office", 2, x, -1)[0].model).toBe("commercial/building-k");
      const tower = lot("office", 3, x, -1);
      expect(tower).toHaveLength(1);
      expect(OFFICE_TOWER_POOL, `x ${x}`).toContain(tower[0].model);
      expect(tower[0].colour).toBe(WHITE);
    }
    expect(OFFICE_LOW_POOL).toEqual("abcde".split("").map((c) => `commercial/building-${c}`));
    expect(OFFICE_TOWER_POOL).toEqual("klmn".split("").map((c) => `commercial/building-${c}`));
  });

  it("gives offices a look of their own: no office model is one that a tier 3 apartment is drawn in", () => {
    expect(OFFICE_TOWER_POOL.filter((m) => APARTMENT_POOL.includes(m))).toEqual([]);
    const apartments = new Set<string>();
    const towers = new Set<string>();
    for (let x = 0; x < 80; x++) {
      apartments.add(lot("apartment", 3, x, -1)[0].model);
      towers.add(lot("office", 3, x, -1)[0].model);
    }
    expect([...apartments].filter((m) => towers.has(m))).toEqual([]);
    // the two pools together are the commercial blocks f to n, which the models list and the size table cover
    expect([...APARTMENT_POOL, ...OFFICE_TOWER_POOL]).toEqual([...BLOCK_POOL]);
    expect(apartments.size).toBeGreaterThan(2);
    expect(towers.size).toBeGreaterThan(2);
  });

  it("lets an office rise from low to slab to tower, which layoutKey sees", () => {
    expect(new Set([1, 2, 3].map((t) => layoutKey(lot("office", t as 1 | 2 | 3)))).size).toBe(3);
  });

  it("draws every office at the size that fits its model", () => {
    for (let x = 0; x < 40; x++) {
      for (const tier of TIERS) {
        const office = lot("office", tier, x, -1)[0];
        expect(office.scale).toBe(commercialScale(office.model));
      }
    }
  });

  it("is the same through buildingPlacements as through layoutCells", () => {
    expect(buildingPlacements("park", 2, 3, -1, 2, built)).toEqual(lot("park", 2));
    expect(buildingPlacements("shop", 1, 3, -1, 2, built)).toEqual(lot("shop", 1));
  });

  describe("layoutKey", () => {
    const key = (kind: Kind, tier: 1 | 2 | 3 = 1) => layoutKey(lot(kind, tier));

    it("tells every kind apart on the same cell", () => {
      const keys = KINDS.map((k) => key(k, 3));
      // an apartment is a block at tier 3 and the house is not: all seven differ there
      expect(new Set(keys).size).toBe(KINDS.length);
      expect(new Set(KINDS.map((k) => key(k, 1))).size).toBe(KINDS.length - 1); // apartment = house at tier 1
    });

    it("does not change with the tier for kinds that do not grow", () => {
      for (const kind of ["park", "landmark"] as const) expect(new Set(TIERS.map((t) => key(kind, t))).size, kind).toBe(1);
    });

    it("notices an extra placement alone: a park tree or a garden tree moving, appearing or going", () => {
      for (const kind of ["park", "detached"] as const) {
        const placed = lot(kind, 1);
        const last = placed.length - 1;
        expect(layoutKey(placed.slice(0, last)), `${kind} one fewer`).not.toBe(layoutKey(placed));
        expect(layoutKey(placed.map((p, i) => (i === last ? { ...p, x: p.x + 0.1 } : p))), `${kind} moved`).not.toBe(layoutKey(placed));
        expect(layoutKey(placed.map((p, i) => (i === last ? { ...p, scale: p.scale * 1.2 } : p))), `${kind} scaled`).not.toBe(layoutKey(placed));
      }
    });

    it("covers every attribute a placement has", () => {
      const base: Placement = { model: "roads/road-end", x: 1, y: 2, turns: 0, scale: 1, colour: WHITE };
      // if a field is added to Placement it must be added to layoutKey, and to this list
      expect(Object.keys(lot("house", 1)[0]).sort()).toEqual(Object.keys(base).sort());
      const k0 = layoutKey([base]);
      const changes: Partial<Placement>[] = [
        { model: "roads/road-square" },
        { x: 1.25 },
        { y: 2.25 },
        { turns: 1 },
        { scale: 0.8 },
        { colour: 0x123456 },
      ];
      expect(changes).toHaveLength(Object.keys(base).length);
      for (const change of changes) expect(layoutKey([{ ...base, ...change }]), JSON.stringify(change)).not.toBe(k0);
    });
  });
});

describe("lampHead", () => {
  const lamp = (turns: 0 | 1 | 2 | 3) => ({ model: "roads/light-square", x: 10, y: 20, turns, scale: LIGHT_SCALE, colour: WHITE });

  it("is up at the top of the pole, scaled with it", () => {
    for (const turns of [0, 1, 2, 3] as const) expect(lampHead(lamp(turns)).y).toBeCloseTo(LAMP_HEAD.height * LIGHT_SCALE);
  });

  it("is where the arm reaches, from the pole towards the road, whichever way the piece turns", () => {
    const reach = LAMP_HEAD.reach * LIGHT_SCALE;
    // the arm points -z (north) at rotation 0 and each +90 turn takes it N -> W -> S -> E
    const arm = [
      [0, -1],
      [-1, 0],
      [0, 1],
      [1, 0],
    ];
    for (const turns of [0, 1, 2, 3] as const) {
      const head = lampHead(lamp(turns));
      expect(head.x).toBeCloseTo(10 + arm[turns][0] * reach);
      expect(head.z).toBeCloseTo(20 + arm[turns][1] * reach);
    }
  });
});

describe("zoom", () => {
  it("keeps the camera half-height between 5 and 60 tiles", () => {
    expect(MIN_HALF_HEIGHT).toBe(5);
    expect(MAX_HALF_HEIGHT).toBe(60);
    expect(clampHalfHeight(1)).toBe(5);
    expect(clampHalfHeight(-3)).toBe(5);
    expect(clampHalfHeight(5)).toBe(5);
    expect(clampHalfHeight(23.5)).toBe(23.5);
    expect(clampHalfHeight(60)).toBe(60);
    expect(clampHalfHeight(1000)).toBe(60);
  });

  it("builds ceil(halfHeight * 2.55) + 2 cells around the middle of the view, at least 30, enough for the widest zoom", () => {
    expect(viewRadius(5)).toBe(30); // ceil(12.75) + 2 = 15, lifted to the close-up's 30
    expect(viewRadius(12)).toBe(33);
    expect(viewRadius(20)).toBe(53);
    expect(viewRadius(46)).toBe(120);
    // the widest zoom needs ceil(153) + 2 = 155: with the old cap of 120 its corners were cut off (Kia, 2026-11-10)
    expect(viewRadius(MAX_HALF_HEIGHT)).toBe(155);
    expect(viewRadius(1000)).toBe(155);
    expect(viewRadius(Infinity)).toBe(155);
  });

  describe("what the camera sees", () => {
    // The camera is 30 degrees above the ground and turned 45 degrees, and the picture is the panel's 512 x 320.
    const ASPECT = PANEL_W / PANEL_H;
    const S = Math.SQRT1_2;
    /** Whether the cell (dx, dy) from the roller is inside the picture at half-height h. */
    const onScreen = (dx: number, dy: number, h: number) => {
      const across = (dx - dy) * S;
      const away = -(dx + dy) * S; // along the ground, away from the camera
      return Math.abs(across) <= ASPECT * h && Math.abs(away) * Math.sin(Math.PI / 6) <= h;
    };

    it("is built out to every corner of the picture, at every zoom the cap allows", () => {
      for (let h = MIN_HALF_HEIGHT; h <= 46; h += 0.5) {
        // the picture's corners are ASPECT * h across and 2 * h along the ground (a tile's depth is halved at 30 degrees)
        const reach = Math.max(...[-1, 1].flatMap((a) => [-1, 1].map((f) => Math.abs(S * (a * ASPECT * h - f * 2 * h)))));
        expect(Math.ceil(reach), `half-height ${h}`).toBeLessThanOrEqual(viewRadius(h));
      }
    });

    it("leaves almost no visible cell undrawn with the roller at a city's corner at full zoom out", () => {
      // a 121 x 118 city with the roller at one corner: the case that left a third of the picture bare
      const undrawn = (radius: number) => {
        let seen = 0;
        let bare = 0;
        for (let y = 0; y <= 117; y++) {
          for (let x = 0; x <= 120; x++) {
            if (!onScreen(x, y, MAX_HALF_HEIGHT)) continue;
            seen++;
            if (Math.max(x, y) > radius) bare++;
          }
        }
        return { seen, bare };
      };
      const now = undrawn(viewRadius(MAX_HALF_HEIGHT));
      expect(now.seen).toBeGreaterThan(5000);
      expect(now.bare / now.seen).toBeLessThanOrEqual(0.01);
      // and the check does see a shortfall: at the radius this view once had (91) over a fifth of what is visible was bare
      const before = undrawn(91);
      expect(before.bare / before.seen).toBeGreaterThan(0.2);
    });
  });

  it("builds more as the view widens, and never less than the close-up radius", () => {
    let last = viewRadius(MIN_HALF_HEIGHT);
    for (let h = MIN_HALF_HEIGHT; h <= MAX_HALF_HEIGHT; h += 0.5) {
      expect(viewRadius(h)).toBeGreaterThanOrEqual(last);
      last = viewRadius(h);
    }
    expect(last).toBe(155); // the widest zoom builds its whole picture
  });

  describe("wheelZoom", () => {
    it("zooms out when the wheel goes one way and in when it goes the other", () => {
      expect(wheelZoom(10, 50, 0, false)).toBeGreaterThan(10);
      expect(wheelZoom(10, -50, 0, false)).toBeLessThan(10);
      expect(wheelZoom(10, 0, 0, false)).toBe(10);
    });

    it("stays between 5 and 60", () => {
      expect(wheelZoom(5, -10_000, 0, false)).toBe(5);
      expect(wheelZoom(40, 10_000, 0, false)).toBe(60);
      expect(wheelZoom(40, 10_000, 0, true)).toBe(60);
    });

    it("turns the same distance each step: out and then in again comes back", () => {
      const out = wheelZoom(10, 120, 0, false);
      expect(wheelZoom(out, -120, 0, false)).toBeCloseTo(10);
    });

    it("moves further for a pinch than for a scroll of the same size", () => {
      expect(wheelZoom(10, 5, 0, true) - 10).toBeGreaterThan(wheelZoom(10, 5, 0, false) - 10);
    });

    it("counts a wheel that reports lines or pages as bigger than one that reports pixels", () => {
      const px = wheelZoom(10, 3, 0, false);
      expect(wheelZoom(10, 3, 1, false)).toBeGreaterThan(px);
      expect(wheelZoom(10, 3, 2, false)).toBeGreaterThan(wheelZoom(10, 3, 1, false));
    });
  });

  describe("wheelZoomTarget", () => {
    it("is wheelZoom for a wheel event that moves up or down", () => {
      expect(wheelZoomTarget(10, 50, 0, false)).toBe(wheelZoom(10, 50, 0, false));
      expect(wheelZoomTarget(10, -3, 1, true)).toBe(wheelZoom(10, -3, 1, true));
    });

    it("is null for one with no vertical movement, which is no zoom input: a sideways scroll, or a pinch's rest", () => {
      expect(wheelZoomTarget(10, 0, 0, false)).toBeNull();
      expect(wheelZoomTarget(10, -0, 0, true)).toBeNull();
      expect(wheelZoomTarget(40, 0, 1, false)).toBeNull();
    });

    it("still counts one pressed against the zoom limit, which is a zoom input that changes nothing", () => {
      expect(wheelZoomTarget(5, -10_000, 0, false)).toBe(5);
    });
  });

  describe("easeHalfHeight", () => {
    it("starts where it was, ends at 5 after 600 ms, and stays there", () => {
      expect(EASE_BACK_MS).toBe(600);
      expect(easeHalfHeight(40, 0)).toBe(40);
      expect(easeHalfHeight(40, EASE_BACK_MS)).toBe(5);
      expect(easeHalfHeight(40, EASE_BACK_MS + 1000)).toBe(5);
    });

    it("comes in steadily, never past either end", () => {
      let last = 40;
      for (let ms = 0; ms <= EASE_BACK_MS; ms += 20) {
        const h = easeHalfHeight(40, ms);
        expect(h).toBeLessThanOrEqual(last);
        expect(h).toBeGreaterThanOrEqual(5);
        last = h;
      }
      const mid = easeHalfHeight(40, EASE_BACK_MS / 2);
      expect(mid).toBeGreaterThan(5);
      expect(mid).toBeLessThan(40);
    });

    it("has nowhere to go from the close-up, or from a time before it began", () => {
      expect(easeHalfHeight(5, 100)).toBe(5);
      expect(easeHalfHeight(40, -50)).toBe(40);
    });
  });

  describe("easeBackLeft", () => {
    it("is all of the way to go at the start, none of it after 600 ms", () => {
      expect(easeBackLeft(0)).toBe(1);
      expect(easeBackLeft(-50)).toBe(1);
      expect(easeBackLeft(EASE_BACK_MS)).toBe(0);
      expect(easeBackLeft(EASE_BACK_MS + 1000)).toBe(0);
    });

    it("shrinks steadily, fast at first", () => {
      let last = 1;
      for (let ms = 0; ms <= EASE_BACK_MS; ms += 20) {
        const left = easeBackLeft(ms);
        expect(left).toBeLessThanOrEqual(last);
        last = left;
      }
      expect(easeBackLeft(EASE_BACK_MS / 2)).toBeLessThan(0.5);
    });
  });

  describe("panDelta", () => {
    /** The view's camera, placed as CityView3D places it, looking at `target` on the ground. */
    function camera(target: { x: number; y: number }, halfHeight: number): THREE.OrthographicCamera {
      const aspect = PANEL_W / PANEL_H;
      const c = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.1, 400);
      const distance = 50;
      const flat = distance * Math.cos(ELEVATION) * Math.SQRT1_2;
      c.position.set(target.x + flat, distance * Math.sin(ELEVATION), target.y + flat);
      c.lookAt(target.x, 0, target.y);
      c.updateMatrixWorld();
      return c;
    }

    /** Where a point on the ground shows on the panel, in CSS pixels from its top-left. */
    function onScreen(c: THREE.OrthographicCamera, x: number, y: number): { x: number; y: number } {
      const p = new THREE.Vector3(x, 0, y).project(c);
      return { x: ((p.x + 1) / 2) * PANEL_W, y: ((1 - p.y) / 2) * PANEL_H };
    }

    it("keeps the ground under the pointer: the city follows the drag", () => {
      for (const [dx, dy, h] of [
        [30, 0, 5],
        [0, 30, 5],
        [-12, 47, 5],
        [80, -25, 40],
      ]) {
        const from = { x: 7, y: -3 };
        const d = panDelta(dx, dy, h, PANEL_H);
        const before = onScreen(camera(from, h), 9, -1);
        const after = onScreen(camera({ x: from.x + d.x, y: from.y + d.y }, h), 9, -1);
        expect(after.x - before.x).toBeCloseTo(dx, 6);
        expect(after.y - before.y).toBeCloseTo(dy, 6);
      }
    });

    it("moves nothing for no drag", () => {
      const d = panDelta(0, 0, 5, PANEL_H);
      expect(Math.abs(d.x)).toBe(0);
      expect(Math.abs(d.y)).toBe(0);
    });
  });

  it("holds a moved view only a moment after the last drag or zoom before easing it back (Kia: 10 s was too long)", () => {
    expect(VIEW_HOLD_MS).toBe(800);
  });
});

describe("road furniture by grade", () => {
  /** Lay out road cells `cells` (all of one grade) around (0, 0). */
  function lay(cells: [number, number][], grade: 1 | 2 | 3 | 4 | 5): Placement[] {
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    return layoutCells((x, y) => set.has(`${x},${y}`), () => 0, 0, 0, 12, {
      driven: () => 1,
      built: () => 0,
      kind: () => undefined,
      grade: () => grade,
    });
  }
  const straight: [number, number][] = Array.from({ length: 25 }, (_, i) => [i - 12, 0]);
  // a crossroad at (0, 0) and a T at (6, 0): a row, a full column through 0 and a half column down from 6
  const junctions: [number, number][] = [
    ...Array.from({ length: 14 }, (_, i): [number, number] => [i - 6, 0]), // x = -6 … 7, so (6, 0) has west, east and south
    [0, -2], [0, -1], [0, 1], [0, 2], [6, 1], [6, 2],
  ];
  const models = (placed: Placement[], model: string) => placed.filter((p) => p.model === model);
  const roads = (placed: Placement[]) => placed.filter((p) => p.model.startsWith("roads/road-") && !p.model.endsWith("-barrier"));

  it("gives dirt and streets no furniture, draws dirt in sand, and keeps their kerbs flat", () => {
    for (const g of [1, 2] as const) {
      const placed = lay(straight, g);
      expect(placed.every((p) => p.model.startsWith("roads/road-")), `grade ${g}`).toBe(true);
      for (const p of roads(placed)) expect(p).toMatchObject({ flat: true, colour: g === 1 ? LANE_COLOUR : STREET_COLOUR });
    }
  });

  it("lights a lit street on every other straight cell, kerbs still flat", () => {
    const placed = lay(straight, 3);
    const lit = models(placed, LIGHT);
    expect(lit.length).toBe(11); // the straights are x = -11 … 11 (the two ends are not); x + y even
    for (const p of roads(placed)) expect(p.flat).toBe(true);
  });

  it("gives an avenue kerbs, double lights, crosswalks and traffic lights at its junctions", () => {
    const placed = lay(junctions, 4);
    expect(models(placed, LIGHT)).toEqual([]);
    expect(models(placed, "roads/light-square-double").length).toBeGreaterThan(0);
    for (const p of roads(placed)) expect(p.flat).toBeFalsy();
    expect(models(placed, "roads/road-crossroad-line").map((p) => [p.x, p.y])).toEqual([[0, 0]]);
    expect(models(placed, "roads/road-intersection-line").map((p) => [p.x, p.y])).toEqual([[6, 0]]);
    expect(models(placed, "roads/road-crossroad")).toEqual([]);
    const lights = models(placed, "roads/traffic-light");
    expect(lights.length).toBe(2);
    for (const p of lights) expect(p.colour).toBe(STREET_COLOUR); // its poles are in the asphalt block
  });

  it("puts barriers along a highway, curved double lights, a sign every 12 cells, and no crosswalks", () => {
    const placed = lay(straight, 5);
    const barriers = models(placed, "roads/road-straight-barrier");
    expect(barriers.length).toBe(23); // one over every straight piece, turned like it
    expect(models(placed, "roads/road-end-barrier").length).toBe(2);
    for (const b of barriers) expect(roads(placed).find((r) => r.x === b.x && r.y === b.y)?.turns).toBe(b.turns);
    expect(models(placed, "roads/light-curved-double").length).toBe(11);
    const signs = models(placed, "roads/sign-highway");
    expect(signs.map((p) => Math.round(p.x))).toEqual([0]); // straights where x + y is a multiple of 12
    const atJunctions = lay(junctions, 5);
    expect(models(atJunctions, "roads/road-crossroad-barrier").length).toBe(1);
    expect(models(atJunctions, "roads/road-intersection-barrier").length).toBe(1);
    expect(models(atJunctions, "roads/road-crossroad-line")).toEqual([]);
    expect(models(atJunctions, "roads/traffic-light")).toEqual([]);
  });

  it("falls back to the grade of the passes when no grade is given", () => {
    const set = new Set(straight.map(([x, y]) => `${x},${y}`));
    const placed = layoutCells((x, y) => set.has(`${x},${y}`), () => 0, 0, 0, 12, { driven: () => 3, built: () => 0, kind: () => undefined });
    expect(models(placed, LIGHT).length).toBe(11);
  });

  it("knows every furniture model", () => {
    for (const m of [
      "roads/road-crossroad-line", "roads/road-intersection-line", "roads/road-straight-barrier", "roads/road-bend-barrier",
      "roads/road-end-barrier", "roads/road-intersection-barrier", "roads/road-crossroad-barrier", "roads/light-square-double",
      "roads/light-curved-double", "roads/traffic-light", "roads/sign-highway",
    ]) expect(MODEL_NAMES, m).toContain(m);
  });

  it("hashes a flat kerb into the layout key", () => {
    const a = lay(straight, 2);
    const b = a.map((p) => ({ ...p, flat: false }));
    expect(layoutKey(a)).not.toBe(layoutKey(b));
  });
});

describe("buildings by kind and density", () => {
  const at = (kind: Kind, tier: 1 | 2 | 3) => buildingPlacements(kind, tier, 3, 4, 0, 0);
  const letters = (prefix: string, ls: string) => ls.split("").map((c) => `${prefix}${c}`);

  it("grows a shop from a small one to a full-size one to a commercial slab", () => {
    const small = at("shop", 1);
    expect(letters("commercial/building-", "abcde")).toContain(small[0].model);
    expect(small[0].scale).toBe(0.6);
    expect(at("shop", 2)[0].scale).toBe(commercialScale(at("shop", 2)[0].model));
    expect(at("shop", 3)[0].model).toBe("commercial/building-k");
  });

  it("grows an office from a low block to the slab to a tower", () => {
    expect(letters("commercial/building-", "abcde")).toContain(at("office", 1)[0].model);
    expect(at("office", 2)[0].model).toBe("commercial/building-k");
    expect(letters("commercial/building-", "lmn")).toContain(at("office", 3)[0].model);
  });

  it("grows industry from sheds to factories with a chimney to plants with a big chimney and a tank", () => {
    expect(letters("industrial/building-", "abc")).toContain(at("industrial", 1)[0].model);
    expect(at("industrial", 1)).toHaveLength(1);
    const mid = at("industrial", 2).map((p) => p.model);
    expect(letters("industrial/building-", "def")).toContain(mid[0]);
    expect(mid).toContain("industrial/chimney-small");
    const big = at("industrial", 3).map((p) => p.model);
    expect(letters("industrial/building-", "gh")).toContain(big[0]);
    expect(big).toContain("industrial/chimney-large");
    expect(big).toContain("industrial/detail-tank");
    for (const m of [...letters("industrial/building-", "abcdefgh"), "industrial/chimney-small", "industrial/chimney-large", "industrial/detail-tank"]) {
      expect(MODEL_NAMES, m).toContain(m);
    }
  });
});

describe("rivers on screen", () => {
  // a river along y = 2..3, a road along x = 0 crossing it from y = -2 to y = 6
  const water = (x: number, y: number) => y === 2 || y === 3;
  const road = new Set(Array.from({ length: 9 }, (_, i) => `0,${i - 2}`));
  const lay = (grade: 1 | 2 | 3 | 4 | 5) =>
    layoutCells((x, y) => road.has(`${x},${y}`), () => 0, 0, 2, 4, { driven: () => 1, built: () => 0, kind: () => undefined, grade: () => grade, water });

  it("draws every water cell as a water piece in the river's colour, under the road where a road bridges it", () => {
    const planes = lay(2).filter((p) => p.model.startsWith(`${WATER}-`));
    // the view is x -4..4, y -2..6: two rows of nine (a straight river: no fillets)
    expect(planes).toHaveLength(18);
    for (const p of planes) expect(p).toMatchObject({ colour: WATER_COLOUR, turns: 0 });
    expect(planes.filter((p) => p.x === 0)).toHaveLength(2);
  });

  it("gives a straight road over water the barrier rails of a bridge, at any grade", () => {
    for (const g of [1, 3, 5] as const) {
      const rails = lay(g).filter((p) => p.model === "roads/road-straight-barrier");
      expect(rails.map((p) => p.y).sort(), `grade ${g}`).toEqual(g === 5 ? [-1, 0, 1, 2, 3, 4, 5] : [2, 3]);
    }
  });

  it("knows the water model for the layout key", () => {
    const a = lay(2);
    expect(layoutKey(a)).not.toBe(layoutKey(a.filter((p) => !p.model.startsWith(WATER))));
  });
});

describe("smooth rivers", () => {
  /** Lay out a patch of water and land around (0, 0); no roads. */
  const lay = (wet: (x: number, y: number) => boolean) =>
    layoutCells(() => false, () => 0, 0, 0, 3, { driven: () => 1, built: () => 0, kind: () => undefined, water: wet });
  const at = (placed: Placement[], x: number, y: number) => placed.filter((p) => p.x === x && p.y === y).map((p) => p.model);

  it("keeps the long sides of a straight river square", () => {
    const placed = lay((_, y) => y === 0);
    expect(at(placed, 1, 0)).toEqual([waterPiece(0)]);
  });

  it("rounds a water cell's corners where it has no water on either side", () => {
    // a lone pond cell: every corner rounded
    expect(at(lay((x, y) => x === 0 && y === 0), 0, 0)).toEqual([waterPiece(ROUND.NW | ROUND.NE | ROUND.SE | ROUND.SW)]);
    // the end of a river running east: its two west corners
    expect(at(lay((x, y) => y === 0 && x >= 0), 0, 0)).toEqual([waterPiece(ROUND.NW | ROUND.SW)]);
  });

  it("fills the inner corner of a land cell the river bends around", () => {
    // a step: water at (0, 0) and (1, 1), plus (1, 0) joining them; the land at (0, 1) has water north and east
    const step = new Set(["0,0", "1,0", "1,1"]);
    const placed = lay((x, y) => step.has(`${x},${y}`));
    expect(at(placed, 0, 1)).toEqual([FILLET.NE]);
    // the step's outer corner is rounded: (1, 0) has no water north or east
    expect(at(placed, 1, 0)).toEqual([waterPiece(ROUND.NE)]);
  });

  it("knows every water piece for the layout key, and makes a different key for a rounded one", () => {
    const square = lay((_, y) => y === 0);
    const rounded = square.map((p) => (p.x === 1 ? { ...p, model: waterPiece(ROUND.NE) } : p));
    expect(layoutKey(rounded)).not.toBe(layoutKey(square));
  });
});

describe("rebuildDue (review #3)", () => {
  it("rebuilds at once when the view moved or close up, but at most every REBUILD_EVERY_MS for city changes zoomed out", () => {
    expect(REBUILD_EVERY_MS).toBe(250);
    expect(rebuildDue({ viewChanged: true, halfHeight: 60, sinceLastMs: 0 })).toBe(true);
    expect(rebuildDue({ viewChanged: false, halfHeight: MIN_HALF_HEIGHT, sinceLastMs: 0 })).toBe(true);
    expect(rebuildDue({ viewChanged: false, halfHeight: 60, sinceLastMs: 100 })).toBe(false);
    // the wider the view, the longer it waits: a layout at the widest zoom takes ~60 ms, so at most once a second there
    expect(rebuildDue({ viewChanged: false, halfHeight: 15, sinceLastMs: 250 })).toBe(true);
    expect(rebuildDue({ viewChanged: false, halfHeight: 60, sinceLastMs: 500 })).toBe(false);
    expect(rebuildDue({ viewChanged: false, halfHeight: 60, sinceLastMs: 1000 })).toBe(true);
  });
});
