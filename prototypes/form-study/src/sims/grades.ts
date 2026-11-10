// How grand a road has grown, from how often the roller drove it. Pure, so it can be tested in node; the city keeps
// each cell's highest grade so far (see CitySim.gradeAt).

/** 1 dirt, 2 street, 3 lit street, 4 avenue, 5 highway. */
export type Grade = 1 | 2 | 3 | 4 | 5;

/** The fewest passes (a run's median) for each grade, dirt to highway. */
export const GRADE_PASSES = [1, 2, 3, 4, 6] as const;

/** The grade a road driven `passes` times has. */
export function gradeOfPasses(passes: number): Grade {
  for (let g = GRADE_PASSES.length; g > 1; g--) if (passes >= GRADE_PASSES[g - 1]) return g as Grade;
  return 1;
}

/**
 * The road cells of the longest straight stretch through (x, y) along `axis`, from west to east (or north to south),
 * junctions included; just the cell itself when it has no road neighbour along that axis.
 */
export function runThrough(has: (x: number, y: number) => boolean, x: number, y: number, axis: "x" | "y"): [number, number][] {
  const [dx, dy] = axis === "x" ? [1, 0] : [0, 1];
  let sx = x;
  let sy = y;
  while (has(sx - dx, sy - dy)) {
    sx -= dx;
    sy -= dy;
  }
  const out: [number, number][] = [];
  for (let cx = sx, cy = sy; has(cx, cy); cx += dx, cy += dy) out.push([cx, cy]);
  return out;
}

/** The grade of a run: that of the median of its cells' pass counts (the upper middle one for an even count). */
export function runGrade(passes: readonly number[]): Grade {
  const sorted = [...passes].sort((a, b) => a - b);
  return gradeOfPasses(sorted[Math.floor(sorted.length / 2)]);
}
