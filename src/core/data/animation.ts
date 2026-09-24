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

/**
 * Shadow strengths, weakest first. In the base game's black shadow the pixel below keeps
 * 7/8, 3/4, 5/8 or 1/2 of each 5/6-bit channel.
 */
export type ShadowKind = 'faint' | 'light' | 'medium' | 'dark'
/** Order in which stacked shadow steps are applied (strongest first; stacking order is not measured). */
export const SHADOW_KIND_ORDER: readonly ShadowKind[] = ['dark', 'medium', 'light', 'faint']

/**
 * Shadow indices of object sprites and their strength. Measured on 16-bit colour, per 5/6-bit
 * channel c: index 1 → (c >> 1) + (c >> 2) and index 4 → c >> 1 on test_map.h3m stills (2026-09-16,
 * research.md T046); index 2 → (c >> 1) + (c >> 3) and index 3 → (c >> 1) + (c >> 2) + (c >> 3) on
 * HotA sprites, 99 % of 7 233 and 3 086 pixels (2026-09-24, spec 005 research "Four shadow
 * strengths"). The markers say the same: (255,50,255) at 3 is the faintest, then (255,150,255) at 1,
 * (255,100,255) at 2 and (255,0,255) at 4. Indices 6 and 7 are not measured; 7 is assumed light, 6
 * dark. Whether an index *is* a shadow in a given sprite is decided by its palette entry, see
 * `isShadowMarker`.
 */
export const SHADOW_KINDS: ReadonlyMap<number, ShadowKind> = new Map([
  [1, 'light'],
  [2, 'medium'],
  [3, 'faint'],
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
export const SHADOW_MARKER_ALPHA: Readonly<Record<ShadowKind, number>> = { faint: 32, light: 64, medium: 96, dark: 128 }

/** The shadow kind a marker alpha stands for. */
export function shadowKindOfAlpha(alpha: number): ShadowKind | undefined {
  return SHADOW_KIND_ORDER.find((k) => SHADOW_MARKER_ALPHA[k] === alpha)
}

/**
 * Shadow tint: HotA recolours shadows by the soil the object stands on (its 1.7.2 changelog; spec 005
 * research "Shadow recolouring"). 0 = black (every terrain of the base game), 1 = sand, 2 = wasteland.
 */
export type ShadowTint = 0 | 1 | 2
export const SHADOW_TINT = { black: 0, sand: 1, wasteland: 2 } as const satisfies Record<string, ShadowTint>

const SAND = 1
const WASTELAND = 11

/** The tint of an object's shadows on a HotA map, from the terrain id under the object. */
export function shadowTintOfTerrain(terrain: number): ShadowTint {
  if (terrain === SAND) return SHADOW_TINT.sand
  if (terrain === WASTELAND) return SHADOW_TINT.wasteland
  return SHADOW_TINT.black
}

// Measured on HotA 1.8.1 captures (test_shadows.h3m, test_map_hota.h3m), in 5/6/5 units per channel
// (r, g, b). Black keeps the shifts. Sand adds a dark brown to them: exact for light and dark; the
// medium addition is extrapolated from the same 16-bit blend (S >> 2) + (S >> 3) with S = (6, 2, 0),
// faint adds S >> 3 = 0 (neither occurs on sand in the captures). Wasteland blends towards
// (3, 2, 0) with α = 38, 77, 115, 154 / 256 from faint to dark — k × 0.15 — exact for all four.
const SAND_ADD: Readonly<Record<ShadowKind, readonly [number, number, number]>> = { faint: [0, 0, 0], light: [1, 0, 0], medium: [1, 0, 0], dark: [3, 1, 0] }
const WASTELAND_COLOUR = [3, 2, 0] as const
const WASTELAND_ALPHA: Readonly<Record<ShadowKind, number>> = { faint: 38, light: 77, medium: 115, dark: 154 }

/** Darkens one channel value given in 5 or 6 bits (`channel` 0 = r, 1 = g, 2 = b). */
export function shadowChannel(c: number, kind: ShadowKind, tint: ShadowTint = SHADOW_TINT.black, channel: 0 | 1 | 2 = 0): number {
  if (tint === SHADOW_TINT.wasteland) {
    const a = WASTELAND_ALPHA[kind]
    return (c * (256 - a) + WASTELAND_COLOUR[channel] * a) >> 8
  }
  const half = c >> 1
  const black = kind === 'dark' ? half : kind === 'medium' ? half + (c >> 3) : kind === 'light' ? half + (c >> 2) : half + (c >> 2) + (c >> 3)
  return tint === SHADOW_TINT.sand ? black + SAND_ADD[kind][channel] : black
}

/**
 * Per-pixel tint accumulator shared by both renderers: each shadow step adds its tint's weight, a body
 * pixel resets it. Where shadows of different tints overlap (not measured) wasteland wins over sand
 * and sand over black. Weights fit an 8-bit render target (up to 15 wasteland steps).
 */
export const SHADOW_TINT_WEIGHT: Readonly<Record<ShadowTint, number>> = { 0: 0, 1: 1, 2: 16 }
export function shadowTintOfWeight(weight: number): ShadowTint {
  if (weight >= SHADOW_TINT_WEIGHT[2]) return SHADOW_TINT.wasteland
  return weight > 0 ? SHADOW_TINT.sand : SHADOW_TINT.black
}
