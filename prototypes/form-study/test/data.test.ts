import { describe, expect, it } from "vitest";
import { parseJsonl, toStrokes, type TouchRecord, type TouchState } from "../src/data";

const rec = (t: number, id: number, state: TouchState, x = 0.5): TouchRecord => ({ t, id, x, y: 0.5, state });

describe("parseJsonl", () => {
  it("reads records, skips blank and truncated lines, sorts by time", () => {
    const text = [
      '{"t":20,"id":1,"x":0.5,"y":0.5,"state":"move"}',
      "",
      '{"t":10,"id":1,"x":0.1,"y":0.2,"state":"down"}',
      '{"t":30,"id":1,"x":0.6,"y":0.5,"st',
    ].join("\n");
    expect(parseJsonl(text)).toEqual([
      { t: 10, id: 1, x: 0.1, y: 0.2, state: "down" },
      { t: 20, id: 1, x: 0.5, y: 0.5, state: "move" },
    ]);
  });

  it("drops unknown states and keeps positions as recorded", () => {
    const text = '{"t":1,"id":1,"x":2560.3,"y":-40,"state":"down"}\n{"t":2,"id":1,"x":0.5,"y":0.5,"state":"hover"}';
    expect(parseJsonl(text)).toEqual([{ t: 1, id: 1, x: 2560.3, y: -40, state: "down" }]);
  });

  it("returns nothing for empty or non-touch text", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("hello\n{\"a\":1}")).toEqual([]);
  });
});

describe("toStrokes", () => {
  it("groups interleaved fingers into strokes ordered by start time", () => {
    const strokes = toStrokes([rec(1, 1, "down"), rec(2, 2, "down"), rec(3, 1, "move"), rec(4, 2, "up"), rec(5, 1, "up")]);
    expect(strokes.map((s) => [s.id, s.points.map((p) => p.t)])).toEqual([
      [1, [1, 3, 5]],
      [2, [2, 4]],
    ]);
  });

  it("starts a stroke on a move with no down and closes open strokes at the end", () => {
    const strokes = toStrokes([rec(1, 7, "move", 0.1), rec(2, 7, "move", 0.2)]);
    expect(strokes).toEqual([{ id: 7, points: [{ t: 1, x: 0.1, y: 0.5 }, { t: 2, x: 0.2, y: 0.5 }] }]);
  });

  it("starts a new stroke when the same finger id goes down again", () => {
    const strokes = toStrokes([rec(1, 1, "down"), rec(2, 1, "down"), rec(3, 1, "up")]);
    expect(strokes.map((s) => s.points.length)).toEqual([1, 2]);
  });

  it("ignores an up for a finger that is not down", () => {
    expect(toStrokes([rec(1, 1, "up")])).toEqual([]);
  });
});
