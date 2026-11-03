// How a road and a roof look, from how often it was driven and when it was built.
// Pure, so it can be tested in node; the Three.js side is in city3d.ts and palette-shader.ts.

/** No tint: an instance colour of white leaves a model as drawn. */
export const WHITE = 0xffffff;

/** Roads by how often they were driven: once, twice, three times or more. */
export function roadTier(driven: number): 1 | 2 | 3 {
  return driven >= 3 ? 3 : driven >= 2 ? 2 : 1;
}

/** A house's roof by the local hour it appeared: 06-12, 12-18, 18-24, 00-06. */
export function roofBand(t: number): 0 | 1 | 2 | 3 {
  const h = new Date(t).getHours();
  return h >= 18 ? 2 : h >= 12 ? 1 : h >= 6 ? 0 : 3;
}

/** Morning, afternoon, evening and night roofs. */
export const ROOF_COLOURS = [0xe9b44c, 0xe0703a, 0x8e6bbe, 0x3e6fb0] as const;

/** Multiplied into the road texture on roads driven only once, so they read as lanes beside the grey streets. */
export const LANE_TINT = 0xc9b48a;

export const roadColour = (tier: 1 | 2 | 3): number => (tier === 1 ? LANE_TINT : WHITE);

/** Suburban roofs (tiers 1 and 2) take the colour of the hour they were built; commercial buildings (tier 3) keep their own. */
export const roofColour = (houseTier: 1 | 2 | 3, built: number): number => (houseTier < 3 ? ROOF_COLOURS[roofBand(built)] : WHITE);
