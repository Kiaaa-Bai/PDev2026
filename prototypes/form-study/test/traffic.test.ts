import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  Budget,
  CAR_LANE,
  CAR_POOL,
  carModelFor,
  KERB,
  laneOffset,
  MAX_CARS,
  MAX_PEOPLE,
  moverPoint,
  PathCache,
  PER_PLACE,
  standingSpot,
  Traffic,
  trafficRadius,
  visibleTrips,
  type Mover,
} from "../src/render/traffic";
import { MODEL_NAMES } from "../src/render/pieces";
import { CitySim, cellKey, type CityConfig, type Dir } from "../src/sims/city";
import { DRIVE_SPEED, positionAt, roadPath, WALK_SPEED, type Cell } from "../src/sims/people";

const HEADINGS: Dir[] = [0, 1, 2, 3];
const street = (x: number, y: number) => y === 0 && x >= 0 && x <= 100;

describe("laneOffset", () => {
  it("puts a car on the right-hand half of the road, whichever way it heads", () => {
    // y runs down the map: a car heading east keeps to the south side, south to the west, west to the north, north to the east
    expect(laneOffset(0, "car")).toEqual([0, CAR_LANE]);
    expect(laneOffset(1, "car")).toEqual([-CAR_LANE, 0]);
    expect(laneOffset(2, "car")).toEqual([0, -CAR_LANE]);
    expect(laneOffset(3, "car")).toEqual([CAR_LANE, 0]);
  });

  it("puts a walker at the kerb on the same side, further out than a car", () => {
    for (const h of HEADINGS) {
      const [cx, cy] = laneOffset(h, "car");
      const [wx, wy] = laneOffset(h, "walk");
      expect(Math.sign(wx)).toBe(Math.sign(cx));
      expect(Math.sign(wy)).toBe(Math.sign(cy));
      expect(Math.hypot(wx, wy)).toBeCloseTo(KERB, 9);
      expect(Math.hypot(cx, cy)).toBeCloseTo(CAR_LANE, 9);
    }
    expect(KERB).toBeGreaterThan(CAR_LANE);
    expect(KERB).toBeLessThan(0.5); // on the road cell
  });

  it("is at right angles to the heading, and opposite for the opposite heading", () => {
    const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const h of HEADINGS) {
      for (const mode of ["car", "walk"] as const) {
        const [ox, oy] = laneOffset(h, mode);
        expect(ox * dir[h][0] + oy * dir[h][1]).toBeCloseTo(0, 9);
        const [px, py] = laneOffset(((h + 2) % 4) as Dir, mode);
        expect(px + ox).toBeCloseTo(0, 9);
        expect(py + oy).toBeCloseTo(0, 9);
      }
    }
  });
});

describe("moverPoint", () => {
  const path: Cell[] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [3, 2]];

  it("is the lane's offset from the path's own position, and null outside the trip", () => {
    const p = moverPoint(path, 0, 1, 500, "car")!;
    const base = positionAt(path, 0, 1, 500)!;
    expect(p.heading).toBe(base.heading);
    expect(p.x).toBeCloseTo(base.x + laneOffset(0, "car")[0], 9);
    expect(p.y).toBeCloseTo(base.y + laneOffset(0, "car")[1], 9);
    expect(moverPoint(path, 1000, 1, 0, "car")).toBeNull();
    expect(moverPoint(path, 0, 1, 5000, "car")).toBeNull();
  });

  it("moves without jumping, round a corner too: lanes blend over the cell either side", () => {
    let last = moverPoint(path, 0, 1, 0, "car")!;
    for (let ms = 10; ms < 4990; ms += 10) {
      const p = moverPoint(path, 0, 1, ms, "car")!;
      // a step of 10 ms at one cell a second is 0.01 cells; blending the lane adds at most a little more
      expect(Math.hypot(p.x - last.x, p.y - last.y), `at ${ms} ms`).toBeLessThan(0.02);
      last = p;
    }
  });

  it("goes through the middle of the road when it turns round at the end of a path", () => {
    const there: Cell[] = [[0, 0], [1, 0], [0, 0]];
    const p = moverPoint(there, 0, 1, 1000, "walk")!; // at the far end, about to head back
    expect(Math.abs(p.y)).toBeLessThan(KERB / 2 + 1e-9);
  });
});

