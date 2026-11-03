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
  sameSky,
  skyAt,
  SUN_COLOUR_DAY,
  SUN_COLOUR_DUSK,
  SUN_COLOUR_NIGHT,
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

  it("colours a roof by the hour its house was built", () => {
    expect(roofColour(at(8, 0))).toBe(ROOF_COLOURS[0]);
    expect(roofColour(at(14, 0))).toBe(ROOF_COLOURS[1]);
    expect(roofColour(at(20, 0))).toBe(ROOF_COLOURS[2]);
    expect(roofColour(at(3, 0))).toBe(ROOF_COLOURS[3]);
  });
});

/** The sky at a local time on 3 November 2026. */
const sky = (h: number, m = 0) => skyAt(new Date(2026, 10, 3, h, m));

describe("skyAt", () => {
  it("is full day at noon and full night at 23:00", () => {
    expect(sky(12)).toEqual({ sky: SKY_DAY, sunColour: SUN_COLOUR_DAY, sun: SUN_DAY, ambient: AMBIENT_DAY, night: 0 });
    expect(sky(23)).toEqual({ sky: SKY_NIGHT, sunColour: SUN_COLOUR_NIGHT, sun: SUN_NIGHT, ambient: AMBIENT_NIGHT, night: 1 });
  });

  it("is half way at 06:00, with the sky at its dusk colour", () => {
    const s = sky(6);
    expect(s.night).toBe(0.5);
    expect(s.sun).toBeCloseTo((SUN_DAY + SUN_NIGHT) / 2);
    expect(s.ambient).toBeCloseTo((AMBIENT_DAY + AMBIENT_NIGHT) / 2);
    expect(s.sky).toBe(SKY_DUSK);
    expect(s.sunColour).toBe(SUN_COLOUR_DUSK);
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

  it("always gives colours that are whole 24-bit numbers", () => {
    for (let m = 0; m < 24 * 60; m++) {
      for (const c of [sky(0, m).sky, sky(0, m).sunColour]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it("has three different sky colours and three different sun colours", () => {
    expect(new Set([SKY_DAY, SKY_DUSK, SKY_NIGHT]).size).toBe(3);
    expect(new Set([SUN_COLOUR_DAY, SUN_COLOUR_DUSK, SUN_COLOUR_NIGHT]).size).toBe(3);
  });

  // The light's colour moves through the day, whatever the constants are: neutral at noon, warm at
  // dusk (red above blue), cool at night (blue above red). A constant colour cannot pass all three.
  const rgb = (c: number) => ({ r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 });

  it("lights neutral at noon, warm at 19:00 and cool at 23:00", () => {
    for (const pick of [(s: ReturnType<typeof sky>) => s.sunColour, (s: ReturnType<typeof sky>) => s.sky]) {
      const noon = rgb(pick(sky(12)));
      const dusk = rgb(pick(sky(19)));
      const night = rgb(pick(sky(23)));
      expect(Math.abs(noon.r - noon.b)).toBeLessThanOrEqual(24); // close to neutral by day
      expect(dusk.r).toBeGreaterThan(dusk.b + 30);
      expect(night.b).toBeGreaterThan(night.r + 30);
    }
  });

  it("moves the light colour smoothly from warm at dusk to cool at night", () => {
    let before = rgb(sky(19, 0).sunColour);
    for (let m = 1; m <= 60; m++) {
      const now = rgb(sky(19, m).sunColour);
      expect(now.b - now.r).toBeGreaterThanOrEqual(before.b - before.r); // never turns warmer on the way to night
      before = now;
    }
    expect(before.b).toBeGreaterThan(before.r);
  });
});

describe("sameSky", () => {
  const base = sky(19);

  it("is true for the same values, and false when any one of them differs", () => {
    expect(sameSky(base, { ...base })).toBe(true);
    expect(sameSky(base, sky(19, 0))).toBe(true);
    for (const key of Object.keys(base) as (keyof typeof base)[]) expect(sameSky(base, { ...base, [key]: base[key] + 1 }), key).toBe(false);
  });

  it("holds through the full day and the full night, and not through the changeover", () => {
    expect(sameSky(sky(9), sky(15, 30))).toBe(true);
    expect(sameSky(sky(21), sky(3))).toBe(true);
    expect(sameSky(sky(18, 0), sky(18, 1))).toBe(false);
    expect(sameSky(sky(5, 0), sky(5, 1))).toBe(false);
  });
});
