import type { Point } from "../data";

/** A form that grows from strokes. Pure state; views read it. */
export interface Sim {
  beginStroke(t: number): void;
  /** Points of the current stroke; successive calls are joined. */
  addPoints(points: Point[]): void;
  endStroke(): void;
  /** Time passes without input. */
  advanceTo(t: number): void;
}
