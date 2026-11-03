/**
 * Small seeded PRNG (mulberry32) so the same file always grows the same world.
 * All of its state is one number, so a run can be saved and picked up later.
 */
export class Rng {
  /** The generator's whole state, a 32-bit unsigned integer. Set it to resume a run. */
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** The next number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export function mulberry32(seed: number): () => number {
  const r = new Rng(seed);
  return () => r.next();
}
