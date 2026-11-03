import { CITY_RULES_VERSION } from "../config";
import type { Dir } from "./city";

/**
 * The city's state as plain JSON, taken between strokes. A stroke cut by a
 * snapshot is not kept: after a restart it may miss one turn.
 */
export interface CitySnapshot {
  /** CITY_RULES_VERSION when it was taken. */
  rules: number;
  road: [string, number][];
  lots: [string, number][];
  roller: { x: number; y: number; dir: Dir; progress: number };
  driven: number;
  distance: number;
  /** null before the first advance. */
  clock: number | null;
  /** null before the first touch, since JSON has no -Infinity. */
  lastInput: number | null;
  started: boolean;
  /** The Rng's state. */
  rng: number;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumberOrNull = (v: unknown): v is number | null => v === null || isNumber(v);
const isCellEntries = (v: unknown): v is [string, number][] =>
  Array.isArray(v) && v.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && isNumber(e[1]));

export function isSnapshot(s: unknown): s is CitySnapshot {
  if (typeof s !== "object" || s === null) return false;
  const v = s as Record<string, unknown>;
  const r = v.roller as Record<string, unknown> | null | undefined;
  return (
    v.rules === CITY_RULES_VERSION &&
    isCellEntries(v.road) &&
    isCellEntries(v.lots) &&
    typeof r === "object" &&
    r !== null &&
    isNumber(r.x) &&
    isNumber(r.y) &&
    isNumber(r.progress) &&
    (r.dir === 0 || r.dir === 1 || r.dir === 2 || r.dir === 3) &&
    isNumber(v.driven) &&
    isNumber(v.distance) &&
    isNumberOrNull(v.clock) &&
    isNumberOrNull(v.lastInput) &&
    typeof v.started === "boolean" &&
    isNumber(v.rng)
  );
}
