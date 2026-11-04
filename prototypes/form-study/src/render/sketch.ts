// The docked window's flat sketch of the city: the same area around the roller as the 3D close-up, in the same diamond
// projection, so opening the window reads as zooming into the same place. Roads are lines shaded by tier, lots small
// squares coloured by kind, the roller a dot; no people or cars. `sketchItems` (what to draw) is pure, for node tests.

import { EDGE_H } from "../modes";
import { cellKey, type CitySim } from "../sims/city";
import type { Kind } from "../sims/kinds";
import { LANE_COLOUR, ROOF_COLOURS, roadTier, STREET_COLOUR, WINDOW_LIT } from "./looks";
import { MIN_HALF_HEIGHT } from "./pieces";

/** Two neighbouring road cells, joined: listed once, from the west or north one. A road with no neighbour is joined to itself. */
export interface SketchRoad {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** The lesser of the two cells' tiers: a lane meeting a street is drawn as the lane. */
  tier: 1 | 2 | 3;
}

export interface SketchLot {
  x: number;
  y: number;
  kind: Kind;
}

export interface SketchItems {
  roads: SketchRoad[];
  lots: SketchLot[];
  roller: { x: number; y: number };
}

/**
 * Cells around the roller the sketch lists: the 3D close-up's picture reaches 2.55 × its half-height cells from the
 * roller to its corners (see `viewRadius`), and the sketch shows the same area; two more for the roads leaving it.
 */
export const SKETCH_RADIUS = Math.ceil(MIN_HALF_HEIGHT * 2.55) + 2;

/** Roads and lots within `radius` cells of `centre` (a square, as the 3D layout builds), and where the roller is. */
export function sketchItems(sim: CitySim, centre: { x: number; y: number }, radius: number): SketchItems {
  const cx = Math.round(centre.x);
  const cy = Math.round(centre.y);
  const inside = (x: number, y: number) => Math.abs(x - cx) <= radius && Math.abs(y - cy) <= radius;
  const driven = (x: number, y: number) => sim.road.get(cellKey(x, y));
  const roads: SketchRoad[] = [];
  const lots: SketchLot[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const n = driven(x, y);
      if (n === undefined) {
        if (sim.lots.has(cellKey(x, y))) lots.push({ x, y, kind: sim.lotKind(x, y) ?? "house" });
        continue;
      }
      const tier = roadTier(n);
      const join = (nx: number, ny: number, m: number) =>
        roads.push({ x, y, nx, ny, tier: Math.min(tier, roadTier(m)) as 1 | 2 | 3 });
      const east = driven(x + 1, y);
      const south = driven(x, y + 1);
      if (east !== undefined && inside(x + 1, y)) join(x + 1, y, east);
      if (south !== undefined && inside(x, y + 1)) join(x, y + 1, south);
      const alone = east === undefined && south === undefined && driven(x - 1, y) === undefined && driven(x, y - 1) === undefined;
      if (alone) roads.push({ x, y, nx: x, ny: y, tier });
    }
  }
  return { roads, lots, roller: sim.rollerAt() };
}

/**
 * The sketch's scale. The 3D close-up shows 2 × MIN_HALF_HEIGHT units of its view from top to bottom; the sketch shows
 * the same in its 120 points. A cell is then a diamond 2K wide and K tall (the camera is 30 degrees up, turned 45).
 */
const UNIT = EDGE_H / (2 * MIN_HALF_HEIGHT);
const K = UNIT * Math.SQRT1_2;

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Lots by kind: homes in the roof colours, a park green, workplaces in shop red and office grey, the landmark lit gold. */
export const KIND_COLOURS: Record<Kind, number> = {
  house: ROOF_COLOURS[1],
  row: ROOF_COLOURS[0],
  detached: ROOF_COLOURS[2],
  apartment: ROOF_COLOURS[3],
  park: 0x4aa36b,
  shop: 0xd94f4f,
  office: 0x8a93a8,
  landmark: WINDOW_LIT,
};

const DAY = { ground: 0xe6ecd9, roads: [LANE_COLOUR, STREET_COLOUR, 0x474b5c], roller: 0xf2b705, outline: 0x2a2a2a };
const NIGHT = { ground: 0x161b28, roads: [0x8f7f5c, 0x8a90a8, 0xc4c9d8], roller: 0xffd27a, outline: 0x000000 };
/** Line widths for lanes, streets and avenues, in points. */
const ROAD_WIDTH = [1.5, 2.5, 3.5];
/** A lot's square, as a share of its cell. */
const LOT_SIZE = 0.55;

/**
 * Draws `items` to fill `ctx`'s canvas, the roller in the middle: light by day, dark by night. The canvas may be any
 * size (it is drawn at its backing resolution); the picture is the docked window's 160 × 120 points scaled to it.
 */
export function drawSketch(ctx: CanvasRenderingContext2D, items: SketchItems, opts: { night: boolean }): void {
  const look = opts.night ? NIGHT : DAY;
  const { width, height } = ctx.canvas;
  const scale = height / EDGE_H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = css(look.ground);
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, width / 2, height / 2);
  const { x: rx, y: ry } = items.roller;
  const sx = (x: number, y: number) => (x - rx - (y - ry)) * K;
  const sy = (x: number, y: number) => (x - rx + (y - ry)) * (K / 2);

  ctx.lineCap = "round";
  for (const tier of [1, 2, 3] as const) {
    ctx.strokeStyle = css(look.roads[tier - 1]);
    ctx.lineWidth = ROAD_WIDTH[tier - 1];
    ctx.beginPath();
    for (const r of items.roads) {
      if (r.tier !== tier) continue;
      ctx.moveTo(sx(r.x, r.y), sy(r.x, r.y));
      ctx.lineTo(sx(r.nx, r.ny), sy(r.nx, r.ny));
    }
    ctx.stroke();
  }

  // a lot is a square on the ground: in this projection a diamond
  const h = LOT_SIZE / 2;
  for (const lot of items.lots) {
    ctx.fillStyle = css(KIND_COLOURS[lot.kind]);
    ctx.beginPath();
    ctx.moveTo(sx(lot.x - h, lot.y - h), sy(lot.x - h, lot.y - h));
    ctx.lineTo(sx(lot.x + h, lot.y - h), sy(lot.x + h, lot.y - h));
    ctx.lineTo(sx(lot.x + h, lot.y + h), sy(lot.x + h, lot.y + h));
    ctx.lineTo(sx(lot.x - h, lot.y + h), sy(lot.x - h, lot.y + h));
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, 2 * Math.PI);
  ctx.fillStyle = css(look.roller);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(look.outline);
  ctx.stroke();
}
