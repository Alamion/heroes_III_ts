// Pixel classification and outcome rules for fidelity checks (research.md §10). Pure functions over
// buffers so they are unit-testable with fabricated captures.

import { CHECK_THRESHOLDS } from '../../../src/core/data/thresholds.ts'
import { TILE_SIZE } from '../../../src/core/data/terrain.ts'
import { isCovered, tileKey } from '../../../src/core/state/footprint.ts'
import type { Footprint } from '../../../src/core/state/footprint.ts'
import type { Region } from '../../shared/cli-runner.ts'

export const PIXEL = {
  outside: 0,
  ui: 1,
  floating: 2,
  object: 3,
  volatile: 4,
  compared: 5,
} as const

export interface ExclusionInput {
  width: number
  height: number
  /** World pixel at the viewport's top-left. */
  offsetX: number
  offsetY: number
  mapSize: number
  region: Region
  /** Viewport-sized, 1 = UI ornament. */
  ui: Uint8Array | null
  /** Viewport-sized, 1 = volatile in the capture (stills only). */
  volatile: Uint8Array | null
  objects: Footprint
  floating: Footprint
  /** Whether a tile's drawn frames use a rotating palette (overrides the volatile mask). */
  animatedTile: (tx: number, ty: number) => boolean
}

export interface Exclusions {
  cls: Uint8Array
  animated: Uint8Array
  /** Tile key per pixel index of the viewport (x, y of the world tile). */
  tileX: Int32Array
  tileY: Int32Array
  counts: { inMap: number; regionPixels: number; outsideViewport: number; ui: number; floating: number; object: number; volatile: number; compared: number; comparedInMap: number; comparedAnimated: number; border: number }
}

export function classifyPixels(input: ExclusionInput): Exclusions {
  const { width, height, offsetX, offsetY, mapSize, region } = input
  const n = width * height
  const cls = new Uint8Array(n)
  const animated = new Uint8Array(n)
  const tileX = new Int32Array(n)
  const tileY = new Int32Array(n)
  const counts = { inMap: 0, regionPixels: 0, outsideViewport: 0, ui: 0, floating: 0, object: 0, volatile: 0, compared: 0, comparedInMap: 0, comparedAnimated: 0, border: 0 }
  for (let y = 0; y < height; y++) {
    const wy = offsetY + y
    const ty = Math.floor(wy / TILE_SIZE)
    const ry = wy - ty * TILE_SIZE
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const wx = offsetX + x
      const tx = Math.floor(wx / TILE_SIZE)
      const rx = wx - tx * TILE_SIZE
      tileX[i] = tx
      tileY[i] = ty
      if (tx < region.x0 || tx > region.x1 || ty < region.y0 || ty > region.y1) continue
      const inMap = tx >= 0 && ty >= 0 && tx < mapSize && ty < mapSize
      if (inMap) counts.inMap++
      if (input.ui !== null && input.ui[i]) {
        cls[i] = PIXEL.ui
        counts.ui++
        continue
      }
      if (inMap && isCovered(input.floating.get(tileKey(tx, ty)), rx, ry)) {
        cls[i] = PIXEL.floating
        counts.floating++
        continue
      }
      if (inMap && isCovered(input.objects.get(tileKey(tx, ty)), rx, ry)) {
        cls[i] = PIXEL.object
        counts.object++
        continue
      }
      const anim = inMap && input.animatedTile(tx, ty)
      if (input.volatile !== null && input.volatile[i] && !anim) {
        cls[i] = PIXEL.volatile
        counts.volatile++
        continue
      }
      cls[i] = PIXEL.compared
      counts.compared++
      if (inMap) counts.comparedInMap++
      else counts.border++
      if (anim) {
        animated[i] = 1
        counts.comparedAnimated++
      }
    }
  }
  const regionTiles = (region.x1 - region.x0 + 1) * (region.y1 - region.y0 + 1)
  let inViewport = 0
  for (let i = 0; i < n; i++) if (tileX[i] as number >= region.x0 && (tileX[i] as number) <= region.x1 && (tileY[i] as number) >= region.y0 && (tileY[i] as number) <= region.y1) inViewport++
  counts.regionPixels = regionTiles * TILE_SIZE * TILE_SIZE
  counts.outsideViewport = counts.regionPixels - inViewport
  return { cls, animated, tileX, tileY, counts }
}

/** Reads RGB of capture pixel (x, y) of the viewport. */
export interface CaptureSampler {
  data: Uint8Array
  channels: number
  /** Image width. */
  stride: number
  /** Viewport origin in the image. */
  x0: number
  y0: number
}

