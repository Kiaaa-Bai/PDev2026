import { describe, expect, it } from "vitest";
import { CITY } from "../src/config";
import { parseJsonl, toStrokes, type TouchRecord } from "../src/data";
import { Feeder } from "../src/drive";
import { CitySim } from "../src/sims/city";
import { SCREEN, testCityDayFiles, testCityRecords, testCityStart, testCityStartProblem, testCityTargetProblem } from "../src/sims/testcity";

/** A Monday morning in this machine's time zone; the generated days start on its date. */
const START = new Date(2026, 9, 12, 7, 30).getTime();
const at = (day: number, hour: number) => new Date(2026, 9, 12 + day, hour).getTime();

describe("testCityRecords", () => {
  it("gives the same records for the same seed, and other records for another seed", () => {
    const a = testCityRecords(7, 1, START);
    expect(a.length).toBeGreaterThan(0);
    expect(testCityRecords(7, 1, START)).toEqual(a);
    expect(testCityRecords(8, 1, START)).not.toEqual(a);
  });

  it("makes no records for no days", () => {
    expect(testCityRecords(7, 0, START)).toEqual([]);
  });

  it("is in time order and inside 09:00–18:00 on each of the days", () => {
    const records = testCityRecords(3, 3, START);
    for (let i = 1; i < records.length; i++) expect(records[i].t).toBeGreaterThanOrEqual(records[i - 1].t);
    for (const r of records) {
      const day = [0, 1, 2].find((d) => r.t >= at(d, 9) && r.t <= at(d, 18));
      expect(day, `record at ${new Date(r.t).toString()}`).toBeDefined();
    }
    for (const d of [0, 1, 2]) {
      expect(records.some((r) => r.t >= at(d, 9) && r.t <= at(d, 18))).toBe(true);
    }
  });

  it("is a pointer: one finger, every stroke a down, moves and an up of 20–400 points, inside the screen", () => {
    const records = testCityRecords(5, 2, START);
    expect(new Set(records.map((r) => r.id))).toEqual(new Set([0]));
    let open: TouchRecord[] | null = null;
    let strokes = 0;
    let lastUp = -Infinity;
    for (const r of records) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x).toBeLessThanOrEqual(SCREEN.w);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThanOrEqual(SCREEN.h);
      if (r.state === "down") {
        expect(open).toBeNull();
        expect(r.t - lastUp, "a pause of at least a second").toBeGreaterThanOrEqual(1000);
        open = [r];
      } else {
        expect(open).not.toBeNull();
        open!.push(r);
        if (r.state === "up") {
          expect(open!.length).toBeGreaterThanOrEqual(20);
          expect(open!.length).toBeLessThanOrEqual(400);
          expect(open!.slice(1, -1).every((m) => m.state === "move")).toBe(true);
          strokes++;
          lastUp = r.t;
          open = null;
        }
      }
    }
    expect(open).toBeNull();
    expect(strokes).toBeGreaterThan(50);
    expect(toStrokes(records)).toHaveLength(strokes);
  });

  it("pauses 1–40 seconds between strokes within a burst, and rests longer between bursts", () => {
    const strokes = toStrokes(testCityRecords(5, 2, START));
    const gaps = strokes.slice(1).map((s, i) => s.points[0].t - strokes[i].points.at(-1)!.t);
    const within = gaps.filter((g) => g <= 40_000);
    expect(within.length).toBeGreaterThan(gaps.length / 2);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000);
    expect(gaps.some((g) => g > 40_000)).toBe(true);
    // a rest between bursts is minutes, not seconds
    expect(Math.min(...gaps.filter((g) => g > 40_000))).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("heads in varied directions, so the roller turns to all four", () => {
    const sim = new CitySim(CITY);
    const feeder = new Feeder(() => [sim]);
    const seen = new Set<number>();
    let turns = 0;
    let dir = sim.roller.dir;
    for (const r of testCityRecords(11, 1, START)) {
      feeder.push(r);
      seen.add(sim.roller.dir);
      if (sim.roller.dir !== dir) turns++;
      dir = sim.roller.dir;
    }
    expect(seen.size).toBe(4);
    expect(turns).toBeGreaterThan(50);
  });

  it("two days of records grow a city of at least 200 road tiles and 150 lots", () => {
    const records = testCityRecords(1, 2, START);
    const sim = new CitySim(CITY);
    const feeder = new Feeder(() => [sim]);
    for (const r of records) feeder.push(r);
    sim.advanceTo(records.at(-1)!.t + 60_000);
    expect(sim.road.size).toBeGreaterThanOrEqual(200);
    expect(sim.lots.size).toBeGreaterThanOrEqual(150);
  });
});

describe("testCityDayFiles", () => {
  it("splits the records into one cursor-YYYY-MM-DD.jsonl per local day that parse back to the records", () => {
    const records = testCityRecords(2, 3, START);
    const files = testCityDayFiles(records);
    expect(files.map((f) => f.name)).toEqual([
      "cursor-2026-10-12.jsonl",
      "cursor-2026-10-13.jsonl",
      "cursor-2026-10-14.jsonl",
    ]);
    expect(files.flatMap((f) => parseJsonl(f.text))).toEqual(records);
    for (const f of files) expect(f.text.endsWith("\n")).toBe(true);
  });

  it("makes no files for no records", () => {
    expect(testCityDayFiles([])).toEqual([]);
  });
});

