import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/rng";
import { CitySim, cellKey, type CityConfig } from "../src/sims/city";
import { JOBS, RESIDENTS, type Kind } from "../src/sims/kinds";
import {
  assignJobs,
  DRIVE_SPEED,
  errandAt,
  jobsOf,
  placesOf,
  positionAt,
  residentsOf,
  roadPath,
  routeTrips,
  tripsForDay,
  travelOf,
  WALK_MAX_CELLS,
  WALK_SPEED,
  type Cell,
  type Job,
  type Resident,
  type Trip,
} from "../src/sims/people";

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

/** A city with exactly these lots, each standing from time 0, with no road: for what people.ts reads from lots and kinds. */
function lots(spec: [number, number, Kind][], ready = 0): CitySim {
  const sim = new CitySim(cfg);
  for (const [x, y, kind] of spec) {
    sim.lots.set(cellKey(x, y), ready);
    sim.kinds.set(cellKey(x, y), kind);
  }
  return sim;
}

const TIER2 = cfg.tierAgesMs[0];
const TIER3 = cfg.tierAgesMs[1];
/** Local midnight of 3 November 2026, and a local clock time on that day, in ms. */
const DAY = new Date(2026, 10, 3).getTime();
const clock = (h: number, m = 0, s = 0, dayOffset = 0) => new Date(2026, 10, 3 + dayOffset, h, m, s).getTime();
const MIN = 60_000;

describe("residentsOf and jobsOf", () => {
  const homes = ["house", "row", "detached", "apartment"] as const;

  it("houses as many residents in a home as its kind and tier say", () => {
    for (const kind of homes) {
      const sim = lots([[3, -2, kind]]);
      for (const [age, tier] of [[0, 1], [TIER2, 2], [TIER3, 3]] as const) {
        const rs = residentsOf(sim, age);
        expect(rs, `${kind} tier ${tier}`).toHaveLength(RESIDENTS[kind][tier - 1]);
        for (const r of rs) expect(r.home).toEqual([3, -2]);
      }
    }
  });

  it("houses nobody before the house has appeared, and nobody in a park, shop, office or landmark", () => {
    expect(residentsOf(lots([[0, 0, "house"]], 50_000), 49_999)).toEqual([]);
    expect(residentsOf(lots([[0, 0, "house"]], 50_000), 50_000)).toHaveLength(2);
    const sim = lots([[0, 0, "park"], [1, 0, "shop"], [2, 0, "office"], [3, 0, "landmark"]]);
    expect(residentsOf(sim, TIER3)).toEqual([]);
  });

  it("gives every resident an id of their own, the same id as the house grows, and different ids to different lots", () => {
    const spec: [number, number, Kind][] = [];
    for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) spec.push([x, y, homes[(x * 7 + y * 3 + 100) % 4]]);
    const sim = lots(spec);
    const one = residentsOf(sim, 0);
    const three = residentsOf(sim, TIER3);
    expect(new Set(three.map((r) => r.id)).size).toBe(three.length);
    expect(three.length).toBeGreaterThan(one.length);
    // everyone who lived there at tier 1 still lives there, under the same id
    const home = new Map(three.map((r) => [r.id, r.home]));
    for (const r of one) expect(home.get(r.id), String(r.id)).toEqual(r.home);
    expect(Number.isSafeInteger(Math.max(...three.map((r) => r.id)))).toBe(true);
  });

  it("holds as many jobs in a workplace as its kind says, whatever its age", () => {
    for (const kind of ["shop", "office", "landmark"] as const) {
      const sim = lots([[4, 5, kind]], 10_000);
      const js = jobsOf(sim);
      expect(js, kind).toHaveLength(JOBS[kind]);
      for (const j of js) expect(j.work).toEqual([4, 5]);
      expect(new Set(js.map((j) => j.id)).size).toBe(js.length);
    }
  });

  it("offers no jobs in homes and parks, and gives each workplace its own job ids", () => {
    const sim = lots([[0, 0, "house"], [1, 0, "park"], [2, 0, "shop"], [3, 0, "shop"], [-4, 9, "office"]]);
    const js = jobsOf(sim);
    expect(js).toHaveLength(4 + 4 + 12);
    expect(new Set(js.map((j) => j.id)).size).toBe(js.length);
    expect(jobsOf(lots([[0, 0, "house"]]))).toEqual([]);
  });

  it("lists the shops and parks as the places to run errands to", () => {
    const sim = lots([[0, 0, "house"], [1, 0, "park"], [2, 0, "shop"], [3, 0, "office"], [4, 0, "landmark"], [5, 0, "apartment"]]);
    expect(placesOf(sim).sort()).toEqual([[1, 0], [2, 0]]);
  });
});

