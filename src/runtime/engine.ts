// Engine facade (contracts/engine-api.md): the interface the dev harness and later platform
// adapters use. Adapters supply files, settings and lifecycle events; the engine owns decoding,
// state, camera, rendering and frame scheduling.

import { TILE_SIZE } from '../core/data/terrain.ts'
import type { Atlas } from '../core/render/atlas.ts'
import { centeredCamera, clampCamera } from '../core/render/camera.ts'
import type { Camera } from '../core/render/camera.ts'
import { TerrainRenderer } from '../core/render/webgl-renderer.ts'
import type { RendererStats } from '../core/render/webgl-renderer.ts'
import { applyEvent } from '../core/sim/events.ts'
import type { WorldState } from '../core/state/world.ts'
import type { Clock } from '../core/util/clock.ts'
import { isSerializedFormatError } from '../core/util/errors.ts'
import type { SerializedFormatError } from '../core/util/errors.ts'
import { log } from '../core/util/log.ts'
import type { Logger } from './logger.ts'
import { installLogger } from './logger.ts'
import { openCache } from './cache.ts'
import { decodeArchive, decodeMap } from './decode.ts'
import type { WorkerDiagnostic, WorkerRequest, WorkerResponse } from './protocol.ts'
import { FrameScheduler } from './scheduler.ts'
import type { SchedulerHost } from './scheduler.ts'

export interface EngineOptions {
  canvas: HTMLCanvasElement
  clock?: Clock
  logger?: Logger
  /** false: decode on the main thread (tests); default: module worker. */
  useWorker?: boolean
  cache?: boolean
  /** Keeps the drawing buffer for pixel readback (checks only). */
  preserveDrawingBuffer?: boolean
  schedulerHost?: SchedulerHost
  /** Tiles of border the camera may show beyond the map edge. */
  borderTiles?: number
}

export type Diagnostic = WorkerDiagnostic

export type LoadResult =
  | { ok: true; identity: string; fromCache: boolean; warnings: Diagnostic[] }
  | { ok: false; error: SerializedFormatError | Diagnostic }

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  archive: string | null
  map: string | null
  diagnostics: Diagnostic[]
}

export interface EngineStats extends RendererStats {
  scheduledFrames: number
  pendingCallbacks: number
  surface: { width: number; height: number }
  camera: Camera
  visible: boolean
  paused: boolean
}

export interface Engine {
  loadArchive(file: Blob, name?: string): Promise<LoadResult>
  loadMap(file: Blob, name?: string): Promise<LoadResult>
  setLevel(level: number): void
  toggleLevel(): void
  scrollBy(dxCss: number, dyCss: number): void
  centerOn(tileX: number, tileY: number): void
  /** Places tile (tx, ty) at device pixel (px, py) — used by checks to match capture mappings. */
  setMapping(level: number, tile: { x: number; y: number }, pixel: { x: number; y: number }): void
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  setVisible(visible: boolean): void
  setPaused(paused: boolean): void
  /** Draws one frame now at a given palette step (checks); returns false if not ready. */
  renderNow(anim: { step: number } | { timeMs: number }): boolean
  onStatus(listener: (s: EngineStatus) => void): () => void
  status(): EngineStatus
  stats(): EngineStats
  world(): WorldState | undefined
  dispose(): void
}

function browserSchedulerHost(): SchedulerHost {
  return {
    requestFrame: (cb) => requestAnimationFrame(() => cb()),
    cancelFrame: (h) => cancelAnimationFrame(h),
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (h) => window.clearTimeout(h),
  }
}

function defaultClock(): Clock {
  return { now: () => performance.now() }
}