export function samePixel(cap: CaptureSampler, rendered: Uint8Array, width: number, i: number): boolean {
  const x = i % width
  const y = (i - x) / width
  const c = ((y + cap.y0) * cap.stride + x + cap.x0) * cap.channels
  const r = i * 4
  return cap.data[c] === rendered[r] && cap.data[c + 1] === rendered[r + 1] && cap.data[c + 2] === rendered[r + 2]
}

/** Differing compared pixels; with `animatedOnly`, only palette-animated ones. */
export function countDiffs(ex: Exclusions, cap: CaptureSampler, rendered: Uint8Array, width: number, animatedOnly = false): number {
  let d = 0
  for (let i = 0; i < ex.cls.length; i++) {
    if (ex.cls[i] !== PIXEL.compared) continue
    if (animatedOnly && !ex.animated[i]) continue
    if (!samePixel(cap, rendered, width, i)) d++
  }
  return d
}

export type Outcome = 'pass' | 'fail' | 'not-checkable'

/** Outcome order: fail (any difference) → not-checkable (compared share below threshold) → pass. */
export function decideOutcome(differing: number, comparedInMap: number, inMap: number, threshold: number = CHECK_THRESHOLDS.notCheckableComparedShare): Outcome {
  if (differing > 0) return 'fail'
  if (inMap === 0 || comparedInMap / inMap < threshold) return 'not-checkable'
  return 'pass'
}

export interface TileStat {
  x: number
  y: number
  compared: number
  differing: number
}

export function tileStats(ex: Exclusions, cap: CaptureSampler, rendered: Uint8Array, width: number): TileStat[] {
  const map = new Map<string, TileStat>()
  for (let i = 0; i < ex.cls.length; i++) {
    if (ex.cls[i] !== PIXEL.compared) continue
    const key = `${ex.tileX[i]},${ex.tileY[i]}`
    let t = map.get(key)
    if (t === undefined) {
      t = { x: ex.tileX[i] as number, y: ex.tileY[i] as number, compared: 0, differing: 0 }
      map.set(key, t)
    }
    t.compared++
    if (!samePixel(cap, rendered, width, i)) t.differing++
  }
  return [...map.values()].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Diff image: red = differing, gray = excluded, dimmed capture = equal, black = outside region. */
export function diffImage(ex: Exclusions, cap: CaptureSampler, rendered: Uint8Array, width: number): Uint8Array {
  const out = new Uint8Array(ex.cls.length * 4)
  for (let i = 0; i < ex.cls.length; i++) {
    const o = i * 4
    out[o + 3] = 255
    const c = ex.cls[i]
    if (c === PIXEL.outside) continue
    if (c !== PIXEL.compared) {
      out[o] = 96
      out[o + 1] = 96
      out[o + 2] = 96
      continue
    }
    if (samePixel(cap, rendered, width, i)) {
      const x = i % width
      const y = (i - x) / width
      const s = ((y + cap.y0) * cap.stride + x + cap.x0) * cap.channels
      out[o] = (cap.data[s] as number) >> 2
      out[o + 1] = (cap.data[s + 1] as number) >> 2
      out[o + 2] = (cap.data[s + 2] as number) >> 2
    } else {
      out[o] = 255
    }
  }
  return out
}

export interface ClipStep {
  tStartMs: number
  paletteStep: number | null
}

/**
 * Clip timing (SC-005): matched palette steps must advance by exactly one per change, and the median
 * interval per step must be within one capture frame of the expected duration. The median ignores
 * steps the capture environment holds for an extra tick (research.md §5).
 */
export function evaluateClipSteps(steps: readonly ClipStep[], states: number, grabFps: number, expectedMs: number): { pass: boolean; ordered: boolean; stepMsMeasured: number } {
  let ordered = true
  const intervals: number[] = []
  let last: { t: number; step: number } | undefined
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1]?.paletteStep
    const b = steps[i]?.paletteStep
    if (a === null || b === null || a === undefined || b === undefined || a === b) continue
    const delta = (b - a + states) % states
    if (delta !== 1) ordered = false
    const t = (steps[i] as ClipStep).tStartMs
    if (last !== undefined) intervals.push((t - last.t) / ((b - last.step + states) % states))
    last = { t, step: b }
  }
  intervals.sort((x, y) => x - y)
  const measured = intervals.length === 0 ? Number.NaN : (intervals[Math.floor(intervals.length / 2)] as number)
  const pass = ordered && Number.isFinite(measured) && Math.abs(measured - expectedMs) <= 1000 / grabFps
  return { pass, ordered, stepMsMeasured: measured }
}