describe("assignJobs", () => {
  /** n residents on a line: ids 1..n at x = id (y = 0). */
  const onLine = (n: number): Resident[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, home: [i + 1, 0] as Cell }));
  /** `n` jobs at `at`, ids from `first`. */
  const jobsAt = (at: Cell, n: number, first: number): Job[] => Array.from({ length: n }, (_, i) => ({ id: first + i, work: at }));
  const dist = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

  /** A random city: homes and workplaces scattered over a square. */
  function scatter(seed: number, homes: number, workplaces: number, size = 60) {
    const rnd = mulberry32(seed);
    const cell = (): Cell => [Math.floor(rnd() * size), Math.floor(rnd() * size)];
    const residents: Resident[] = [];
    let id = 1;
    for (let i = 0; i < homes; i++) {
      const home = cell();
      for (let k = 0; k < 1 + Math.floor(rnd() * 5); k++) residents.push({ id: id++, home });
    }
    const jobs: Job[] = [];
    let jid = 1_000_000;
    for (let i = 0; i < workplaces; i++) {
      const work = cell();
      for (let k = 0; k < (rnd() < 0.7 ? 12 : 4); k++) jobs.push({ id: jid++, work });
    }
    return { residents, jobs };
  }
  const shuffled = <T,>(list: readonly T[], seed: number): T[] => {
    const rnd = mulberry32(seed);
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  it("is deterministic: the same city and seed give the same jobs, whatever order the lists come in", () => {
    const { residents, jobs } = scatter(3, 40, 20);
    const a = assignJobs(residents, jobs, 11);
    const b = assignJobs(residents, jobs, 11);
    const c = assignJobs(shuffled(residents, 1), shuffled(jobs, 2), 11);
    expect([...b].sort()).toEqual([...a].sort());
    expect([...c].sort()).toEqual([...a].sort());
    expect(a.size).toBe(residents.length);
  });

  it("gives another seed another pairing", () => {
    const { residents, jobs } = scatter(4, 40, 20);
    const a = assignJobs(residents, jobs, 1);
    const b = assignJobs(residents, jobs, 2);
    expect([...b].sort()).not.toEqual([...a].sort());
  });

  it("never over-fills a job: no job goes to two residents, and only jobs that exist are given", () => {
    for (const [homes, workplaces] of [[60, 8], [60, 40], [10, 40]] as const) {
      const { residents, jobs } = scatter(homes + workplaces, homes, workplaces);
      const jobIds = new Set(jobs.map((j) => j.id));
      const got = assignJobs(residents, jobs, 5);
      const taken = [...got.values()].filter((j): j is number => j !== null);
      expect(new Set(taken).size, `${homes} homes, ${workplaces} workplaces`).toBe(taken.length);
      for (const j of taken) expect(jobIds.has(j)).toBe(true);
      // everyone is in the map, and every job or every resident is taken care of
      expect(got.size).toBe(residents.length);
      expect(taken.length).toBe(Math.min(residents.length, jobs.length));
    }
  });

  it("leaves residents without a job when there are not enough, and a job unfilled when there are not enough residents", () => {
    const some = assignJobs(onLine(10), jobsAt([50, 0], 4, 100), 1);
    expect([...some.values()].filter((j) => j === null)).toHaveLength(6);
    expect([...some.values()].filter((j) => j !== null)).toHaveLength(4);
    const spare = assignJobs(onLine(3), jobsAt([50, 0], 4, 100), 1);
    expect([...spare.values()].every((j) => j !== null)).toBe(true);
  });

  it("gives a resident the nearest workplace, then the next once it is full", () => {
    const near = jobsAt([10, 0], 2, 100);
    const far = jobsAt([40, 0], 12, 200);
    const got = assignJobs(onLine(5), [...near, ...far], 1); // residents at x = 1..5
    const where = (id: number) => [...near, ...far].find((j) => j.id === got.get(id))!.work;
    const atNear = onLine(5).filter((r) => where(r.id)[0] === 10);
    expect(atNear).toHaveLength(2); // the two jobs at (10, 0) go first, to whoever is served first
    expect(onLine(5).filter((r) => where(r.id)[0] === 40)).toHaveLength(3);
  });

  it("gives each workplace's jobs out one by one, lowest id first", () => {
    const got = assignJobs(onLine(3), jobsAt([10, 0], 5, 300), 1);
    expect([...got.values()].sort()).toEqual([300, 301, 302]);
  });

  it("breaks a tie between equally near workplaces by the seed: some of each, and the same every time", () => {
    // one resident at the origin, a workplace three cells east and another three cells north
    const residents: Resident[] = [{ id: 7, home: [0, 0] }];
    const jobs = [...jobsAt([3, 0], 1, 10), ...jobsAt([0, 3], 1, 20)];
    const picks = new Set<number | null>();
    for (let seed = 1; seed <= 40; seed++) {
      const first = assignJobs(residents, jobs, seed).get(7);
      expect(assignJobs(residents, jobs, seed).get(7)).toBe(first);
      expect(assignJobs(residents, [...jobs].reverse(), seed).get(7)).toBe(first);
      picks.add(first!);
    }
    expect([...picks].sort()).toEqual([10, 20]);
  });

  it("never gives a resident a farther job while a nearer one stays free to the end", () => {
    // jobs outnumber residents: some stay free, and nobody can have passed over a nearer free one
    for (const seed of [1, 2, 3, 4]) {
      const { residents, jobs } = scatter(seed, 25, 60, 80);
      expect(jobs.length).toBeGreaterThan(residents.length);
      const got = assignJobs(residents, jobs, seed);
      const taken = new Set([...got.values()].filter((j): j is number => j !== null));
      const free = jobs.filter((j) => !taken.has(j.id));
      expect(free.length).toBeGreaterThan(0);
      const byId = new Map(jobs.map((j) => [j.id, j]));
      for (const r of residents) {
        const mine = byId.get(got.get(r.id)!)!;
        for (const f of free) expect(dist(r.home, mine.work), `seed ${seed} resident ${r.id}`).toBeLessThanOrEqual(dist(r.home, f.work));
      }
    }
  });

  it("leaves a resident without a job only when every job is taken", () => {
    for (const seed of [1, 2, 3]) {
      const { residents, jobs } = scatter(seed, 80, 12, 120);
      expect(residents.length).toBeGreaterThan(jobs.length);
      const got = assignJobs(residents, jobs, seed);
      const taken = [...got.values()].filter((j) => j !== null);
      expect(taken).toHaveLength(jobs.length);
      expect([...got.values()].some((j) => j === null)).toBe(true);
    }
  });

  it("handles no residents, no jobs, and neither", () => {
    expect(assignJobs([], [], 1).size).toBe(0);
    expect(assignJobs([], jobsAt([1, 1], 4, 1), 1).size).toBe(0);
    const none = assignJobs(onLine(3), [], 1);
    expect([...none.values()]).toEqual([null, null, null]);
  });

  it("works for a city of about six thousand lots in a fraction of a second", () => {
    // 4,500 homes and 1,500 workplaces, mostly offices: about 13,500 residents and 14,400 jobs
    const { residents, jobs } = scatter(9, 4500, 1500, 140);
    const t0 = performance.now();
    const got = assignJobs(residents, jobs, 1);
    const ms = performance.now() - t0;
    expect(got.size).toBe(residents.length);
    expect(ms, `${residents.length} residents, ${jobs.length} jobs: ${ms.toFixed(0)} ms`).toBeLessThan(2000);
  });
});

