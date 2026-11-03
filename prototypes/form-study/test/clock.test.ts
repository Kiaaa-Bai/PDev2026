import { describe, expect, it } from "vitest";
import { fastForward, hourParam, runningClock, skyTime } from "../src/clock";

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

describe("fastForward", () => {
  const HOUR = 3_600_000;

  it("adds nothing until the key has been held", () => {
    expect(fastForward(0)).toBe(0);
  });

  it("runs a whole day in twelve seconds of holding", () => {
    expect(fastForward(500)).toBe(HOUR);
    expect(fastForward(6_000)).toBe(12 * HOUR);
  });

  it("starts the day over instead of running past it", () => {
    expect(fastForward(12_000)).toBe(0);
    expect(fastForward(13_000)).toBe(2 * HOUR);
  });
});

describe("runningClock", () => {
  it("is the plain clock when there is no hour to show", () => {
    let wall = new Date(2026, 10, 3, 13, 40, 12);
    const clock = runningClock(null, () => wall);
    expect(clock()).toEqual(wall);
    wall = new Date(2026, 10, 3, 13, 41, 0);
    expect(clock()).toEqual(wall);
  });

  it("starts at the hour asked for today and runs on from there as the real clock does", () => {
    let wall = new Date(2026, 10, 3, 17, 7, 30);
    const clock = runningClock(8.25, () => wall);
    expect(clock()).toEqual(new Date(2026, 10, 3, 8, 15, 0));
    wall = new Date(2026, 10, 3, 17, 7, 42);
    expect(clock()).toEqual(new Date(2026, 10, 3, 8, 15, 12)); // twelve seconds later
  });
});
