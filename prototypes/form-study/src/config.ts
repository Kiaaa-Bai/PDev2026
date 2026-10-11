import type { CityConfig } from "./sims/city";

export const CITY: CityConfig = {
  cols: 32,
  rows: 20,
  roadThreshold: 3,
  wideRoadAt: 12,
  buildChance: 0.05,
  tierThresholds: [3, 10, 25],
  seed: 42,
};
