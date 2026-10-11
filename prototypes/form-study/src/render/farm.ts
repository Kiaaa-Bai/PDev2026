import { Container, Sprite } from "pixi.js";
import type { FarmSim } from "../sims/farm";
import type { Finger } from "../pointers";
import { TILES, tex } from "../tiles";
import { PointerLayer } from "./pointer";

const CELL = 32;

export class FarmView {
  readonly root = new Container();
  private crops: Sprite[] = [];
  private seen = -1;

  private pointers = new PointerLayer(TILES.farm.pointer);

  constructor(
    private sim: FarmSim,
    private fingers: ReadonlyMap<number, Finger> = new Map(),
  ) {
    const { cols, rows } = sim.cfg;
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * CELL;
      const y = Math.floor(i / cols) * CELL;
      const soil = new Sprite(tex(TILES.farm.soil));
      soil.position.set(x, y);
      soil.scale.set(2);
      this.root.addChild(soil);
      const crop = new Sprite(tex(TILES.farm.stages[0]));
      crop.position.set(x, y);
      crop.scale.set(2);
      crop.visible = false;
      this.root.addChild(crop);
      this.crops.push(crop);
    }
    this.root.addChild(this.pointers.root);
  }

  update(_now: number): void {
    this.pointers.sync(this.fingers);
    if (this.sim.version === this.seen) return;
    this.seen = this.sim.version;
    for (let i = 0; i < this.crops.length; i++) {
      const stage = this.sim.stage[i];
      const planted = stage > 0 || this.sim.water[i] > 0;
      this.crops[i].visible = planted;
      if (planted) this.crops[i].texture = tex(TILES.farm.stages[stage]);
    }
  }

  stat(): string {
    return `${this.sim.harvested.toLocaleString()} harvested`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
