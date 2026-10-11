import { Container, Graphics, Sprite } from "pixi.js";
import { roadMask, type CitySim } from "../sims/city";
import type { Finger } from "../pointers";
import { TILES, tex } from "../tiles";
import { PointerLayer } from "./pointer";

const T = 16;
const ROAD = 0x8b8579;

export class CityView {
  readonly root = new Container();
  private roads = new Graphics();
  private buildings: Sprite[] = [];
  private seen = -1;

  private pointers = new PointerLayer(TILES.city.pointer);

  constructor(
    private sim: CitySim,
    private fingers: ReadonlyMap<number, Finger> = new Map(),
  ) {
    const { cols, rows } = sim.cfg;
    for (let i = 0; i < cols * rows; i++) {
      const grass = new Sprite(tex(TILES.city.grass));
      grass.position.set((i % cols) * T, Math.floor(i / cols) * T);
      this.root.addChild(grass);
    }
    this.root.addChild(this.roads);
    for (let i = 0; i < cols * rows; i++) {
      const b = new Sprite(tex(TILES.city.buildings[0]));
      b.position.set((i % cols) * T, Math.floor(i / cols) * T);
      b.visible = false;
      this.root.addChild(b);
      this.buildings.push(b);
    }
    this.root.addChild(this.pointers.root);
  }

  update(_now: number): void {
    this.pointers.sync(this.fingers);
    if (this.sim.version === this.seen) return;
    this.seen = this.sim.version;
    const { cols, rows, wideRoadAt } = this.sim.cfg;
    this.roads.clear();
    for (let i = 0; i < cols * rows; i++) {
      if (!this.sim.road[i]) continue;
      const x = (i % cols) * T;
      const y = Math.floor(i / cols) * T;
      const w = this.sim.traffic[i] >= wideRoadAt ? 10 : 6;
      const o = (T - w) / 2;
      const m = roadMask(this.sim.road, cols, rows, i);
      this.roads.rect(x + o, y + o, w, w).fill(ROAD);
      if (m & 1) this.roads.rect(x + o, y, w, o).fill(ROAD);
      if (m & 2) this.roads.rect(x + o + w, y + o, o, w).fill(ROAD);
      if (m & 4) this.roads.rect(x + o, y + o + w, w, o).fill(ROAD);
      if (m & 8) this.roads.rect(x, y + o, o, w).fill(ROAD);
    }
    for (let i = 0; i < cols * rows; i++) {
      const tier = this.sim.building[i];
      const sprite = this.buildings[i];
      sprite.visible = tier > 0;
      if (tier > 0) sprite.texture = tex(TILES.city.buildings[tier - 1]);
    }
  }

  stat(): string {
    let roads = 0;
    let buildings = 0;
    for (let i = 0; i < this.sim.road.length; i++) {
      if (this.sim.road[i]) roads++;
      if (this.sim.building[i]) buildings++;
    }
    return `${roads} road tiles · ${buildings} buildings`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
