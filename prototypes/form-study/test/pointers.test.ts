import { describe, expect, it } from "vitest";
import { PointerSet } from "../src/pointers";

type Fake = { x: number; y: number; removed: boolean };

function setup() {
  const made: Fake[] = [];
  const set = new PointerSet<Fake>(
    () => {
      const f = { x: 0, y: 0, removed: false };
      made.push(f);
      return f;
    },
    (f, x, y) => {
      f.x = x;
      f.y = y;
    },
    (f) => {
      f.removed = true;
    },
  );
  return { set, made };
}

describe("PointerSet", () => {
  it("puts one pointer on each finger, scaled to the panel", () => {
    const { set, made } = setup();
    set.sync(new Map([[1, { x: 0.5, y: 0.25 }], [2, { x: 1, y: 1 }]]), 512, 320);
    expect(made.map((f) => [f.x, f.y])).toEqual([
      [256, 80],
      [512, 320],
    ]);
  });

  it("moves a pointer with its finger instead of making a new one", () => {
    const { set, made } = setup();
    set.sync(new Map([[1, { x: 0, y: 0 }]]), 512, 320);
    set.sync(new Map([[1, { x: 0.25, y: 0.5 }]]), 512, 320);
    expect(made).toHaveLength(1);
    expect([made[0].x, made[0].y]).toEqual([128, 160]);
  });

  it("removes the pointer when its finger lifts", () => {
    const { set, made } = setup();
    set.sync(new Map([[1, { x: 0, y: 0 }]]), 512, 320);
    set.sync(new Map(), 512, 320);
    expect(made[0].removed).toBe(true);
    set.sync(new Map([[1, { x: 0, y: 0 }]]), 512, 320);
    expect(made).toHaveLength(2);
  });
});
