// Adventure-map object animation and special sprite indices (specs/003-map-objects/research.md
// §3, §7). Values marked "pending SPIKE" are hypotheses until measured on reference captures.

import { PALETTE_STEP_MS } from './palette-rotation.ts'

/**
 * Duration of one object animation step (tick) in ms. Hypothesis: the adventure map uses one timer
 * for palette rotation and object frames. Pending SPIKE T062.
 */
export const OBJECT_FRAME_MS = PALETTE_STEP_MS

/**
 * 'perObject': every object starts its animation at its own frame, `frame = (tick + phase) mod
 * frameCount`. Measured 2026-09-16 (research.md §7): in two launches of the same test_map.h3m view the
 * frame differences between 69 animated objects were spread over all 12 values, i.e. the game picks
 * phases at random per launch; the project picks them from the seed.
 */
export const OBJECT_PHASE_MODEL: 'global' | 'perDef' | 'perObject' = 'perObject'

/** Palette index of flag pixels, replaced by the owner's colour. */
export const FLAG_INDEX = 5

export type ShadowKind = 'light' | 'dark'

/**
 * Shadow indices of object sprites and how they darken the pixel below (measured 2026-09-16 on
 * test_map.h3m stills, research.md T046): the game works on the 16-bit colour, per 5/6-bit channel
 * c: light (index 1) → (c >> 1) + (c >> 2), dark (index 4) → c >> 1. Indices 6 and 7 did not occur
 * in the captured base-game sprites; 7 is assumed light, 6 dark.
 *
 * Indices 2 and 3 carry HotA's shadows in the sprites that use them as shadows: 3 behaves like base
 * index 1 and 2 like base index 4. Whether an index *is* a shadow in a given sprite is decided by
 * its palette entry, see `isShadowMarker`.
 */
export const SHADOW_KINDS: ReadonlyMap<number, ShadowKind> = new Map([
  [1, 'light'],
  [2, 'dark'],
  [3, 'light'],
  [4, 'dark'],
  [6, 'dark'],
  [7, 'light'],
])

/**
 * Palette colours that make a special index a shadow. Every base-game object sprite holds one of
 * these at the special indices its pixels use. Most HotA sprites keep ordinary colours there
 * instead — at index 2 in 630 of 1227 HotA object sprites, at 3 in 694, at 6 in 955, at 7 in 951 —
 * and the game draws those opaque (a door drawn with index 2, `(7,2,2)`, shows as that colour,
 * measured on the owner's probe map, 2026-09-24; spec 005 research). Base reef and rock sprites
 * store `(255,151,255)`, one step off the usual marker, hence the tolerance.
 */
const SHADOW_MARKER_COLOURS: readonly (readonly [number, number, number])[] = [
  [255, 150, 255],
  [255, 100, 255],
  [255, 50, 255],
  [255, 0, 255],
  [180, 0, 255],
  [0, 255, 0],
]
const MARKER_TOLERANCE = 2

/**
 * Whether a special index holds a shadow marker rather than an ordinary colour. Cyan variants at a
 * special index (19 HotA sprites, e.g. `(0,191,191)` at index 4) are not understood; they keep the
 * shadow reading every special index had before, until a capture shows otherwise.
 */
export function isShadowMarker(r: number, g: number, b: number): boolean {
  const near = (m: readonly [number, number, number]): boolean =>
    Math.abs(r - m[0]) <= MARKER_TOLERANCE && Math.abs(g - m[1]) <= MARKER_TOLERANCE && Math.abs(b - m[2]) <= MARKER_TOLERANCE
  if (SHADOW_MARKER_COLOURS.some(near)) return true
  return r <= 8 && g >= 180 && Math.abs(g - b) <= 8
}

/** Palette alpha marking shadow entries in object palettes (not used as opacity). */
export const SHADOW_MARKER_ALPHA: Readonly<Record<ShadowKind, number>> = { light: 64, dark: 128 }

/** Darkens one channel value given in 5 or 6 bits. */
export function shadowChannel(c: number, kind: ShadowKind): number {
  return kind === 'dark' ? c >> 1 : (c >> 1) + (c >> 2)
}