describe("tripsForDay", () => {
  const home: Cell = [0, 0];
  const work: Cell = [20, 5];
  const places: Cell[] = [[3, 0], [0, 4], [6, 6], [30, 30], [-4, -5], [1, 9], [8, 1]];
  const trip = (id: number, w: Cell | null = work, day = DAY, seed = 1, p: readonly Cell[] = places) => tripsForDay(id, home, w, day, seed, p);
  const ids = Array.from({ length: 400 }, (_, i) => i + 1);

  /** Is the resident away from base (out on an errand, or at its end) at time `t`? */
  const away = (trips: Trip[], t: number) => errandAt(trips, t) !== null;
  /** The day of `n` residents with an errand-friendly city around them; `w` says who works where (nobody, by default). */
  const city = (n: number, w: (id: number) => Cell | null = () => null) => Array.from({ length: n }, (_, i) => trip(i + 1, w(i + 1)));
  const share = (day: Trip[][], t: number) => day.filter((trips) => away(trips, t)).length / day.length;

  it("sends an employed resident to work between 07:00 and 09:30 and home between 16:30 and 19:00", () => {
    for (const id of ids) {
      const trips = trip(id);
      // the commute is the trip out from home to work and the trip home from work; errands from work come between
      const out = trips.find((t) => t.purpose === "work" && t.from[0] === home[0] && t.from[1] === home[1])!;
      const back = trips.find((t) => t.purpose === "home" && t.from[0] === work[0] && t.from[1] === work[1])!;
      expect(out, String(id)).toBeDefined();
      expect(back, String(id)).toBeDefined();
      expect(trips.filter((t) => t.to[0] === home[0] && t.to[1] === home[1] && t.purpose === "home" && t.from[0] === work[0])).toHaveLength(1);
      expect(out.from).toEqual(home);
      expect(out.to).toEqual(work);
      expect(back.from).toEqual(work);
      expect(back.to).toEqual(home);
      expect(out.depart).toBeGreaterThanOrEqual(clock(7));
      expect(out.depart).toBeLessThan(clock(9, 30));
      expect(back.depart).toBeGreaterThanOrEqual(clock(16, 30));
      expect(back.depart).toBeLessThan(clock(19));
    }
  });

  it("spreads the departures over the whole window, not on one minute", () => {
    const outs = ids.map((id) => trip(id).find((t) => t.purpose === "work")!.depart);
    const backs = ids.map((id) => trip(id).find((t) => t.purpose === "home")!.depart);
    const spread = (xs: number[], from: number, to: number) => {
      const bins = new Array(5).fill(0);
      for (const x of xs) bins[Math.min(4, Math.floor(((x - from) / (to - from)) * 5))]++;
      return bins;
    };
    for (const n of spread(outs, clock(7), clock(9, 30))) expect(n).toBeGreaterThan(40);
    for (const n of spread(backs, clock(16, 30), clock(19))) expect(n).toBeGreaterThan(40);
  });

  it("is a pure function of its arguments, and changes with the resident, the day and the seed", () => {
    expect(trip(5)).toEqual(trip(5));
    expect(trip(5)).not.toEqual(trip(6));
    expect(trip(5)).not.toEqual(trip(5, work, clock(0, 0, 0, 1)));
    expect(trip(5)).not.toEqual(trip(5, work, DAY, 2));
  });

  it("lists the trips in the order they depart", () => {
    for (const id of ids) {
      const trips = trip(id);
      expect(trips.map((t) => t.depart)).toEqual([...trips.map((t) => t.depart)].sort((a, b) => a - b));
    }
  });

  it("keeps each leg beginning where the one before ended, and never overlaps two errands", () => {
    for (const id of ids) {
      const trips = trip(id);
      let at: Cell = home;
      for (const t of trips) {
        expect(t.from, `${id} ${t.purpose}`).toEqual(at);
        at = t.to;
      }
      expect(at).toEqual(home); // everyone ends the day at home
    }
  });

  it("gives an unemployed resident errands and no commute", () => {
    for (const id of ids.slice(0, 50)) {
      const trips = trip(id, null);
      expect(trips.some((t) => t.purpose === "work")).toBe(false);
      const errands = trips.filter((t) => t.purpose === "errand" && t.depart < clock(17)); // not the evening outing
      expect(errands, String(id)).toHaveLength(3);
      for (const e of errands) {
        expect(e.from).toEqual(home);
        expect(places.some(([x, y]) => x === e.to[0] && y === e.to[1])).toBe(true);
        expect(e.depart).toBeGreaterThanOrEqual(clock(9, 55));
        expect(e.depart).toBeLessThan(clock(16, 10));
      }
      // every errand is followed by the way back
      const sorted = trips.map((t) => t.purpose);
      sorted.forEach((p, i) => {
        if (p === "errand") expect(["home", "work"]).toContain(sorted[i + 1]);
      });
    }
  });

  it("sends an employed resident on errands from work, and back to work, never past the evening commute", () => {
    for (const id of ids) {
      const trips = trip(id);
      const home16 = trips.find((t) => t.purpose === "home" && t.from[0] === work[0] && t.from[1] === work[1])!;
      const daytime = trips.filter((t) => t.depart > clock(9, 30) && t.depart < home16.depart);
      expect(daytime.length).toBeGreaterThan(0);
      for (const t of daytime) {
        if (t.purpose === "errand") expect(t.from).toEqual(work);
        else expect(t.to).toEqual(work); // a way back from an errand is a trip to work
      }
      const last = daytime[daytime.length - 1];
      expect(last.depart, String(id)).toBeLessThan(home16.depart - 10 * MIN);
    }
  });

  it("puts about a quarter of 200 residents out on errands at 13:00, within 10%", () => {
    // "within 10%" read as ten points either way: 15% to 35% of the 200
    const idle = share(city(200), clock(13));
    expect(idle).toBeGreaterThan(0.15);
    expect(idle).toBeLessThan(0.35);
    // and the same for the employed, who go out from work
    const employed = share(city(200, () => work), clock(13));
    expect(employed).toBeGreaterThan(0.15);
    expect(employed).toBeLessThan(0.35);
  });

  it("keeps a quarter out from half past ten to half past three, over a large city", () => {
    const big = city(3000, (id) => (id % 2 ? work : null)); // half of them work
    for (const [h, m] of [[10, 45], [11, 30], [12, 15], [13, 0], [14, 20], [15, 10], [15, 30]]) {
      const out = share(big, clock(h, m));
      expect(out, `${h}:${m}`).toBeGreaterThan(0.22);
      expect(out, `${h}:${m}`).toBeLessThan(0.28);
    }
  });

  it("has nobody out on an errand in the small hours, and only a few in the evening and after 21:00", () => {
    const big = city(3000);
    for (const [h, m] of [[3, 0], [5, 30], [6, 30], [8, 0], [9, 30]]) expect(share(big, clock(h, m)), `${h}:${m}`).toBe(0);
    expect(share(big, clock(17, 30))).toBe(0); // on the way home from work, no errands
    expect(share(big, clock(19, 0))).toBe(0);
    for (const [h, m] of [[20, 30], [21, 30], [22, 30], [23, 30]]) {
      expect(share(big, clock(h, m)), `${h}:${m}`).toBeGreaterThan(0);
      expect(share(big, clock(h, m)), `${h}:${m}`).toBeLessThan(0.03);
    }
  });

  it("lets a trip run past midnight: a late outing's way home departs on the next day", () => {
    let late = 0;
    for (let id = 1; id <= 3000; id++) {
      const trips = trip(id, null);
      const back = trips[trips.length - 1];
      expect(back.purpose).toBe("home");
      if (back.depart >= clock(24)) {
        late++;
        expect(back.depart).toBeLessThan(clock(24, 30)); // soon after midnight
        // it belongs to the day it began on: the next day's own list starts afresh in the morning
        const next = trip(id, null, clock(0, 0, 0, 1));
        expect(next[0].depart).toBeGreaterThan(back.depart);
      }
    }
    expect(late).toBeGreaterThan(0);
  });

  it("keeps every trip of a year of days on the clock times, whatever the clocks did", () => {
    // across daylight saving, if this Mac's time zone has any: 07:00 stays 07:00 on the wall clock
    for (let d = 0; d < 366; d += 1) {
      const start = new Date(2026, 0, 1 + d).getTime();
      const trips = tripsForDay(77, home, work, start, 3, places);
      const out = new Date(trips.find((t) => t.purpose === "work")!.depart);
      expect(out.getHours() * 60 + out.getMinutes(), `day ${d}`).toBeGreaterThanOrEqual(7 * 60);
      expect(out.getHours() * 60 + out.getMinutes(), `day ${d}`).toBeLessThan(9 * 60 + 30);
      const back = new Date(trips.find((t) => t.purpose === "home")!.depart);
      expect(back.getHours() * 60 + back.getMinutes(), `day ${d}`).toBeGreaterThanOrEqual(16 * 60 + 30);
      expect(back.getHours() * 60 + back.getMinutes(), `day ${d}`).toBeLessThan(19 * 60);
    }
  });

  it("sends no one on an errand to the lot they are leaving", () => {
    for (const id of ids.slice(0, 80)) {
      for (const t of trip(id, [3, 0])) expect(t.from[0] === t.to[0] && t.from[1] === t.to[1], String(id)).toBe(false);
    }
  });

  it("no workplace, no commute, no crash: nobody without a job or a place to go has anything to do", () => {
    const sim = lots([[0, 1, "house"], [2, 1, "row"], [4, 1, "apartment"]]);
    const residents = residentsOf(sim, TIER3);
    const js = jobsOf(sim);
    expect(js).toEqual([]);
    const got = assignJobs(residents, js, 7);
    expect(residents.length).toBeGreaterThan(0);
    for (const r of residents) {
      expect(got.get(r.id)).toBeNull();
      const trips = tripsForDay(r.id, r.home, null, DAY, 7, placesOf(sim));
      expect(trips.some((t) => t.purpose === "work")).toBe(false);
      expect(trips).toEqual([]); // no shops, no parks: nowhere to go
      expect(tripsForDay(r.id, r.home, null, DAY, 7)).toEqual([]); // and the places are optional
    }
    // a city with nothing in it at all
    const empty = new CitySim(cfg);
    expect(residentsOf(empty, 0)).toEqual([]);
    expect(jobsOf(empty)).toEqual([]);
    expect(placesOf(empty)).toEqual([]);
    expect(assignJobs([], [], 1).size).toBe(0);
  });

  it("without places an employed resident still commutes", () => {
    const trips = tripsForDay(9, home, work, DAY, 1);
    expect(trips.map((t) => t.purpose)).toEqual(["work", "home"]);
  });

  it("goes to one of the four nearest places, not any in the city", () => {
    // from (0, 0): distances 3, 4, 9 and 9 are the nearest four; the places at 10, 12 and 60 are never chosen
    const nearest = new Set(["3,0", "0,4", "-4,-5", "8,1"]);
    const seen = new Set<string>();
    for (const id of ids) for (const t of trip(id, null)) if (t.purpose === "errand") seen.add(`${t.to[0]},${t.to[1]}`);
    expect(seen.size).toBeGreaterThanOrEqual(3); // they do not all choose the same
    for (const k of seen) expect(nearest.has(k), k).toBe(true);
  });
});

