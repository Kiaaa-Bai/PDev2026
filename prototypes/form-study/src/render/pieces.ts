// Which Kenney model goes on which cell, which way it turns and what colour it is
// tinted. Pure, so it can be tested in node; the Three.js side is in city3d.ts.

import type { Kind } from "../sims/kinds";
import { gradeOfPasses, type Grade } from "../sims/grades";
import { roadColour, roofColour, STREET_COLOUR, WHITE } from "./looks";

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

const suburban = (letters: string) => letters.split("").map((c) => `suburban/building-type-${c}`);
const commercial = (letters: string) => letters.split("").map((c) => `commercial/building-${c}`);

/**
 * Houses by tier: small suburban, bigger suburban, tallest suburban. All of them are suburban, so every roof can
 * take the colour of the hour. Tier 3 leaves out p and q: their roofs read a different part of the palette than
 * the other houses' do, so that colour could not reach them.
 */
export const HOUSE_POOLS: readonly (readonly string[])[] = [suburban("abcdefg"), suburban("hijklmn"), suburban("orstu")];

/** A house is drawn this much smaller than its road tile, by tier. */
export const HOUSE_SCALE = [0.7, 0.7, 0.7] as const;

/**
 * Shops are the low commercial buildings (a to e). The blocks (f to n) are shared out between the two kinds that stand
 * tall: apartments, from tier 3 on, take the mid-rise f to j, and offices their own, the slab and towers k to n, from tier
 * 3 on, so an apartment block and an office tower never share a model. The landmark is a skyscraper.
 */
export const SHOP_POOL: readonly string[] = commercial("abcde");
export const APARTMENT_POOL: readonly string[] = commercial("fghij");
export const OFFICE_TOWER_POOL: readonly string[] = commercial("klmn");
/** Every commercial block, f to n: the apartment pool and the office towers together. */
export const BLOCK_POOL: readonly string[] = [...APARTMENT_POOL, ...OFFICE_TOWER_POOL];
/** A young office is low, like a shop (a to e); at tier 3 it rises into a tower. */
export const OFFICE_LOW_POOL: readonly string[] = commercial("abcde");
export const LANDMARK = "commercial/building-skyscraper-a";

/** A park is a tree and planters; a detached house has a small tree in its garden. */
export const PARK_TREE = "suburban/tree-large";
export const PARK_PLANTER = "suburban/planter";
export const GARDEN_TREE = "suburban/tree-small";

/** Row houses are drawn wider than the tile's house so that neighbours meet; detached houses narrower, to leave a garden. */
export const ROW_SCALE = 0.8;
export const DETACHED_SCALE = 0.6;
/** The standard size of a commercial building (shop, block, landmark). */
export const COMMERCIAL_SCALE = 0.8;

/**
 * The longer side of each shop and block model's footprint, in cells at scale 1, read off the models.
 * The widest are wider than two lots, so they are drawn smaller to fit the one lot they stand on.
 */
export const COMMERCIAL_FOOTPRINT: Readonly<Record<string, number>> = {
  "commercial/building-a": 0.94,
  "commercial/building-b": 0.98,
  "commercial/building-c": 1.1,
  "commercial/building-d": 0.9,
  "commercial/building-e": 1.64,
  "commercial/building-f": 1.03,
  "commercial/building-g": 0.98,
  "commercial/building-h": 1.0,
  "commercial/building-i": 1.3,
  "commercial/building-j": 2.08,
  "commercial/building-k": 2.08,
  "commercial/building-l": 1.4,
  "commercial/building-m": 1.24,
  "commercial/building-n": 2.32,
};

/** A shop or block is drawn at the standard size, or smaller where that would be wider than its lot. */
export function commercialScale(model: string): number {
  return Math.min(COMMERCIAL_SCALE, 1 / COMMERCIAL_FOOTPRINT[model]);
}

/** The same cell always gets the same model from a pool. */
function pick(pool: readonly string[], x: number, y: number): string {
  return pool[Math.abs((x * 73856093) ^ (y * 19349663)) % pool.length];
}

