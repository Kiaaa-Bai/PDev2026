import { Container, Graphics } from "pixi.js";
import type { Heat } from "../heat";
import { PANEL_H, PANEL_W } from "./panel";

const BG = 0x111111;
const WARM = 0xffaa50;

/** The heat map plus the fingers that are down right now. */
export class HeatView {
  readonly root = new Container();
  private cells = new Graphics();
  private dots = new Graphics();
  private seen = -1;
  private seenFingers = "";

  constructor(
    private heat: Heat,
    private fingers: Map<number, { x: number; y: number }>,
  ) {
    this.root.addChild(this.cells, this.dots);
  }

  update(_now: number): void {
    if (this.heat.version !== this.seen) {
      this.seen = this.heat.version;
      const { cols, rows, counts, max } = this.heat;
      const cw = PANEL_W / cols;
      const ch = PANEL_H / rows;
      this.cells.clear();
      this.cells.rect(0, 0, PANEL_W, PANEL_H).fill(BG);
      for (let i = 0; i < counts.length; i++) {
        if (!counts[i]) continue;
        // sqrt so light use still shows next to the busiest cell
        const alpha = Math.sqrt(counts[i] / max);
        this.cells.rect((i % cols) * cw, Math.floor(i / cols) * ch, cw, ch).fill({ color: WARM, alpha });
      }
    }
    const key = [...this.fingers.values()].map((f) => `${f.x},${f.y}`).join(";");
    if (key !== this.seenFingers) {
      this.seenFingers = key;
      this.dots.clear();
      for (const f of this.fingers.values()) this.dots.circle(f.x * PANEL_W, f.y * PANEL_H, 5).fill(0xffffff);
    }
  }

  stat(): string {
    return `${this.heat.total.toLocaleString()} points today`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
