import { Container, Graphics, Sprite } from "pixi.js";
import type { MonsterSim } from "../sims/monster";
import type { Finger } from "../pointers";
import { TILES, tex } from "../tiles";
import { PointerLayer } from "./pointer";

const CELL = 32;
const POOF_MS = 300;

export class MonsterView {
  readonly root = new Container();
  private monsters: Sprite[] = [];
  private effects = new Graphics();
  private live: { cell: number; born: number }[] = [];
  private seen = -1;

  private pointers = new PointerLayer(TILES.monster.pointer);

  constructor(
    private sim: MonsterSim,
    private fingers: ReadonlyMap<number, Finger> = new Map(),
  ) {
    const { cols, rows } = sim.cfg;
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * CELL;
      const y = Math.floor(i / cols) * CELL;
      const floor = new Sprite(tex(TILES.monster.floor));
      floor.position.set(x, y);
      floor.scale.set(2);
      this.root.addChild(floor);
      const m = new Sprite(tex(TILES.monster.kinds[0]));
      m.position.set(x, y);
      m.scale.set(2);
      m.visible = false;
      this.root.addChild(m);
      this.monsters.push(m);
    }
    this.root.addChild(this.effects, this.pointers.root);
  }

  update(now: number): void {
    this.pointers.sync(this.fingers);
    for (const p of this.sim.poofs.splice(0)) this.live.push({ cell: p.cell, born: now });
    this.live = this.live.filter((p) => now - p.born < POOF_MS);
    this.effects.clear();
    const { cols } = this.sim.cfg;
    for (const p of this.live) {
      const k = (now - p.born) / POOF_MS;
      const size = 8 + 24 * k;
      const cx = (p.cell % cols) * CELL + CELL / 2;
      const cy = Math.floor(p.cell / cols) * CELL + CELL / 2;
      this.effects.rect(cx - size / 2, cy - size / 2, size, size).fill({ color: 0xffffff, alpha: 1 - k });
    }
    if (this.sim.version === this.seen) return;
    this.seen = this.sim.version;
    for (let i = 0; i < this.monsters.length; i++) {
      const kind = this.sim.monster[i];
      this.monsters[i].visible = kind > 0;
      if (kind > 0) this.monsters[i].texture = tex(TILES.monster.kinds[kind - 1]);
    }
  }

  stat(): string {
    return `${this.sim.loot.toLocaleString()} defeated · ${this.sim.alive} around`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
