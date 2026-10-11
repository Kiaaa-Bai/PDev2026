import { Container, Sprite } from "pixi.js";
import { PointerSet, type Finger } from "../pointers";
import { tex } from "../tiles";
import { PANEL_H, PANEL_W } from "./panel";

export interface PointerTile {
  tile: string;
  /** The tool's tip, as a fraction of the tile, placed on the finger. */
  anchor: readonly [number, number];
}

/** A tool sprite on every finger that is down, drawn above a form. */
export class PointerLayer {
  readonly root = new Container();
  private set: PointerSet<Sprite>;

  constructor(pointer: PointerTile) {
    this.set = new PointerSet<Sprite>(
      () => {
        const s = new Sprite(tex(pointer.tile));
        s.anchor.set(pointer.anchor[0], pointer.anchor[1]);
        s.scale.set(2);
        this.root.addChild(s);
        return s;
      },
      (s, x, y) => s.position.set(Math.round(x), Math.round(y)),
      (s) => s.destroy(),
    );
  }

  sync(fingers: ReadonlyMap<number, Finger>): void {
    this.set.sync(fingers, PANEL_W, PANEL_H);
  }
}
