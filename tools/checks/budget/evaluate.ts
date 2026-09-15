// Budget evaluation (pure): turns measurements into BudgetReport entries (contracts/checks-cli.md).

import { CHECK_THRESHOLDS } from '../../../src/core/data/thresholds.ts'
import { PALETTE_STEP_MS } from '../../../src/core/data/palette-rotation.ts'

export const LIMITS = {
  runtimeJsGzipBytes: 100 * 1024,
  coldStartMs: 10_000,
  warmStartMs: 2_000,
  memoryBytes: 300 * 1024 * 1024,
} as const

export interface BudgetEntry {
  id: string
  map?: string
  measured?: number
  limit?: number
  unit?: string
  status: 'pass' | 'fail' | 'skip'
  note?: string
}

export interface MapMeasurement {
  map: string
  coldStartMs: number
  warmStartMs: number
  memoryBytes: number
  surface: { width: number; height: number }
  display: { width: number; height: number; dpr: number }
  hiddenFrames: number
  hiddenPending: number
  idleFrames: number
  idleWindowMs: number
  animatedInView: boolean
}

export function entry(id: string, measured: number, limit: number, unit: string, map?: string, note?: string): BudgetEntry {
  return { id, measured, limit, unit, status: measured <= limit ? 'pass' : 'fail', ...(map !== undefined ? { map } : {}), ...(note !== undefined ? { note } : {}) }
}

export function evaluateMap(m: MapMeasurement): BudgetEntry[] {
  const maxSurface = m.display.width * m.display.dpr * m.display.height * m.display.dpr
  const idleLimit = m.animatedInView ? Math.floor(m.idleWindowMs / PALETTE_STEP_MS) + 1 : 1
  return [
    entry('cold-start', m.coldStartMs, LIMITS.coldStartMs, 'ms', m.map),
    entry('warm-start', m.warmStartMs, LIMITS.warmStartMs, 'ms', m.map),
    entry('memory', m.memoryBytes, LIMITS.memoryBytes, 'bytes', m.map, 'main-thread JS heap + renderer GPU bytes'),
    entry('surface', m.surface.width * m.surface.height, maxSurface, 'px', m.map, `${m.surface.width}x${m.surface.height} vs display ${m.display.width}x${m.display.height}@${m.display.dpr}`),
    entry('hidden-frames', m.hiddenFrames, 0, 'frames', m.map),
    entry('hidden-timers', m.hiddenPending, 0, 'callbacks', m.map),
    entry('idle-cadence', m.idleFrames, idleLimit, 'frames', m.map, `${m.idleWindowMs} ms idle, ${m.animatedInView ? 'animated content in view' : 'static view'}`),
  ]
}

export interface FrameWork {
  drawCalls: number
  /** Vertex buffer capacity for the view (vertices actually drawn depend on map content). */
  vertices: number
  gpuBytes: number
  medianFrameCpuMs: number
}

/** SC-007: work on the large map must equal the small map's (CPU within tolerance). */
export function evaluateSc007(small: FrameWork, large: FrameWork): BudgetEntry[] {
  const cpuAllowed = Math.max(small.medianFrameCpuMs * (1 + CHECK_THRESHOLDS.sc007CpuTolerance), small.medianFrameCpuMs + CHECK_THRESHOLDS.sc007CpuFloorMs)
  const bytesAllowed = small.gpuBytes * (1 + CHECK_THRESHOLDS.gpuBytesTolerance)
  return [
    entry('sc007-draw-calls', large.drawCalls, small.drawCalls, 'calls', undefined, 'large map vs small map, same view'),
    entry('sc007-vertices', large.vertices, small.vertices, 'vertices', undefined, 'vertex buffer capacity, large map vs small map, same view'),
    entry('sc007-gpu-bytes', large.gpuBytes, bytesAllowed, 'bytes', undefined, `small map ${small.gpuBytes}`),
    entry('sc007-frame-cpu', large.medianFrameCpuMs, cpuAllowed, 'ms', undefined, `small map median ${small.medianFrameCpuMs.toFixed(3)} ms`),
  ]
}
