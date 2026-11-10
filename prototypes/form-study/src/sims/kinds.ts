// What kind of building a lot becomes, from the lots and road around it and from how far the pointer
// has travelled in all. Pure, so it can be tested in node; the city picks the kind once, when the lot is made.

/**
 * House, row house, detached house and the workplaces (shop, office) are there from the start; park, apartment and
 * the landmark unlock with distance.
 */
export type Kind = "house" | "row" | "detached" | "park" | "shop" | "office" | "apartment" | "landmark" | "industrial";

const KINDS: readonly Kind[] = ["house", "row", "detached", "park", "shop", "office", "apartment", "landmark", "industrial"];

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
export const JOBS: Record<"shop" | "office" | "landmark" | "industrial", number> = { shop: 4, office: 12, landmark: 30, industrial: 15 };

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

/**
 * What a new lot's surroundings say about its zone, all worked out by the city when the lot is made. Left out, each is
 * false (or none), and `kindFor` is today's rule.
 */
export interface LotContext {
  /** The city's commercial jobs are short of one per `RESIDENTS_PER_SHOP_JOB` residents. */
  commercialShort?: boolean;
  /** The lot is in the city's outer ring: further from the centroid of homes than their spread. */
  outer?: boolean;
  /** A home stands within `BUFFER` cells (no industry may come here). */
  nearHome?: boolean;
  /** Industry stands within `BUFFER` cells (no home may come here). */
  nearIndustry?: boolean;
  /** Industry stands on a neighbouring cell, so industry may cluster here even inside the ring. */
  touchesIndustry?: boolean;
  /** The kind of the nearest lot along the same street within `BUFFER` cells, for clustering. */
  clusterKind?: Kind | null;
  /** The lot fronts a highway (grade 5): only a shop or an office. */
  highwayFrontage?: boolean;
  /** The lot touches a river: no industry here (the waterfront is for homes, shops and offices). */
  waterfront?: boolean;
}

/** Commercial jobs are short while there are fewer than one for this many residents (Cities: Skylines' zero point). */
export const RESIDENTS_PER_SHOP_JOB = 8;
/** How far, in cells (a square), industry and homes keep from each other. No city builder documents one; ours. */
export const BUFFER = 2;
/** The chance a new lot takes the zone of its neighbour along the street, so zones come in blocks. */
export const CLUSTER_CHANCE = 0.6;

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
export function kindFor(n: Neighbours, distance: number, roll: number, demand: Demand, besideAvenue: boolean, ctx: LotContext = {}): Kind {
  if (ctx.highwayFrontage) return roll < 0.5 ? "shop" : "office";
  let r = roll;
  // a neighbour along the street, below the cluster chance, makes the decision for this lot (the roll is then
  // stretched back over [0, 1) whichever way it went, so what follows still reads a uniform roll)
  let home = false;
  // while shops are short, a home next door does not make this lot a home too
  const cluster = ctx.commercialShort && ctx.clusterKind && !isWorkplaceKind(ctx.clusterKind) ? null : ctx.clusterKind;
  if (cluster) {
    if (roll < CLUSTER_CHANCE) {
      const k = cluster;
      if (isWorkplaceKind(k) && (k !== "industrial" || !ctx.nearHome)) return k;
      home = !isWorkplaceKind(k);
      r = roll / CLUSTER_CHANCE;
    } else r = (roll - CLUSTER_CHANCE) / (1 - CLUSTER_CHANCE);
  }
  // shops are a demand of their own: while they are short, a lot is a workplace as often as when jobs are short
  const p = ctx.commercialShort ? Math.max(workplaceChance(demand), WORKPLACE_CHANCE_SHORT) : workplaceChance(demand);
  if (!home) {
    if (r < p) return workplaceKind(n, besideAvenue, ctx);
    r = (r - p) / (1 - p);
  }
  // a home, unless industry is near: then a park (once parks unlock) or an office
  if (ctx.nearIndustry) return isUnlocked("park", distance) && r < 0.5 ? "park" : "office";
  const plain: Kind = isUnlocked("apartment", distance) ? "apartment" : "house";
  if (n.cornerRoads) return plain;
  if (n.lotsAlongRoad >= 2) return "row";
  if (n.lotsAlongRoad <= 0) return "detached";
  if (isUnlocked("park", distance) && r < PARK_CHANCE) return "park";
  return plain;
}

const isWorkplaceKind = (k: Kind): boolean => k === "shop" || k === "office" || k === "industrial";

/** Which workplace: a shop where shops are short, at a corner or beside an avenue; industry in the outer ring (or next to industry) away from homes; otherwise an office. */
function workplaceKind(n: Neighbours, besideAvenue: boolean, ctx: LotContext): Kind {
  if (ctx.commercialShort || n.cornerRoads || besideAvenue) return "shop";
  if ((ctx.outer || ctx.touchesIndustry) && !ctx.nearHome && !ctx.waterfront) return "industrial";
  return "office";
}

/** A lot's zone, Cities: Skylines-style. */
export type Zone = "residential" | "commercial" | "office" | "industrial" | "park" | "landmark";

/** The zone each kind of lot belongs to. */
export function zoneOf(kind: Kind): Zone {
  switch (kind) {
    case "house":
    case "row":
    case "detached":
    case "apartment":
      return "residential";
    case "shop":
      return "commercial";
    default:
      return kind;
  }
}

/** On an avenue, this share of homes (by their roll) become shops; on a highway, this share shops and the rest offices. */
export const AVENUE_SHOP_SHARE = 0.25;
export const HIGHWAY_SHOP_SHARE = 0.5;

/**
 * The zone a lot holds now, from the zone it was born with, its own roll and the best grade of the roads it touches:
 * homes beside an avenue (grade 4) become shops below `AVENUE_SHOP_SHARE`; homes beside a highway (grade 5) all become
 * shops or offices. Every other zone stays.
 */
export function zoneNow(born: Zone, roll: number, grade: number): Zone {
  if (born !== "residential") return born;
  if (grade >= 5) return roll < HIGHWAY_SHOP_SHARE ? "commercial" : "office";
  if (grade === 4 && roll < AVENUE_SHOP_SHARE) return "commercial";
  return born;
}
