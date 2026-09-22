// Engine facade (contracts/engine-api.md): the interface the dev harness and later platform
// adapters use. Adapters supply files, settings and lifecycle events; the engine owns decoding,
// state, camera, rendering and frame scheduling.

import { TILE_SIZE } from '../core/data/terrain.ts'
import type { Atlas } from '../core/render/atlas.ts'
import { centeredCamera, clampCamera } from '../core/render/camera.ts'
import type { Camera } from '../core/render/camera.ts'
import { TerrainRenderer } from '../core/render/webgl-renderer.ts'
import type { FrameAnimation, RendererStats } from '../core/render/webgl-renderer.ts'
import type { DrawListEntry } from '../core/render/object-plan.ts'
import { placeView } from '../core/render/view-placement.ts'
import type { LevelChoice, ViewPlacement } from '../core/render/view-placement.ts'
import { ObjectIndex } from '../core/state/object-index.ts'
import { applyEvent } from '../core/sim/events.ts'
import type { WorldState } from '../core/state/world.ts'
import type { Clock } from '../core/util/clock.ts'
import { isSerializedFormatError } from '../core/util/errors.ts'
import type { SerializedFormatError } from '../core/util/errors.ts'
import { log } from '../core/util/log.ts'
import type { Logger } from './logger.ts'
import { installLogger } from './logger.ts'
import { openCache } from './cache.ts'
import { checkDataArchive, decodeArchive, decodeMap, decodeObjects } from './decode.ts'
import type { ArchiveFileMsg, WorkerDiagnostic, WorkerRequest, WorkerResponse } from './protocol.ts'
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
  /** Decides random-object outcomes (default 1). */
  seed?: number
  /** false: draw terrain only. */
  objects?: boolean
  /** Creates the decode worker. Default: module worker via import.meta.url (ESM builds only). */
  workerFactory?: () => Worker
}

/** Presentation scale: integer multiples of native 32 px tiles (spec 004 FR-010). */
export type UserScale = 1 | 2 | 3

export type Diagnostic = WorkerDiagnostic

export type LoadResult =
  | { ok: true; identity: string; fromCache: boolean; warnings: Diagnostic[] }
  | { ok: false; error: SerializedFormatError | Diagnostic }

/** Error code of a load whose result was dropped because a newer load of the same slot started. */
export const SUPERSEDED = 'SUPERSEDED'

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  archive: string | null
  dataArchive: string | null
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
  /** Time of the next visible change after the last frame (palette step or object tick), or null. */
  nextChangeMs: number | null
}

export interface Engine {
  loadArchive(file: Blob, name?: string): Promise<LoadResult>
  loadMap(file: Blob, name?: string): Promise<LoadResult>
  /** h3bitmap.lod: Objects.txt, artraits.txt and game.pal; objects are drawn only with it. */
  loadDataArchive(file: Blob, name?: string): Promise<LoadResult>
  setObjectsVisible(visible: boolean): void
  /** Objects drawn in the last frame, in draw order (collected with preserveDrawingBuffer only). */
  drawList(): DrawListEntry[]
  setLevel(level: number): void
  toggleLevel(): void
  scrollBy(dxCss: number, dyCss: number): void
  centerOn(tileX: number, tileY: number): void
  /** Places tile (tx, ty) at device pixel (px, py) — used by checks to match capture mappings. `scale` defaults to 1. */
  setMapping(level: number, tile: { x: number; y: number }, pixel: { x: number; y: number }, scale?: number): void
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  /** Integer presentation scale; camera.scale = dpr × userScale; keeps the view centre. */
  setUserScale(scale: UserScale): void
  /** Positions the camera on the current map; returns the level and fractions used. */
  placeView(level: LevelChoice, placement: ViewPlacement): { level: number; fx: number; fy: number } | undefined
  /** Host frame limit in frames per second; 0 = no limit. */
  setFrameLimit(fps: number): void
  /** Deletes all decoded cache entries. */
  forgetCache(): Promise<void>
  setVisible(visible: boolean): void
  setPaused(paused: boolean): void
  /** Draws one frame now at a given palette step (checks); returns false if not ready. */
  renderNow(anim: FrameAnimation): boolean
  onStatus(listener: (s: EngineStatus) => void): () => void
  status(): EngineStatus
  stats(): EngineStats
  world(): WorldState | undefined
  dispose(): void
}

