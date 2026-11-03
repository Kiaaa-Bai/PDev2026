import { describe, expect, it } from "vitest";
import { CITY_RULES_VERSION } from "../src/config";
import { CitySim, cellKey, roadMaskAt, type CityConfig } from "../src/sims/city";
import { kindFor, neighboursAt, UNLOCKS, type Kind } from "../src/sims/kinds";

const cfg: CityConfig = {
  speed: 1,
  steerMin: 40,
  idleStopMs: 300_000,
  slowMs: 10_000,
  lotDelayMs: [20_000, 20_000],
  lotChance: 1,
  tierAgesMs: [300_000, 1_200_000],
  wideRoadAt: 3,
  seed: 1,
};

let nextId = 1;

/** A pointer touches at t and moves by (dx, dy) screen points; (0, 0) is a plain tap. */
function swipe(sim: CitySim, t: number, dx = 0, dy = 0) {
  const id = nextId++;
  sim.advanceTo(t);
  sim.beginStroke(id, t);
  sim.addPoints(id, [{ t, x: 500, y: 500 }]);
  if (dx || dy) sim.addPoints(id, [{ t, x: 500 + dx, y: 500 + dy }]);
  sim.endStroke(id);
}

/** Pushes that point exactly along each heading on screen: E ↘, S ↙, W ↖, N ↗. */
const PUSH = { E: [100, 50], S: [-100, 50], W: [-100, -50], N: [100, -50] } as const;

const roads = (sim: CitySim) => [...sim.road.keys()].sort();

