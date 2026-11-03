import { describe, expect, it } from "vitest";
import {
  buildFleet,
  buildPopulation,
  entriesFor,
  FLEET_REACH,
  FLEET_SHARE,
  FLEET_SLOT_MS,
  fleetActivity,
  fleetEntries,
  idleStrolls,
  MAX_TRANSIT_MS,
  planFor,
  STROLL_LEG_MS,
  STROLL_STEPS,
  strollLeg,
  type Entry,
  type PathOf,
  type Person,
} from "../src/sims/crowd";
import { CitySim, cellKey, type CityConfig } from "../src/sims/city";
import type { Kind } from "../src/sims/kinds";
import { DRIVE_SPEED, errandAt, placesOf, roadPath, travelOf, tripsForDay, WALK_SPEED, type Cell, type Trip } from "../src/sims/people";

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

const DAY = new Date(2026, 10, 3).getTime();
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 3, h, m, s).getTime();
const MIN = 60_000;
const SEED = 42;

/** A street along y = 0 from x = 0 to 60, with everything else off the road. */
const street = (x: number, y: number) => y === 0 && x >= 0 && x <= 60;
const noRoad = () => false;
/** A path function that searches the road and never runs out of time. */
const find: PathOf = (a, b) => roadPath(street, a, b);

describe("strollLeg", () => {
  const grid = (x: number, y: number) => x % 3 === 0 || y % 3 === 0; // a block grid: streets every third cell

  it("starts on a road cell beside the base and ends where it started, out and back", () => {
    for (let who = 1; who <= 40; who++) {
      const base: Cell = [4 + (who % 5), 4 + (who % 7)]; // x, y not both multiples of 3 for most, so lots beside streets
      if (grid(base[0], base[1])) continue;
      const leg = strollLeg(grid, base, SEED, who, 11, 0);
      expect(leg, `who ${who}`).not.toBeNull();
      const path = leg!;
      expect(path).toHaveLength(2 * STROLL_STEPS + 1);
      expect(path[0]).toEqual(path[path.length - 1]);
      expect(Math.abs(path[0][0] - base[0]) + Math.abs(path[0][1] - base[1])).toBe(1);
      expect(grid(path[0][0], path[0][1])).toBe(true);
    }
  });

  it("walks one road cell at a time, only on road, and comes back the way it went", () => {
    const base: Cell = [4, 4];
    const path = strollLeg(grid, base, SEED, 5, 11, 3)!;
    for (let i = 1; i < path.length; i++) {
      expect(grid(path[i][0], path[i][1])).toBe(true);
      expect(Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1])).toBe(1);
    }
    for (let i = 0; i <= STROLL_STEPS; i++) expect(path[path.length - 1 - i]).toEqual(path[i]);
  });

  it("never wanders more than a stroll's steps from where it started", () => {
    for (let leg = 0; leg < 30; leg++) {
      const path = strollLeg(grid, [4, 4], SEED, 9, 2, leg)!;
      for (const c of path) expect(Math.abs(c[0] - path[0][0]) + Math.abs(c[1] - path[0][1])).toBeLessThanOrEqual(STROLL_STEPS);
    }
  });

  it("is the same every time for the same person, stroll and leg, and differs between legs", () => {
    const a = strollLeg(grid, [4, 4], SEED, 5, 7, 2);
    expect(strollLeg(grid, [4, 4], SEED, 5, 7, 2)).toEqual(a);
    const legs = new Set(Array.from({ length: 12 }, (_, leg) => JSON.stringify(strollLeg(grid, [4, 4], SEED, 5, 7, leg))));
    expect(legs.size).toBeGreaterThan(4);
  });

  it("turns round at a dead end instead of getting stuck", () => {
    const path = strollLeg(street, [5, 1], SEED, 1, 1, 0)!; // a street along y = 0: every walk is up or down it
    expect(path).toHaveLength(2 * STROLL_STEPS + 1);
    const deadEnd = strollLeg(street, [58, 1], SEED, 2, 1, 0)!;
    for (const c of deadEnd) expect(street(c[0], c[1])).toBe(true);
  });

  it("has no leg for a base with no road beside it", () => {
    expect(strollLeg(noRoad, [3, 3], SEED, 1, 1, 0)).toBeNull();
  });

  it("takes whole legs at the walking speed", () => {
    expect(STROLL_LEG_MS).toBeCloseTo((2 * STROLL_STEPS * 1000) / WALK_SPEED, 6);
  });
});

