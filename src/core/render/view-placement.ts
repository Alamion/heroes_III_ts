// Initial view placement for wallpapers (spec 004 FR-003a, data-model.md "ViewPlacement"): a random
// position (seeded), the map centre, or relative coordinates from two 0–100 % sliders. Given the map's
// coverage grid, a random place is chosen among candidates so it is not an empty view (spec 009,
// data-model.md "Choice"). Pure and DOM-free so it is unit-tested in Node.

import { TILE_SIZE } from '../data/terrain.ts'
import { viewCoverage } from '../state/coverage.ts'
import type { CoverageGrid } from '../state/coverage.ts'
import { createRng } from '../util/rng.ts'
import type { Camera } from './camera.ts'

/** A candidate view this covered is taken at once (spec 009 research R3: only solid emptiness is avoided). */
export const BUSY_COVERAGE = 0.15
/** Candidates per level tried before the best one is taken. */
export const CANDIDATES_PER_LEVEL = 10

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
  /** With a random placement: choose a busy place (spec 009). Absent: a uniform random place. */
  coverage?: CoverageGrid
}

export interface Candidate {
  level: number
  fx: number
  fy: number
  coverage: number
}

export interface PlaceChoice {
  /** In the order tried; the last is the first that reached the threshold, or the last of all. */
  candidates: readonly Candidate[]
  /** Index of the candidate shown. */
  chosen: number
  reached: boolean
}

export interface PlacementResult {
  camera: Camera
  /** Fractions actually used (random draws them), so later level changes can keep them. */
  fx: number
  fy: number
  /** Only for a random placement with a coverage grid. */
  choice?: PlaceChoice
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)

/** Offset along one axis: a fraction of the range from the first to the last view position. */
function axisOffset(fraction: number, mapPixels: number, viewPixels: number, overscan: number): number {
  const max = mapPixels - viewPixels
  if (max <= 0) return Math.round(max / 2)
  const past = Math.max(0, overscan)
  return Math.round(-past + fraction * (max + 2 * past))
}

function cameraAt(input: PlacementInput, level: number, fx: number, fy: number): Camera {
  const mapPixels = input.mapSize * TILE_SIZE
  const overscan = input.overscan ?? 0
  const offsetX = axisOffset(fx, mapPixels, input.width / input.scale, overscan)
  const offsetY = axisOffset(fy, mapPixels, input.height / input.scale, overscan)
  return { level, offsetX, offsetY, width: input.width, height: input.height, scale: input.scale }
}

export function placeView(input: PlacementInput): PlacementResult {
  const { placement } = input
  const choice = input.level
  const level =
    typeof choice !== 'number' ? (input.levels > 1 ? createRng(choice.random).int(input.levels) : 0) : choice >= 0 && choice < input.levels ? Math.floor(choice) : 0
  if (placement.mode === 'random' && input.coverage !== undefined) return chooseBusyPlace(input, input.coverage, placement.seed, level)
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
  return { camera: cameraAt(input, level, fx, fy), fx, fy }
}

/**
 * Candidates from one stream of the placement seed: the first is exactly the uniform place, then the
 * rest of the drawn level, then (with a random level on a two-level map) the other level. The first
 * busy enough is taken, otherwise the most covered, earlier on ties (spec 009 FR-002, FR-003).
 */
function chooseBusyPlace(input: PlacementInput, coverage: CoverageGrid, seed: number, drawn: number): PlacementResult {
  const levels = typeof input.level !== 'number' && input.levels === 2 ? [drawn, 1 - drawn] : [drawn]
  const rng = createRng(seed)
  const candidates: Candidate[] = []
  let best = 0
  let bestCamera: Camera | undefined
  search: for (const level of levels) {
    for (let k = 0; k < CANDIDATES_PER_LEVEL; k++) {
      const fx = rng.next()
      const fy = rng.next()
      const camera = cameraAt(input, level, fx, fy)
      const c = { level, fx, fy, coverage: viewCoverage(coverage, camera) }
      candidates.push(c)
      if (bestCamera === undefined || c.coverage > (candidates[best] as Candidate).coverage) {
        best = candidates.length - 1
        bestCamera = camera
      }
      if (c.coverage >= BUSY_COVERAGE) break search
    }
  }
  const chosen = candidates[best] as Candidate
  return { camera: bestCamera as Camera, fx: chosen.fx, fy: chosen.fy, choice: { candidates, chosen: best, reached: chosen.coverage >= BUSY_COVERAGE } }
}
