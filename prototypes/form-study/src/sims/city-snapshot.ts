import { CITY_RULES_VERSION } from "../config";
import type { Dir } from "./city";
import { isKind, type Kind } from "./kinds";

/**
 * The city's state as plain JSON, taken between strokes. A stroke cut by a
 * snapshot is not kept: after a restart it may miss one turn.
 */
export interface CitySnapshot {
  /** CITY_RULES_VERSION when it was taken. */
  rules: number;
  road: [string, number][];
  /** Each lot's own roll in [0, 1), drawn when it was made. */
  rolls: [string, number][];
  /** Each road cell's grade (1 dirt to 5 highway), the highest it has reached. */
  grades: [string, 1 | 2 | 3 | 4 | 5][];
  lots: [string, number][];
  /** The kind of building on each lot, fixed when the lot was made. */
  kinds: [string, Kind][];
  /** Whether the one landmark has been placed. */
  landmark: boolean;
  roller: { x: number; y: number; dir: Dir; progress: number };
  driven: number;
  distance: number;
  /** The roller's speed at the last touch when it follows the pointer, in tiles a second (0 when it does not). */
  pace: number;
  /** How much the city's shape stretched the coast from the last touch (1 when shapeCoast is off). */
  coast: number;
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

/** Kinds for exactly the lots there are: a kind that is not a real one, or a lot without a kind, is a broken snapshot. */
function isKindEntries(v: unknown, lots: [string, number][]): v is [string, Kind][] {
  if (!Array.isArray(v)) return false;
  if (!v.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && isKind(e[1]))) return false;
  const keys = new Set<string>(v.map((e) => e[0]));
  return keys.size === lots.length && lots.every(([k]) => keys.has(k));
}

/** A roll in [0, 1) for exactly the lots there are. */
function isRollEntries(v: unknown, lots: [string, number][]): v is [string, number][] {
  if (!Array.isArray(v) || v.length !== lots.length) return false;
  const keys = new Set(lots.map(([k]) => k));
  return v.every((e) => Array.isArray(e) && e.length === 2 && keys.has(e[0]) && isNumber(e[1]) && e[1] >= 0 && e[1] < 1);
}

/** Grades for road cells only, each 1 to 5. */
function isGradeEntries(v: unknown, road: [string, number][]): v is [string, 1 | 2 | 3 | 4 | 5][] {
  if (!Array.isArray(v)) return false;
  const roads = new Set(road.map(([k]) => k));
  return v.every((e) => Array.isArray(e) && e.length === 2 && roads.has(e[0]) && [1, 2, 3, 4, 5].includes(e[1]));
}

export function isSnapshot(s: unknown): s is CitySnapshot {
  if (typeof s !== "object" || s === null) return false;
  const v = s as Record<string, unknown>;
  const r = v.roller as Record<string, unknown> | null | undefined;
  return (
    v.rules === CITY_RULES_VERSION &&
    isCellEntries(v.road) &&
    isGradeEntries(v.grades, v.road) &&
    isCellEntries(v.lots) &&
    isKindEntries(v.kinds, v.lots) &&
    isRollEntries(v.rolls, v.lots) &&
    typeof v.landmark === "boolean" &&
    typeof r === "object" &&
    r !== null &&
    isNumber(r.x) &&
    isNumber(r.y) &&
    isNumber(r.progress) &&
    (r.dir === 0 || r.dir === 1 || r.dir === 2 || r.dir === 3) &&
    isNumber(v.driven) &&
    isNumber(v.distance) &&
    isNumber(v.pace) &&
    v.pace >= 0 &&
    isNumber(v.coast) &&
    v.coast > 0 &&
    isNumberOrNull(v.clock) &&
    isNumberOrNull(v.lastInput) &&
    typeof v.started === "boolean" &&
    isNumber(v.rng)
  );
}
