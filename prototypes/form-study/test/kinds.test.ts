import { describe, expect, it } from "vitest";
import {
  isKind,
  isUnlocked,
  JOBS,
  JOBS_SHORT_RATIO,
  kindFor as kindForWith,
  neighboursAt,
  PARK_CHANCE,
  RESIDENTS,
  UNLOCKS,
  WORKPLACE_CHANCE,
  WORKPLACE_CHANCE_SHORT,
  workplaceChance,
  type Demand,
  type Kind,
  type Neighbours,
  zoneNow,
  zoneOf,
} from "../src/sims/kinds";

const at = (kind: Kind) => UNLOCKS.find((u) => u.kind === kind)!.at;
type Cell = [number, number];
const cells = (...list: Cell[]) => {
  const keys = new Set(list.map(([x, y]) => `${x},${y}`));
  return (x: number, y: number) => keys.has(`${x},${y}`);
};
/** Neighbours of the lot at the origin, given where the road and the other lots are. */
const around = (road: Cell[], lots: Cell[] = []) => neighboursAt(cells(...road), cells(...lots), 0, 0);

/** Every neighbourhood kindFor can be asked about. */
const ALL: Neighbours[] = [];
for (const roadSides of [1, 2, 3, 4]) {
  for (const cornerRoads of [false, true]) {
    for (const lotsAlongRoad of [0, 1, 2]) ALL.push({ roadSides, cornerRoads, lotsAlongRoad });
  }
}
const ROLLS = [0, 0.05, PARK_CHANCE - 0.001, PARK_CHANCE, 0.5, 0.999];

/** Residents and jobs in balance: the usual chance of a workplace. */
const BALANCED: Demand = { residents: 0, jobs: 0 };
/** More than 20% more residents than jobs: the raised chance. */
const SHORT: Demand = { residents: 13, jobs: 10 };
/** kindFor with the city's demand and avenue as options: a balanced city, no avenue. */
const kindFor = (n: Neighbours, distance: number, roll: number, demand: Demand = BALANCED, besideAvenue = false): Kind =>
  kindForWith(n, distance, roll, demand, besideAvenue);
const isWorkplace = (k: Kind) => k === "shop" || k === "office";

describe("UNLOCKS", () => {
  it("lists parks, then apartments, then the landmark, at the agreed distances: shops are workplaces now, not an unlock", () => {
    expect(UNLOCKS).toEqual([
      { kind: "park", at: 200_000 },
      { kind: "apartment", at: 1_500_000 },
      { kind: "landmark", at: 3_000_000 },
    ]);
  });

  it("unlocks a kind exactly at its distance, and house, row and detached from the start", () => {
    for (const { kind, at: d } of UNLOCKS) {
      expect(isUnlocked(kind, d - 1), `${kind} just before`).toBe(false);
      expect(isUnlocked(kind, d), `${kind} at`).toBe(true);
      expect(isUnlocked(kind, d * 10), `${kind} long after`).toBe(true);
    }
    for (const kind of ["house", "row", "detached", "shop", "office"] as const) expect(isUnlocked(kind, 0)).toBe(true);
  });

  it("names exactly the eight kinds", () => {
    for (const k of ["house", "row", "detached", "park", "shop", "office", "apartment", "landmark"]) expect(isKind(k)).toBe(true);
    for (const k of ["", "tower", "House", 3, null, undefined]) expect(isKind(k)).toBe(false);
  });
});

describe("capacities", () => {
  it("lists the residents of each home by tier, and the jobs of each workplace", () => {
    expect(RESIDENTS).toEqual({ house: [2, 4, 6], row: [3, 3, 3], detached: [2, 3, 4], apartment: [2, 4, 20] });
    expect(JOBS).toEqual({ shop: 4, office: 12, landmark: 30, industrial: 15 });
  });
});

