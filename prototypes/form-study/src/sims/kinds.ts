// What kind of building a lot becomes, from the lots and road around it and from how far the pointer
// has travelled in all. Pure, so it can be tested in node; the city picks the kind once, when the lot is made.

/**
 * House, row house, detached house and the workplaces (shop, office) are there from the start; park, apartment and
 * the landmark unlock with distance.
 */
export type Kind = "house" | "row" | "detached" | "park" | "shop" | "office" | "apartment" | "landmark";

const KINDS: readonly Kind[] = ["house", "row", "detached", "park", "shop", "office", "apartment", "landmark"];

export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

/**
 * Total pointer distance, in screen points, from which each kind can appear (to be tuned on real days).
 * Shops are not here: they are workplaces now, which a city grows from its first lots as it needs them.
 */
export const UNLOCKS: readonly { kind: Kind; at: number }[] = [
  { kind: "park", at: 200_000 },
  { kind: "apartment", at: 1_500_000 },
  { kind: "landmark", at: 3_000_000 },
];

/** Whether `kind` can appear once the pointer has travelled `distance`. Kinds not in UNLOCKS always can. */
export function isUnlocked(kind: Kind, distance: number): boolean {
  const u = UNLOCKS.find((e) => e.kind === kind);
  return !u || distance >= u.at;
}

/**
 * Of the lots that are neither workplaces, corners, rows nor detached, this share becomes a park once parks unlock.
 * It is a share of what the workplace chance leaves: see `kindFor`.
 */
export const PARK_CHANCE = 0.15;

/** How many people live in a home at each tier (1, 2, 3). A park, a workplace and the landmark house nobody. */
export const RESIDENTS: Record<"house" | "row" | "detached" | "apartment", readonly [number, number, number]> = {
  house: [2, 4, 6],
  row: [3, 3, 3],
  detached: [2, 3, 4],
  apartment: [2, 4, 20],
};

/** How many jobs a workplace holds, whatever its age. */
export const JOBS: Record<"shop" | "office" | "landmark", number> = { shop: 4, office: 12, landmark: 30 };

/** The whole city's residents and jobs, each counted at tier-3 capacity so the sum does not drift as houses grow. */
export interface Demand {
  residents: number;
  jobs: number;
}

/** A new lot is a workplace with this chance while jobs keep up with residents. */
export const WORKPLACE_CHANCE = 0.1;
/** ... and with this chance while residents outnumber jobs by more than JOBS_SHORT_RATIO times. */
export const WORKPLACE_CHANCE_SHORT = 0.5;
/** Residents beyond this many times the jobs make the city short of work. */
export const JOBS_SHORT_RATIO = 1.2;

/** The chance that a new lot is a workplace, given the city's demand. */
export function workplaceChance(demand: Demand): number {
  return demand.residents > JOBS_SHORT_RATIO * demand.jobs ? WORKPLACE_CHANCE_SHORT : WORKPLACE_CHANCE;
}

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
 * The kind of a new lot, given its surroundings, the total distance so far, the city's demand, whether the lot
 * lies beside an avenue, and a random `roll` in [0, 1). The one roll decides two things without a second draw:
 *
 * - Under the workplace chance (0.5 while residents outnumber jobs by more than 20%, else 0.1) the lot is a
 *   workplace: a shop at a corner or beside an avenue, otherwise an office.
 * - Above it, the roll is stretched back over [0, 1) as (roll - p) / (1 - p), so it is again uniform whatever
 *   the demand was, and the old rules read it: a corner is a plain house, a lot with lots on both sides along its
 *   street a row house, one with none a detached house, any other lot a park when parks are unlocked and the
 *   stretched roll is under PARK_CHANCE. What is left is the plain house, an apartment once apartments unlock.
 *   So parks stay 15% of what is not a workplace, whatever the demand.
 *
 * The landmark is not decided here: the city gives it to one lot, beside its busiest road.
 */
export function kindFor(n: Neighbours, distance: number, roll: number, demand: Demand, besideAvenue: boolean): Kind {
  const p = workplaceChance(demand);
  if (roll < p) return n.cornerRoads || besideAvenue ? "shop" : "office";
  const plain: Kind = isUnlocked("apartment", distance) ? "apartment" : "house";
  if (n.cornerRoads) return plain;
  if (n.lotsAlongRoad >= 2) return "row";
  if (n.lotsAlongRoad <= 0) return "detached";
  if (isUnlocked("park", distance) && (roll - p) / (1 - p) < PARK_CHANCE) return "park";
  return plain;
}
