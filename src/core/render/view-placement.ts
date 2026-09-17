// Initial view placement for wallpapers (spec 004 FR-003a, data-model.md "ViewPlacement"): a random
// position (seeded), the map centre, or relative coordinates from two 0–100 % sliders. Pure and
// DOM-free so it is unit-tested in Node.

import { TILE_SIZE } from '../data/terrain.ts'
import { createRng } from '../util/rng.ts'
import type { Camera } from './camera.ts'

export type ViewPlacement =
  | { mode: 'random'; seed: number }
  | { mode: 'centre' }
  /** Fractions 0..1 of the reachable range (0 = leftmost/topmost view, past the edge by the overscan). */
  | { mode: 'coords'; fx: number; fy: number }

export type LevelChoice = number | { random: number }

export interface PlacementInput {
  mapSize: number
  levels: number
  /**
   * Requested level (a level the map does not have falls back to the surface), or a random level drawn
   * from the given seed on maps with an underground.
   */
  level: LevelChoice
  placement: ViewPlacement
  /**
   * How far past each map edge a view may reach, in world pixels: the border band the camera may show
   * (8 tiles in the engine), so edges and the map border show up like when scrolling to the edge in
   * the game. Default 0.
   */
  overscan?: number
  /** Viewport in device pixels and device pixels per world pixel. */
  width: number
  height: number
  scale: number
}

export interface PlacementResult {
  camera: Camera
  /** Fractions actually used (random draws them), so later level changes can keep them. */
  fx: number
  fy: number
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)

/** Offset along one axis: a fraction of the range from the first to the last view position. */
function axisOffset(fraction: number, mapPixels: number, viewPixels: number, overscan: number): number {
  const max = mapPixels - viewPixels
  if (max <= 0) return Math.round(max / 2)
  const past = Math.max(0, overscan)
  return Math.round(-past + fraction * (max + 2 * past))
}

export function placeView(input: PlacementInput): PlacementResult {
  const { placement } = input
  let fx: number
  let fy: number
  if (placement.mode === 'centre') {
    fx = 0.5
    fy = 0.5
  } else if (placement.mode === 'coords') {
    fx = clamp01(placement.fx)
    fy = clamp01(placement.fy)
  } else {
    const rng = createRng(placement.seed)
    fx = rng.next()
    fy = rng.next()
  }
  const choice = input.level
  const level =
    typeof choice !== 'number' ? (input.levels > 1 ? createRng(choice.random).int(input.levels) : 0) : choice >= 0 && choice < input.levels ? Math.floor(choice) : 0
  const mapPixels = input.mapSize * TILE_SIZE
  const overscan = input.overscan ?? 0
  const offsetX = axisOffset(fx, mapPixels, input.width / input.scale, overscan)
  const offsetY = axisOffset(fy, mapPixels, input.height / input.scale, overscan)
  return { camera: { level, offsetX, offsetY, width: input.width, height: input.height, scale: input.scale }, fx, fy }
}
