// Which Kenney model goes on which cell, which way it turns and what colour it is
// tinted. Pure, so it can be tested in node; the Three.js side is in city3d.ts.

import { roadColour, roadTier, roofColour, WHITE } from "./looks";

/** A quarter-turn count: each +90° about the vertical axis turns S→E→N→W. */
export type Turns = 0 | 1 | 2 | 3;

/** Road neighbour bits: N=1 E=2 S=4 W=8. Rotating +90° turns S→E→N→W→S. */
export const rotMask = (m: number) => ((m & 1) << 3) | ((m & 2) >> 1) | ((m & 4) >> 1) | ((m & 8) >> 1);

/**
 * Each road piece with the neighbours it joins at rotation 0, read off the models
 * seen from above: the end opens east, the straight runs east-west, the bend joins
 * south and west, the T joins west, east and south.
 */
export const ROAD_BASE: readonly (readonly [string, number])[] = [
  ["roads/road-square", 0],
  ["roads/road-end", 2],
  ["roads/road-straight", 10],
  ["roads/road-bend", 12],
  ["roads/road-intersection", 14],
  ["roads/road-crossroad", 15],
];

const STRAIGHT = "roads/road-straight";

/** The piece, and the turns it needs, to join exactly the neighbours in `mask`. */
export function roadPiece(mask: number): { model: string; turns: Turns } {
  for (const [model, base] of ROAD_BASE) {
    let m = base;
    for (let k = 0; k < 4; k++) {
      if (m === mask) return { model, turns: k as Turns };
      m = rotMask(m);
    }
  }
  return { model: "roads/road-square", turns: 0 };
}

/** Houses by tier: small suburban, bigger suburban, then commercial buildings. */
export const HOUSE_POOLS: readonly (readonly string[])[] = [
  "abcdefg".split("").map((c) => `suburban/building-type-${c}`),
  "hijklmn".split("").map((c) => `suburban/building-type-${c}`),
  "abcdefghijklmn".split("").map((c) => `commercial/building-${c}`),
];

/** A house is drawn this much smaller than its road tile, by tier. */
export const HOUSE_SCALE = [0.7, 0.7, 0.8] as const;

/** The same cell always gets the same house. */
export function housePiece(tier: 1 | 2 | 3, x: number, y: number): string {
  const pool = HOUSE_POOLS[tier - 1];
  return pool[Math.abs((x * 73856093) ^ (y * 19349663)) % pool.length];
}

/**
 * Every house model's front (door, planters, shop window) faces north at rotation 0,
 * as read off the models; each +90° turns it N→W→S→E. Turn it to the first road
 * among S, E, N, W.
 */
export function houseTurns(has: (x: number, y: number) => boolean, x: number, y: number): Turns {
  return has(x, y + 1) ? 2 : has(x + 1, y) ? 3 : has(x, y - 1) ? 0 : 1;
}

/**
 * The roller: model, scale, and the yaw that points it along each heading (0 E, 1 S, 2 W, 3 N).
 * The model's front (shovel) is at +z at rotation 0, and a yaw of θ turns +z to (sin θ, cos θ) in (x, z).
 */
export const ROLLER = {
  model: "car/tractor-shovel",
  scale: 0.4,
  yaw: [Math.PI / 2, 0, -Math.PI / 2, Math.PI],
} as const;

/**
 * A streetlight: a thin pole at the model's origin with its arm reaching 0.2 towards -z (north at
 * rotation 0). It stands on the south edge of an east-west street, so the arm reaches over the road,
 * and turns with the street: on the east edge of a north-south one.
 */
export const LIGHT = "roads/light-square";

/** How far from the cell's centre the pole stands, in cells: on the edge, just inside it. */
export const LIGHT_INSET = 0.42;

/** Drawn this much larger than modelled: at 0.05 wide the pole all but vanishes at the city's zoom. */
export const LIGHT_SCALE = 1.5;

/** The edge each quarter-turn puts the pole on, as a step (dx, dy): S, E, N, W. */
const LIGHT_SIDE = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

/** Every model the city draws, by path under assets/kenney (no extension). */
export const MODEL_NAMES: readonly string[] = [...ROAD_BASE.map(([name]) => name), LIGHT, ...HOUSE_POOLS.flat(), ROLLER.model];

/** One model on one cell (or, for a streetlight, a point inside it). */
export interface Placement {
  model: string;
  x: number;
  y: number;
  turns: Turns;
  scale: number;
  /** Instance colour, 0xRRGGBB: multiplied into a road, swapped in for a suburban roof, white for no change. */
  colour: number;
}

/** What each cell's road and house have been through, which decides how they look. */
export interface Looks {
  /** Times the road on this cell was driven. */
  driven: (x: number, y: number) => number;
  /** When the house on this cell appeared, by the city's clock. */
  built: (x: number, y: number) => number;
}

/**
 * What stands on the cells within `radius` of (cx, cy): road pieces joined to their
 * neighbours (tinted when driven once, with a streetlight on every other straight cell
 * when driven three times or more), and houses turned to face a road with a roof for
 * the hour they were built. `tierAt` is 0 for no house.
 */
export function layoutCells(
  has: (x: number, y: number) => boolean,
  tierAt: (x: number, y: number) => 0 | 1 | 2 | 3,
  cx: number,
  cy: number,
  radius: number,
  looks: Looks,
): Placement[] {
  const out: Placement[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (has(x, y)) {
        const mask = (has(x, y - 1) ? 1 : 0) | (has(x + 1, y) ? 2 : 0) | (has(x, y + 1) ? 4 : 0) | (has(x - 1, y) ? 8 : 0);
        const p = roadPiece(mask);
        const tier = roadTier(looks.driven(x, y));
        out.push({ model: p.model, x, y, turns: p.turns, scale: 1, colour: roadColour(tier) });
        // every other cell along a straight (x + y is even on alternate cells of a line along either axis)
        if (tier === 3 && p.model === STRAIGHT && ((x + y) & 1) === 0) {
          const [dx, dy] = LIGHT_SIDE[p.turns];
          out.push({ model: LIGHT, x: x + dx * LIGHT_INSET, y: y + dy * LIGHT_INSET, turns: p.turns, scale: LIGHT_SCALE, colour: WHITE });
        }
        continue;
      }
      const tier = tierAt(x, y);
      if (tier) {
        const colour = roofColour(tier, looks.built(x, y));
        out.push({ model: housePiece(tier, x, y), x, y, turns: houseTurns(has, x, y), scale: HOUSE_SCALE[tier - 1], colour });
      }
    }
  }
  return out;
}

const MODEL_INDEX = new Map(MODEL_NAMES.map((name, i) => [name, i]));

/**
 * A 32-bit hash of a layout, to tell whether a re-check changed anything on screen: it covers
 * everything a placement draws, so the same models, spots (to 1/64 cell), turns, scales and
 * colours hash alike. Anything added to Placement that shows must be added here too.
 */
export function layoutKey(placed: readonly Placement[]): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h = Math.imul(h ^ n, 0x01000193);
  };
  for (const p of placed) {
    mix(MODEL_INDEX.get(p.model) ?? -1);
    mix(Math.round(p.x * 64));
    mix(Math.round(p.y * 64));
    mix(p.turns);
    mix(Math.round(p.scale * 1000));
    mix(p.colour);
  }
  return h >>> 0;
}