describe("buildPopulation", () => {
  function city(spec: [number, number, Kind][]) {
    const sim = new CitySim(cfg);
    for (const [x, y, kind] of spec) {
      sim.lots.set(cellKey(x, y), 0);
      sim.kinds.set(cellKey(x, y), kind);
    }
    return sim;
  }

  it("lists every resident once with a job at a workplace, or none when the jobs run out", () => {
    const sim = city([
      [0, 1, "house"], // 2 residents at tier 1
      [1, 1, "row"], // 3
      [5, 1, "shop"], // 4 jobs
      [9, 1, "park"],
    ]);
    const pop = buildPopulation(sim, 0, SEED);
    expect(pop.people).toHaveLength(5);
    expect(new Set(pop.people.map((p) => p.id)).size).toBe(5);
    expect(pop.people.filter((p) => p.work).length).toBe(4);
    for (const p of pop.people) if (p.work) expect(p.work).toEqual([5, 1]);
    expect(pop.places.sort()).toEqual([[5, 1], [9, 1]]);
  });

  it("gives everybody no job in a city with no workplaces, and nobody a home in one with no homes", () => {
    expect(buildPopulation(city([[0, 1, "house"]]), 0, SEED).people.every((p) => p.work === null)).toBe(true);
    expect(buildPopulation(city([[0, 1, "shop"]]), 0, SEED).people).toEqual([]);
  });

  it("is the same for the same city and seed", () => {
    const sim = city([[0, 1, "house"], [1, 1, "row"], [5, 1, "shop"], [6, 1, "office"]]);
    expect(buildPopulation(sim, 0, SEED)).toEqual(buildPopulation(sim, 0, SEED));
  });
});

