// Adventure-map animation state (specs/003-map-objects/data-model.md "Animation state"): one global
// tick drives object frames; the palette step comes from the same clock (spec 002).

import { OBJECT_FRAME_MS } from '../data/animation.ts'
import { PALETTE_STEP_MS } from '../data/palette-rotation.ts'

export interface AnimationState {
  paletteStep: number
  tick: number
}

export function objectTick(timeMs: number): number {
  return Math.floor(Math.max(0, timeMs) / OBJECT_FRAME_MS)
}

/** Frame index of a group with `frameCount` frames at `tick` (global phase model). */
export function frameOf(frameCount: number, tick: number): number {
  return frameCount <= 1 ? 0 : ((tick % frameCount) + frameCount) % frameCount
}

/**
 * Earliest time after `timeMs` at which something visible changes: the next palette step when
 * palette-animated sprites are in view, the next object tick when animated objects are in view;
 * null when nothing animates.
 */
export function nextChangeMs(timeMs: number, inView: { animatedRows: boolean; animatedObjects: boolean }): number | null {
  const t = Math.max(0, timeMs)
  let next: number | null = null
  if (inView.animatedRows) next = (Math.floor(t / PALETTE_STEP_MS) + 1) * PALETTE_STEP_MS
  if (inView.animatedObjects) {
    const o = (Math.floor(t / OBJECT_FRAME_MS) + 1) * OBJECT_FRAME_MS
    next = next === null ? o : Math.min(next, o)
  }
  return next
}
