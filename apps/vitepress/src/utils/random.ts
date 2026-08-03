export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(probability?: number): boolean;
  /** Uniform date between from and to (inclusive range of timestamps). */
  date(from: Date, to: Date): Date;
  /** Zero-padded integer string, e.g. padded(7, 4) -> "0007". */
  padded(n: number, length: number): string;
}

/** Deterministic 32-bit PRNG (mulberry32). Same seed => same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    bool: (probability = 0.5) => next() < probability,
    date: (from, to) =>
      new Date(from.getTime() + next() * (to.getTime() - from.getTime())),
    padded: (n, length) => String(n).padStart(length, "0"),
  };
}
