import { Graphics } from "pixi.js";

/** The steamroller, top-down and facing east: yellow body, cab, grey drum in front. */
const MAP = [
  "................",
  "................",
  ".oooo....oooooo.",
  ".oddooooogggggGo",
  ".oyyyyyyogggggGo",
  ".oyddddyogggggGo",
  ".oydwwdyogggggGo",
  ".oydwwdyogggggGo",
  ".oydwwdyogggggGo",
  ".oydwwdyogggggGo",
  ".oyddddyogggggGo",
  ".oyyyyyyogggggGo",
  ".oddooooogggggGo",
  ".oooo....oooooo.",
  "................",
  "................",
];

const PALETTE: Record<string, number> = {
  o: 0x3f2832,
  d: 0x4a4e5c,
  y: 0xf4b93b,
  g: 0xd6d8de,
  G: 0x8b8f99,
  w: 0x9fd3e8,
};

/** A 16×16 roller centred on its own origin, so it can turn in place. */
export function makeRoller(): Graphics {
  const g = new Graphics();
  MAP.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = PALETTE[ch];
      if (color !== undefined) g.rect(x - 8, y - 8, 1, 1).fill(color);
    });
  });
  return g;
}
