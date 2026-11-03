// Which Kenney model goes on which cell, and which way it turns. Pure, so it
// can be tested in node; the Three.js side is in city3d.ts.

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

/** Every model the city draws, by path under assets/kenney (no extension). */
export const MODEL_NAMES: readonly string[] = [...ROAD_BASE.map(([name]) => name), ...HOUSE_POOLS.flat(), ROLLER.model];

/** One model on one cell. */
export interface Placement {
  model: string;
  x: number;
  y: number;
  turns: Turns;
  scale: number;
}

/**
 * What stands on the cells within `radius` of (cx, cy): road pieces joined to their
 * neighbours, and houses turned to face a road. `tierAt` is 0 for no house.
 */
export function layoutCells(
  has: (x: number, y: number) => boolean,
  tierAt: (x: number, y: number) => 0 | 1 | 2 | 3,
  cx: number,
  cy: number,
  radius: number,
): Placement[] {
  const out: Placement[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (has(x, y)) {
        const mask = (has(x, y - 1) ? 1 : 0) | (has(x + 1, y) ? 2 : 0) | (has(x, y + 1) ? 4 : 0) | (has(x - 1, y) ? 8 : 0);
        const p = roadPiece(mask);
        out.push({ model: p.model, x, y, turns: p.turns, scale: 1 });
        continue;
      }
      const tier = tierAt(x, y);
      if (tier) out.push({ model: housePiece(tier, x, y), x, y, turns: houseTurns(has, x, y), scale: HOUSE_SCALE[tier - 1] });
    }
  }
  return out;
}

const MODEL_INDEX = new Map(MODEL_NAMES.map((name, i) => [name, i]));

/** A 32-bit hash of a layout: the same cells with the same models and turns hash alike (scale follows the model). */
export function layoutKey(placed: readonly Placement[]): number {
  let h = 0x811c9dc5;
  for (const p of placed) {
    h = Math.imul(h ^ (MODEL_INDEX.get(p.model) ?? -1), 0x01000193);
    h = Math.imul(h ^ (p.x | 0), 0x01000193);
    h = Math.imul(h ^ (p.y | 0), 0x01000193);
    h = Math.imul(h ^ p.turns, 0x01000193);
  }
  return h >>> 0;
}