describe("CitySim roller", () => {
  it("stays parked until the first touch", () => {
    const sim = new CitySim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(60_000);
    expect(sim.driven).toBe(0);
    expect(sim.road.size).toBe(0);
  });

  it("drives east one tile a second after a touch, paving as it goes", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(4000);
    expect(sim.driven).toBe(3);
    expect(roads(sim)).toEqual(["0,0", "1,0", "2,0", "3,0"]);
  });

  it("turns at once to the direction the finger moves", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    swipe(sim, 1500, ...PUSH.N);
    sim.advanceTo(4500);
    expect(roads(sim)).toEqual(["0,-1", "0,-2", "0,-3", "0,0"]);
  });

  it("ignores finger jitter smaller than steerMin", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    swipe(sim, 1000, 10, -20);
    sim.advanceTo(3000);
    expect(roads(sim)).toEqual(["0,0", "1,0", "2,0"]);
  });

  it("keeps its heading on a tie between diagonals and never U-turns on one", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    swipe(sim, 1000, 100, 0); // right while heading ↘: east and north tie, east is kept
    expect(sim.roller.dir).toBe(0);
    swipe(sim, 1000, 0, 100); // down: east and south tie, east is kept
    expect(sim.roller.dir).toBe(0);
    swipe(sim, 1000, 0, -100); // up: north and west tie, west is the U-turn
    expect(sim.roller.dir).toBe(3);
  });

  it("steers from points far outside 0–1", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000, ...PUSH.S);
    expect(sim.roller.dir).toBe(1);
    const id = nextId++;
    sim.beginStroke(id, 2000);
    sim.addPoints(id, [{ t: 2000, x: 3000, y: -500 }]);
    sim.addPoints(id, [{ t: 2000, x: 3100, y: -450 }]);
    expect(sim.roller.dir).toBe(0);
  });

  it("parks five minutes after the last touch and moves again on the next", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(1000 + 600_000);
    // 290 tiles at full speed, then 5 while slowing over the last 10 seconds
    expect(sim.driven).toBe(295);
    expect(sim.parked()).toBe(true);
    swipe(sim, 1000 + 700_000);
    sim.advanceTo(1000 + 702_000);
    expect(sim.driven).toBe(297);
    expect(sim.parked()).toBe(false);
  });

  it("slows down over the last slowMs before it parks", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(1000 + 290_000);
    expect(sim.driven).toBe(290);
    sim.advanceTo(1000 + 295_000); // 290 + 5 - 25/20 = 293.75 tiles
    expect(sim.driven).toBe(293);
    expect(sim.parked()).toBe(false);
  });

  it("stops dead at idleStopMs when slowMs is 0", () => {
    const sim = new CitySim({ ...cfg, slowMs: 0 });
    swipe(sim, 1000);
    sim.advanceTo(1000 + 600_000);
    expect(sim.driven).toBe(300);
  });

  it("covers half the distance when it slows for the whole wait", () => {
    const sim = new CitySim({ ...cfg, idleStopMs: 30_000, slowMs: 30_000 });
    swipe(sim, 0);
    sim.advanceTo(15_000); // 15 - 225/60 = 11.25 tiles
    expect(sim.driven).toBe(11);
    sim.advanceTo(60_000);
    expect(sim.driven).toBe(15);
    expect(sim.parked()).toBe(true);
  });

  it("times each paved cell by when the slowing roller reached it", () => {
    const sim = new CitySim({ ...cfg, idleStopMs: 30_000, slowMs: 30_000 });
    swipe(sim, 0);
    sim.advanceTo(2000);
    // (1,0) is reached at 30000 * (1 - sqrt(1 - 2/30)) ≈ 1017 ms, so its lot at (1,1) is ready 20 s later
    expect(sim.houseTier(1, 1, 21_010)).toBe(0);
    expect(sim.houseTier(1, 1, 21_020)).toBe(1);
  });

  const sameCityAnyFrameRate = (over: Partial<CityConfig>) => {
    const run = (step: number) => {
      const sim = new CitySim({ ...cfg, lotChance: 0.5, lotDelayMs: [20_000, 120_000], seed: 9, ...over });
      sim.distance = 3_000_000; // every kind unlocked
      const turns: [number, readonly [number, number]][] = [
        [1000, [0, 0]],
        [3200, PUSH.S],
        [5700, PUSH.W],
        [9100, PUSH.N],
      ];
      let t = 0;
      for (const [tt, [dx, dy]] of turns) {
        for (; t < tt; t += step) sim.advanceTo(t);
        swipe(sim, tt, dx, dy);
      }
      for (; t < 20_000; t += step) sim.advanceTo(t);
      sim.advanceTo(20_000);
      return { roads: roads(sim), lots: [...sim.lots.entries()].sort(), kinds: [...sim.kinds.entries()].sort() };
    };
    const a = run(16);
    const b = run(5000);
    expect(a.roads).toEqual(b.roads);
    expect(a.kinds).toEqual(b.kinds);
    // the lots are the same cells; their times may differ in the last bit, since the roller's position is summed in different steps
    expect(a.lots.map(([k]) => k)).toEqual(b.lots.map(([k]) => k));
    a.lots.forEach(([k, ready], i) => expect(ready, k).toBeCloseTo(b.lots[i][1], 6));
  };

  it("grows the same city whatever the frame rate", () => sameCityAnyFrameRate({}));

  it("grows the same city whatever the frame rate while slowing", () =>
    sameCityAnyFrameRate({ idleStopMs: 4000, slowMs: 4000 }));
});

describe("CitySim distance", () => {
  const stroke = (sim: CitySim, id: number, t: number, pts: [number, number][]) =>
    sim.addPoints(id, pts.map(([x, y]) => ({ t, x, y })));

  it("sums pointer distance in points", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    stroke(sim, 1, 0, [[0, 0], [30, 40], [30, 100]]);
    sim.endStroke(1);
    expect(sim.distance).toBe(110);
  });

  it("counts moves too short to steer", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    stroke(sim, 1, 0, [[0, 0], [10, 0], [20, 0], [30, 0]]);
    expect(sim.distance).toBe(30);
    expect(sim.roller.dir).toBe(0);
  });

  it("adds nothing for the first point of a stroke, and starts over on a new stroke", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    stroke(sim, 1, 0, [[0, 0], [3, 4]]);
    expect(sim.distance).toBe(5);
    sim.endStroke(1);
    sim.beginStroke(1, 100);
    stroke(sim, 1, 100, [[900, 900], [900, 910]]); // far from the old stroke's end
    expect(sim.distance).toBe(15);
    sim.beginStroke(1, 200); // a stroke that never ended
    stroke(sim, 1, 200, [[0, 0], [0, 7]]);
    expect(sim.distance).toBe(22);
  });

  it("keeps each pointer's path apart", () => {
    const sim = new CitySim(cfg);
    sim.beginStroke(1, 0);
    sim.beginStroke(2, 0);
    stroke(sim, 1, 0, [[0, 0]]);
    stroke(sim, 2, 0, [[1000, 1000]]);
    stroke(sim, 1, 1, [[30, 40]]);
    stroke(sim, 2, 1, [[1000, 1010]]);
    stroke(sim, 1, 2, [[30, 100]]);
    expect(sim.distance).toBe(50 + 10 + 60);
  });
});