describe("workplaceChance", () => {
  it("is 0.1 while residents are at most 20% over jobs, and 0.5 beyond", () => {
    expect([WORKPLACE_CHANCE, WORKPLACE_CHANCE_SHORT, JOBS_SHORT_RATIO]).toEqual([0.1, 0.5, 1.2]);
    expect(workplaceChance({ residents: 0, jobs: 0 })).toBe(0.1); // an empty city is in balance
    expect(workplaceChance({ residents: 100, jobs: 100 })).toBe(0.1);
    expect(workplaceChance({ residents: 120, jobs: 100 })).toBe(0.1); // exactly 1.2 times is not more than 1.2 times
    expect(workplaceChance({ residents: 121, jobs: 100 })).toBe(0.5);
    expect(workplaceChance({ residents: 1, jobs: 0 })).toBe(0.5); // any resident with no job at all
    expect(workplaceChance({ residents: 5, jobs: 50 })).toBe(0.1); // more jobs than people
  });
});

describe("kindFor", () => {
  const beside = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 1 };
  const corner = { roadSides: 2, cornerRoads: true, lotsAlongRoad: 1 };
  /** A roll that is never a workplace, whatever the demand, and does not reach the park share either. */
  const NOT_WORK = WORKPLACE_CHANCE_SHORT + (1 - WORKPLACE_CHANCE_SHORT) * 0.9;
  /** The first roll above the workplace chance `p` that gives a park, and the last one below it. */
  const parkSpan = (p: number): [number, number] => [p, p + (1 - p) * PARK_CHANCE];

  describe("workplaces by demand", () => {
    it("makes a lot a workplace when its roll is under 0.1 in a city in balance, with no unlock needed", () => {
      for (const n of ALL) {
        expect(isWorkplace(kindFor(n, 0, 0)), "0").toBe(true);
        expect(isWorkplace(kindFor(n, 0, 0.099)), "0.099").toBe(true);
        expect(isWorkplace(kindFor(n, 0, 0.1)), "0.1").toBe(false);
        expect(isWorkplace(kindFor(n, 0, 0.9)), "0.9").toBe(false);
      }
    });

    it("raises the chance to 0.5 when residents outnumber jobs by more than 20%", () => {
      for (const n of ALL) {
        expect(isWorkplace(kindFor(n, 0, 0.499, SHORT))).toBe(true);
        expect(isWorkplace(kindFor(n, 0, 0.5, SHORT))).toBe(false);
        // at exactly 1.2 times the jobs it is still the usual chance
        expect(isWorkplace(kindFor(n, 0, 0.3, { residents: 12, jobs: 10 }))).toBe(false);
        expect(isWorkplace(kindFor(n, 0, 0.05, { residents: 12, jobs: 10 }))).toBe(true);
      }
    });

    it("makes about 10% of lots workplaces in balance and about 50% when short, over evenly spread rolls", () => {
      const share = (demand: Demand) => {
        let work = 0;
        const N = 10_000;
        for (let i = 0; i < N; i++) if (isWorkplace(kindFor(beside, 0, (i + 0.5) / N, demand))) work++;
        return work / N;
      };
      expect(share(BALANCED)).toBeCloseTo(0.1, 2);
      expect(share(SHORT)).toBeCloseTo(0.5, 2);
    });

    it("makes a workplace a shop at a corner, and an office elsewhere", () => {
      expect(kindFor(corner, 0, 0)).toBe("shop");
      expect(kindFor(corner, 0, 0, SHORT)).toBe("shop");
      for (const lotsAlongRoad of [0, 1, 2]) {
        expect(kindFor({ ...beside, lotsAlongRoad }, 0, 0)).toBe("office");
        expect(kindFor({ ...beside, lotsAlongRoad }, 0, 0, SHORT)).toBe("office");
      }
      // a lot with road on three or four sides is a corner too
      expect(kindFor({ roadSides: 3, cornerRoads: true, lotsAlongRoad: 0 }, 0, 0)).toBe("shop");
    });

    it("makes a workplace beside an avenue a shop, avenue or corner or both", () => {
      expect(kindFor(beside, 0, 0, BALANCED, true)).toBe("shop");
      expect(kindFor(beside, 0, 0, SHORT, true)).toBe("shop");
      expect(kindFor({ ...beside, lotsAlongRoad: 2 }, 0, 0, BALANCED, true)).toBe("shop"); // even between two lots
      expect(kindFor({ ...beside, lotsAlongRoad: 0 }, 0, 0, BALANCED, true)).toBe("shop");
      expect(kindFor(corner, 0, 0, BALANCED, true)).toBe("shop");
    });

    it("does nothing for an avenue when the lot is not a workplace", () => {
      for (const n of ALL) {
        for (const roll of [0.3, 0.7, 0.99]) expect(kindFor(n, 0, roll, BALANCED, true)).toBe(kindFor(n, 0, roll, BALANCED, false));
      }
    });

    it("keeps shops and offices once everything is unlocked, and gives workplaces at distance 0 too", () => {
      for (const d of [0, at("park"), at("apartment"), at("landmark"), 1e9]) {
        expect(kindFor(corner, d, 0.01)).toBe("shop");
        expect(kindFor(beside, d, 0.01)).toBe("office");
      }
    });
  });

  describe("everything else", () => {
    it("makes a corner that is not a workplace a plain house (an apartment once unlocked), never a row or detached", () => {
      for (const lotsAlongRoad of [0, 1, 2]) {
        expect(kindFor({ ...corner, lotsAlongRoad }, 0, NOT_WORK)).toBe("house");
        expect(kindFor({ ...corner, lotsAlongRoad }, at("park"), NOT_WORK)).toBe("house");
        expect(kindFor({ ...corner, lotsAlongRoad }, at("apartment") - 1, NOT_WORK)).toBe("house");
        expect(kindFor({ ...corner, lotsAlongRoad }, at("apartment"), NOT_WORK)).toBe("apartment");
      }
      // and no park from a corner, however low the park share of the roll
      for (const demand of [BALANCED, SHORT]) {
        const [lo, hi] = parkSpan(workplaceChance(demand));
        expect(kindFor(corner, at("park"), (lo + hi) / 2, demand)).toBe("house");
      }
    });

    it("makes a lot with lots on both sides along its road a row, whatever is unlocked", () => {
      const between = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 2 };
      for (const d of [0, at("park"), at("apartment"), at("landmark")]) {
        for (const roll of ROLLS) if (!isWorkplace(kindFor(between, d, roll))) expect(kindFor(between, d, roll)).toBe("row");
        expect(kindFor(between, d, NOT_WORK)).toBe("row");
      }
    });

    it("makes a lot with no lots along its road a detached house, whatever is unlocked", () => {
      const alone = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 0 };
      for (const d of [0, at("park"), at("apartment"), at("landmark")]) {
        for (const roll of ROLLS) if (!isWorkplace(kindFor(alone, d, roll))) expect(kindFor(alone, d, roll)).toBe("detached");
        expect(kindFor(alone, d, NOT_WORK)).toBe("detached");
      }
    });

    it("splits one roll in two: under the workplace chance a workplace, then 15% of what is left a park", () => {
      expect(PARK_CHANCE).toBe(0.15);
      for (const demand of [BALANCED, SHORT]) {
        const p = workplaceChance(demand);
        const [lo, hi] = parkSpan(p);
        const eps = 1e-9;
        expect(isWorkplace(kindFor(beside, at("park"), p - eps, demand))).toBe(true);
        expect(kindFor(beside, at("park"), lo + eps, demand)).toBe("park");
        expect(kindFor(beside, at("park"), hi - eps, demand)).toBe("park");
        expect(kindFor(beside, at("park"), hi + eps, demand)).toBe("house");
        expect(kindFor(beside, at("park"), 0.999, demand)).toBe("house");
        // before parks unlock the same rolls are plain houses
        expect(kindFor(beside, at("park") - 1, (lo + hi) / 2, demand)).toBe("house");
      }
    });

    it("keeps the park share of the lots that are not workplaces at 15%, whatever the demand", () => {
      for (const demand of [BALANCED, SHORT]) {
        let parks = 0;
        let rest = 0;
        const N = 20_000;
        for (let i = 0; i < N; i++) {
          const k = kindFor(beside, at("park"), (i + 0.5) / N, demand);
          if (isWorkplace(k)) continue;
          rest++;
          if (k === "park") parks++;
        }
        expect(parks / rest).toBeCloseTo(PARK_CHANCE, 2);
      }
    });

    it("calls the plain house an apartment once apartments are unlocked, and only the plain house", () => {
      expect(kindFor(beside, at("apartment") - 1, NOT_WORK)).toBe("house");
      expect(kindFor(beside, at("apartment"), NOT_WORK)).toBe("apartment");
      expect(kindFor({ ...beside, lotsAlongRoad: 2 }, at("apartment"), NOT_WORK)).toBe("row");
      expect(kindFor({ ...beside, lotsAlongRoad: 0 }, at("apartment"), NOT_WORK)).toBe("detached");
      const [lo, hi] = parkSpan(WORKPLACE_CHANCE);
      expect(kindFor(beside, at("apartment"), (lo + hi) / 2)).toBe("park"); // parks keep their share
    });
  });

  it("never gives a kind before its distance", () => {
    for (const { kind, at: d } of UNLOCKS) {
      for (const demand of [BALANCED, SHORT]) {
        for (const n of ALL) {
          for (const roll of ROLLS) for (const avenue of [false, true]) expect(kindFor(n, d - 1, roll, demand, avenue), `${kind} before ${d}`).not.toBe(kind);
        }
      }
    }
  });

  it("never gives the landmark: the city picks that one itself", () => {
    for (const d of [0, at("landmark"), 1e9]) {
      for (const n of ALL) for (const roll of ROLLS) for (const demand of [BALANCED, SHORT]) expect(kindFor(n, d, roll, demand)).not.toBe("landmark");
    }
  });

  it("gives each other kind to some neighbourhood once everything is unlocked", () => {
    const seen = new Set<Kind>();
    for (const n of ALL) for (const roll of ROLLS) for (const avenue of [false, true]) seen.add(kindFor(n, at("landmark"), roll, BALANCED, avenue));
    expect([...seen].sort()).toEqual(["apartment", "detached", "office", "park", "row", "shop"]);
  });

  it("starts out with houses, rows, detached houses and workplaces only", () => {
    const seen = new Set<Kind>();
    for (const n of ALL) for (const roll of ROLLS) for (const avenue of [false, true]) seen.add(kindFor(n, 0, roll, BALANCED, avenue));
    expect([...seen].sort()).toEqual(["detached", "house", "office", "row", "shop"]);
  });
});