/** The same cell always gets the same house. */
export function housePiece(tier: 1 | 2 | 3, x: number, y: number): string {
  return pick(HOUSE_POOLS[tier - 1], x, y);
}

/**
 * Every house model's front (door, planters, shop window) faces north at rotation 0,
 * as read off the models; each +90° turns it N→W→S→E. Turn it to the first road
 * among S, E, N, W.
 */
export function houseTurns(has: (x: number, y: number) => boolean, x: number, y: number): Turns {
  return has(x, y + 1) ? 2 : has(x + 1, y) ? 3 : has(x, y - 1) ? 0 : 1;
}

/** The offset (dx, dz) turned `turns` quarter-turns the way a model turns: N -> W -> S -> E. */
function turned(dx: number, dz: number, turns: Turns): [number, number] {
  for (let k = 0; k < turns; k++) [dx, dz] = [dz, -dx];
  return [dx, dz];
}

/**
 * A spot on a lot given as `across` the front (positive to the right of a model facing the road) and `deep`
 * (positive towards the road), in cells from the lot's centre, turned to face the road like the house would.
 */
function onLot(x: number, y: number, turns: Turns, across: number, deep: number, model: string, scale: number): Placement {
  // at rotation 0 the front is north (-z) and "right" is east (+x)
  const [dx, dz] = turned(across, -deep, turns);
  return { model, x: x + dx, y: y + dz, turns, scale, colour: WHITE };
}

/** A park: planters on the street side, large trees behind them. [across, deep, scale] in lot cells. */
const PARK_TREES = [
  [-0.22, -0.18, 1.6],
  [0.2, -0.05, 1.6],
  [-0.05, 0.12, 1.3],
] as const;
const PARK_PLANTERS = [
  [-0.26, 0.38, 1.1],
  [0.26, 0.38, 1.1],
] as const;
/** A detached house's garden: a small tree in the corner behind the house. */
const GARDEN = [[0.3, -0.34, 1.4]] as const;

/**
 * What stands on the lot at (x, y) once its house has appeared, turned to face its road. `built` is when it
 * appeared, which sets a suburban house's roof colour. The kind decides what it is: a house, row house or
 * detached house is a suburban one for its tier (a detached house with a tree in its garden); an apartment
 * is a house until tier 3 and a mid-rise commercial block after; an office is a low commercial building until tier 3
 * and a tower after; a shop is a low commercial building and the landmark a skyscraper, whatever the tier; a park is
 * trees and planters and does not grow.
 */
