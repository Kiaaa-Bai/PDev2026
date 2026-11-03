import { describe, expect, it } from "vitest";
import {
  AMBIENT_DAY,
  AMBIENT_NIGHT,
  LANE_TINT,
  roadColour,
  roadTier,
  roofBand,
  roofColour,
  ROOF_COLOURS,
  SKY_DAY,
  SKY_DUSK,
  SKY_NIGHT,
  skyAt,
  SUN_DAY,
  SUN_NIGHT,
  WHITE,
} from "../src/render/looks";

/** A moment on 3 November 2026 by the local clock, which is what a roof's hour means. */
const at = (h: number, m: number) => new Date(2026, 10, 3, h, m).getTime();

describe("roadTier", () => {
  it("steps at 1, 2 and 3 times driven", () => {
    expect(roadTier(1)).toBe(1);
    expect(roadTier(2)).toBe(2);
    expect(roadTier(3)).toBe(3);
  });

  it("stays at the top tier beyond 3, and at the bottom tier below 1", () => {
    expect(roadTier(4)).toBe(3);
    expect(roadTier(250)).toBe(3);
    expect(roadTier(0)).toBe(1);
  });
});

describe("roofBand", () => {
  it("uses local hour edges", () => {
    expect(roofBand(at(5, 59))).toBe(3);
    expect(roofBand(at(6, 0))).toBe(0);
    expect(roofBand(at(11, 59))).toBe(0);
    expect(roofBand(at(12, 0))).toBe(1);
    expect(roofBand(at(17, 59))).toBe(1);
    expect(roofBand(at(18, 0))).toBe(2);
    expect(roofBand(at(23, 59))).toBe(2);
    expect(roofBand(at(0, 0))).toBe(3);
  });

  it("goes by the date's local hours, not a 24 h remainder of the timestamp", () => {
    // another day, another month: the band still follows the clock on the wall
    expect(roofBand(new Date(2026, 0, 17, 13, 30).getTime())).toBe(1);
    expect(roofBand(new Date(2025, 6, 4, 2, 5).getTime())).toBe(3);
  });
});

describe("colours", () => {
  it("has one distinct roof colour per band, and the lane tint is not white", () => {
    expect(ROOF_COLOURS).toHaveLength(4);
    expect(new Set(ROOF_COLOURS).size).toBe(4);
    expect(LANE_TINT).not.toBe(WHITE);
  });

  it("tints only the narrowest roads", () => {
    expect(roadColour(1)).toBe(LANE_TINT);
    expect(roadColour(2)).toBe(WHITE);
    expect(roadColour(3)).toBe(WHITE);
  });

  it("colours suburban roofs by the hour they were built, and leaves commercial ones alone", () => {
    expect(roofColour(1, at(8, 0))).toBe(ROOF_COLOURS[0]);
    expect(roofColour(2, at(20, 0))).toBe(ROOF_COLOURS[2]);
    expect(roofColour(3, at(20, 0))).toBe(WHITE);
  });
});

/** The sky at a local time on 3 November 2026. */
const sky = (h: number, m = 0) => skyAt(new Date(2026, 10, 3, h, m));

describe("skyAt", () => {
  it("is full day at noon and full night at 23:00", () => {
    expect(sky(12)).toEqual({ sky: SKY_DAY, sun: SUN_DAY, ambient: AMBIENT_DAY, night: 0 });
    expect(sky(23)).toEqual({ sky: SKY_NIGHT, sun: SUN_NIGHT, ambient: AMBIENT_NIGHT, night: 1 });
  });

  it("is half way at 06:00, with the sky at its dusk colour", () => {
    const s = sky(6);
    expect(s.night).toBe(0.5);
    expect(s.sun).toBeCloseTo((SUN_DAY + SUN_NIGHT) / 2);
    expect(s.ambient).toBeCloseTo((AMBIENT_DAY + AMBIENT_NIGHT) / 2);
    expect(s.sky).toBe(SKY_DUSK);
  });

  it("changes over at 05:00 to 07:00 and 18:00 to 20:00, and is steady outside them", () => {
    for (const [h, m] of [[0, 0], [3, 30], [5, 0], [20, 0], [21, 15], [23, 59]]) expect(sky(h, m).night).toBe(1);
    for (const [h, m] of [[7, 0], [9, 30], [12, 0], [15, 45], [18, 0]]) expect(sky(h, m).night).toBe(0);
  });

  it("goes in a straight line between, down in the morning and up in the evening", () => {
    expect(sky(5, 30).night).toBeCloseTo(0.75);
    expect(sky(6, 30).night).toBeCloseTo(0.25);
    expect(sky(18, 30).night).toBeCloseTo(0.25);
    expect(sky(19, 0).night).toBeCloseTo(0.5);
    expect(sky(19, 30).night).toBeCloseTo(0.75);
    // the evening mirrors the morning
    expect(sky(19, 0)).toEqual(sky(6, 0));
  });

  it("dims the lights as the night comes in", () => {
    let before = sky(18, 0);
    for (let m = 1; m <= 120; m++) {
      const s = sky(18, m);
      expect(s.sun).toBeLessThanOrEqual(before.sun);
      expect(s.ambient).toBeLessThanOrEqual(before.ambient);
      expect(s.night).toBeGreaterThanOrEqual(before.night);
      before = s;
    }
    expect(SUN_NIGHT).toBeLessThan(SUN_DAY);
    expect(AMBIENT_NIGHT).toBeLessThan(AMBIENT_DAY);
  });

  it("always gives a colour that is a whole 24-bit number", () => {
    for (let m = 0; m < 24 * 60; m++) {
      const c = sky(0, m).sky;
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("has three different sky colours", () => {
    expect(new Set([SKY_DAY, SKY_DUSK, SKY_NIGHT]).size).toBe(3);
  });
});