describe("visibleTrips", () => {
  /** n movers along a road at distinct spots: walkers on short paths, cars on long ones. */
  function crowd(cars: number, walkers: number): Mover[] {
    const out: Mover[] = [];
    for (let i = 0; i < cars; i++) {
      out.push({ who: i + 1, path: Array.from({ length: 41 }, (_, k): Cell => [k, -(i % 20)]), depart: 0, speed: DRIVE_SPEED, mode: "car" });
    }
    for (let i = 0; i < walkers; i++) {
      out.push({ who: 10_000 + i, path: Array.from({ length: 9 }, (_, k): Cell => [k, i % 30]), depart: 0, speed: WALK_SPEED, mode: "walk" });
    }
    return out;
  }
  const caps = { cars: MAX_CARS, people: MAX_PEOPLE };

  it("caps cars at 400 and people at 600, keeping the ones nearest the centre", () => {
    const seen = visibleTrips(crowd(1000, 1500), 1000, [4, 0], 200, caps);
    const cars = seen.filter((s) => s.mode === "car");
    const walkers = seen.filter((s) => s.mode === "walk");
    expect(cars).toHaveLength(MAX_CARS);
    expect(walkers).toHaveLength(MAX_PEOPLE);
    // nobody left out is nearer than somebody kept
    const all = visibleTrips(crowd(1000, 1500), 1000, [4, 0], 200, { cars: Infinity, people: Infinity });
    const far = (s: { x: number; y: number }) => Math.max(Math.abs(s.x - 4), Math.abs(s.y));
    const keptCars = new Set(cars.map((s) => s.who));
    const worstKept = Math.max(...cars.map(far));
    for (const s of all) if (s.mode === "car" && !keptCars.has(s.who)) expect(far(s)).toBeGreaterThanOrEqual(worstKept - 1e-9);
  });

  it("draws nobody outside the radius, nobody before departing and nobody who has arrived", () => {
    const movers = crowd(10, 10);
    for (const s of visibleTrips(movers, 1000, [0, 0], 3, caps)) expect(Math.max(Math.abs(s.x), Math.abs(s.y))).toBeLessThanOrEqual(3);
    expect(visibleTrips(movers, -5, [0, 0], 500, caps)).toEqual([]);
    expect(visibleTrips(movers, 1e9, [0, 0], 500, caps)).toEqual([]);
  });

  it("takes the mode from the mover and gives each its position and heading", () => {
    const path = Array.from({ length: 11 }, (_, k): Cell => [k, 0]);
    const [one] = visibleTrips([{ who: 5, path, depart: 0, speed: 1, mode: "walk" } as Mover], 3000, [0, 0], 99, caps);
    expect(one).toMatchObject({ who: 5, mode: "walk", heading: 0 });
    expect(one.x).toBeCloseTo(3, 1);
  });

  it("is the same for the same input, whatever order the movers come in", () => {
    const m = crowd(30, 30);
    const a = visibleTrips(m, 1000, [4, 0], 200, { cars: 10, people: 10 });
    const b = visibleTrips([...m].reverse(), 1000, [4, 0], 200, { cars: 10, people: 10 });
    expect(b).toEqual(a);
  });
});

