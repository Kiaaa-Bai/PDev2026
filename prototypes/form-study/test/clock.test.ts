import { describe, expect, it } from "vitest";
import { hourParam, skyTime } from "../src/clock";

describe("hourParam", () => {
  it("reads ?hour= as hours, with fractions", () => {
    expect(hourParam("?hour=22")).toBe(22);
    expect(hourParam("?x=1&hour=19.5")).toBe(19.5);
    expect(hourParam("?hour=0")).toBe(0);
  });

  it("is null when there is none or it is not a number", () => {
    expect(hourParam("")).toBeNull();
    expect(hourParam("?hour=")).toBeNull();
    expect(hourParam("?hour=noon")).toBeNull();
  });
});

describe("skyTime", () => {
  const now = new Date(2026, 10, 3, 13, 40, 12);
  const recorded = new Date(2026, 9, 11, 19, 5).getTime();

  it("is the wall clock when nothing else is asked for", () => {
    expect(skyTime(null, null, now)).toEqual(now);
  });

  it("is the recording's own time while a recording is replayed", () => {
    const d = skyTime(null, recorded, now);
    expect(d.getTime()).toBe(recorded);
    expect(d.getHours()).toBe(19);
  });

  it("is the time ?hour= names, today, ahead of the recording's and the wall clock", () => {
    const d = skyTime(22, recorded, now);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 3, 22, 0]);
    const half = skyTime(19.5, null, now);
    expect([half.getHours(), half.getMinutes()]).toEqual([19, 30]);
  });
});
