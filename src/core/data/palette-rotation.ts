// Palette animation of adventure-map terrain and rivers (research.md §5).
// Each step: new[start + i] = old[start + (i − 1) mod length], i.e. the last colour of the range
// moves to its start (measured from reference clips; h3lwp rotates the other way).

export interface PaletteRotation {
  /** First palette index of the rotating range. */
  readonly start: number
  /** Number of indices in the range (also the cycle length in steps). */
  readonly length: number
}

export interface AnimatedDef {
  readonly defName: string
  readonly rotations: readonly PaletteRotation[]
}

/**
 * Step duration in milliseconds, measured from five 60 fps reference clips of water
 * (mean 179.6–180.2 ms per step, research.md §5).
 */
export const PALETTE_STEP_MS = 180

/**
 * How ranges advance. 'global': one step counter `k` for all ranges, range rotated by
 * `k mod length`. Both water ranges were observed in lock in reference clips; rivers and lava share
 * the counter until a capture shows otherwise.
 */
export const PHASE_MODEL: 'global' | 'independent' = 'global'

/**
 * Rotating ranges. Water, clear river and lava are verified against reference captures (lava rotates
 * nine colours, 246–254, not h3lwp's eight); mud and lava rivers follow h3lwp and are not yet seen
 * in a capture.
 */
export const ANIMATED_DEFS = [
  { defName: 'watrtl.def', rotations: [{ start: 229, length: 12 }, { start: 242, length: 12 }] },
  { defName: 'lavatl.def', rotations: [{ start: 246, length: 9 }] },
  { defName: 'clrrvr.def', rotations: [{ start: 183, length: 12 }, { start: 195, length: 6 }] },
  { defName: 'mudrvr.def', rotations: [{ start: 183, length: 6 }, { start: 240, length: 6 }] },
  { defName: 'lavrvr.def', rotations: [{ start: 240, length: 8 }] },
] as const satisfies readonly AnimatedDef[]

export function rotationsFor(defName: string): readonly PaletteRotation[] {
  const lower = defName.toLowerCase()
  return ANIMATED_DEFS.find((d) => d.defName === lower)?.rotations ?? []
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Joint period of all rotations in steps (LCM of the lengths). */
export function jointPeriod(): number {
  let p = 1
  for (const d of ANIMATED_DEFS) for (const r of d.rotations) p = (p * r.length) / gcd(p, r.length)
  return p
}
