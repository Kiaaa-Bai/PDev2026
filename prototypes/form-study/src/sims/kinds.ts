// What kind of building a lot becomes, from the lots and road around it and from how far the pointer
// has travelled in all. Pure, so it can be tested in node; the city picks the kind once, when the lot is made.

/** House, row house and detached house are there from the start; the rest unlock with distance. */
export type Kind = "house" | "row" | "detached" | "park" | "shop" | "apartment" | "landmark";

const KINDS: readonly Kind[] = ["house", "row", "detached", "park", "shop", "apartment", "landmark"];

export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

/** Total pointer distance, in screen points, from which each kind can appear (to be tuned on real days). */
export const UNLOCKS: readonly { kind: Kind; at: number }[] = [
  { kind: "park", at: 200_000 },
  { kind: "shop", at: 600_000 },
  { kind: "apartment", at: 1_500_000 },
  { kind: "landmark", at: 3_000_000 },
];

/** Whether `kind` can appear once the pointer has travelled `distance`. Kinds not in UNLOCKS always can. */
export function isUnlocked(kind: Kind, distance: number): boolean {
  const u = UNLOCKS.find((e) => e.kind === kind);
  return !u || distance >= u.at;
}

/** Of the lots that are neither corners, rows nor detached, this share becomes a park once parks unlock. */
export const PARK_CHANCE = 0.15;

/** What surrounds a lot at the moment it is made. */
export interface Neighbours {
  /** How many of its four sides touch road. */
  roadSides: number;
  /** It touches road on two sides that are not opposite (an L): the inside of a bend, or a T or a crossing. */
  cornerRoads: boolean;
  /** How many of the two lots on either side of it along its street are already lots: 0, 1 or 2. */
  lotsAlongRoad: number;
}

type Has = (x: number, y: number) => boolean;

/**
 * What surrounds the lot at (x, y). Its street is the first road among south, east, north, west, which
 * is the side the house turns its front to; "along" the street is the line at right angles to that, so
 * west and east of a lot on a street to its north or south, north and south of one on a street to its
 * east or west. Lots on the diagonals, across the street or behind the lot are not along it.
 */
export function neighboursAt(isRoad: Has, isLot: Has, x: number, y: number): Neighbours {
  const n = isRoad(x, y - 1);
  const e = isRoad(x + 1, y);
  const s = isRoad(x, y + 1);
  const w = isRoad(x - 1, y);
  const streetRunsEastWest = s || (!e && n);
  const lotsAlongRoad = streetRunsEastWest
    ? Number(isLot(x - 1, y)) + Number(isLot(x + 1, y))
    : Number(isLot(x, y - 1)) + Number(isLot(x, y + 1));
  return {
    roadSides: Number(n) + Number(e) + Number(s) + Number(w),
    cornerRoads: (n || s) && (e || w),
    lotsAlongRoad,
  };
}

/**
 * The kind of a new lot, given its surroundings, the total distance so far and a random `roll` in [0, 1).
 * A corner becomes a shop once shops are unlocked; a lot with lots on both sides along its street a row house;
 * one with none a detached house; any other lot a park when parks are unlocked and the roll is under
 * PARK_CHANCE. What is left is the plain house, which is an apartment once apartments are unlocked.
 * The landmark is not decided here: the city gives it to one lot, beside its busiest road.
 */
export function kindFor(n: Neighbours, distance: number, roll: number): Kind {
  const plain: Kind = isUnlocked("apartment", distance) ? "apartment" : "house";
  if (n.cornerRoads) return isUnlocked("shop", distance) ? "shop" : plain;
  if (n.lotsAlongRoad >= 2) return "row";
  if (n.lotsAlongRoad <= 0) return "detached";
  if (isUnlocked("park", distance) && roll < PARK_CHANCE) return "park";
  return plain;
}
