import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/rng";

describe("mulberry32", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("differs for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