describe("errandAt", () => {
  const home: Cell = [0, 0];
  const shop: Cell = [5, 5];
  const trips: Trip[] = [
    { from: home, to: shop, depart: 1000, purpose: "errand" },
    { from: shop, to: home, depart: 2000, purpose: "home" },
    { from: home, to: [9, 9], depart: 5000, purpose: "errand" },
    { from: [9, 9], to: home, depart: 6000, purpose: "home" },
  ];

  it("names the place from the errand's departure until the trip back departs", () => {
    expect(errandAt(trips, 999)).toBeNull();
    expect(errandAt(trips, 1000)).toEqual(shop);
    expect(errandAt(trips, 1999)).toEqual(shop);
    expect(errandAt(trips, 2000)).toBeNull();
    expect(errandAt(trips, 5500)).toEqual([9, 9]);
    expect(errandAt(trips, 6000)).toBeNull();
    expect(errandAt(trips, 99_999)).toBeNull();
  });

  it("is null for a day with no errands, and for no trips", () => {
    expect(errandAt([], 1000)).toBeNull();
    expect(errandAt([{ from: home, to: shop, depart: 0, purpose: "work" }, { from: shop, to: home, depart: 10, purpose: "home" }], 5)).toBeNull();
  });
});

describe("roadPath", () => {
  const roads = (...cells: Cell[]) => {
    const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
    return (x: number, y: number) => keys.has(`${x},${y}`);
  };
  const row = (y: number, from: number, to: number): Cell[] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y] as Cell);
  const column = (x: number, from: number, to: number): Cell[] => Array.from({ length: to - from + 1 }, (_, i) => [x, from + i] as Cell);
  const adjacent = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

  it("starts at a road cell beside the first lot and ends at one beside the second", () => {
    const isRoad = roads(...row(0, 0, 9));
    const path = roadPath(isRoad, [0, -1], [9, 1])!; // lots north of the first cell and south of the last
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([9, 0]);
    expect(path).toHaveLength(10);
    for (let i = 1; i < path.length; i++) expect(adjacent(path[i - 1], path[i])).toBe(true);
  });

  it("finds the shortest way, round a bend", () => {
    // an L: along y = 0 to x = 5, then down x = 5 to y = 4; a long way round beside it
    const isRoad = roads(...row(0, 0, 5), ...column(5, 1, 4), ...row(8, 0, 5), ...column(0, 1, 8));
    const path = roadPath(isRoad, [0, -1], [6, 4])!; // beside (0, 0) and beside (5, 4)
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([5, 4]);
    expect(path).toHaveLength(6 + 4); // 6 cells along, 4 more down
    for (const [x, y] of path) expect(isRoad(x, y)).toBe(true);
    for (let i = 1; i < path.length; i++) expect(adjacent(path[i - 1], path[i])).toBe(true);
  });

  it("starts from whichever road beside the first lot gives the shortest way", () => {
    // the first lot at (5, 5) has road to its west (4, 5) and its east (6, 5); the goal is far to the east
    const isRoad = roads(...row(5, 4, 4), ...row(5, 6, 20));
    const path = roadPath(isRoad, [5, 5], [21, 5])!;
    expect(path[0]).toEqual([6, 5]);
    expect(path[path.length - 1]).toEqual([20, 5]);
    // and the same pair the other way is the same length
    expect(roadPath(isRoad, [21, 5], [5, 5])!).toHaveLength(path.length);
  });

  it("is one cell long when both lots touch the same road cell, and when it is a lot's own street", () => {
    const isRoad = roads(...row(0, 0, 3));
    expect(roadPath(isRoad, [1, -1], [1, 1])).toEqual([[1, 0]]);
    expect(roadPath(isRoad, [1, -1], [1, -1])).toEqual([[1, 0]]);
  });

  it("returns null when the roads are not connected, or a lot has no road beside it", () => {
    const apart = roads(...row(0, 0, 4), ...row(10, 0, 4));
    expect(roadPath(apart, [0, -1], [0, 11])).toBeNull();
    expect(roadPath(apart, [0, -1], [50, 50])).toBeNull(); // no road beside the destination
    expect(roadPath(apart, [50, 50], [0, -1])).toBeNull(); // nor beside the origin
    expect(roadPath(() => false, [0, 0], [3, 3])).toBeNull();
  });

  it("gives up after maxNodes road cells: a trip too far to search is none", () => {
    const isRoad = roads(...row(0, 0, 100));
    const far = roadPath(isRoad, [0, -1], [100, 1], 5000);
    expect(far).toHaveLength(101);
    expect(roadPath(isRoad, [0, -1], [100, 1], 50)).toBeNull();
    expect(roadPath(isRoad, [0, -1], [100, 1], 101)).toHaveLength(101); // a road cell is counted as it is searched
    expect(roadPath(isRoad, [0, -1], [100, 1])).toHaveLength(101); // the default is generous enough for this
    // the default cuts a search at 4000 cells
    const long = roads(...row(0, 0, 5000));
    expect(roadPath(long, [0, -1], [4500, 1])).toBeNull();
    expect(roadPath(long, [0, -1], [3000, 1])).toHaveLength(3001);
  });

  it("is the same path every time, whichever of equal paths it picks", () => {
    // a block of road: many shortest paths between two corners
    const cells: Cell[] = [];
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) cells.push([x, y]);
    const isRoad = roads(...cells);
    const a = roadPath(isRoad, [-1, 0], [6, 5])!;
    expect(roadPath(isRoad, [-1, 0], [6, 5])).toEqual(a);
    expect(a).toHaveLength(5 + 5 + 1); // from (0, 0) to (5, 5)
  });
});

