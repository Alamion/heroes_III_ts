// Palette animation state (research.md §5). Rows of the atlas palette texture are rotated on the
// CPU and uploaded as data updates — no textures are created per step (constitution IV).

import { ANIMATED_DEFS, jointPeriod, PALETTE_STEP_MS, PHASE_MODEL, rotationsFor } from '../data/palette-rotation.ts'
import type { AtlasLayout } from './atlas.ts'
import { rotatePalette } from './palette-math.ts'

/** Animation step index at a time (global phase model). */
export function animationStep(timeMs: number): number {
  return Math.floor(Math.max(0, timeMs) / PALETTE_STEP_MS)
}

/** Time of the next step change after `timeMs`. */
export function nextStepTime(timeMs: number): number {
  return (animationStep(timeMs) + 1) * PALETTE_STEP_MS
}

/** Number of distinct animation states (a still's unknown phase is searched over these). */
export function animationStateCount(): number {
  return PHASE_MODEL === 'global' ? jointPeriod() : jointPeriod()
}

export function allAnimationStates(): number[] {
  return Array.from({ length: animationStateCount() }, (_, i) => i)
}

/** Atlas palette rows that animate. */
export function animatedRows(layout: AtlasLayout): number[] {
  const rows: number[] = []
  for (const d of ANIMATED_DEFS) {
    const s = layout.sprites[d.defName]
    if (s !== undefined) rows.push(s.row)
  }
  return rows.sort((a, b) => a - b)
}

export interface PaletteRowUpdate {
  row: number
  rgba: Uint8Array
}

/** RGBA palette rows for animated sprites at a step. */
export function paletteRowsAt(layout: AtlasLayout, basePalettes: Uint8Array, step: number): PaletteRowUpdate[] {
  const out: PaletteRowUpdate[] = []
  for (const sprite of Object.values(layout.sprites)) {
    const rotations = rotationsFor(sprite.name)
    if (rotations.length === 0) continue
    const base = basePalettes.subarray(sprite.row * 1024, (sprite.row + 1) * 1024)
    out.push({ row: sprite.row, rgba: rotatePalette(base, rotations, step, 4) })
  }
  return out
}

/** Full palette texture data at a step (for software rendering and tests). */
export function palettesAt(layout: AtlasLayout, basePalettes: Uint8Array, step: number): Uint8Array {
  const out = basePalettes.slice()
  for (const u of paletteRowsAt(layout, basePalettes, step)) out.set(u.rgba, u.row * 1024)
  return out
}
