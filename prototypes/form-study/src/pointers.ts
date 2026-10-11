/** A finger that is down right now, position 0–1 with the origin at the top-left. */
export type Finger = { x: number; y: number };

/** Keeps one pointer per finger: makes, moves and removes them as fingers come and go. */
export class PointerSet<T> {
  private live = new Map<number, T>();

  constructor(
    private make: () => T,
    private place: (pointer: T, x: number, y: number) => void,
    private remove: (pointer: T) => void,
  ) {}

  sync(fingers: ReadonlyMap<number, Finger>, width: number, height: number): void {
    for (const [id, pointer] of this.live) {
      if (!fingers.has(id)) {
        this.remove(pointer);
        this.live.delete(id);
      }
    }
    for (const [id, f] of fingers) {
      let pointer = this.live.get(id);
      if (!pointer) {
        pointer = this.make();
        this.live.set(id, pointer);
      }
      this.place(pointer, f.x * width, f.y * height);
    }
  }
}