describe("positionAt", () => {
  // east two cells, south one, east one: 4 steps
  const path: Cell[] = [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1]];
  const T0 = 1_000_000;

  it("walks the path at the given speed in cells a second, at the cell centres and between them", () => {
    const p0 = positionAt(path, T0, 2, T0)!;
    expect(p0).toMatchObject({ x: 0, y: 0 });
    const p1 = positionAt(path, T0, 2, T0 + 250)!; // 0.5 cell along
    expect(p1.x).toBeCloseTo(0.5);
    expect(p1.y).toBeCloseTo(0);
    const p2 = positionAt(path, T0, 2, T0 + 1500)!; // 3 cells: the south corner
    expect(p2.x).toBeCloseTo(2);
    expect(p2.y).toBeCloseTo(1); // cell (2, 1)
    const p3 = positionAt(path, T0, 2, T0 + 1250)!; // 2.5 cells: halfway down
    expect(p3.x).toBeCloseTo(2);
    expect(p3.y).toBeCloseTo(0.5);
  });

  it("faces the way it is going: 0 east, 1 south, 2 west, 3 north", () => {
    expect(positionAt(path, T0, 1, T0 + 500)!.heading).toBe(0);
    expect(positionAt(path, T0, 1, T0 + 2500)!.heading).toBe(1);
    expect(positionAt(path, T0, 1, T0 + 3500)!.heading).toBe(0);
    const back: Cell[] = [[3, 1], [2, 1], [2, 0]];
    expect(positionAt(back, T0, 1, T0 + 500)!.heading).toBe(2);
    expect(positionAt(back, T0, 1, T0 + 1500)!.heading).toBe(3);
  });

  it("is null before it departs and after it arrives", () => {
    expect(positionAt(path, T0, 2, T0 - 1)).toBeNull();
    expect(positionAt(path, T0, 2, T0 - 10_000)).toBeNull();
    // four cells at two a second: two seconds
    expect(positionAt(path, T0, 2, T0 + 1999)).not.toBeNull();
    expect(positionAt(path, T0, 2, T0 + 2000)).toBeNull();
    expect(positionAt(path, T0, 2, T0 + 60_000)).toBeNull();
  });

  it("is null for a path of one cell or none: there is nowhere to travel", () => {
    expect(positionAt([[4, 4]], T0, 2, T0)).toBeNull();
    expect(positionAt([], T0, 2, T0)).toBeNull();
  });

  it("does not care what day it is: a trip begun before midnight is still under way after it", () => {
    const start = clock(23, 59, 55);
    const long: Cell[] = Array.from({ length: 41 }, (_, i) => [i, 0] as Cell); // 40 cells
    const [before, after] = [positionAt(long, start, DRIVE_SPEED, clock(23, 59, 58))!, positionAt(long, start, DRIVE_SPEED, clock(24, 0, 3))!];
    expect(before.x).toBeCloseTo(12);
    expect(after.x).toBeCloseTo(32); // 8 seconds in, past midnight
    expect(positionAt(long, start, DRIVE_SPEED, clock(24, 0, 5))).toBeNull(); // 10 seconds: arrived
  });
});