describe("CitySim houses", () => {
  it("puts a house beside new road once its delay has passed", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(2500);
    expect(sim.houseTier(0, 1, 20_999)).toBe(0);
    expect(sim.houseTier(0, 1, 21_000)).toBe(1);
  });

  it("grows a house with age", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(2500);
    expect(sim.houseTier(0, -1, 21_000 + 300_000)).toBe(2);
    expect(sim.houseTier(0, -1, 21_000 + 1_200_000)).toBe(3);
  });

  it("paves over a house in its way", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000, ...PUSH.S); // south at once, through the lot at (0,1)
    sim.advanceTo(2500);
    expect(sim.road.has("0,1")).toBe(true);
    expect(sim.houseTier(0, 1, 100_000)).toBe(0);
  });

  it("grows houses faster beside road that was driven twice", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000); // east to (2,0) by 3000
    swipe(sim, 3000, ...PUSH.S); // south to (2,1)
    swipe(sim, 4000, ...PUSH.W); // west to (1,1)
    swipe(sim, 5000, ...PUSH.N); // north, back over (1,0) at 6000
    sim.advanceTo(6500);
    expect(sim.road.get("1,0")).toBe(2);
    // (1,-1) sits beside the twice-driven (1,0); (0,-1) only beside (0,0)
    expect(sim.houseTier(1, -1, 122_000)).toBe(2);
    expect(sim.houseTier(0, -1, 122_000)).toBe(1);
  });

  it("counts the houses that are up", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(2500);
    expect(sim.houses(21_000)).toBe(3);
  });
});