export function buildingPlacements(kind: Kind, tier: 1 | 2 | 3, x: number, y: number, turns: Turns, built: number): Placement[] {
  const house = (scale: number): Placement => ({ model: housePiece(tier, x, y), x, y, turns, scale, colour: roofColour(built) });
  const commercialOne = (model: string, scale = commercialScale(model)): Placement => ({ model, x, y, turns, scale, colour: WHITE });
  switch (kind) {
    case "row":
      return [house(ROW_SCALE)];
    case "detached":
      return [house(DETACHED_SCALE), ...GARDEN.map(([a, d, s]) => onLot(x, y, turns, a, d, GARDEN_TREE, s))];
    case "shop":
      return [commercialOne(pick(SHOP_POOL, x, y))];
    case "office":
      return [commercialOne(pick(tier < 3 ? OFFICE_LOW_POOL : OFFICE_TOWER_POOL, x, y))];
    case "apartment":
      return tier < 3 ? [house(HOUSE_SCALE[tier - 1])] : [commercialOne(pick(APARTMENT_POOL, x, y))];
    case "landmark":
      return [commercialOne(LANDMARK, COMMERCIAL_SCALE)]; // a landmark may stand a little over its lot
    case "park":
      return [
        ...PARK_TREES.map(([a, d, s]) => onLot(x, y, turns, a, d, PARK_TREE, s)),
        ...PARK_PLANTERS.map(([a, d, s]) => onLot(x, y, turns, a, d, PARK_PLANTER, s)),
      ];
    case "house":
      return [house(HOUSE_SCALE[tier - 1])];
  }
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

/**
 * What each grade adds to the plain road (Kenney City Kit Roads): an avenue draws crosswalks at its junctions with a
 * traffic light, and double lights; a highway lays barriers over every piece but a lone square, and curved double
 * lights, with a highway sign every 12 cells. Furniture whose poles sample the asphalt block is tinted the asphalt's
 * own colour, so the road shader's swap leaves it as modelled.
 */
export const FURNITURE = {
  avenueCross: { "roads/road-crossroad": "roads/road-crossroad-line", "roads/road-intersection": "roads/road-intersection-line" } as Record<string, string>,
  avenueLight: "roads/light-square-double",
  trafficLight: "roads/traffic-light",
  highwayLight: "roads/light-curved-double",
  highwaySign: "roads/sign-highway",
  barrier: (piece: string): string | null => (piece === "roads/road-square" ? null : `${piece}-barrier`),
} as const;
/** A highway sign stands on straight cells where x + y is a multiple of this. */
export const SIGN_EVERY = 12;

/** How far from the cell's centre the pole stands, in cells: on the edge, just inside it. */
export const LIGHT_INSET = 0.42;

/** Drawn this much larger than modelled: at 0.05 wide the pole all but vanishes at the city's zoom. */
export const LIGHT_SCALE = 1.5;

/**
 * Where the lamp is on the streetlight model, before scaling: 0.6 up, at the end of the arm that
 * reaches 0.2 from the pole towards -z (the head is the last 0.1 of it, centred 0.113 out).
 */
export const LAMP_HEAD = { height: 0.6, reach: 0.113 } as const;

/** The edge each quarter-turn puts the pole on, as a step (dx, dy): S, E, N, W. */
const LIGHT_SIDE = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

/** The arm's direction on the ground for each quarter-turn: -z at rotation 0, then N -> W -> S -> E. */
const LIGHT_ARM = [
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
] as const;

/** The lamp of a streetlight placement in the 3D scene: x and z on the ground, y up. */
export function lampHead(p: Placement): { x: number; y: number; z: number } {
  const [dx, dz] = LIGHT_ARM[p.turns];
  return { x: p.x + dx * LAMP_HEAD.reach * p.scale, y: LAMP_HEAD.height * p.scale, z: p.y + dz * LAMP_HEAD.reach * p.scale };
}

/** The camera's half-height in tiles: 5 close up (where it rests), up to 60 zoomed out. */
export const MIN_HALF_HEIGHT = 5;
export const MAX_HALF_HEIGHT = 60;

/** A half-height held to the zoom range. */
export const clampHalfHeight = (h: number): number => Math.min(MAX_HALF_HEIGHT, Math.max(MIN_HALF_HEIGHT, h));

/**
 * How many cells around the roller to build for a camera `halfHeight` tiles tall: enough to fill the picture to its
 * corners (at 1.6 wide a corner is 2.55 x halfHeight cells from the roller along an axis: the picture is 1.6 x
 * halfHeight across and, at 30 degrees up, 2 x halfHeight deep along the ground, then turned 45 degrees), two
 * more, never fewer than the close-up's 30 and never more than 120.
 */
export const viewRadius = (halfHeight: number): number => Math.min(120, Math.max(30, Math.ceil(halfHeight * 2.55) + 2));

/** How much one unit of wheel delta scales the half-height (as the exponent of e): a pinch much more than a scroll. */
const PINCH_RATE = 0.01;
const SCROLL_RATE = 0.0015;
/** A wheel that reports lines or pages instead of pixels: roughly this many pixels each. */
const LINE_PX = 16;
const PAGE_PX = 400;

/**
 * The half-height after one wheel event: scrolling down zooms out and up zooms in, the way a map does.
 * A trackpad pinch arrives as a wheel event with ctrlKey held and much smaller deltas, so it is weighted up.
 * Each step multiplies the height, so out and back in by the same amount returns to where it started.
 */
export function wheelZoom(halfHeight: number, deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  return clampHalfHeight(halfHeight * Math.exp(px * (pinch ? PINCH_RATE : SCROLL_RATE)));
}

/**
 * What a wheel event zooms to, or null when it is no zoom input: with no vertical movement (a sideways scroll)
 * it must not count, or it would restart the hold on a zoomed-out view and cancel the ease back.
 */
export function wheelZoomTarget(halfHeight: number, deltaY: number, deltaMode: number, pinch: boolean): number | null {
  return deltaY === 0 ? null : wheelZoom(halfHeight, deltaY, deltaMode, pinch);
}

/** A zoomed-out view settles back to the close-up in this long. */
export const EASE_BACK_MS = 600;

/** A dragged or zoomed-out view stays where it was put this long after the last drag or zoom, then eases back to the roller. */
export const VIEW_HOLD_MS = 10_000;

/** Camera: 30° above the ground (and turned 45° around), so a tile is a diamond. */
export const ELEVATION = Math.PI / 6;

/** The share of the way back still to go `elapsedMs` into easing back: 1 at the start, 0 after 600 ms, fast at first. */
export function easeBackLeft(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1;
  if (elapsedMs >= EASE_BACK_MS) return 0;
  return (1 - elapsedMs / EASE_BACK_MS) ** 3;
}

/** The half-height `elapsedMs` into easing back to the close-up from `from`: fast at first, slowing to rest at 5. */
export function easeHalfHeight(from: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return from;
  if (elapsedMs >= EASE_BACK_MS || from <= MIN_HALF_HEIGHT) return MIN_HALF_HEIGHT;
  return MIN_HALF_HEIGHT + (from - MIN_HALF_HEIGHT) * easeBackLeft(elapsedMs);
}

/**
 * How far the camera's target moves on the ground, in tiles, when the pointer drags the picture by (dx, dy) CSS
 * pixels on a panel `heightPx` tall showing `halfHeight` tiles above and below its middle: the ground under the
 * pointer stays under it, so the city follows the hand. Across the screen a pixel is 2·halfHeight/heightPx tiles;
 * up and down the ground is seen at 30°, so a pixel there covers 1/sin(30°) = twice as far. Screen right is
 * (1, −1)/√2 on the ground and screen down is (1, 1)/√2; the camera moves against the drag.
 */
export function panDelta(dxPx: number, dyPx: number, halfHeight: number, heightPx: number): { x: number; y: number } {
  const perPx = (2 * halfHeight) / heightPx;
  const across = dxPx * perPx;
  const along = (dyPx * perPx) / Math.sin(ELEVATION);
  return { x: -(across + along) * Math.SQRT1_2, y: (across - along) * Math.SQRT1_2 };
}

/** The cars on the streets, from the Car Kit: each trip's car is picked from them by who drives it. */
export const CAR_POOL: readonly string[] = ["sedan", "taxi", "van", "suv", "hatchback-sports", "delivery", "truck"].map((n) => `car/${n}`);

/** Every model the city draws, by path under assets/kenney (no extension). */
export const MODEL_NAMES: readonly string[] = [
  ...ROAD_BASE.map(([name]) => name),
  LIGHT,
  ...HOUSE_POOLS.flat(),
  ...SHOP_POOL,
  ...BLOCK_POOL,
  LANDMARK,
  PARK_TREE,
  PARK_PLANTER,
  GARDEN_TREE,
  ROLLER.model,
  ...CAR_POOL,
  ...Object.values(FURNITURE.avenueCross),
  FURNITURE.avenueLight,
  FURNITURE.trafficLight,
  FURNITURE.highwayLight,
  FURNITURE.highwaySign,
  ...ROAD_BASE.map(([name]) => FURNITURE.barrier(name)).filter((m): m is string => m !== null),
];

/** One model on one cell (or, for a streetlight, a point inside it). */
export interface Placement {
  model: string;
  x: number;
  y: number;
  turns: Turns;
  scale: number;
  /** Instance colour, 0xRRGGBB: the asphalt of a road, the roof of a suburban house, white for no change on anything else. */
  colour: number;
  /** A road piece whose kerb is drawn in its own asphalt colour, so it shows none (grades below the avenue). */
  flat?: boolean;
}

/** What each cell's road and house have been through, which decides how they look. */
export interface Looks {
  /** Times the road on this cell was driven. */
  driven: (x: number, y: number) => number;
  /** When the house on this cell appeared, by the city's clock. */
  built: (x: number, y: number) => number;
  /** The kind of building on the lot on this cell; undefined (no kind known) is drawn as a house. */
  kind: (x: number, y: number) => Kind | undefined;
  /** The road's grade on this cell (CitySim.gradeAt); left out, or 0, it is the grade of the cell's own passes. */
  grade?: (x: number, y: number) => Grade | 0;
}

/**
 * What stands on the cells within `radius` of (cx, cy): road pieces joined to their
 * neighbours (a lane's asphalt when driven once, with a streetlight on every other straight cell
 * when driven three times or more), and buildings of their kind turned to face a road, a house
 * with a roof for the hour it was built. `tierAt` is 0 for no house.
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
        const grade = looks.grade?.(x, y) || gradeOfPasses(looks.driven(x, y));
        const base = grade === 4 ? (FURNITURE.avenueCross[p.model] ?? p.model) : p.model;
        out.push({ model: base, x, y, turns: p.turns, scale: 1, colour: roadColour(grade), flat: grade <= 3 });
        const [dx, dy] = LIGHT_SIDE[p.turns];
        const side = (model: string, colour: number, scale = LIGHT_SCALE): Placement =>
          ({ model, x: x + dx * LIGHT_INSET, y: y + dy * LIGHT_INSET, turns: p.turns, scale, colour });
        const junction = p.model === "roads/road-intersection" || p.model === "roads/road-crossroad";
        // every other cell along a straight (x + y is even on alternate cells of a line along either axis)
        const lightHere = p.model === STRAIGHT && ((x + y) & 1) === 0;
        if (grade === 3 && lightHere) out.push(side(LIGHT, WHITE));
        if (grade === 4) {
          if (lightHere) out.push(side(FURNITURE.avenueLight, WHITE));
          if (junction) out.push({ model: FURNITURE.trafficLight, x: x + LIGHT_INSET, y: y + LIGHT_INSET, turns: p.turns, scale: LIGHT_SCALE, colour: STREET_COLOUR });
        }
        if (grade === 5) {
          const barrier = FURNITURE.barrier(p.model);
          if (barrier) out.push({ model: barrier, x, y, turns: p.turns, scale: 1, colour: WHITE });
          if (lightHere) out.push(side(FURNITURE.highwayLight, WHITE));
          if (p.model === STRAIGHT && (((x + y) % SIGN_EVERY) + SIGN_EVERY) % SIGN_EVERY === 0) out.push(side(FURNITURE.highwaySign, STREET_COLOUR, 1));
        }
        continue;
      }
      const tier = tierAt(x, y);
      if (tier) out.push(...buildingPlacements(looks.kind(x, y) ?? "house", tier, x, y, houseTurns(has, x, y), looks.built(x, y)));
    }
  }
  return out;
}

const MODEL_INDEX = new Map(MODEL_NAMES.map((name, i) => [name, i]));

/**
 * A 32-bit hash of a layout, to tell whether a re-check changed anything on screen: it covers
 * everything a placement draws, so the same models, spots (to 1/64 cell), turns, scales and
 * colours hash alike. That includes the extra placements a kind brings (a park's trees, a garden's
 * tree), which are placements like any other. Anything added to Placement that shows must be added here too.
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
    mix(p.flat ? 1 : 0);
  }
  return h >>> 0;
}