describe("planFor and idleStrolls", () => {
  const person = (id: number, work: Cell | null): Person => ({ id, home: [2, -1], work });

  it("keeps a late evening errand's way home, which departs after midnight, when asked for the tail of yesterday", () => {
    let found = 0;
    for (let id = 1; id <= 6000 && found < 3; id++) {
      const yest = tripsForDay(id, [2, -1], null, new Date(2026, 10, 2).getTime(), SEED, [[10, -1]]);
      const lateBack = yest.filter((t) => t.depart >= DAY);
      if (lateBack.length === 0) continue;
      found++;
      const plan = planFor(person(id, null), DAY, SEED, [[10, -1]], true);
      for (const t of lateBack) expect(plan.trips).toContainEqual(t);
      expect(plan.trips.map((t) => t.depart)).toEqual([...plan.trips.map((t) => t.depart)].sort((a, b) => a - b));
      expect(errandAt(plan.trips, lateBack[0].depart - 1000)).not.toBeNull(); // still out at the place just before the way home
      expect(planFor(person(id, null), DAY, SEED, [[10, -1]], false).trips.every((t) => t.depart >= DAY)).toBe(true);
    }
    expect(found).toBeGreaterThan(0);
  });

  it("gives every resident three strolls a day, 10 to 40 minutes of whole legs, morning, afternoon and evening", () => {
    let total = 0;
    for (let id = 1; id <= 300; id++) {
      const p = person(id, id % 3 === 0 ? null : [30, -1]);
      const plan = planFor(p, DAY, SEED, [[10, -1]], false);
      expect(plan.strolls.length).toBeLessThanOrEqual(3);
      total += plan.strolls.length;
      for (const s of plan.strolls) {
        const len = s.end - s.start;
        expect(len).toBeGreaterThanOrEqual(10 * MIN - STROLL_LEG_MS);
        expect(len).toBeLessThanOrEqual(40 * MIN + STROLL_LEG_MS);
        expect(Math.abs(len / STROLL_LEG_MS - Math.round(len / STROLL_LEG_MS))).toBeLessThan(1e-6);
        expect(s.start).toBeGreaterThanOrEqual(at(7, 0));
        expect(s.end).toBeLessThanOrEqual(at(22, 30));
      }
    }
    expect(total / 300).toBeGreaterThan(2); // most residents manage all three
  });

  it("has about as many people strolling at any hour of the day, with no dip where one window gives way to the next", () => {
    const people = 3000;
    const plans = Array.from({ length: people }, (_, i) => planFor(person(i + 1, null), DAY, SEED, [], false));
    const share = (h: number) => plans.filter((p) => p.strolls.some((s) => s.start <= at(h) && at(h) < s.end)).length / people;
    for (const h of [8, 9, 10, 11, 11.98, 12, 12.02, 13, 14, 16, 16.98, 17, 17.02, 18, 19, 20]) {
      const hour = Math.floor(h);
      const t = at(hour, Math.round((h - hour) * 60));
      const n = plans.filter((p) => p.strolls.some((s) => s.start <= t && t < s.end)).length / people;
      expect(n, `at ${h}`).toBeGreaterThan(0.045);
      expect(n, `at ${h}`).toBeLessThan(0.12);
    }
    expect(share(3)).toBe(0); // none in the small hours
  });

  it("never lets two of a person's strolls overlap", () => {
    for (let id = 1; id <= 500; id++) {
      const strolls = planFor(person(id, null), DAY, SEED, [], false).strolls;
      for (let i = 1; i < strolls.length; i++) expect(strolls[i].start).toBeGreaterThanOrEqual(strolls[i - 1].end);
    }
  });

  it("never lets a stroll cross a trip, an errand's stay or the moment before a departure", () => {
    for (let id = 1; id <= 300; id++) {
      const p = person(id, id % 4 === 0 ? null : [30, -1]);
      const plan = planFor(p, DAY, SEED, [[10, -1], [20, -1]], false);
      for (const s of plan.strolls) {
        for (let i = 0; i < plan.trips.length; i++) {
          const trip = plan.trips[i];
          // under way
          expect(s.start >= trip.depart + MAX_TRANSIT_MS || s.end <= trip.depart, `${id}: trip ${i}`).toBe(true);
          // back inside before the next departure
          if (trip.depart > s.start) expect(trip.depart - s.end).toBeGreaterThanOrEqual(30_000);
          // away at an errand's place
          if (trip.purpose === "errand" && i + 1 < plan.trips.length) {
            const [a, b] = [trip.depart, plan.trips[i + 1].depart];
            expect(s.end <= a || s.start >= b, `${id}: errand ${i}`).toBe(true);
          }
        }
      }
    }
  });

  it("strolls around the workplace while at work and around home otherwise", () => {
    const work: Cell = [30, -1];
    let atWork = 0;
    let atHome = 0;
    for (let id = 1; id <= 400; id++) {
      const plan = planFor(person(id, work), DAY, SEED, [], false);
      for (const s of plan.strolls) {
        const before = plan.trips.filter((t) => t.depart <= s.start);
        const where = before.length === 0 ? [2, -1] : before[before.length - 1].to;
        expect(s.base, `${id}`).toEqual(where);
        if (s.base[0] === 30) atWork++;
        else atHome++;
      }
    }
    expect(atWork).toBeGreaterThan(0);
    expect(atHome).toBeGreaterThan(0);
  });

  it("strolls even where there is nowhere to go to: no shop or park", () => {
    let n = 0;
    for (let id = 1; id <= 50; id++) n += planFor(person(id, null), DAY, SEED, [], false).strolls.length;
    expect(n).toBeGreaterThan(50);
  });

  it("is a function of the person, the day and the seed", () => {
    const p = person(77, [30, -1]);
    expect(planFor(p, DAY, SEED, [[10, -1]], true)).toEqual(planFor(p, DAY, SEED, [[10, -1]], true));
    expect(planFor(p, DAY, SEED + 1, [[10, -1]], true)).not.toEqual(planFor(p, DAY, SEED, [[10, -1]], true));
    const plain = idleStrolls([], p, DAY, SEED);
    expect(plain.length).toBe(3);
  });
});