describe("PathCache", () => {
  const a: Cell = [5, -1];
  const b: Cell = [40, 1];
  const never = new Budget(Infinity, () => 0);

  it("finds a way once and then answers from memory", () => {
    let searches = 0;
    const cache = new PathCache((x, y) => (searches++, street(x, y)));
    const first = cache.resolve(a, b, never)!;
    const spent = searches;
    expect(spent).toBeGreaterThan(0);
    expect(cache.resolve(a, b, never)).toBe(first);
    expect(searches).toBe(spent);
    expect(first).toEqual(roadPath(street, a, b));
  });

  it("sends a return leg the way it came, reversed, without searching", () => {
    let searches = 0;
    const cache = new PathCache((x, y) => (searches++, street(x, y)));
    const out = cache.resolve(a, b, never)!;
    const spent = searches;
    const back = cache.resolve(b, a, never)!;
    expect(searches).toBe(spent);
    expect(back).toEqual([...out].reverse());
  });

  it("remembers that there is no way, and does not search for it again", () => {
    let searches = 0;
    const cache = new PathCache((x, y) => (searches++, street(x, y)));
    const lonely: Cell = [5, 30]; // no road beside it
    expect(cache.resolve(a, lonely, never)).toBeNull();
    const spent = searches;
    expect(cache.resolve(a, lonely, never)).toBeNull();
    expect(cache.resolve(lonely, a, never)).toBeNull(); // and the other way round
    expect(searches).toBe(spent);
  });

  it("searches again when the city changes for a way that was missing: it may have been built since", () => {
    let roadEnd = 20;
    const isRoad = (x: number, y: number) => y === 0 && x >= 0 && x <= roadEnd;
    const cache = new PathCache(isRoad);
    cache.sync(1);
    expect(cache.resolve([2, -1], [40, 1], never)).toBeNull(); // the road stops short of the goal
    roadEnd = 100;
    expect(cache.resolve([2, -1], [40, 1], never)).toBeNull(); // same version: still the old answer
    cache.sync(2);
    expect(cache.resolve([2, -1], [40, 1], never)).not.toBeNull();
  });

  it("keeps a way it found for good: roads are never taken away, so growth does not spoil it, and nothing is searched again", () => {
    let calls = 0;
    const cache = new PathCache((x, y) => (calls++, street(x, y)));
    cache.sync(1);
    const first = cache.resolve(a, b, never)!;
    cache.sync(2);
    calls = 0;
    expect(cache.resolve(a, b, new Budget(0, () => 0))).toBe(first); // out of time: still there
    expect(cache.resolve(a, b, never)).toBe(first);
    expect(cache.resolve(b, a, never)).toEqual([...first].reverse());
    expect(calls).toBe(0);
  });

  it("asks again for a missing way when the city has grown, but out of time it answers 'none' rather than searching", () => {
    let roadEnd = 20;
    let calls = 0;
    const cache = new PathCache((x, y) => (calls++, y === 0 && x >= 0 && x <= roadEnd));
    cache.sync(1);
    expect(cache.resolve([2, -1], [40, 1], never)).toBeNull();
    roadEnd = 100;
    cache.sync(2);
    calls = 0;
    expect(cache.resolve([2, -1], [40, 1], new Budget(0, () => 0))).toBeNull();
    expect(calls).toBe(0);
    expect(cache.resolve([2, -1], [40, 1], never)).not.toBeNull();
  });

  it("has no answer for a way it has never seen when out of time, and does not search", () => {
    let calls = 0;
    const cache = new PathCache((x, y) => (calls++, street(x, y)));
    expect(cache.resolve(a, b, new Budget(0, () => 0))).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("spreads new searches over frames so that one frame spends at most its budget", () => {
    // every search "takes" 2 ms on a fake clock; a frame has 5 ms
    let now = 0;
    const isRoad = (x: number, y: number) => {
      return street(x, y);
    };
    const cache = new PathCache(isRoad);
    const timed = {
      resolve: (from: Cell, to: Cell, budget: Budget) => {
        const r = cache.resolve(from, to, budget);
        if (r !== undefined && !timed.seen.has(`${from}>${to}`)) {
          timed.seen.add(`${from}>${to}`);
          now += 2;
        }
        return r;
      },
      seen: new Set<string>(),
    };
    const wanted: [Cell, Cell][] = Array.from({ length: 12 }, (_, i) => [[i + 1, -1], [i + 30, 1]]);
    const frames: number[] = [];
    let todo = wanted;
    for (let frame = 0; frame < 20 && todo.length > 0; frame++) {
      const budget = new Budget(5, () => now);
      const before = now;
      const rest: [Cell, Cell][] = [];
      for (const [f, t] of todo) if (timed.resolve(f, t, budget) === undefined) rest.push([f, t]);
      frames.push(now - before);
      todo = rest;
      now += 16; // the frame ends
    }
    expect(todo).toEqual([]); // all of them done in the end
    expect(frames.length).toBeGreaterThan(2); // ... but not in one frame
    for (const spent of frames) expect(spent).toBeLessThanOrEqual(6); // a frame goes at most one search over
  });

  it("forgets everything when asked", () => {
    let calls = 0;
    const cache = new PathCache((x, y) => (calls++, street(x, y)));
    cache.resolve(a, b, never);
    cache.clear();
    calls = 0;
    cache.resolve(a, b, never);
    expect(calls).toBeGreaterThan(0);
    expect(cache.size).toBeGreaterThan(0);
  });
});

describe("standingSpot", () => {
  const isRoad = (x: number, y: number) => y === 1 && x >= -5 && x <= 5; // a street along y = 1
  it("stands just outside the lot, on its street's kerb", () => {
    for (let who = 1; who < 50; who++) {
      const s = standingSpot(isRoad, [0, 0], who, 42)!;
      expect(s.y).toBeGreaterThan(1 - 0.5); // inside the road cell, on the near side (the lot is to the north)
      expect(s.y).toBeLessThan(1);
      expect(s.y).toBeCloseTo(1 - KERB, 9);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(0.4);
    }
  });

  it("spreads people along the frontage instead of stacking them", () => {
    const xs = new Set(Array.from({ length: 12 }, (_, who) => standingSpot(isRoad, [0, 0], who + 1, 42)!.x.toFixed(3)));
    expect(xs.size).toBeGreaterThan(8);
  });

  it("faces the street the house faces: south, then east, north, west", () => {
    const both = (x: number, y: number) => (x === 1 && y === 0) || (x === 0 && y === 1);
    const s = standingSpot(both, [0, 0], 1, 42)!;
    expect(s.y).toBeCloseTo(1 - KERB, 9); // the road to the south wins over the east one
    const east = standingSpot((x, y) => x === 1 && y === 0, [0, 0], 1, 42)!;
    expect(east.x).toBeCloseTo(1 - KERB, 9);
  });

  it("is nowhere when no road touches the lot", () => {
    expect(standingSpot(() => false, [0, 0], 1, 42)).toBeNull();
  });
});

describe("carModelFor", () => {
  it("gives a service vehicle (negative id) a van, taxi, delivery van or truck, and a resident a private car", () => {
    const service = new Set<string>();
    const private_ = new Set<string>();
    for (let i = 1; i <= 400; i++) {
      service.add(carModelFor(-i, 42));
      private_.add(carModelFor(i * 977, 42));
    }
    expect([...service].sort()).toEqual(["car/delivery", "car/taxi", "car/truck", "car/van"]);
    expect(private_.size).toBeGreaterThanOrEqual(3);
    for (const m of private_) expect(["car/delivery", "car/truck", "car/taxi"]).not.toContain(m);
    for (const m of [...service, ...private_]) expect(CAR_POOL).toContain(m);
  });

  it("is the same for the same person every time", () => {
    expect(carModelFor(12345, 42)).toBe(carModelFor(12345, 42));
    expect(carModelFor(-12345, 7)).toBe(carModelFor(-12345, 7));
  });
});

describe("trafficRadius", () => {
  it("covers the picture at the close-up and is held to a limit zoomed far out", () => {
    expect(trafficRadius(5)).toBeGreaterThanOrEqual(14);
    expect(trafficRadius(5)).toBeLessThan(30);
    expect(trafficRadius(60)).toBeLessThanOrEqual(40);
    expect(trafficRadius(30)).toBeGreaterThan(trafficRadius(5));
  });
});

describe("the car models", () => {
  it("are seven and all in MODEL_NAMES", () => {
    expect(CAR_POOL).toHaveLength(7);
    for (const m of CAR_POOL) expect(MODEL_NAMES).toContain(m);
    expect(new Set(MODEL_NAMES).size).toBe(MODEL_NAMES.length);
  });
});

describe("Traffic", () => {
  const cfg: CityConfig = {
    speed: 1,
    steerMin: 40,
    idleStopMs: 300_000,
    slowMs: 10_000,
    lotDelayMs: [20_000, 20_000],
    lotChance: 1,
    tierAgesMs: [300_000, 1_200_000],
    wideRoadAt: 3,
    seed: 3,
  };
  const DAY = new Date(2026, 10, 3).getTime();
  const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 3, h, m, s).getTime();

  /** A street along y = 0 from x = 0 to 60 with homes on its north side, a shop and a park, an office at the end. */
  function town() {
    const sim = new CitySim(cfg);
    for (let x = 0; x <= 60; x++) sim.road.set(cellKey(x, 0), 3);
    const lot = (x: number, y: number, kind: "house" | "apartment" | "shop" | "park" | "office") => {
      sim.lots.set(cellKey(x, y), 0);
      sim.kinds.set(cellKey(x, y), kind);
    };
    for (let x = 0; x <= 40; x += 2) lot(x, -1, x % 4 === 0 ? "apartment" : "house");
    lot(44, -1, "shop");
    lot(46, -1, "park");
    for (let x = 50; x <= 58; x += 2) lot(x, -1, "office");
    sim.version = 1;
    return sim;
  }

  /** A traffic whose background work is queued so a test can run it when it chooses. */
  function make(caps?: { cars: number; people: number }) {
    const scene = new THREE.Scene();
    const models = new Map(CAR_POOL.map((n) => [n, { geo: new THREE.BoxGeometry(1, 1, 2), mat: new THREE.MeshBasicMaterial() }]));
    const queue: (() => void)[] = [];
    let clock = 0;
    const traffic = new Traffic(scene, models, {
      later: (fn) => queue.push(fn),
      perf: () => clock,
      caps,
    });
    const flush = (max = 1000) => {
      for (let i = 0; i < max && queue.length > 0; i++) queue.shift()!();
    };
    return { traffic, scene, flush, queue, tick: (ms: number) => (clock += ms) };
  }

  it("draws nothing before its background work has run, then draws people out and about", () => {
    const sim = town();
    const { traffic, flush } = make();
    const t = new Date(at(13, 0, 0));
    expect(traffic.update(sim, t, [20, 0], 30)).toBe(false);
    expect(traffic.drawn()).toEqual({ cars: 0, people: 0 });
    flush();
    traffic.update(sim, t, [20, 0], 30);
    expect(traffic.drawn().people).toBeGreaterThan(0);
  });

  it("reports motion while somebody walks or drives in view", () => {
    const sim = town();
    const { traffic, flush } = make();
    // at 13:00 people are at the shop and park and strolling: something moves
    const noon = new Date(at(13, 0, 0));
    traffic.update(sim, noon, [20, 0], 40);
    flush();
    expect(traffic.update(sim, noon, [20, 0], 40)).toBe(true);
    expect(traffic.update(sim, new Date(at(13, 0, 1)), [20, 0], 40)).toBe(true);
  });

  it("reports no motion, and draws nothing again, while only people standing about are in view and none has come or gone", () => {
    // a park on a street, apartments around it, and a view no bigger than the park's frontage: the people who stand there, and few passers-by
    const sim = new CitySim(cfg);
    for (let x = 0; x <= 40; x++) sim.road.set(cellKey(x, 0), 3);
    for (let x = 0; x <= 40; x++) {
      sim.lots.set(cellKey(x, -1), 0);
      sim.kinds.set(cellKey(x, -1), x === 20 ? "park" : "apartment");
    }
    sim.version = 1;
    const { traffic, flush } = make();
    let gates = 0;
    for (let m = 10 * 60 + 40; m < 15 * 60 + 40; m++) {
      const t = DAY + m * 60_000;
      traffic.update(sim, new Date(t), [20, 0], 0.6);
      flush();
      traffic.update(sim, new Date(t), [20, 0], 0.6);
      const before = traffic.drawn();
      if (before.cars !== 0 || before.people === 0 || traffic.standing() !== before.people) continue; // somebody walks: not the case
      const first = traffic.update(sim, new Date(t + 300), [20, 0], 0.6);
      const second = traffic.update(sim, new Date(t + 600), [20, 0], 0.6);
      const after = traffic.drawn();
      if (after.people !== before.people || after.cars !== 0 || traffic.standing() !== after.people) continue; // somebody came or went
      expect([first, second], `at minute ${m}`).toEqual([false, false]);
      gates++;
    }
    expect(gates).toBeGreaterThan(5);
  });

  it("has nobody about, and reports no motion, in the small hours", () => {
    const sim = town();
    const { traffic, flush } = make();
    const night = new Date(at(3, 0, 0));
    traffic.update(sim, night, [20, 0], 40);
    flush();
    expect(traffic.update(sim, night, [20, 0], 40)).toBe(false);
    expect(traffic.drawn()).toEqual({ cars: 0, people: 0 });
  });

  it("shows cars on the morning drive to work: long trips are driven, in the right-hand lane", () => {
    const sim = town();
    const { traffic, flush } = make();
    let carsSeen = 0;
    for (let m = 7 * 60; m < 9.5 * 60 && carsSeen === 0; m += 1) {
      const t = new Date(DAY + m * 60_000);
      traffic.update(sim, t, [30, 0], 40);
      flush();
      traffic.update(sim, t, [30, 0], 40);
      carsSeen += traffic.drawn().cars;
    }
    expect(carsSeen).toBeGreaterThan(0);
  });

  /** A long street with an office or shop every 5 cells, and `homes` houses at the west end. */
  function workTown(homes: number) {
    const sim = new CitySim(cfg);
    for (let x = 0; x <= 120; x++) sim.road.set(cellKey(x, 0), 3);
    for (let x = 10; x <= 120; x += 5) {
      sim.lots.set(cellKey(x, -1), 0);
      sim.kinds.set(cellKey(x, -1), x % 10 === 0 ? "office" : "shop");
    }
    for (let i = 0; i < homes; i++) {
      sim.lots.set(cellKey(i, -1), 0);
      sim.kinds.set(cellKey(i, -1), "house");
    }
    sim.version = 1;
    return sim;
  }

  it("puts service vehicles on the road in the working day where people live", () => {
    const sim = workTown(3);
    const { traffic, flush } = make();
    let cars = 0;
    for (let s = 0; s < 120; s += 2) {
      const t = new Date(at(13, 0, s));
      traffic.update(sim, t, [60, 0], 70);
      flush();
      traffic.update(sim, t, [60, 0], 70);
      cars += traffic.drawn().cars;
    }
    expect(cars).toBeGreaterThan(10);
  });

  it("puts none on the road where nobody lives, however many workplaces there are", () => {
    const sim = workTown(0);
    const { traffic, flush } = make();
    for (let s = 0; s < 120; s += 2) {
      const t = new Date(at(13, 0, s));
      traffic.update(sim, t, [60, 0], 70);
      flush();
      expect(traffic.update(sim, t, [60, 0], 70)).toBe(false);
      expect(traffic.drawn()).toEqual({ cars: 0, people: 0 });
    }
  });

  it("goes quiet at night: with the fleet off the streets a parked night city draws nothing at all", () => {
    const sim = workTown(20);
    const { traffic, flush } = make();
    let frames = 0;
    for (let m = 60; m < 5 * 60; m += 7) { // 01:00 to 05:00, after the last late errand is home
      const t = new Date(DAY + m * 60_000);
      traffic.update(sim, t, [60, 0], 70);
      flush();
      if (traffic.update(sim, t, [60, 0], 70)) frames++;
      expect(traffic.drawn()).toEqual({ cars: 0, people: 0 });
    }
    expect(frames).toBe(0);
  });

  it("never draws more cars or people than its caps, whatever the crowd, and fills them when there are enough", () => {
    const sim = new CitySim(cfg);
    for (let x = -80; x <= 80; x++) sim.road.set(cellKey(x, 0), 3);
    for (let x = -80; x <= 80; x++) {
      for (const y of [-1, 1]) {
        sim.lots.set(cellKey(x, y), 0);
        sim.kinds.set(cellKey(x, y), x % 5 === 0 ? "park" : x % 7 === 0 ? "shop" : "apartment");
      }
    }
    sim.version = 1;
    sim.advanceTo(cfg.tierAgesMs[1] + 1); // every apartment is grown: thousands of residents
    const { traffic, flush } = make({ cars: 5, people: 40 });
    let mostPeople = 0;
    let mostCars = 0;
    for (let m = 7 * 60; m < 14 * 60; m += 7) {
      const t = new Date(DAY + m * 60_000);
      traffic.update(sim, t, [0, 0], 90);
      flush();
      traffic.update(sim, t, [0, 0], 90);
      const d = traffic.drawn();
      expect(d.cars).toBeLessThanOrEqual(5);
      expect(d.people).toBeLessThanOrEqual(40);
      mostPeople = Math.max(mostPeople, d.people);
      mostCars = Math.max(mostCars, d.cars);
    }
    expect(mostPeople).toBe(40);
    expect(mostCars).toBeGreaterThan(0);
    expect(MAX_CARS).toBe(400);
    expect(MAX_PEOPLE).toBe(600);
  });

  it("draws no more than PER_PLACE people standing at one place", () => {
    const sim = new CitySim(cfg);
    for (let x = 0; x <= 20; x++) sim.road.set(cellKey(x, 0), 3);
    for (let x = 0; x <= 18; x += 1) {
      sim.lots.set(cellKey(x, -1), 0);
      sim.kinds.set(cellKey(x, -1), x === 10 ? "park" : "apartment");
    }
    sim.version = 1;
    sim.advanceTo(cfg.tierAgesMs[1] + 1); // grown apartments: dozens of residents out at the one park
    const { traffic, flush } = make();
    let most = 0;
    for (let m = 10 * 60 + 40; m < 15 * 60 + 40; m += 15) {
      const t = new Date(DAY + m * 60_000);
      traffic.update(sim, t, [10, 0], 30);
      flush();
      traffic.update(sim, t, [10, 0], 30);
      most = Math.max(most, traffic.standing());
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(PER_PLACE);
  });

  it("does the heavy work in tasks of its own, never inside update", () => {
    const sim = town();
    const { traffic, queue, flush } = make();
    const t = new Date(at(13, 0, 0));
    traffic.update(sim, t, [20, 0], 30);
    expect(queue.length).toBe(1); // asked for one task, did nothing else
    expect(traffic.populationBuilds()).toBe(0);
    flush();
    expect(traffic.populationBuilds()).toBe(1);
  });

  it("asks for another task only when something changed or its picture is old", () => {
    const sim = town();
    const { traffic, queue, flush } = make();
    const t = new Date(at(13, 0, 0));
    traffic.update(sim, t, [20, 0], 30);
    flush();
    traffic.update(sim, t, [20, 0], 30);
    expect(queue.length).toBe(0); // nothing to do: same moment, same place
    traffic.update(sim, t, [20, 0], 30);
    expect(queue.length).toBe(0);
    traffic.update(sim, new Date(at(13, 0, 5)), [20, 0], 30); // five seconds on
    expect(queue.length).toBe(1);
    flush();
    traffic.update(sim, new Date(at(13, 0, 5)), [60, 0], 30); // the view moved a long way
    expect(queue.length).toBe(1);
    flush();
  });

  it("rebuilds who lives and works where after the city changes, but not on every change, and not inside update", () => {
    const sim = town();
    const { traffic, queue, flush, tick } = make();
    const t = new Date(at(13, 0, 0));
    traffic.update(sim, t, [20, 0], 30);
    flush();
    expect(traffic.populationBuilds()).toBe(1);
    // a new house appears
    sim.lots.set(cellKey(30, 1), 0);
    sim.kinds.set(cellKey(30, 1), "house");
    sim.version++;
    traffic.update(sim, new Date(at(13, 0, 2)), [20, 0], 30);
    flush();
    expect(traffic.populationBuilds()).toBe(1); // too soon after the last build: it waits
    tick(60_000);
    traffic.update(sim, new Date(at(13, 1, 30)), [20, 0], 30);
    flush();
    expect(traffic.populationBuilds()).toBe(2);
    expect(queue.length).toBe(0);
  });

  it("notices houses growing into a bigger tier although the city's version stays the same", () => {
    const sim = town();
    sim.lots.set(cellKey(30, 1), 0);
    sim.kinds.set(cellKey(30, 1), "house");
    sim.version = 5;
    sim.advanceTo(0); // clock at 0
    const { traffic, flush, tick } = make();
    const t = new Date(at(13, 0, 0));
    traffic.update(sim, t, [20, 0], 30);
    flush();
    const before = traffic.populationBuilds();
    // time passes in the city: the lot's house is now older than the tier ages, with no change of version
    sim.advanceTo(cfg.tierAgesMs[1] + 1);
    tick(30_000);
    traffic.update(sim, new Date(at(13, 5, 0)), [20, 0], 30);
    flush();
    traffic.update(sim, new Date(at(13, 5, 0)), [20, 0], 30);
    flush();
    expect(traffic.populationBuilds()).toBeGreaterThan(before);
  });

  it("gets through its work and draws people even when the clock jumps so far at every look that no slice has any time", () => {
    const sim = town();
    const scene = new THREE.Scene();
    const models = new Map(CAR_POOL.map((n) => [n, { geo: new THREE.BoxGeometry(1, 1, 2), mat: new THREE.MeshBasicMaterial() }]));
    const queue: (() => void)[] = [];
    let clock = 0;
    const traffic = new Traffic(scene, models, { later: (fn) => queue.push(fn), perf: () => (clock += 1000) });
    const t = new Date(at(13, 0, 0));
    traffic.update(sim, t, [20, 0], 30);
    let tasks = 0;
    while (queue.length > 0 && tasks++ < 100_000) queue.shift()!();
    expect(queue.length).toBe(0); // it finished: every slice made some progress
    expect(tasks).toBeGreaterThan(5); // ... a person or a vehicle at a time
    traffic.update(sim, t, [20, 0], 30);
    expect(traffic.drawn().people).toBeGreaterThan(0);
  });

  it("waits longer to rebuild the population when building it took long", () => {
    const sim = town();
    const scene = new THREE.Scene();
    const models = new Map(CAR_POOL.map((n) => [n, { geo: new THREE.BoxGeometry(1, 1, 2), mat: new THREE.MeshBasicMaterial() }]));
    const queue: (() => void)[] = [];
    let clock = 0;
    // each look at the clock is a second on: building the population takes seconds, so its gap is a hundred times that
    const traffic = new Traffic(scene, models, { later: (fn) => queue.push(fn), perf: () => (clock += 1000) });
    const run = () => {
      let n = 0;
      while (queue.length > 0 && n++ < 100_000) queue.shift()!();
    };
    traffic.update(sim, new Date(at(13, 0, 0)), [20, 0], 30);
    run();
    expect(traffic.populationBuilds()).toBe(1);
    sim.version++;
    sim.lots.set(cellKey(30, 1), 0);
    sim.kinds.set(cellKey(30, 1), "house");
    traffic.update(sim, new Date(at(13, 1, 0)), [20, 0], 30); // a minute on: a quick build would rebuild by now
    run();
    expect(traffic.populationBuilds()).toBe(1);
    traffic.update(sim, new Date(at(15, 0, 0)), [20, 0], 30); // two hours on
    run();
    expect(traffic.populationBuilds()).toBe(2);
  });

  it("recovers when its background work throws: nothing stays scheduled for good, and it tries again after a pause", () => {
    const sim = town();
    const { traffic, flush, queue } = make();
    const real = sim.hasRoad.bind(sim);
    let broken = true;
    sim.hasRoad = (x: number, y: number) => {
      if (broken) throw new Error("boom");
      return real(x, y);
    };
    traffic.update(sim, new Date(at(13, 0, 0)), [20, 0], 30);
    expect(() => flush()).toThrow("boom");
    expect(queue.length).toBe(0);
    // not again on every frame, which would throw on every frame
    for (let ms = 0; ms < 2000; ms += 100) expect(traffic.update(sim, new Date(at(13, 0, 0) + 100 + ms), [20, 0], 30)).toBe(false);
    expect(queue.length).toBe(0);
    // once the fault is gone, and the pause is over, it works through to a picture
    broken = false;
    traffic.update(sim, new Date(at(13, 0, 30)), [20, 0], 30);
    expect(queue.length).toBe(1);
    flush();
    traffic.update(sim, new Date(at(13, 0, 30)), [20, 0], 30);
    expect(traffic.drawn().people).toBeGreaterThan(0);
    expect(queue.length).toBe(0);
  });

  it("recovers from a throw in the middle of a long job, not only the first", () => {
    const sim = town();
    sim.advanceTo(cfg.tierAgesMs[1] + 1);
    const { traffic, flush, queue } = make();
    const real = sim.hasRoad.bind(sim);
    let calls = 0;
    sim.hasRoad = (x: number, y: number) => {
      if (++calls === 200) throw new Error("boom in the middle");
      return real(x, y);
    };
    traffic.update(sim, new Date(at(13, 0, 0)), [20, 0], 40);
    expect(() => flush()).toThrow("boom in the middle");
    expect(queue.length).toBe(0);
    traffic.update(sim, new Date(at(13, 0, 30)), [20, 0], 40);
    flush();
    traffic.update(sim, new Date(at(13, 0, 30)), [20, 0], 40);
    expect(traffic.drawn().people).toBeGreaterThan(0);
  });

  describe("a brand-new city", () => {
    /** A short street from the roller's first cell with `houses` houses on its north side and no workplace. */
    function fresh(houses: number, roadCells = 8) {
      const sim = new CitySim(cfg);
      for (let x = 0; x < roadCells; x++) sim.road.set(cellKey(x, 0), 1);
      for (let x = 0; x < houses; x++) {
        sim.lots.set(cellKey(x, -1), 0);
        sim.kinds.set(cellKey(x, -1), "house");
      }
      sim.version = 1;
      return sim;
    }
    const meshesOf = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);

    for (const houses of [0, 1, 3, 5]) {
      it(`runs from 07:00 to 22:00 with ${houses} houses and no workplace: nobody stuck, nothing NaN, nothing thrown`, () => {
        const sim = fresh(houses);
        const { traffic, scene, flush, queue } = make();
        let seenPeople = 0;
        for (let m = 7 * 60; m <= 22 * 60; m += 5) {
          const t = new Date(DAY + m * 60_000);
          expect(() => traffic.update(sim, t, [3, 0], 15)).not.toThrow();
          flush();
          expect(queue.length, `at minute ${m}`).toBe(0); // the work always ends: nothing stays scheduled
          traffic.update(sim, t, [3, 0], 15);
          const d = traffic.drawn();
          expect(Number.isInteger(d.cars) && Number.isInteger(d.people)).toBe(true);
          expect(d.cars).toBe(0); // no workplace, no commute, no fleet
          seenPeople += d.people;
          for (const mesh of meshesOf(scene)) {
            for (let i = 0; i < mesh.count * 16; i++) {
              if (!Number.isFinite(mesh.instanceMatrix.array[i])) throw new Error(`NaN in a matrix at minute ${m}`);
            }
          }
        }
        expect(traffic.info()).not.toBeNull();
        expect(traffic.info()!.people).toBe(houses * 2); // tier 1: two residents a house
        // the people have no job to go to and no place to go to, yet they come out to stroll
        if (houses > 0) expect(seenPeople).toBeGreaterThan(0);
        else expect(seenPeople).toBe(0);
      });
    }

    it("shows people strolling at 08:00 already, when a few of the residents are out", () => {
      let out = 0;
      for (let id = 0; id < 12; id++) {
        // twelve towns that differ in the seed, so a different two or ten people are out at 08:00 in each
        const sim = fresh(5);
        const seeded = new CitySim({ ...cfg, seed: 100 + id });
        for (const [k, v] of sim.road) seeded.road.set(k, v);
        for (const [k, v] of sim.lots) seeded.lots.set(k, v);
        for (const [k, v] of sim.kinds) seeded.kinds.set(k, v);
        seeded.version = 1;
        const { traffic, flush } = make();
        const t = new Date(at(8, 0, 0));
        traffic.update(seeded, t, [3, 0], 15);
        flush();
        traffic.update(seeded, t, [3, 0], 15);
        out += traffic.drawn().people;
      }
      expect(out).toBeGreaterThan(0);
    });

    it("copes with no road at all, and with a lot that no road touches", () => {
      const noRoad = fresh(3, 0);
      const { traffic, flush, queue } = make();
      for (let m = 7 * 60; m < 22 * 60; m += 30) {
        const t = new Date(DAY + m * 60_000);
        traffic.update(noRoad, t, [0, 0], 15);
        flush();
        expect(traffic.update(noRoad, t, [0, 0], 15)).toBe(false);
        expect(traffic.drawn()).toEqual({ cars: 0, people: 0 });
      }
      expect(queue.length).toBe(0);
      expect(new CitySim(cfg).houses(0)).toBe(0);
      const empty = new CitySim(cfg);
      traffic.update(empty, new Date(at(8, 0, 0)), [0, 0], 15);
      flush();
      expect(traffic.update(empty, new Date(at(8, 0, 0)), [0, 0], 15)).toBe(false);
    });
  });

  it("starts over with another city", () => {
    const sim = town();
    const { traffic, flush } = make();
    const t = new Date(at(13, 0, 0));
    traffic.update(sim, t, [20, 0], 30);
    flush();
    traffic.update(sim, t, [20, 0], 30);
    expect(traffic.drawn().people).toBeGreaterThan(0);
    const empty = new CitySim(cfg);
    traffic.update(empty, t, [20, 0], 30);
    expect(traffic.drawn()).toEqual({ cars: 0, people: 0 });
    flush();
    expect(traffic.update(empty, t, [20, 0], 30)).toBe(false);
  });

  it("adds its meshes to the scene: one instanced mesh per car model and meshes for the people", () => {
    const { scene } = make();
    const meshes = scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
    expect(meshes.length).toBeGreaterThanOrEqual(CAR_POOL.length + 1);
    for (const m of meshes) expect(m.count).toBe(0);
    for (const m of meshes) expect(m.frustumCulled).toBe(false);
  });
});
