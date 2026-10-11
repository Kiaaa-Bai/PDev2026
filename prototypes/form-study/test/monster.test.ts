import { describe, expect, it } from "vitest";
import { MonsterSim, type MonsterConfig } from "../src/sims/monster";

const cfg: MonsterConfig = { cols: 4, rows: 2, spawnIntervalMs: 1000, cap: 3, kinds: 2, seed: 3 };

const occupied = (sim: MonsterSim) => [...sim.monster].map((k, i) => (k ? i : -1)).filter((i) => i >= 0);

describe("MonsterSim", () => {
  it("spawns one monster per interval after the clock starts", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(999);
    expect(sim.alive).toBe(0);
    sim.advanceTo(1000);
    expect(sim.alive).toBe(1);
    const [cell] = occupied(sim);
    expect(sim.monster[cell]).toBeGreaterThanOrEqual(1);
    expect(sim.monster[cell]).toBeLessThanOrEqual(2);
  });

  it("stops at the cap, even after a huge gap", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(1e12);
    expect(sim.alive).toBe(3);
    expect(occupied(sim)).toHaveLength(3);
  });

  it("ignores time going backwards", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(2000);
    const before = [...sim.monster];
    sim.advanceTo(100);
    sim.advanceTo(2500);
    expect([...sim.monster]).toEqual(before);
  });

  it("a stroke through a monster defeats it", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(1000);
    const [cell] = occupied(sim);
    const x = ((cell % cfg.cols) + 0.5) / cfg.cols;
    const y = (Math.floor(cell / cfg.cols) + 0.5) / cfg.rows;
    sim.beginStroke(1, 1100);
    sim.addPoints(1, [{ t: 1100, x, y }]);
    sim.endStroke(1);
    expect(sim.monster[cell]).toBe(0);
    expect(sim.loot).toBe(1);
    expect(sim.alive).toBe(0);
    expect(sim.poofs).toEqual([{ cell, t: 1100 }]);
  });

  it("is deterministic for a seed", () => {
    const a = new MonsterSim(cfg);
    const b = new MonsterSim(cfg);
    for (const t of [0, 1000, 2000, 3000]) {
      a.advanceTo(t);
      b.advanceTo(t);
    }
    expect([...a.monster]).toEqual([...b.monster]);
  });
});
