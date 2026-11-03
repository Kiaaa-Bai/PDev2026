import type { CityConfig } from "./sims/city";
import type { FarmConfig } from "./sims/farm";
import type { MonsterConfig } from "./sims/monster";

/** Bump when the city's rules change, so an old snapshot is dropped and the days are replayed. */
export const CITY_RULES_VERSION = 3;

export const CITY: CityConfig = {
  speed: 1,
  steerMin: 40, // screen points
  idleStopMs: 30_000,
  slowMs: 30_000,
  lotDelayMs: [3_000, 15_000],
  lotChance: 0.6,
  tierAgesMs: [5 * 60_000, 20 * 60_000],
  wideRoadAt: 3,
  seed: 42,
};

export const FARM: FarmConfig = { cols: 16, rows: 10, waterPerStage: 3 };

/** One monster per minute of recorded time when replaying a file. */
export const MONSTER: MonsterConfig = { cols: 16, rows: 10, spawnIntervalMs: 60_000, cap: 24, kinds: 4, seed: 7 };

/** Faster spawning in live mouse mode, so the panel moves while you watch. */
export const MONSTER_LIVE_SPAWN_MS = 2_000;