describe("neighboursAt", () => {
  it("counts the road on each side of the lot, and not on a diagonal", () => {
    expect(around([[0, 1]]).roadSides).toBe(1);
    expect(around([[0, 1], [0, -1]]).roadSides).toBe(2);
    expect(around([[0, 1], [0, -1], [1, 0], [-1, 0]]).roadSides).toBe(4);
    expect(around([[1, 1], [-1, -1]]).roadSides).toBe(0);
  });

  it("calls a lot a corner when it touches road on two sides that are not opposite (an L)", () => {
    const ls: [Cell, Cell][] = [
      [[0, -1], [1, 0]], // N and E
      [[1, 0], [0, 1]], // E and S
      [[0, 1], [-1, 0]], // S and W
      [[-1, 0], [0, -1]], // W and N
    ];
    for (const [a, b] of ls) expect(around([a, b]).cornerRoads, `${a} + ${b}`).toBe(true);
  });

  it("does not call a lot a corner when its road is on one side, or on opposite sides only", () => {
    for (const side of [[0, -1], [1, 0], [0, 1], [-1, 0]] as Cell[]) expect(around([side]).cornerRoads).toBe(false);
    expect(around([[0, 1], [0, -1]]).cornerRoads).toBe(false); // N and S
    expect(around([[1, 0], [-1, 0]]).cornerRoads).toBe(false); // E and W
    expect(around([[1, 1], [-1, 1]]).cornerRoads).toBe(false); // diagonals do not touch
  });

  it("calls a lot with road on three or four sides a corner", () => {
    expect(around([[0, 1], [0, -1], [1, 0]]).cornerRoads).toBe(true);
    expect(around([[0, 1], [0, -1], [1, 0], [-1, 0]]).cornerRoads).toBe(true);
  });

  it("counts the lots to the west and east of a lot on a road to its north or south", () => {
    for (const road of [[0, 1], [0, -1]] as Cell[]) {
      expect(around([road]).lotsAlongRoad).toBe(0);
      expect(around([road], [[-1, 0]]).lotsAlongRoad).toBe(1);
      expect(around([road], [[1, 0]]).lotsAlongRoad).toBe(1);
      expect(around([road], [[-1, 0], [1, 0]]).lotsAlongRoad).toBe(2);
    }
  });

  it("counts the lots to the north and south of a lot on a road to its east or west", () => {
    for (const road of [[1, 0], [-1, 0]] as Cell[]) {
      expect(around([road]).lotsAlongRoad).toBe(0);
      expect(around([road], [[0, -1]]).lotsAlongRoad).toBe(1);
      expect(around([road], [[0, 1]]).lotsAlongRoad).toBe(1);
      expect(around([road], [[0, -1], [0, 1]]).lotsAlongRoad).toBe(2);
    }
  });

  it("does not count lots across the road, on a diagonal, or on the other axis", () => {
    // road to the south, so along it is west-east: north and the diagonals are not along it
    expect(around([[0, 1]], [[0, -1], [1, -1], [-1, -1], [1, 1], [-1, 1]]).lotsAlongRoad).toBe(0);
    // road to the east, so along it is north-south: west and the diagonals are not along it
    expect(around([[1, 0]], [[-1, 0], [-1, -1], [1, -1]]).lotsAlongRoad).toBe(0);
  });

  it("follows the street the house will face: the first road among south, east, north, west", () => {
    // roads S and E: the street is S, so only west and east count (a lot to the north does not)
    expect(around([[0, 1], [1, 0]], [[0, -1]]).lotsAlongRoad).toBe(0);
    expect(around([[0, 1], [-1, 0]], [[1, 0]]).lotsAlongRoad).toBe(1);
    // roads E and N: the street is E, so only north and south count
    expect(around([[1, 0], [0, -1]], [[0, 1]]).lotsAlongRoad).toBe(1);
    expect(around([[1, 0], [0, -1]], [[-1, 0]]).lotsAlongRoad).toBe(0);
    // roads N and W: the street is N, so west and east count
    expect(around([[0, -1], [-1, 0]], [[1, 0]]).lotsAlongRoad).toBe(1);
    expect(around([[0, -1], [-1, 0]], [[0, 1]]).lotsAlongRoad).toBe(0);
  });

  it("asks only the cells around the lot", () => {
    const asked: string[] = [];
    const spy = (x: number, y: number) => {
      asked.push(`${x},${y}`);
      return false;
    };
    neighboursAt(spy, spy, 4, -2);
    for (const k of asked) {
      const [x, y] = k.split(",").map(Number);
      expect(Math.abs(x - 4) + Math.abs(y + 2), k).toBe(1);
    }
  });
});