describe("walking and driving", () => {
  const line = (n: number): Cell[] => Array.from({ length: n }, (_, i) => [i, 0] as Cell);

  it("walks up to eight cells at 1.2 cells a second, and drives further at 4", () => {
    expect([WALK_SPEED, DRIVE_SPEED, WALK_MAX_CELLS]).toEqual([1.2, 4, 8]);
    expect(travelOf(line(1))).toEqual({ walking: true, speed: 1.2 });
    expect(travelOf(line(8))).toEqual({ walking: true, speed: 1.2 });
    expect(travelOf(line(9))).toEqual({ walking: false, speed: 4 });
    expect(travelOf(line(300))).toEqual({ walking: false, speed: 4 });
  });
});

describe("routeTrips", () => {
  const road = (...cells: Cell[]) => {
    const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
    return (x: number, y: number) => keys.has(`${x},${y}`);
  };
  const street = Array.from({ length: 21 }, (_, i) => [i, 0] as Cell);
  const trips: Trip[] = [
    { from: [0, -1], to: [20, -1], depart: 1000, purpose: "work" },
    { from: [20, -1], to: [3, -1], depart: 5000, purpose: "errand" },
    { from: [3, -1], to: [3, 1], depart: 9000, purpose: "home" },
  ];

  it("finds each trip's path and speed, and when it arrives", () => {
    const routes = routeTrips(road(...street), trips);
    expect(routes).toHaveLength(3);
    const [far, mid, short] = routes;
    expect(far.trip).toBe(trips[0]);
    expect(far.path).toHaveLength(21);
    expect(far.speed).toBe(DRIVE_SPEED);
    expect(far.arrive).toBeCloseTo(1000 + (20 / DRIVE_SPEED) * 1000);
    expect(mid.path).toHaveLength(18);
    expect(mid.speed).toBe(DRIVE_SPEED);
    expect(short.path).toHaveLength(1);
    expect(short.speed).toBe(WALK_SPEED);
    expect(short.arrive).toBe(9000);
  });

  it("drops a trip that has no way: no road beside a lot, or the roads do not meet", () => {
    const two = road(...street, [30, 0], [31, 0]);
    const cut: Trip[] = [...trips, { from: [0, -1], to: [31, -1], depart: 20_000, purpose: "errand" }, { from: [50, 50], to: [0, -1], depart: 30_000, purpose: "home" }];
    const routes = routeTrips(two, cut);
    expect(routes.map((r) => r.trip)).toEqual(trips); // the other two are dropped, the rest keep their order
  });

  it("drops a trip too far to search", () => {
    const long = Array.from({ length: 5001 }, (_, i) => [i, 0] as Cell);
    const far: Trip[] = [{ from: [0, -1], to: [4600, -1], depart: 0, purpose: "work" }, ...trips.slice(2)];
    const routes = routeTrips(road(...long, ...street), far);
    expect(routes.map((r) => r.trip.purpose)).toEqual(["home"]);
    expect(routeTrips(road(...long), far.slice(0, 1), 6000)).toHaveLength(1); // unless the limit is raised
  });

  it("is empty for no trips", () => {
    expect(routeTrips(road(...street), [])).toEqual([]);
  });
});
