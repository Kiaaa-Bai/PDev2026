import { describe, expect, it } from "vitest";
import { LANE_TINT, roadColour, roadTier, roofBand, roofColour, ROOF_COLOURS, WHITE } from "../src/render/looks";

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
