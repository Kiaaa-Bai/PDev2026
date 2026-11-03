// THROWAWAY: synthetic swipes for the 3D performance spike.
import type { TouchRecord } from "./data";

let nextId = 1000;
/** A synthetic swipe in a random direction, so the roller keeps driving. */
export function autopilotSwipe(push: (r: TouchRecord) => void, now = Date.now()): void {
  const id = nextId++;
  const a = Math.floor(Math.random() * 4);
  const [dx, dy] = [[0.1, 0], [0, 0.1], [-0.1, 0], [0, -0.1]][a];
  push({ t: now, id, x: 0.5, y: 0.5, state: "down" });
  push({ t: now, id, x: 0.5 + dx, y: 0.5 + dy, state: "move" });
  push({ t: now, id, x: 0.5 + dx, y: 0.5 + dy, state: "up" });
}
