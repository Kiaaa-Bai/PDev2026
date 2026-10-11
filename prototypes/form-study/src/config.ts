import type { CityConfig } from "./sims/city";
import type { FarmConfig } from "./sims/farm";
import type { MonsterConfig } from "./sims/monster";

export const CITY: CityConfig = {
  cols: 32,
  rows: 20,
  roadThreshold: 3,
  wideRoadAt: 12,
  buildChance: 0.05,
  tierThresholds: [3, 10, 25],
  seed: 42,
};

export const FARM: FarmConfig = { cols: 16, rows: 10, waterPerStage: 3 };

/** One monster per minute of recorded time when replaying a file. */
export const MONSTER: MonsterConfig = { cols: 16, rows: 10, spawnIntervalMs: 60_000, cap: 24, kinds: 4, seed: 7 };

/** Faster spawning in live mouse mode, so the panel moves while you watch. */
export const MONSTER_LIVE_SPAWN_MS = 2_000;