describe("entriesFor", () => {
  const home: Cell = [2, -1];
  const work: Cell = [50, -1];
  const shop: Cell = [20, -1];
  /** The first person with a work trip and an errand in the day, with their plan. */
  function commuter() {
    for (let id = 1; id < 200; id++) {
      const p: Person = { id, home, work };
      const plan = planFor(p, DAY, SEED, [shop], false);
      if (plan.trips.some((t) => t.purpose === "errand") && plan.strolls.length > 0) return { p, plan };
    }
    throw new Error("nobody had both");
  }
  const win = (from: number, to: number) => [from, to] as const;

  it("shows a trip under way from its departure to its arrival, driving the long way and walking the short", () => {
    const { p, plan } = commuter();
    const toWork = plan.trips.find((t) => t.purpose === "work")!;
    const path = roadPath(street, toWork.from, toWork.to)!;
    const { walking, speed } = travelOf(path);
    expect(walking).toBe(false); // 48 cells: driven
    expect(speed).toBe(DRIVE_SPEED);
    const { entries, pending } = entriesFor(p, plan, ...win(toWork.depart - 1000, toWork.depart + 1000), SEED, find);
    expect(pending).toBe(false);
    const move = entries.find((e) => e.type === "move" && e.depart === toWork.depart);
    expect(move).toMatchObject({ type: "move", who: p.id, mode: "car", speed: DRIVE_SPEED });
    expect(move!.until).toBeCloseTo(toWork.depart + ((path.length - 1) / DRIVE_SPEED) * 1000, 3);
    expect(move!.from).toBe(toWork.depart);
  });

  it("leaves out a trip that is over before the window, and one that departs after it", () => {
    const { p, plan } = commuter();
    const toWork = plan.trips.find((t) => t.purpose === "work")!;
    const none = entriesFor(p, plan, ...win(toWork.depart + MAX_TRANSIT_MS + 1, toWork.depart + MAX_TRANSIT_MS + 2000), SEED, find);
    expect(none.entries.some((e) => e.type === "move" && e.depart === toWork.depart)).toBe(false);
    const early = entriesFor(p, plan, ...win(toWork.depart - 10_000, toWork.depart - 5000), SEED, find);
    expect(early.entries.some((e) => e.type === "move" && e.depart === toWork.depart)).toBe(false);
  });

  it("puts a resident at the errand's place between arriving and leaving, standing or strolling round it", () => {
    const { p, plan } = commuter();
    const k = plan.trips.findIndex((t) => t.purpose === "errand");
    const [out, back] = [plan.trips[k], plan.trips[k + 1]];
    const path = roadPath(street, out.from, out.to)!;
    const arrive = out.depart + ((path.length - 1) / travelOf(path).speed) * 1000;
    const mid = (arrive + back.depart) / 2;
    const { entries } = entriesFor(p, plan, ...win(mid, mid + 1000), SEED, find);
    const there = entries.filter((e): e is Extract<Entry, { type: "stand" | "stroll" }> => e.type === "stand" || e.type === "stroll");
    const dwell = there.find((e) => (e.type === "stand" ? e.from : e.stroll.start) >= arrive - 1);
    expect(dwell, "somebody at the place").toBeDefined();
    if (dwell!.type === "stand") {
      expect(dwell!.place).toEqual(shop);
      expect(dwell!.from).toBeCloseTo(arrive, 3);
      expect(dwell!.until).toBe(back.depart);
    } else {
      expect(dwell!.stroll.base).toEqual(shop);
      expect(dwell!.stroll.start).toBeCloseTo(arrive, 3);
      expect(dwell!.stroll.end).toBeLessThanOrEqual(back.depart);
    }
    // while the trip out is still on the road, the move entry is there and the dwell has not begun
    const during = entriesFor(p, plan, ...win(out.depart, out.depart + 500), SEED, find).entries;
    expect(during.some((e) => e.type === "move" && e.depart === out.depart)).toBe(true);
  });

  it("splits errand dwells between standing outside and strolling round the place", () => {
    let stands = 0;
    let strolls = 0;
    for (let id = 1; id <= 300; id++) {
      const p: Person = { id, home, work: null };
      const plan = planFor(p, DAY, SEED, [shop], false);
      const k = plan.trips.findIndex((t) => t.purpose === "errand");
      if (k < 0) continue;
      const out = plan.trips[k];
      const t = (out.depart + plan.trips[k + 1].depart) / 2;
      for (const e of entriesFor(p, plan, t, t + 1000, SEED, find).entries) {
        if (e.type === "stand") stands++;
        if (e.type === "stroll" && e.stroll.base[0] === shop[0]) strolls++;
      }
    }
    expect(stands).toBeGreaterThan(40);
    expect(strolls).toBeGreaterThan(40);
  });

  it("does not put anybody at an errand's place that has no road to it: the trip was never made", () => {
    const { p, plan } = commuter();
    const k = plan.trips.findIndex((t) => t.purpose === "errand");
    const mid = (plan.trips[k].depart + plan.trips[k + 1].depart) / 2;
    const cutOff: PathOf = (a, b) => (b[0] === shop[0] || a[0] === shop[0] ? null : roadPath(street, a, b));
    const { entries, pending } = entriesFor(p, plan, mid, mid + 1000, SEED, cutOff);
    expect(pending).toBe(false);
    expect(entries.filter((e) => e.type === "stand" || (e.type === "stroll" && e.stroll.base[0] === shop[0]))).toEqual([]);
    expect(entries.filter((e) => e.type === "move" && e.depart === plan.trips[k].depart)).toEqual([]);
  });

  it("says it is pending, and has no entry for the trip, while a way has not been found yet", () => {
    const { p, plan } = commuter();
    const toWork = plan.trips.find((t) => t.purpose === "work")!;
    const later: PathOf = () => undefined;
    const r = entriesFor(p, plan, ...win(toWork.depart, toWork.depart + 1000), SEED, later);
    expect(r.pending).toBe(true);
    expect(r.entries.some((e) => e.type === "move" && e.depart === toWork.depart)).toBe(false);
  });

  it("asks for a way only for trips whose time is near the window", () => {
    const { p, plan } = commuter();
    const asked: [Cell, Cell][] = [];
    const spy: PathOf = (a, b) => (asked.push([a, b]), find(a, b));
    const t = at(3, 0);
    entriesFor(p, plan, t, t + 4000, SEED, spy);
    expect(asked).toEqual([]);
  });

  it("shows a stroll for the whole of it, and none outside it", () => {
    const { p, plan } = commuter();
    const s = plan.strolls[0];
    const inside = entriesFor(p, plan, s.start + 1000, s.start + 2000, SEED, find).entries;
    const mine = inside.find((e) => e.type === "stroll" && e.stroll.start === s.start);
    expect(mine).toMatchObject({ type: "stroll", who: p.id, from: s.start, until: s.end });
    const outside = entriesFor(p, plan, s.end + 1, s.end + 2000, SEED, find).entries;
    expect(outside.some((e) => e.type === "stroll" && e.stroll.start === s.start)).toBe(false);
  });

  it("agrees with placesOf: errands go only to shops and parks", () => {
    const sim = new CitySim(cfg);
    sim.kinds.set(cellKey(20, -1), "shop");
    expect(placesOf(sim)).toEqual([[20, -1]]);
  });
});

