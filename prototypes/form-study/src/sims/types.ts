import type { Point } from "../data";

/**
 * A form that grows from touches. Several fingers can be down at once, so
 * every stroke carries its finger id. Pure state; views read it.
 */
export interface Sim {
  beginStroke(id: number, t: number): void;
  /** Points of finger `id`'s current stroke; successive calls are joined. */
  addPoints(id: number, points: Point[]): void;
  endStroke(id: number): void;
  /** Time passes. */
  advanceTo(t: number): void;
}