describe("CitySim kinds", () => {
  const unlockAt = (kind: Kind) => UNLOCKS.find((u) => u.kind === kind)!.at;
  const kinds = (sim: CitySim) => [...sim.kinds.entries()].sort();
  const kindsAt = (sim: CitySim, ...at: [number, number][]) => at.map(([x, y]) => sim.lotKind(x, y));
  /** A city with `distance` already driven, whose first touch paves (0, 0) beside the road and lots given. */
  function startWith(distance: number, road: [number, number, number?][] = [], lots: [number, number][] = []) {
    const sim = new CitySim(cfg);
    sim.distance = distance;
    for (const [x, y, n = 1] of road) sim.road.set(cellKey(x, y), n);
    for (const [x, y] of lots) sim.lots.set(cellKey(x, y), 0);
    swipe(sim, 1000);
    return sim;
  }
  /** Drives a winding path of re-driven streets, so lots come up beside corners, rows, and wide road. */
  function wander(sim: CitySim, pushes = 160, each?: () => void) {
    // the strokes add distance; hold it where it started, so what is unlocked stays as the test set it
    const held = sim.distance;
    const headings = [PUSH.E, PUSH.E, PUSH.S, PUSH.W, PUSH.W, PUSH.N, PUSH.E, PUSH.S, PUSH.S, PUSH.W, PUSH.N, PUSH.N];
    let t = 1000;
    for (let i = 0; i < pushes; i++) {
      t += 2500 + (i % 3) * 2000;
      swipe(sim, t, ...headings[(i * 5) % headings.length]);
      sim.distance = held;
      each?.();
    }
    sim.advanceTo(t + 60_000);
    each?.();
  }
  const wild: CityConfig = { ...cfg, lotChance: 0.5, lotDelayMs: [3_000, 15_000], seed: 5 };

  it("bumps the rules version, since kinds change what a city grows", () => {
    expect(CITY_RULES_VERSION).toBe(3);
  });

  it("gives every lot a kind, stored apart from the time its house appears", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(3500);
    expect(sim.lots.size).toBeGreaterThan(4);
    for (const [k, ready] of sim.lots) {
      expect(typeof ready).toBe("number");
      expect(sim.kinds.has(k), k).toBe(true);
    }
    expect(sim.kinds.size).toBe(sim.lots.size);
    expect(sim.lotKind(0, -1)).toBe(sim.kinds.get("0,-1"));
    expect(sim.lotKind(50, 50)).toBeUndefined();
    expect(sim.lotKind(0, 0)).toBeUndefined(); // a road, not a lot
  });

  it("starts out with detached houses at the head of a road and houses behind them", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(3500);
    // the first lot on each side has nothing beside it, the next ones have the lot behind
    expect(kindsAt(sim, [0, -1], [0, 1])).toEqual(["detached", "detached"]);
    expect(kindsAt(sim, [1, -1], [2, -1], [1, 1], [2, 1])).toEqual(["house", "house", "house", "house"]);
  });

  it("makes a lot between two lots along its road a row", () => {
    const sim = startWith(0, [], [[-1, -1], [1, -1]]);
    expect(sim.lotKind(0, -1)).toBe("row");
  });

  it("makes a lot beside road on two sides a shop once shops are unlocked, and a house before", () => {
    // a road already at (1, 1): the lots at (1, 0) and (0, 1) touch it and the new road at (0, 0)
    const before = startWith(unlockAt("shop") - 1, [[1, 1]]);
    expect(kindsAt(before, [1, 0], [0, 1])).toEqual(["house", "house"]);
    const after = startWith(unlockAt("shop"), [[1, 1]]);
    expect(kindsAt(after, [1, 0], [0, 1])).toEqual(["shop", "shop"]);
  });

  it("does not count a road beside the lot as a lot", () => {
    const sim = startWith(0, [[1, 1]]);
    // (1, 0) has road to the west and south: a corner, and no lots along its street (they would be north and south)
    const n = neighboursAt((x, y) => sim.hasRoad(x, y), (x, y) => sim.lots.has(cellKey(x, y)), 1, 0);
    expect(n).toMatchObject({ roadSides: 2, cornerRoads: true });
  });

  it("makes parks from a share of the plain houses once parks are unlocked, and none before", () => {
    const run = (distance: number) => {
      const sim = new CitySim({ ...cfg, idleStopMs: 400_000, slowMs: 10_000 });
      sim.distance = distance;
      swipe(sim, 0);
      sim.advanceTo(300_000);
      return [...sim.kinds.values()];
    };
    const before = run(unlockAt("park") - 1);
    expect(before.length).toBeGreaterThan(300);
    expect(before).not.toContain("park");
    const after = run(unlockAt("park"));
    const share = after.filter((k) => k === "park").length / after.filter((k) => k === "park" || k === "house").length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.25);
  });

  it("gives out nothing before its distance", () => {
    for (const { kind, at } of UNLOCKS) {
      const sim = new CitySim(wild);
      sim.distance = at - 1;
      wander(sim);
      expect([...sim.kinds.values()], kind).not.toContain(kind);
      expect(sim.landmarkPlaced).toBe(false);
    }
  });

  it("makes the same roads and lots whatever the distance: only the kinds depend on it", () => {
    const run = (distance: number) => {
      const sim = new CitySim(wild);
      sim.distance = distance;
      wander(sim);
      return sim;
    };
    const none = run(0);
    const all = run(unlockAt("landmark"));
    expect([...all.road]).toEqual([...none.road]);
    expect([...all.lots]).toEqual([...none.lots]);
    expect(all.lots.size).toBeGreaterThan(100);
    expect(kinds(all)).not.toEqual(kinds(none));
  });

  it("gives out every kind once all are unlocked", () => {
    const sim = new CitySim(wild);
    sim.distance = unlockAt("landmark");
    wander(sim);
    expect([...new Set(sim.kinds.values())].sort()).toEqual(["apartment", "detached", "landmark", "park", "row", "shop"]);
  });

  it("keeps a lot's kind when neighbours arrive later", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000); // east, lots all along both sides
    sim.advanceTo(3500);
    swipe(sim, 3500, ...PUSH.W); // and back west past the start, so (-1, -1) gets its lot
    sim.advanceTo(8000);
    expect(sim.road.has("-1,0")).toBe(true);
    expect(sim.lots.has("-1,-1")).toBe(true);
    // (0, -1) now has a lot on each side along its street, which would make it a row ...
    const now = neighboursAt((x, y) => sim.hasRoad(x, y), (x, y) => sim.lots.has(cellKey(x, y)), 0, -1);
    expect(now.lotsAlongRoad).toBe(2);
    expect(kindFor(now, 0, 0.9)).toBe("row");
    // ... but it was made detached, and stays so
    expect(sim.lotKind(0, -1)).toBe("detached");
  });

  it("keeps every lot's kind when more distance unlocks new kinds", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000);
    sim.advanceTo(3500);
    const before = kinds(sim);
    expect(new Set(before.map(([, kind]) => kind))).toEqual(new Set(["detached", "house"]));
    sim.distance = unlockAt("landmark");
    swipe(sim, 3500, ...PUSH.S);
    sim.advanceTo(9000);
    const kept = before.filter(([k]) => sim.lots.has(k)); // the roller flattens the lots in its way
    expect(kept.length).toBeGreaterThan(4);
    for (const [k, kind] of kept) expect(sim.kinds.get(k), k).toBe(kind);
    expect(new Set(sim.kinds.values()).size).toBeGreaterThan(2); // and the new lots take the new kinds
  });

  it("forgets a lot's kind when the roller paves over it", () => {
    const sim = new CitySim(cfg);
    swipe(sim, 1000, ...PUSH.S);
    sim.advanceTo(2500);
    expect(sim.road.has("0,1")).toBe(true);
    expect(sim.lotKind(0, 1)).toBeUndefined();
    expect(sim.kinds.size).toBe(sim.lots.size);
  });

  describe("the landmark", () => {
    it("is the first new lot beside road driven three times, once it is unlocked", () => {
      // road at (1, 1) already driven three times: the new lots at (1, 0) and (0, 1) both touch it
      const sim = startWith(unlockAt("landmark"), [[1, 1, 3]]);
      expect(sim.lotKind(1, 0)).toBe("landmark"); // made first, in the order east, south, west, north
      expect(sim.landmarkPlaced).toBe(true);
      expect(sim.lotKind(0, 1)).toBe("shop"); // a corner lot, and the landmark is taken
    });

    it("is not placed before it is unlocked, nor beside road driven only twice", () => {
      const early = startWith(unlockAt("landmark") - 1, [[1, 1, 3]]);
      expect([...early.kinds.values()]).not.toContain("landmark");
      expect(early.landmarkPlaced).toBe(false);
      const twice = startWith(unlockAt("landmark"), [[1, 1, 2]]);
      expect([...twice.kinds.values()]).not.toContain("landmark");
      expect(twice.landmarkPlaced).toBe(false);
    });

    it("is the only one: a later lot beside wide road is an ordinary one", () => {
      // two stretches of wide road: the first lot beside either becomes the landmark, the second does not
      const sim = startWith(unlockAt("landmark"), [[1, 1, 3], [1, -2, 3]]);
      swipe(sim, 1000, ...PUSH.N); // away from the first, towards the second: (1, -1) touches it
      sim.advanceTo(4000);
      expect(sim.lotKind(1, 0)).toBe("landmark");
      expect(sim.lotKind(1, -1)).toBeDefined();
      expect(sim.lotKind(1, -1)).not.toBe("landmark");
      expect([...sim.kinds.values()].filter((k) => k === "landmark")).toHaveLength(1);
    });

    it("rises again when the roller flattens it: a later qualifying lot becomes the landmark", () => {
      const sim = startWith(unlockAt("landmark"), [[1, 1, 3]]);
      expect(sim.lotKind(1, 0)).toBe("landmark");
      sim.advanceTo(2500); // east over (1, 0), which was the landmark's lot
      expect(sim.road.has("1,0")).toBe(true);
      expect(sim.lotKind(1, 0)).toBeUndefined();
      expect([...sim.kinds.values()]).not.toContain("landmark");
      expect(sim.landmarkPlaced).toBe(false);
      sim.advanceTo(5000); // on to (2, 0): the lot at (2, 1) touches the wide road at (1, 1) too
      expect(sim.lotKind(2, 1)).toBe("landmark");
      expect(sim.landmarkPlaced).toBe(true);
      expect([...sim.kinds.values()].filter((k) => k === "landmark")).toHaveLength(1);
    });

    it("keeps the flag only while a landmark stands, so there is never more than one", () => {
      let replaced = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const sim = new CitySim({ ...wild, seed });
        sim.distance = unlockAt("landmark");
        sim.road.set("1,1", 3); // the first lot beside it, ahead of the roller, becomes the landmark and is soon flattened
        let standingAt: string | null = null;
        wander(sim, 160, () => {
          const standing = [...sim.kinds.entries()].filter(([, k]) => k === "landmark").map(([cell]) => cell);
          expect(standing.length, `seed ${seed}`).toBeLessThanOrEqual(1);
          expect(sim.landmarkPlaced, `seed ${seed}`).toBe(standing.length === 1);
          if (standing[0] && standingAt && standing[0] !== standingAt) replaced++; // a flattened landmark, built again elsewhere
          standingAt = standing[0] ?? standingAt;
        });
      }
      // across these drives the roller did flatten a landmark and a later lot took its place
      expect(replaced).toBeGreaterThan(0);
    });

    it("leaves lots made before the unlock as they were", () => {
      const sim = new CitySim(cfg);
      sim.road.set("1,1", 3);
      swipe(sim, 1000); // lots are made beside the new road, nothing unlocked
      const before = kinds(sim);
      expect(before.map(([, k]) => k)).not.toContain("landmark");
      sim.distance = unlockAt("landmark");
      swipe(sim, 3000, ...PUSH.S);
      sim.advanceTo(8000);
      const kept = before.filter(([k]) => sim.lots.has(k));
      expect(kept.length).toBeGreaterThan(1);
      for (const [k, kind] of kept) expect(sim.kinds.get(k), k).toBe(kind);
    });
  });
});