/** Worker request without the id the engine assigns (distributes over the union). */
type RequestWithoutId = WorkerRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never

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
  const status: EngineStatus = { state: 'idle', archive: null, dataArchive: null, map: null, diagnostics: [] }
  let world: WorldState | undefined
  let atlas: Atlas | undefined
  const seed = options.seed ?? 1
  renderer.setCollectDrawList(options.preserveDrawingBuffer === true)
  let spriteFile: { files: ArchiveFileMsg[]; identity: string; name: string } | undefined
  let dataFile: { files: ArchiveFileMsg[]; identity: string; name: string } | undefined
  /** Optional HotA archive: it goes in front of every archive set (spec 005 FR-004). */
  let hotaFile: ArchiveFileMsg | undefined
  const archiveFiles = (primary: ArchiveFileMsg): ArchiveFileMsg[] => (hotaFile === undefined ? [primary] : [hotaFile, primary])
  let mapIdentity: string | undefined
  let objectsKey: string | undefined
  let objectsBuild: Promise<void> | undefined
  let dataMissingReported = false
  let camera: Camera = { level: 0, offsetX: 0, offsetY: 0, width: canvas.width, height: canvas.height, scale: 1 }
  let dpr = 1
  let userScale: UserScale = 1
  /** Load generation per slot: a result is applied only if no newer load of that slot started. */
  const generations = { archive: 0, data: 0, map: 0 }
  let visible = true
  let paused = false
  let contextLost = false
  let nextId = 1
  const pending = new Map<number, (r: WorkerResponse) => void>()

  let worker: Worker | undefined
  if (options.useWorker !== false) {
    worker = options.workerFactory !== undefined ? options.workerFactory() : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
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
      if (world === undefined || contextLost) return null
      world = applyEvent(world, { kind: 'setTime', timeMs })
      renderer.render(camera, { timeMs: world.animationTimeMs })
      return renderer.nextChangeMs(world.animationTimeMs)
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

  const run = async (req: RequestWithoutId): Promise<WorkerResponse> => {
    if (worker === undefined) {
      try {
        if (req.kind === 'openArchive') {
          const r = await decodeArchive(req.files, cache)
          return { id: 0, kind: 'archiveReady', ...r }
        }
        if (req.kind === 'openDataArchive') {
          const r = await checkDataArchive(req.files)
          return { id: 0, kind: 'dataArchiveReady', ...r }
        }
        if (req.kind === 'buildObjects') {
          if (world === undefined) throw new Error('no map loaded')
          const r = await decodeObjects(req.sprites, req.data, { world, identity: req.mapIdentity }, req.seed, cache)
          return { id: 0, kind: 'objectsReady', ...r }
        }
        const r = await decodeMap(req.file, req.name, cache)
        return { id: 0, kind: 'mapReady', ...r }
      } catch (err) {
        const e = err as { toJSON?: () => SerializedFormatError }
        const where = 'name' in req ? req.name : 'files' in req ? ((req.files[req.files.length - 1] as ArchiveFileMsg).name) : ((req.data.files[req.data.files.length - 1] as ArchiveFileMsg).name)
        return { id: 0, kind: 'failed', error: typeof e.toJSON === 'function' ? e.toJSON() : { level: 'error', code: 'INTERNAL', message: String(err), file: where } }
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
  const superseded = (n: string): LoadResult => ({ ok: false, error: { level: 'warn', code: SUPERSEDED, message: `a newer file replaced ${n} while it was loading`, file: n } })

  /** Builds the object layer once sprite archive, data archive and map are loaded. */
  const refreshObjects = async (): Promise<void> => {
    if (options.objects === false || world === undefined || spriteFile === undefined || mapIdentity === undefined) return
    if (dataFile === undefined) {
      if (!dataMissingReported) {
        dataMissingReported = true
        diagnose({ level: 'warn', code: 'DATA_ARCHIVE_MISSING', message: 'objects are not drawn: supply the data archive (h3bitmap.lod)' })
        emit()
      }
      return
    }
    const key = `${spriteFile.identity}:${dataFile.identity}:${mapIdentity}:${seed}`
    if (key === objectsKey) return
    objectsKey = key
    renderer.setObjects(undefined)
    const r = await run({ kind: 'buildObjects', sprites: spriteFile, data: dataFile, mapIdentity, seed, useCache: options.cache !== false })
    if (key !== objectsKey || world === undefined) return
    if (r.kind === 'failed') {
      failure(r.error, dataFile.name)
      return
    }
    if (r.kind !== 'objectsReady') return
    r.warnings.forEach(diagnose)
    renderer.setObjects({ index: new ObjectIndex(r.objects, world.size, world.levels), atlas: r.atlas, flagColors: r.flagColors })
    emit()
    scheduler.invalidate()
  }
  const scheduleObjects = (): Promise<void> => {
    objectsBuild = (objectsBuild ?? Promise.resolve()).then(refreshObjects).catch((err: unknown) => log.error('object layer failed', String(err)))
    return objectsBuild
  }

  const engine: Engine = {
    async loadArchive(file, name) {
      const n = fileName(file, name)
      const gen = ++generations.archive
      status.state = 'loading'
      emit()
      const r = await run({ kind: 'openArchive', files: archiveFiles({ file, name: n }), useCache: options.cache !== false })
      if (gen !== generations.archive) return superseded(n)
      if (r.kind === 'failed') return failure(r.error, n)
      if (r.kind !== 'archiveReady') return failure({ level: 'error', code: 'PROTOCOL', message: 'unexpected worker reply' }, n)
      atlas = r.atlas
      renderer.setAtlas(r.atlas)
      status.archive = n
      spriteFile = { files: archiveFiles({ file, name: n }), name: n, identity: r.identity }
      r.warnings.forEach(diagnose)
      refreshReady()
      await scheduleObjects()
      return { ok: true, identity: r.identity, fromCache: r.fromCache, warnings: r.warnings }
    },
    async loadMap(file, name) {
      const n = fileName(file, name)
      const gen = ++generations.map
      status.state = 'loading'
      emit()
      const r = await run({ kind: 'openMap', file, name: n, useCache: options.cache !== false })
      if (gen !== generations.map) return superseded(n)
      if (r.kind === 'failed') return failure(r.error, n)
      if (r.kind !== 'mapReady') return failure({ level: 'error', code: 'PROTOCOL', message: 'unexpected worker reply' }, n)
      world = r.world
      renderer.setTerrain(r.world)
      status.map = n
      camera = centeredCamera(0, (world.size * TILE_SIZE) / 2, (world.size * TILE_SIZE) / 2, camera.width, camera.height, dpr * userScale)
      mapIdentity = r.identity
      renderer.setObjects(undefined)
      objectsKey = undefined
      r.warnings.forEach(diagnose)
      clampAndInvalidate()
      refreshReady()
      await scheduleObjects()
      return { ok: true, identity: r.identity, fromCache: r.fromCache, warnings: r.warnings }
    },
    async loadDataArchive(file, name) {
      const n = fileName(file, name)
      const gen = ++generations.data
      const r = await run({ kind: 'openDataArchive', files: archiveFiles({ file, name: n }), useCache: options.cache !== false })
      if (gen !== generations.data) return superseded(n)
      if (r.kind === 'failed') return failure(r.error, n)
      if (r.kind !== 'dataArchiveReady') return failure({ level: 'error', code: 'PROTOCOL', message: 'unexpected worker reply' }, n)
      dataFile = { files: archiveFiles({ file, name: n }), name: n, identity: r.identity }
      status.dataArchive = n
      emit()
      await scheduleObjects()
      return { ok: true, identity: r.identity, fromCache: false, warnings: r.warnings }
    },
    setObjectsVisible(v) {
      renderer.setObjectsVisible(v)
      scheduler.invalidate()
    },
    drawList: () => renderer.drawList(),
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
    setMapping(level, tile, pixel, scale = 1) {
      camera = { ...camera, level, scale, offsetX: tile.x * TILE_SIZE - pixel.x / scale, offsetY: tile.y * TILE_SIZE - pixel.y / scale }
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
      // Keep the world pixel at the view centre in place across resizes and scale changes.
      const cx = camera.offsetX + camera.width / camera.scale / 2
      const cy = camera.offsetY + camera.height / camera.scale / 2
      camera = centeredCamera(camera.level, cx, cy, width, height, deviceRatio * userScale)
      clampAndInvalidate()
    },
    setUserScale(scale) {
      if (scale === userScale) return
      userScale = scale
      const cx = camera.offsetX + camera.width / camera.scale / 2
      const cy = camera.offsetY + camera.height / camera.scale / 2
      camera = centeredCamera(camera.level, cx, cy, camera.width, camera.height, dpr * userScale)
      clampAndInvalidate()
    },
    placeView(level, placement) {
      if (world === undefined) return undefined
      const r = placeView({ mapSize: world.size, levels: world.levels, level, placement, overscan: borderTiles * TILE_SIZE, width: camera.width, height: camera.height, scale: dpr * userScale })
      camera = r.camera
      clampAndInvalidate()
      return { level: camera.level, fx: r.fx, fy: r.fy }
    },
    setFrameLimit(fps) {
      scheduler.setMinFrameInterval(Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0)
    },
    forgetCache: () => cache.clear(),
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
      nextChangeMs: renderer.nextChangeMs(world?.animationTimeMs ?? 0),
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
