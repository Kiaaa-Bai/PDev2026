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

/** The warm light of a lit window. */
export const WINDOW_LIT = 0xffd27a;

/**
 * The sky light's colour (the hemisphere light, which every surface facing up or sideways takes some of)
 * at full day, at dawn and dusk (half way between day and night), and at full night.
 */
export const SKY_DAY = 0xe8f4ff;
export const SKY_DUSK = 0xffc4a0;
export const SKY_NIGHT = 0x3048d8;

/** The sun's colour (the directional light): neutral by day, orange at dawn and dusk, cool moonlight at night. */
export const SUN_COLOUR_DAY = 0xffffff;
export const SUN_COLOUR_DUSK = 0xffa866;
export const SUN_COLOUR_NIGHT = 0x6a7cff;

/** Light intensities at full day and full night: the sun (directional light) and the sky and ground glow (hemisphere light). */
export const SUN_DAY = 1.8;
export const SUN_NIGHT = 0.6;
export const AMBIENT_DAY = 1.6;
export const AMBIENT_NIGHT = 1.3;

export interface SkyState {
  /** Colour of the sky light, 0xRRGGBB. */
  sky: number;
  /** Colour of the sun light, 0xRRGGBB. */
  sunColour: number;
  /** Intensity of the directional light. */
  sun: number;
  /** Intensity of the hemisphere light. */
  ambient: number;
  /** 0 in full day, 1 in full night: how far the windows and streetlights are lit. */
  night: number;
}

/** Exactly `a` at t = 0 and exactly `b` at t = 1. */
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

/** Two 0xRRGGBB colours blended channel by channel, t = 0 giving `a` and t = 1 giving `b`. */
function mixColour(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) out = (out << 8) | Math.round(mix((a >> shift) & 255, (b >> shift) & 255, t));
  return out;
}

/** Day, then dusk half way through the changeover, then night: `night` is 0 for the first colour and 1 for the last. */
const through = (day: number, dusk: number, night: number, n: number) =>
  n < 0.5 ? mixColour(day, dusk, n * 2) : mixColour(dusk, night, n * 2 - 1);

/**
 * The sky for a moment by the local clock. Night is full until 05:00, falls to day by 07:00, stays
 * day until 18:00 and rises to full night by 20:00, in straight lines. The intensities follow
 * `night`; the sky and sun colours go day to dusk to night, so half way is the dusk colour.
 */
export function skyAt(d: Date): SkyState {
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const night = h < 5 || h >= 20 ? 1 : h < 7 ? (7 - h) / 2 : h <= 18 ? 0 : (h - 18) / 2;
  return {
    sky: through(SKY_DAY, SKY_DUSK, SKY_NIGHT, night),
    sunColour: through(SUN_COLOUR_DAY, SUN_COLOUR_DUSK, SUN_COLOUR_NIGHT, night),
    sun: mix(SUN_DAY, SUN_NIGHT, night),
    ambient: mix(AMBIENT_DAY, AMBIENT_NIGHT, night),
    night,
  };
}

/** Whether two skies would draw the same picture: every value alike. */
export function sameSky(a: SkyState, b: SkyState): boolean {
  return a.sky === b.sky && a.sunColour === b.sunColour && a.sun === b.sun && a.ambient === b.ambient && a.night === b.night;
}
