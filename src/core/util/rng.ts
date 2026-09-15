// Seeded pseudo-random generator (constitution III): mulberry32, 32-bit state.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [0, max). */
  int(max: number): number
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
  }
}

/** Stable 32-bit hash of integers, for position-seeded choices that do not depend on call order. */
export function hashInts(...values: number[]): number {
  let h = 0x811c9dc5
  for (const v of values) {
    h ^= v >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
    h ^= h >>> 13
  }
  return h >>> 0
}