describe("kindFor with the lot's surroundings (zones)", () => {
  const beside = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 1 };
  const WORK = 0.05; // under the workplace chance in a city in balance
  const HOME = 0.9;
  const BAL: Demand = { residents: 100, jobs: 100 };

  it("is exactly today's rule with no surroundings given", () => {
    for (const roll of [0, 0.05, 0.3, 0.6, 0.95]) expect(kindForWith(beside, 0, roll, BAL, false, {})).toBe(kindForWith(beside, 0, roll, BAL, false));
  });

  it("makes a workplace a shop while commercial jobs are short of one per eight residents", () => {
    expect(kindForWith(beside, 0, WORK, BAL, false, { commercialShort: true })).toBe("shop");
    expect(kindForWith(beside, 0, WORK, BAL, false, {})).toBe("office");
  });

  it("makes a workplace in the city's outer ring industry, unless a home is within 2 cells", () => {
    expect(kindForWith(beside, 0, WORK, BAL, false, { outer: true })).toBe("industrial");
    expect(kindForWith(beside, 0, WORK, BAL, false, { outer: true, nearHome: true })).toBe("office");
    expect(kindForWith(beside, 0, WORK, BAL, false, { touchesIndustry: true })).toBe("industrial");
  });

  it("never puts a home within 2 cells of industry", () => {
    for (const roll of [0.3, 0.5, 0.9, 0.99]) {
      const k = kindForWith(beside, 3_000_000, roll, BAL, false, { nearIndustry: true });
      expect(isHome(k), `${roll} → ${k}`).toBe(false);
    }
  });

  it("follows its neighbour along the street most of the time", () => {
    expect(kindForWith(beside, 0, 0.3, BAL, false, { clusterKind: "office" })).toBe("office");
    expect(kindForWith(beside, 0, 0.59, BAL, false, { clusterKind: "industrial", outer: true })).toBe("industrial");
    // a neighbour's industry is not copied next to a home
    expect(kindForWith(beside, 0, 0.3, BAL, false, { clusterKind: "industrial", nearHome: true })).not.toBe("industrial");
    // a home neighbour makes it a home
    expect(isHome(kindForWith(beside, 0, 0.01, BAL, false, { clusterKind: "house" }))).toBe(true);
    // above the cluster chance the lot decides for itself again
    expect(kindForWith(beside, 0, 0.6 + 0.4 * 0.05, BAL, false, { clusterKind: "house" })).toBe("office");
  });

  it("is only a shop or an office on highway frontage", () => {
    for (const roll of [0, 0.3, 0.7, 0.99]) expect(["shop", "office"]).toContain(kindForWith(beside, 0, roll, BAL, false, { highwayFrontage: true }));
  });

  it("keeps industry off the waterfront", () => {
    expect(kindForWith(beside, 0, WORK, BAL, false, { outer: true, waterfront: true })).toBe("office");
  });

  it("counts industry as a workplace with jobs", () => {
    expect(isKind("industrial")).toBe(true);
    expect(JOBS.industrial).toBeGreaterThan(0);
  });

  const isHome = (k: Kind) => k in RESIDENTS;
  void HOME;
});

