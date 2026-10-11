import { describe, expect, it } from "vitest";
import { cellOf, segmentCells, StrokeCells } from "../src/grid";

describe("cellOf", () => {
  it("maps 0–1 to row-major cells and clamps the far edge", () => {
    expect(cellOf(0, 0, 4, 2)).toBe(0);
    expect(cellOf(0.5, 0.25, 4, 2)).toBe(2);
    expect(cellOf(1, 1, 4, 2)).toBe(7);
  });
});

describe("segmentCells", () => {
  it("lists each cell along a line once, in order", () => {
    expect(segmentCells(0.05, 0.1, 0.95, 0.1, 4, 2)).toEqual([0, 1, 2, 3]);
  });
});

describe("StrokeCells", () => {
  it("reports a cell once per stroke, even when the stroke comes back", () => {
    const sc = new StrokeCells(4, 2);
    sc.begin();
    expect(sc.push([{ t: 0, x: 0.05, y: 0.1 }, { t: 1, x: 0.6, y: 0.1 }])).toEqual([0, 1, 2]);
    expect(sc.push([{ t: 2, x: 0.05, y: 0.1 }])).toEqual([]);
    sc.begin();
    expect(sc.push([{ t: 3, x: 0.05, y: 0.1 }])).toEqual([0]);
  });

  it("joins points across push calls", () => {
    const sc = new StrokeCells(4, 2);
    sc.begin();
    sc.push([{ t: 0, x: 0.05, y: 0.1 }]);
    expect(sc.push([{ t: 1, x: 0.95, y: 0.1 }])).toEqual([1, 2, 3]);
  });
});