describe("CitySim snapshot", () => {
  /** Forty swipes that turn or just tap, with gaps long enough for the roller to park partway between cells. */
  const script = (() => {
    const headings = [PUSH.E, PUSH.S, PUSH.W, PUSH.N, PUSH.S, PUSH.E, PUSH.N];
    let t = 1000;
    return Array.from({ length: 40 }, (_, i) => {
      t += 2000 + (i % 5) * 4000;
      return { t, push: i % 4 === 3 ? ([0, 0] as const) : headings[(i * 3) % headings.length] };
    });
  })();
  /** Plays swipes `from` up to `to` of the script, always whole swipes. */
  const swipes = (sim: CitySim, from: number, to: number) => {
    for (const { t, push } of script.slice(from, to)) swipe(sim, t, ...push);
  };
  const busy: CityConfig = { ...cfg, idleStopMs: 6000, slowMs: 3000, lotChance: 0.5, lotDelayMs: [20_000, 120_000], seed: 9 };
  const state = (sim: CitySim) => ({
    road: [...sim.road.entries()].sort(),
    lots: [...sim.lots.entries()].sort(),
    kinds: [...sim.kinds.entries()].sort(),
    landmarkPlaced: sim.landmarkPlaced,
    roller: sim.roller,
    driven: sim.driven,
    distance: sim.distance,
    time: sim.time(),
    parked: sim.parked(),
  });
  const throughJson = (s: unknown) => JSON.parse(JSON.stringify(s));

  it("snapshot plus later records equals full replay", () => {
    // every kind unlocked from the start, so the kinds, the park rolls and the landmark all take part
    const whole = new CitySim(busy);
    whole.distance = 3_000_000;
    swipes(whole, 0, 40);
    whole.advanceTo(400_000);

    const first = new CitySim(busy);
    first.distance = 3_000_000;
    swipes(first, 0, 20);
    const restored = CitySim.restore(busy, throughJson(first.snapshot()))!;
    expect(restored).not.toBeNull();
    swipes(restored, 20, 40);
    restored.advanceTo(400_000);

    expect(whole.road.size).toBeGreaterThan(20);
    expect(whole.lots.size).toBeGreaterThan(10);
    expect(new Set(whole.kinds.values()).size).toBeGreaterThan(3);
    expect(state(restored)).toEqual(state(whole));
  });

  it("picks up between two cells where it left off", () => {
    const flat = { ...busy, slowMs: 0 };
    const sim = new CitySim(flat);
    swipe(sim, 1000);
    sim.advanceTo(3500);
    expect(sim.roller.progress).toBeCloseTo(0.5);
    const restored = CitySim.restore(flat, throughJson(sim.snapshot()))!;
    for (const s of [sim, restored]) s.advanceTo(5000);
    expect(roads(restored)).toEqual(["0,0", "1,0", "2,0", "3,0", "4,0"]);
    expect(state(restored)).toEqual(state(sim));
  });

  it("round-trips a city that was never touched", () => {
    const sim = new CitySim(busy);
    const restored = CitySim.restore(busy, throughJson(sim.snapshot()))!;
    expect(restored.parked()).toBe(true);
    expect(restored.time()).toBe(0);
    swipes(sim, 0, 5);
    swipes(restored, 0, 5);
    expect(state(restored)).toEqual(state(sim));
  });

  it("ignores a snapshot from another rules version", () => {
    const sim = new CitySim(busy);
    swipes(sim, 0, 5);
    const snap = sim.snapshot();
    expect(snap.rules).toBe(CITY_RULES_VERSION);
    expect(CitySim.restore(busy, { ...snap, rules: CITY_RULES_VERSION + 1 })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, rules: CITY_RULES_VERSION - 1 })).toBeNull();
    const { rules: _gone, ...noRules } = snap;
    expect(CitySim.restore(busy, noRules)).toBeNull();
  });

  it("carries the kinds and whether the landmark is placed", () => {
    const sim = new CitySim({ ...busy, lotChance: 1 });
    sim.distance = 3_000_000;
    sim.road.set("1,1", 3); // wide road beside the lot at (1, 0)
    swipe(sim, 1000);
    sim.advanceTo(1500); // before the roller drives over that lot
    expect(sim.lotKind(1, 0)).toBe("landmark");
    expect(sim.landmarkPlaced).toBe(true);
    const snap = throughJson(sim.snapshot());
    expect(snap.kinds.length).toBe(sim.lots.size);
    expect(snap.landmark).toBe(true);
    expect(snap.kinds).toContainEqual(["1,0", "landmark"]);
    const restored = CitySim.restore(busy, snap)!;
    expect(restored.kinds).toEqual(sim.kinds);
    expect(restored.landmarkPlaced).toBe(true);
    expect(restored.lotKind(1, 0)).toBe("landmark");
    const fresh = throughJson(new CitySim(busy).snapshot());
    expect(fresh.kinds).toEqual([]);
    expect(fresh.landmark).toBe(false);
  });

  it("ignores broken snapshot text", () => {
    const sim = new CitySim(busy);
    swipes(sim, 0, 5);
    const snap = throughJson(sim.snapshot());
    expect(CitySim.restore(busy, { rules: CITY_RULES_VERSION, road: 5 })).toBeNull();
    for (const bad of [null, undefined, 5, "{}", [], {}]) expect(CitySim.restore(busy, bad)).toBeNull();
    expect(CitySim.restore(busy, { ...snap, lots: [["0,1"]] })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, road: [["0,0", null]] })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, roller: { ...snap.roller, dir: 7 } })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, started: "yes" })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, rng: "seed" })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, clock: "now" })).toBeNull();
    // the kinds must be there, be real kinds, and cover every lot
    const { kinds: _kinds, ...noKinds } = snap;
    expect(CitySim.restore(busy, noKinds)).toBeNull();
    expect(CitySim.restore(busy, { ...snap, kinds: "house" })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, kinds: [["0,1", "tower"]] })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, kinds: [["0,1", 3]] })).toBeNull();
    expect(CitySim.restore(busy, { ...snap, kinds: snap.kinds.slice(1) })).toBeNull();
    const { landmark: _landmark, ...noLandmark } = snap;
    expect(CitySim.restore(busy, noLandmark)).toBeNull();
    expect(CitySim.restore(busy, { ...snap, landmark: 1 })).toBeNull();
    expect(CitySim.restore(busy, snap)).not.toBeNull();
  });
});

describe("roadMaskAt", () => {
  it("encodes road neighbours as N=1 E=2 S=4 W=8", () => {
    const set = new Set(["0,-1", "1,0", "0,1", "-1,0", "0,0"]);
    const has = (x: number, y: number) => set.has(`${x},${y}`);
    expect(roadMaskAt(has, 0, 0)).toBe(15);
    expect(roadMaskAt(has, 0, -1)).toBe(4);
    expect(roadMaskAt(has, 5, 5)).toBe(0);
  });
});