describe("the service fleet", () => {
  /** Workplaces on a grid, 6 cells apart, 30 x 30 of them. */
  const grid: Cell[] = [];
  for (let x = 0; x < 30; x++) for (let y = 0; y < 30; y++) grid.push([x * 6, y * 6]);
  const dist = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

  it("has a vehicle for the share of workplaces FLEET_SHARE says, each with stops that are neither next door nor far away", () => {
    const fleet = buildFleet(grid, SEED);
    expect(fleet.length / grid.length).toBeGreaterThan(FLEET_SHARE * 0.9);
    expect(fleet.length / grid.length).toBeLessThanOrEqual(FLEET_SHARE);
    expect(new Set(fleet.map((v) => v.id)).size).toBe(fleet.length);
    for (const v of fleet) {
      expect(v.stops.length).toBeGreaterThan(0);
      for (const stop of v.stops) {
        expect(dist(v.depot, stop)).toBeGreaterThanOrEqual(FLEET_REACH[0]);
        expect(dist(v.depot, stop)).toBeLessThanOrEqual(FLEET_REACH[1]);
      }
    }
  });

  it("takes the nearest such stops, whatever order the workplaces come in", () => {
    const a = buildFleet(grid, SEED);
    const b = buildFleet([...grid].reverse(), SEED);
    const byId = new Map(b.map((v) => [v.id, v]));
    expect(b.length).toBe(a.length);
    for (const v of a) expect(byId.get(v.id)!.stops.map((c) => c.join())).toEqual(v.stops.map((c) => c.join()));
  });

  it("is empty where there is nowhere far enough to drive, and for a lone workplace", () => {
    expect(buildFleet([[0, 0]], SEED)).toEqual([]);
    expect(buildFleet([[0, 0], [3, 3], [4, 0]], SEED)).toEqual([]);
    expect(buildFleet([], SEED)).toEqual([]);
  });

  it("has ids that are never a resident's: they are negative", () => {
    for (const v of buildFleet(grid, SEED)) expect(v.id).toBeLessThan(0);
  });

  it("drives out to a stop in one slot and back from the same stop in the next, in a car, from its depot", () => {
    const fleet = buildFleet(grid, SEED);
    const noon = at(13, 0, 0);
    const slot = Math.floor(noon / FLEET_SLOT_MS / 2) * 2; // an even slot
    let pairs = 0;
    for (const v of fleet.slice(0, 40)) {
      const out = fleetEntries([v], slot * FLEET_SLOT_MS, (slot + 1) * FLEET_SLOT_MS - 1, SEED, () => [[0, 0], [1, 0], [2, 0], [3, 0]], () => true).entries;
      const back = fleetEntries([v], (slot + 1) * FLEET_SLOT_MS, (slot + 2) * FLEET_SLOT_MS - 1, SEED, () => [[0, 0], [1, 0], [2, 0], [3, 0]], () => true).entries;
      if (out.length === 0 || back.length === 0) continue; // a quiet slot
      pairs++;
      for (const e of [...out, ...back]) expect(e).toMatchObject({ type: "move", who: v.id, mode: "car", speed: DRIVE_SPEED });
    }
    expect(pairs).toBeGreaterThan(10);
  });

  it("drives out from the depot in the even slots and back from the same stop in the odd ones", () => {
    const v = { id: -5, depot: [0, 0] as Cell, stops: [[20, 0], [0, 20]] as Cell[] };
    const base = Math.floor(at(13, 0, 0) / FLEET_SLOT_MS / 2) * 2;
    // a way that is just its two ends, so each entry shows where its trip went from and to
    const ends: PathOf = (a, b) => [a, b];
    const { entries } = fleetEntries([v], base * FLEET_SLOT_MS, (base + 80) * FLEET_SLOT_MS, SEED, ends, () => true);
    const bySlot = new Map<number, (typeof entries)[number]>();
    for (const e of entries) bySlot.set(Math.floor(e.depart / FLEET_SLOT_MS), e);
    expect(bySlot.size).toBeGreaterThan(40);
    for (const [slot, e] of bySlot) {
      const [from, to] = [e.path[0], e.path[1]];
      if (slot % 2 === 0) expect(from).toEqual(v.depot);
      else expect(to).toEqual(v.depot);
      const mate = bySlot.get(slot % 2 === 0 ? slot + 1 : slot - 1);
      if (mate) {
        // out and back use the same stop
        const [outTo, backFrom] = slot % 2 === 0 ? [to, mate.path[0]] : [mate.path[1], from];
        expect(backFrom).toEqual(outTo);
      }
    }
  });

  it("is busy in the working day, quiet in the evening and nearly gone at night", () => {
    expect(fleetActivity(at(10, 0))).toBeGreaterThan(0.7);
    expect(fleetActivity(at(13, 0))).toBeGreaterThan(0.7);
    expect(fleetActivity(at(20, 30))).toBeLessThan(fleetActivity(at(13, 0)));
    expect(fleetActivity(at(3, 0))).toBeLessThan(0.15);
    expect(fleetActivity(at(3, 0))).toBeGreaterThan(0);
    for (let m = 0; m < 24 * 60; m += 10) {
      const a = fleetActivity(DAY + m * MIN);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("puts fewer vehicles on the road at night than at noon", () => {
    const fleet = buildFleet(grid, SEED);
    const road: PathOf = () => [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0]];
    const count = (h: number) => {
      let n = 0;
      for (let k = 0; k < 20; k++) {
        const t = at(h, 0) + k * FLEET_SLOT_MS;
        n += fleetEntries(fleet, t, t + 1000, SEED, road, () => true).entries.length;
      }
      return n;
    };
    expect(count(13)).toBeGreaterThan(count(3) * 5);
    expect(count(3)).toBeGreaterThan(0);
  });

  it("looks only at trips with an end in the wanted part of town, and does not ask for the others' ways", () => {
    const fleet = buildFleet(grid, SEED);
    const asked: Cell[] = [];
    const spy: PathOf = (a, b) => (asked.push(a, b), [a, b]);
    const t = at(13, 0);
    fleetEntries(fleet, t, t + FLEET_SLOT_MS * 4, SEED, spy, ([x, y]) => x < 20 && y < 20);
    expect(asked.length).toBeGreaterThan(0);
    for (let i = 0; i < asked.length; i += 2) {
      const [a, b] = [asked[i], asked[i + 1]];
      expect((a[0] < 20 && a[1] < 20) || (b[0] < 20 && b[1] < 20)).toBe(true);
    }
  });

  it("reports pending when a way is not known yet, and has nothing for a trip with no way", () => {
    const fleet = buildFleet(grid, SEED);
    const t = at(13, 0);
    expect(fleetEntries(fleet, t, t + FLEET_SLOT_MS * 2, SEED, () => undefined, () => true).pending).toBe(true);
    const none = fleetEntries(fleet, t, t + FLEET_SLOT_MS * 2, SEED, () => null, () => true);
    expect(none.pending).toBe(false);
    expect(none.entries).toEqual([]);
  });

  it("shows a trip only from its departure to its arrival", () => {
    const fleet = buildFleet(grid, SEED);
    const path = Array.from({ length: 21 }, (_, k): Cell => [k, 0]); // 20 cells: 5 s at the driving speed
    const t = at(13, 0);
    const { entries } = fleetEntries(fleet, t, t + FLEET_SLOT_MS * 3, SEED, () => path, () => true);
    expect(entries.length).toBeGreaterThan(20);
    for (const e of entries) {
      expect(e.until - e.from).toBeCloseTo((20 / DRIVE_SPEED) * 1000, 3);
      expect(e.from).toBe(e.depart);
      expect(e.until).toBeGreaterThan(t);
      expect(e.depart).toBeLessThanOrEqual(t + FLEET_SLOT_MS * 3);
    }
  });
});
