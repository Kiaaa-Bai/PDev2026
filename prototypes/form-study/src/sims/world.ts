// The world the city grows on: rivers, from a seed each Mac keeps in its data folder. Pure, and plain arithmetic only
// (no Math.sin), so every engine — the window's WebKit, the dev page, node — floods exactly the same cells.

/** The mean distance between rivers, in cells; each lies up to 15 cells off its slot, so neighbours are 60–120 apart. */
export const RIVER_SPACING = 90;
const JITTER = 15;
/** The meander: the line through a control point every this many cells along x, each up to this far off. */
const BEND_EVERY = 40;
const BEND = 16;

/** A number in [0, 1) from the seed and an integer, by integer mixing (exact everywhere). */
function hash(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** How far the rivers' line is bent at column x: control points every BEND_EVERY cells, eased between with smoothstep. */
function meander(seed: number, x: number): number {
  const j = Math.floor(x / BEND_EVERY);
  const t = (x - j * BEND_EVERY) / BEND_EVERY;
  const a = (hash(seed, j) - 0.5) * 2 * BEND;
  const b = (hash(seed, j + 1) - 0.5) * 2 * BEND;
  return a + (b - a) * t * t * (3 - 2 * t);
}

/**
 * A seed's rivers never change, so each column's bend and each slot's centre and half-width are worked out once and
 * kept (the same numbers as computing them afresh: caching changes nothing about which cells are water).
 */
interface Memo {
  bend: Map<number, number>;
  slot: Map<number, [centre: number, half: number]>;
}
const memos = new Map<number, Memo>();
function memoOf(seed: number): Memo {
  let m = memos.get(seed);
  if (!m) memos.set(seed, (m = { bend: new Map(), slot: new Map() }));
  return m;
}

function wet(seed: number, x: number, y: number, shift: number): boolean {
  const memo = memoOf(seed);
  let bend = memo.bend.get(x);
  if (bend === undefined) memo.bend.set(x, (bend = meander(seed, x)));
  const v = y - bend - shift;
  const slot = Math.floor(v / RIVER_SPACING);
  for (let k = slot - 1; k <= slot + 1; k++) {
    let band = memo.slot.get(k);
    if (!band) {
      const centre = k * RIVER_SPACING + RIVER_SPACING / 2 + (hash(seed, 1_000_003 + k) - 0.5) * 2 * JITTER;
      const width = hash(seed, 2_000_003 + k) < 0.5 ? 2 : 3;
      memo.slot.set(k, (band = [centre, width / 2]));
    }
    if (Math.abs(v - band[0]) < band[1]) return true;
  }
  return false;
}

/** How far a seed's rivers are shifted so that none floods the roller's first cell (0, 0). */
const shifts = new Map<number, number>();
function shiftOf(seed: number): number {
  let s = shifts.get(seed);
  if (s === undefined) {
    s = 0;
    while (wet(seed, 0, 0, s)) s += 4;
    shifts.set(seed, s);
  }
  return s;
}

/**
 * Whether the cell (x, y) is river. Rivers are bands 2 or 3 cells deep (down the map) that run along x across the
 * endless map, one in every slot of RIVER_SPACING cells, bending gently as they go.
 */
export function isWater(seed: number, x: number, y: number): boolean {
  return wet(seed, x, y, shiftOf(seed));
}
