import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import { cellKey, roadMaskAt, type CitySim } from "../sims/city";
import { TILES, tex } from "../tiles";
import { PANEL_H, PANEL_W } from "./panel";
import { makeRoller } from "./roller";

const T = 16;
const ROAD = 0x8b8579;
const COLS = PANEL_W / T + 2;
const ROWS = PANEL_H / T + 2;

/** An endless city seen from a camera that follows the roller. */
export class CityView {
  readonly root = new Container();
  private grass: TilingSprite;
  private roads = new Graphics();
  private houses = new Container();
  private pool: Sprite[] = [];
  private roller = makeRoller();
  private seen = "";

  constructor(private sim: CitySim) {
    this.grass = new TilingSprite({ texture: tex(TILES.city.grass), width: PANEL_W, height: PANEL_H });
    for (let i = 0; i < COLS * ROWS; i++) {
      const s = new Sprite(tex(TILES.city.buildings[0]));
      s.visible = false;
      this.houses.addChild(s);
      this.pool.push(s);
    }
    this.roller.position.set(PANEL_W / 2, PANEL_H / 2);
    this.root.addChild(this.grass, this.roads, this.houses, this.roller);
  }

  update(_now: number): void {
    const t = this.sim.time();
    const at = this.sim.rollerAt();
    // camera: the roller's centre sits at the panel's centre, in whole pixels
    const camX = Math.round(at.x * T + T / 2 - PANEL_W / 2);
    const camY = Math.round(at.y * T + T / 2 - PANEL_H / 2);
    const sig = `${camX},${camY},${this.sim.version},${this.sim.roller.dir},${Math.floor(t / 5000)}`;
    if (sig === this.seen) return;
    this.seen = sig;

    this.grass.tilePosition.set(-camX, -camY);
    this.roller.rotation = (this.sim.roller.dir * Math.PI) / 2;

    const x0 = Math.floor(camX / T);
    const y0 = Math.floor(camY / T);
    const has = (x: number, y: number) => this.sim.hasRoad(x, y);
    this.roads.clear();
    let used = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cx = x0 + col;
        const cy = y0 + row;
        const px = cx * T - camX;
        const py = cy * T - camY;
        const traffic = this.sim.road.get(cellKey(cx, cy)) ?? 0;
        if (traffic > 0) {
          const w = traffic >= this.sim.cfg.wideRoadAt ? 10 : 6;
          const o = (T - w) / 2;
          const m = roadMaskAt(has, cx, cy);
          this.roads.rect(px + o, py + o, w, w).fill(ROAD);
          if (m & 1) this.roads.rect(px + o, py, w, o).fill(ROAD);
          if (m & 2) this.roads.rect(px + o + w, py + o, o, w).fill(ROAD);
          if (m & 4) this.roads.rect(px + o, py + o + w, w, o).fill(ROAD);
          if (m & 8) this.roads.rect(px, py + o, o, w).fill(ROAD);
          continue;
        }
        const tier = this.sim.houseTier(cx, cy, t);
        if (tier === 0) continue;
        const s = this.pool[used++];
        s.texture = tex(TILES.city.buildings[tier - 1]);
        s.position.set(px, py);
        s.visible = true;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  stat(): string {
    const parked = this.sim.parked() ? " · parked" : "";
    return `${this.sim.road.size.toLocaleString()} road tiles · ${this.sim.houses(this.sim.time()).toLocaleString()} houses${parked}`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
