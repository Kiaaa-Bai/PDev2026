import type { Dir } from "./city";

/**
 * Screen angle in degrees (y up) each heading points at in the 2:1 diamond
 * view, indexed by Dir: east ↘, south ↙, west ↖, north ↗.
 */
const HEADING_ANGLE = [-26.57, -153.43, 153.43, 26.57] as const;

/** A heading this close (degrees) to the nearest one counts as just as good. */
const TIE_DEG = 15;

/** The smaller angle between two directions, 0–180, wrapping around 360. */
function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The heading a pointer push (dx, dy in screen points, y down) steers to.
 * The nearest of the four screen diagonals wins, and the current heading stays
 * when it is within TIE_DEG of the nearest. Between two close headings the one
 * that is not a U-turn wins; a push straight along the reverse diagonal still
 * turns the roller around.
 */
export function headingFor(dx: number, dy: number, current: Dir): Dir {
  const theta = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const gaps = HEADING_ANGLE.map((a) => angleGap(theta, a));
  const limit = Math.min(...gaps) + TIE_DEG;
  if (gaps[current] <= limit) return current;
  const back = (current + 2) % 4;
  let pick = back;
  for (let d = 0; d < 4; d++) {
    if (d === back || gaps[d] > limit) continue;
    if (pick === back || gaps[d] < gaps[pick]) pick = d;
  }
  return pick as Dir;
}