describe("testCityStart", () => {
  const tuesday = new Date(2026, 10, 3, 15, 10).getTime();
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

  it("starts at local midnight of the date it is given, whatever today is", () => {
    expect(testCityStart(3, "2026-10-12", tuesday)).toBe(local(2026, 10, 12));
    expect(testCityStart(3, "2026-10-12", local(2030, 1, 1))).toBe(local(2026, 10, 12));
  });

  it("gives the same files whenever it is run, once the date is given", () => {
    const names = (now: number) =>
      testCityDayFiles(testCityRecords(1, 2, testCityStart(2, "2026-10-12", now)!)).map((f) => f.name);
    expect(names(tuesday)).toEqual(["cursor-2026-10-12.jsonl", "cursor-2026-10-13.jsonl"]);
    expect(names(local(2031, 5, 5))).toEqual(names(tuesday));
  });

  it("without a date, the days end yesterday", () => {
    expect(testCityStart(1, undefined, tuesday)).toBe(local(2026, 11, 2));
    expect(testCityStart(3, undefined, tuesday)).toBe(local(2026, 10, 31));
    expect(testCityStart(3, undefined, local(2027, 1, 2))).toBe(local(2026, 12, 30));
  });

  it("is null for anything that is not a real YYYY-MM-DD date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "10/12/2026", "2026-1-5", "", "tomorrow", "2026-10-12x"]) {
      expect(testCityStart(3, bad, tuesday), bad).toBeNull();
    }
  });
});

describe("testCityTargetProblem", () => {
  const appData = "/Users/me/Library/Application Support/edu.nyu.kiabai.trackpad";
  const data = "/work/prototypes/data";
  const guarded = [appData, data];

  it("accepts a new folder, an empty one, and one holding other files", () => {
    expect(testCityTargetProblem("/work/prototypes/data/test-city", guarded, [])).toBeNull();
    expect(testCityTargetProblem("/tmp/city", guarded, ["notes.txt", "touches-2026-10-10.jsonl"])).toBeNull();
  });

  it("refuses the app data folder and prototypes/data themselves, with or without a trailing slash", () => {
    for (const dir of [appData, appData + "/", data, data + "/"]) {
      expect(testCityTargetProblem(dir, guarded, []), dir).toMatch(/own data folder/);
    }
  });

  it("compares case-blind, as the Mac's file system does", () => {
    for (const dir of ["/work/Prototypes/DATA", "/WORK/prototypes/data/", appData.toUpperCase(), appData.toLowerCase()]) {
      expect(testCityTargetProblem(dir, guarded, []), dir).toMatch(/own data folder/);
    }
    expect(testCityTargetProblem("/work/Prototypes/Data/Test-City", guarded, [])).toBeNull();
    expect(testCityTargetProblem("/tmp/city", guarded, ["CURSOR-2026-10-12.JSONL"])).not.toBeNull();
    expect(testCityTargetProblem("/tmp/city", guarded, ["City-Snapshot.json"])).not.toBeNull();
  });

  it("refuses a folder that already holds day files or a city snapshot", () => {
    expect(testCityTargetProblem("/tmp/city", guarded, ["cursor-2026-10-12.jsonl"])).toMatch(/cursor-2026-10-12\.jsonl/);
    expect(testCityTargetProblem("/tmp/city", guarded, ["city-snapshot.json"])).toMatch(/city-snapshot\.json/);
    expect(testCityTargetProblem("/tmp/city", guarded, ["city-snapshot.json.tmp"])).not.toBeNull();
  });
});

describe("testCityStartProblem", () => {
  const tuesday = new Date(2026, 10, 3, 15, 10).getTime();
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

  it("accepts days that all end before today, up to yesterday", () => {
    expect(testCityStartProblem(3, local(2026, 10, 12), tuesday)).toBeNull();
    expect(testCityStartProblem(3, local(2026, 10, 31), tuesday)).toBeNull();
    expect(testCityStartProblem(1, local(2026, 11, 2), tuesday)).toBeNull();
    expect(testCityStartProblem(2, local(2027, 2, 27), local(2027, 3, 1))).toBeNull();
  });

  it("refuses days that reach today, whose file the capture source appends to, or later", () => {
    expect(testCityStartProblem(1, local(2026, 11, 3), tuesday)).toMatch(/2026-11-03.*today/);
    expect(testCityStartProblem(3, local(2026, 11, 1), tuesday)).toMatch(/2026-11-03/);
    expect(testCityStartProblem(1, local(2026, 12, 25), tuesday)).toMatch(/2026-12-25/);
    expect(testCityStartProblem(3, local(2027, 2, 27), local(2027, 3, 1))).toMatch(/2027-03-01/);
  });

  it("never refuses the default start, which ends yesterday", () => {
    for (const days of [1, 2, 30]) {
      expect(testCityStartProblem(days, testCityStart(days, undefined, tuesday)!, tuesday)).toBeNull();
    }
  });
});
