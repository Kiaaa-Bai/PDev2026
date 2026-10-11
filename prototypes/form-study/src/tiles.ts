import { Assets, type Texture } from "pixi.js";

const urls = import.meta.glob("./assets/tiles/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const TILES = {
  city: {
    grass: "town_0000",
    // hut → orange-roof cottage → grey-roof house
    buildings: ["town_0092", "town_0067", "town_0063"],
  },
  farm: {
    soil: "farm_0063",
    // cabbage: sprout → leaves → bigger leaves → ripe head
    stages: ["farm_0052", "farm_0053", "farm_0054", "farm_0056"],
  },
  monster: {
    floor: "dungeon_0048",
    // green slime, red crab, bat, ghost
    kinds: ["dungeon_0108", "dungeon_0110", "dungeon_0120", "dungeon_0121"],
  },
} as const;

const cache = new Map<string, Texture>();

export async function loadTiles(): Promise<void> {
  const names = new Set<string>([
    TILES.city.grass,
    ...TILES.city.buildings,
    TILES.farm.soil,
    ...TILES.farm.stages,
    TILES.monster.floor,
    ...TILES.monster.kinds,
  ]);
  for (const name of names) {
    const url = urls[`./assets/tiles/${name}.png`];
    if (!url) throw new Error(`Tile ${name}.png is missing from src/assets/tiles`);
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = "nearest";
    cache.set(name, texture);
  }
}

export function tex(name: string): Texture {
  const t = cache.get(name);
  if (!t) throw new Error(`Tile ${name} is not loaded`);
  return t;
}
