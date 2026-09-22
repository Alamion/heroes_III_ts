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
 * Indices 2 and 3 are HotA's shadow slots, where 3 behaves like base index 1 and 2 like base index
 * 4. This is not a per-file exception: sweeping both archives (spec 005 T041) found them in 699 of
 * 1072 HotA adventure sprites and in 2 of 1369 base-game ones, where they cover 1 and 25 pixels.
 * The indices themselves are therefore the signal and no name list is needed.
 */
export const SHADOW_KINDS: ReadonlyMap<number, ShadowKind> = new Map([
  [1, 'light'],
  [2, 'dark'],
  [3, 'light'],
  [4, 'dark'],
  [6, 'dark'],
  [7, 'light'],
])

/** Palette alpha marking shadow entries in object palettes (not used as opacity). */
export const SHADOW_MARKER_ALPHA: Readonly<Record<ShadowKind, number>> = { light: 64, dark: 128 }

/** Darkens one channel value given in 5 or 6 bits. */
export function shadowChannel(c: number, kind: ShadowKind): number {
  return kind === 'dark' ? c >> 1 : (c >> 1) + (c >> 2)
}
