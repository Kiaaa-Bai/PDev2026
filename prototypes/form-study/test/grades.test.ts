import { describe, expect, it } from "vitest";
import { GRADE_PASSES, gradeOfPasses, runGrade, runThrough } from "../src/sims/grades";

describe("gradeOfPasses", () => {
  it("ranks passes into dirt, street, lit street, avenue and highway", () => {
    // tuned on Kia's days 11-03 → 11-10 (rules 7): run medians reach 1 / 2 / 3 / 5 / 12 at the 20th / 45th / 80th / 95th / 100th percentile
    expect(GRADE_PASSES).toEqual([1, 2, 3, 4, 6]);
    const cases: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 4], [6, 5], [37, 5]];
    for (const [passes, grade] of cases) expect(gradeOfPasses(passes), `${passes} passes`).toBe(grade);
  });
});

describe("runThrough", () => {
  // a plus: a row y = 0 from x = -3 to 3, and a column x = 0 from y = -2 to 2
  const cells = new Set<string>();
  for (let x = -3; x <= 3; x++) cells.add(`${x},0`);
  for (let y = -2; y <= 2; y++) cells.add(`0,${y}`);
  const has = (x: number, y: number) => cells.has(`${x},${y}`);

  it("is the whole straight line through the cell along the axis, junctions and all", () => {
    expect(runThrough(has, 2, 0, "x")).toEqual([[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(runThrough(has, 0, 1, "y")).toEqual([[0, -2], [0, -1], [0, 0], [0, 1], [0, 2]]);
  });

  it("is the cell alone when it has no neighbour along that axis", () => {
    expect(runThrough(has, 2, 0, "y")).toEqual([[2, 0]]);
  });
});

describe("runGrade", () => {
  it("is the grade of the median pass count", () => {
    expect(runGrade([1, 1, 9])).toBe(1);
    expect(runGrade([4, 5, 1])).toBe(4);
  });
});

describe("runGrade on an even count", () => {
  it("takes the lower middle, so a two-cell run off a busy road is graded by its new cell (review #1)", () => {
    expect(runGrade([6, 1])).toBe(1);
    expect(runGrade([1, 6, 6, 6])).toBe(5);
  });
});
