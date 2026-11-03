import { describe, expect, it } from "vitest";
import { isKind, isUnlocked, kindFor, neighboursAt, PARK_CHANCE, UNLOCKS, type Kind, type Neighbours } from "../src/sims/kinds";

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

describe("UNLOCKS", () => {
  it("lists parks, then shops, then apartments, then the landmark, at the agreed distances", () => {
    expect(UNLOCKS).toEqual([
      { kind: "park", at: 200_000 },
      { kind: "shop", at: 600_000 },
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
    for (const kind of ["house", "row", "detached"] as const) expect(isUnlocked(kind, 0)).toBe(true);
  });

  it("names exactly the seven kinds", () => {
    for (const k of ["house", "row", "detached", "park", "shop", "apartment", "landmark"]) expect(isKind(k)).toBe(true);
    for (const k of ["", "tower", "House", 3, null, undefined]) expect(isKind(k)).toBe(false);
  });
});

describe("kindFor", () => {
  const beside = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 1 };
  const corner = { roadSides: 2, cornerRoads: true, lotsAlongRoad: 1 };

  it("makes a corner lot a shop once shops are unlocked, and a house before", () => {
    expect(kindFor(corner, at("shop") - 1, 0.9)).toBe("house");
    expect(kindFor(corner, at("shop"), 0.9)).toBe("shop");
  });

  it("lets a corner beat row, detached and the park roll", () => {
    for (const lotsAlongRoad of [0, 1, 2]) {
      for (const roll of ROLLS) expect(kindFor({ ...corner, lotsAlongRoad }, at("shop"), roll)).toBe("shop");
    }
    // and before shops unlock a corner is a house, not a row or a detached house
    expect(kindFor({ ...corner, lotsAlongRoad: 0 }, 0, 0.5)).toBe("house");
    expect(kindFor({ ...corner, lotsAlongRoad: 2 }, 0, 0.5)).toBe("house");
  });

  it("makes a lot with lots on both sides along its road a row, whatever is unlocked", () => {
    const between = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 2 };
    for (const d of [0, at("park"), at("shop"), at("apartment"), at("landmark")]) {
      for (const roll of ROLLS) expect(kindFor(between, d, roll)).toBe("row");
    }
  });

  it("makes a lot with no lots along its road a detached house, whatever is unlocked", () => {
    const alone = { roadSides: 1, cornerRoads: false, lotsAlongRoad: 0 };
    for (const d of [0, at("park"), at("shop"), at("apartment"), at("landmark")]) {
      for (const roll of ROLLS) expect(kindFor(alone, d, roll)).toBe("detached");
    }
  });

  it("gives a lot beside one other lot a park when the roll is under 0.15 and parks are unlocked, else a house", () => {
    expect(PARK_CHANCE).toBe(0.15);
    expect(kindFor(beside, at("park"), 0.14)).toBe("park");
    expect(kindFor(beside, at("park"), 0)).toBe("park");
    expect(kindFor(beside, at("park"), 0.15)).toBe("house");
    expect(kindFor(beside, at("park"), 0.99)).toBe("house");
    // before parks unlock a low roll is just a house
    expect(kindFor(beside, at("park") - 1, 0)).toBe("house");
  });

  it("calls the plain house an apartment once apartments are unlocked, and only the plain house", () => {
    expect(kindFor(beside, at("apartment") - 1, 0.9)).toBe("house");
    expect(kindFor(beside, at("apartment"), 0.9)).toBe("apartment");
    expect(kindFor(beside, at("apartment"), 0.01)).toBe("park"); // parks keep their share
    expect(kindFor({ ...beside, lotsAlongRoad: 2 }, at("apartment"), 0.9)).toBe("row");
    expect(kindFor({ ...beside, lotsAlongRoad: 0 }, at("apartment"), 0.9)).toBe("detached");
    expect(kindFor(corner, at("apartment"), 0.9)).toBe("shop");
  });

  it("never gives a kind before its distance", () => {
    for (const { kind, at: d } of UNLOCKS) {
      for (const n of ALL) for (const roll of ROLLS) expect(kindFor(n, d - 1, roll), `${kind} before ${d}`).not.toBe(kind);
    }
  });

  it("never gives the landmark: the city picks that one itself", () => {
    for (const d of [0, at("landmark"), 1e9]) for (const n of ALL) for (const roll of ROLLS) expect(kindFor(n, d, roll)).not.toBe("landmark");
  });

  it("gives each other kind to some neighbourhood once everything is unlocked", () => {
    const seen = new Set<Kind>();
    for (const n of ALL) for (const roll of ROLLS) seen.add(kindFor(n, at("landmark"), roll));
    expect([...seen].sort()).toEqual(["apartment", "detached", "park", "row", "shop"]);
  });

  it("starts out with houses, rows and detached houses only", () => {
    const seen = new Set<Kind>();
    for (const n of ALL) for (const roll of ROLLS) seen.add(kindFor(n, 0, roll));
    expect([...seen].sort()).toEqual(["detached", "house", "row"]);
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
