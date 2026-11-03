import { describe, expect, it } from "vitest";
import type { Dir } from "../src/sims/city";
import { headingFor } from "../src/sims/steer";

// Headings: 0 east ↘, 1 south ↙, 2 west ↖, 3 north ↗ (on screen, 2:1 diamond view).
describe("headingFor", () => {
  it("push right keeps ↗", () => {
    expect(headingFor(10, 0, 3)).toBe(3);
  });

  it("push right from ↙ turns ↘ (north and east tie, north is the U-turn)", () => {
    expect(headingFor(10, 0, 1)).toBe(0);
  });

  it("push down from ↗ turns ↘", () => {
    expect(headingFor(0, 10, 3)).toBe(0);
  });

  it("a clear diagonal wins", () => {
    expect(headingFor(-20, -10, 0)).toBe(2); // up-left = west
  });

  it("a push straight along a diagonal turns to it, even backwards", () => {
    const pushes: [number, number, Dir][] = [
      [100, 50, 0], // ↘
      [-100, 50, 1], // ↙
      [-100, -50, 2], // ↖
      [100, -50, 3], // ↗
    ];
    for (const [dx, dy, want] of pushes) {
      for (const current of [0, 1, 2, 3] as Dir[]) {
        expect(headingFor(dx, dy, current), `push ${dx},${dy} from ${current}`).toBe(want);
      }
    }
  });

  it("measures angles around the wrap at 180°", () => {
    // pushing left is 26.57° from both ↖ (153.43°) and ↙ (-153.43°) across the wrap
    expect(headingFor(-10, 0, 2)).toBe(2);
    expect(headingFor(-10, 0, 1)).toBe(1);
    // left and a little up: ↖ is 16.57° away, ↙ 36.57° — out of reach of the tie
    expect(headingFor(-100, -17.6, 1)).toBe(2);
    // left and a little down is the mirror image
    expect(headingFor(-100, 17.6, 2)).toBe(1);
  });

  it("a straight push between two headings never U-turns", () => {
    for (const [dx, dy] of [[10, 0], [-10, 0], [0, 10], [0, -10]]) {
      for (const current of [0, 1, 2, 3] as Dir[]) {
        expect(headingFor(dx, dy, current), `push ${dx},${dy} from ${current}`).not.toBe((current + 2) % 4);
      }
    }
  });
});
