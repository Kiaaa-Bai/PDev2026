import type { CityConfig } from "./sims/city";
import type { FarmConfig } from "./sims/farm";
import type { MonsterConfig } from "./sims/monster";

/** Bump when the city's rules change, so an old snapshot is dropped and the days are replayed. */
export const CITY_RULES_VERSION = 7;

export const CITY: CityConfig = {
  // The roller follows the cursor: a tile per 100 points it moves, up to 20 tiles a second (rules 5).
  speed: 20,
  ptPerTile: 100,
  smoothMs: 100,
  // never a second road right beside one running the same way: merge onto it, so passes widen one road (rules 6)
  mergeBeside: true,
  steerMin: 40, // screen points
  // When the cursor stops the roller coasts on, slowing evenly over 2 s (so it covers speed × 1 s), and the city's
  // shape stretches or shortens that coast up to 4× each way so the city spreads out instead of into a band (rules 7).
  // On Kia's days 11-03 → 11-10: width/height on screen 18.9 → 1.9, 5,215 → 13,246 road cells.
  idleStopMs: 2000,
  slowMs: 2000,
  shapeCoast: { aspect: 1.5, strength: 1.5, min: 0.25, max: 4 },
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
