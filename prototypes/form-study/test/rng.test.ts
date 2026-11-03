import { describe, expect, it } from "vitest";
import { Rng, mulberry32 } from "../src/rng";

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

describe("Rng", () => {
  it("matches mulberry32 and resumes from its state", () => {
    const a = new Rng(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b());
    const resumed = new Rng(0);
    resumed.state = a.state;
    for (let i = 0; i < 50; i++) expect(resumed.next()).toBe(a.next());
  });

  it("keeps its whole state in one number that survives JSON", () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const resumed = new Rng(0);
    resumed.state = JSON.parse(JSON.stringify(a.state));
    expect(resumed.next()).toBe(a.next());
  });
});