describe("zoneOf and zoneNow", () => {
  it("files every kind under its zone", () => {
    for (const k of ["house", "row", "detached", "apartment"] as const) expect(zoneOf(k)).toBe("residential");
    expect(zoneOf("shop")).toBe("commercial");
    expect(zoneOf("office")).toBe("office");
    expect(zoneOf("industrial")).toBe("industrial");
    expect(zoneOf("park")).toBe("park");
    expect(zoneOf("landmark")).toBe("landmark");
  });

  it("rezones homes on an avenue partly to shops, and on a highway wholly to shops and offices", () => {
    expect(zoneNow("residential", 0.2, 4)).toBe("commercial");
    expect(zoneNow("residential", 0.3, 4)).toBe("residential"); // a quarter of the homes on an avenue
    expect(zoneNow("residential", 0.5, 4)).toBe("residential");
    expect(zoneNow("residential", 0.3, 5)).toBe("commercial");
    expect(zoneNow("residential", 0.7, 5)).toBe("office");
    expect(zoneNow("residential", 0.1, 3)).toBe("residential");
    expect(zoneNow("industrial", 0.1, 5)).toBe("industrial");
    expect(zoneNow("park", 0.1, 5)).toBe("park");
  });
});

describe("a cluster neighbour's industry passes industry's own checks (review #4)", () => {
  const beside = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 1 };
  const BAL: Demand = { residents: 100, jobs: 100 };
  it("is not copied onto the waterfront, nor outside the ring away from industry", () => {
    expect(kindForWith(beside, 0, 0.1, BAL, false, { clusterKind: "industrial", outer: true, waterfront: true })).not.toBe("industrial");
    expect(kindForWith(beside, 0, 0.1, BAL, false, { clusterKind: "industrial" })).not.toBe("industrial");
    expect(kindForWith(beside, 0, 0.1, BAL, false, { clusterKind: "industrial", outer: true })).toBe("industrial");
    expect(kindForWith(beside, 0, 0.1, BAL, false, { clusterKind: "industrial", touchesIndustry: true })).toBe("industrial");
  });
});

describe("parks cluster as parks (minor fix)", () => {
  const beside = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 1 };
  const BAL: Demand = { residents: 100, jobs: 100 };
  it("copies a park neighbour once parks are unlocked, and otherwise decides as a home", () => {
    expect(kindForWith(beside, 3_000_000, 0.3, BAL, false, { clusterKind: "park" })).toBe("park");
    expect(kindForWith(beside, 0, 0.3, BAL, false, { clusterKind: "park" })).not.toBe("park");
  });
});