export function createEngine(options: EngineOptions): Engine {
  const { canvas } = options
  if (options.logger !== undefined) installLogger(options.logger)
  const clock = options.clock ?? defaultClock()
  const borderTiles = options.borderTiles ?? 8
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    powerPreference: 'low-power',
  })
  if (gl === null) throw new Error('WebGL 1.0 is not available')
  const renderer = new TerrainRenderer(gl, () => performance.now())
  const cache = openCache(options.cache !== false)
  const listeners = new Set<(s: EngineStatus) => void>()
  const status: EngineStatus = { state: 'idle', archive: null, map: null, diagnostics: [] }
  let world: WorldState | undefined
  let atlas: Atlas | undefined
  let camera: Camera = { level: 0, offsetX: 0, offsetY: 0, width: canvas.width, height: canvas.height, scale: 1 }
  let dpr = 1
  let visible = true
  let paused = false
  let contextLost = false
  let nextId = 1
  const pending = new Map<number, (r: WorkerResponse) => void>()

  let worker: Worker | undefined
  if (options.useWorker !== false) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resolve = pending.get(e.data.id)
      pending.delete(e.data.id)
      resolve?.(e.data)
    }
    worker.onerror = (e) => log.error('decode worker error', e.message)
  }

  const emit = (): void => {
    const snapshot = { ...status, diagnostics: [...status.diagnostics] }
    for (const l of listeners) l(snapshot)
  }
  const diagnose = (d: Diagnostic): void => {
    status.diagnostics = [...status.diagnostics.slice(-9), d]
    if (d.level === 'error') log.error(d.message, d)
    else log.warn(d.message, d)
  }

  const scheduler = new FrameScheduler(options.schedulerHost ?? browserSchedulerHost(), clock, {
    draw: (timeMs) => {
      if (world === undefined || contextLost) return false
      world = applyEvent(world, { kind: 'setTime', timeMs })
      renderer.render(camera, { timeMs: world.animationTimeMs })
      return renderer.hasAnimationInView
    },
  })

  const refreshReady = (): void => {
    status.state = contextLost ? 'loading' : atlas !== undefined && world !== undefined ? 'ready' : status.state === 'error' ? 'error' : 'idle'
    emit()
    scheduler.invalidate()
  }

  const clampAndInvalidate = (): void => {
    if (world !== undefined) camera = clampCamera(camera, world.size, borderTiles)
    scheduler.invalidate()
  }

  const run = async (req: Omit<WorkerRequest, 'id'>): Promise<WorkerResponse> => {
    if (worker === undefined) {
      try {
        if (req.kind === 'openArchive') {
          const r = await decodeArchive(req.file, req.name, cache)
          return { id: 0, kind: 'archiveReady', ...r }
        }
        const r = await decodeMap(req.file, req.name, cache)
        return { id: 0, kind: 'mapReady', ...r }
      } catch (err) {
        const e = err as { toJSON?: () => SerializedFormatError }
        return { id: 0, kind: 'failed', error: typeof e.toJSON === 'function' ? e.toJSON() : { level: 'error', code: 'INTERNAL', message: String(err), file: req.name } }
      }
    }
    const id = nextId++
    const w = worker
    return new Promise((resolve) => {
      pending.set(id, resolve)
      w.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  const failure = (error: SerializedFormatError | Diagnostic, file: string): LoadResult => {
    const d: Diagnostic = isSerializedFormatError(error)
      ? { level: 'error', code: error.code, message: `${error.message} (${error.structure} @${error.offset})`, file: error.file }
      : { ...error, file }
    diagnose(d)
    status.state = atlas !== undefined && world !== undefined ? 'ready' : 'error'
    emit()
    return { ok: false, error }
  }

  const fileName = (file: Blob, name: string | undefined): string => name ?? (file instanceof File ? file.name : 'unnamed')

  const engine: Engine = {
    async loadArchive(file, name) {
      const n = fileName(file, name)
      status.state = 'loading'
      emit()
      const r = await run({ kind: 'openArchive', file, name: n, useCache: options.cache !== false })
      if (r.kind === 'failed') return failure(r.error, n)
      if (r.kind !== 'archiveReady') return failure({ level: 'error', code: 'PROTOCOL', message: 'unexpected worker reply' }, n)
      atlas = r.atlas
      renderer.setAtlas(r.atlas)
      status.archive = n
      r.warnings.forEach(diagnose)
      refreshReady()
      return { ok: true, identity: r.identity, fromCache: r.fromCache, warnings: r.warnings }
    },
    async loadMap(file, name) {
      const n = fileName(file, name)
      status.state = 'loading'
      emit()
      const r = await run({ kind: 'openMap', file, name: n, useCache: options.cache !== false })
      if (r.kind === 'failed') return failure(r.error, n)
      if (r.kind !== 'mapReady') return failure({ level: 'error', code: 'PROTOCOL', message: 'unexpected worker reply' }, n)
      world = r.world
      renderer.setTerrain(r.world)
      status.map = n
      camera = centeredCamera(0, (world.size * TILE_SIZE) / 2, (world.size * TILE_SIZE) / 2, camera.width, camera.height, dpr)
      r.warnings.forEach(diagnose)
      clampAndInvalidate()
      refreshReady()
      return { ok: true, identity: r.identity, fromCache: r.fromCache, warnings: r.warnings }
    },
    setLevel(level) {
      if (world === undefined || level < 0 || level >= world.levels || level === camera.level) return
      camera = { ...camera, level }
      scheduler.invalidate()
    },
    toggleLevel() {
      if (world !== undefined) engine.setLevel((camera.level + 1) % world.levels)
    },
    scrollBy(dx, dy) {
      camera = { ...camera, offsetX: Math.round(camera.offsetX + dx), offsetY: Math.round(camera.offsetY + dy) }
      clampAndInvalidate()
    },
    centerOn(tx, ty) {
      camera = centeredCamera(camera.level, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, camera.width, camera.height, camera.scale)
      clampAndInvalidate()
    },
    setMapping(level, tile, pixel) {
      camera = { ...camera, level, scale: 1, offsetX: tile.x * TILE_SIZE - pixel.x, offsetY: tile.y * TILE_SIZE - pixel.y }
      scheduler.invalidate()
    },
    resize(cssWidth, cssHeight, deviceRatio) {
      dpr = deviceRatio
      // Never larger than the display (constitution IV).
      const maxW = Math.round(screen.width * deviceRatio)
      const maxH = Math.round(screen.height * deviceRatio)
      const width = Math.max(1, Math.min(Math.round(cssWidth * deviceRatio), maxW))
      const height = Math.max(1, Math.min(Math.round(cssHeight * deviceRatio), maxH))
      canvas.width = width
      canvas.height = height
      camera = { ...camera, width, height, scale: deviceRatio }
      clampAndInvalidate()
    },
    setVisible(v) {
      visible = v
      scheduler.setVisible(v)
    },
    setPaused(p) {
      paused = p
      scheduler.setPaused(p)
    },
    renderNow(anim) {
      if (world === undefined || contextLost) return false
      return renderer.render(camera, anim)
    },
    onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    status: () => ({ ...status, diagnostics: [...status.diagnostics] }),
    stats: () => ({
      ...renderer.getStats(),
      scheduledFrames: scheduler.frames,
      pendingCallbacks: scheduler.pending,
      surface: { width: canvas.width, height: canvas.height },
      camera: { ...camera },
      visible,
      paused,
    }),
    world: () => world,
    dispose() {
      scheduler.dispose()
      renderer.dispose()
      worker?.terminate()
      listeners.clear()
    },
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    contextLost = true
    status.state = 'loading'
    diagnose({ level: 'warn', code: 'CONTEXT_LOST', message: 'graphics context lost; waiting for restore' })
    emit()
  })
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false
    renderer.contextRestored()
    refreshReady()
  })

  return engine
}
