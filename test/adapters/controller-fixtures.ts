// Shared fakes for the wallpaper controller tests (spec 004 T023, spec 007): an engine that records
// calls, timers that run only when flushed, a classifier by name, and the setup of a controller.
import { createController } from '../../src/adapters/shared/controller.ts'
import type { ControllerDeps, ControllerEngine, RememberedFile, Timers } from '../../src/adapters/shared/controller.ts'
import { UserFileError } from '../../src/adapters/shared/file-url.ts'
import type { OverlayState } from '../../src/adapters/shared/overlay.ts'
import type { EngineStats, EngineStatus, LoadResult, PrepareResult, PreparedMap } from '../../src/runtime/engine.ts'
import type { FileKind } from '../../src/runtime/file-kind.ts'

export class FakeEngine implements ControllerEngine {
  calls: string[] = []
  paused = false
  visible = true
  scale = 1
  objects = true
  frameLimit = 0
  placements: { level: number | { random: number }; placement: unknown }[] = []
  forgot = 0
  loadDelay = 0
  /** Names that fail to load. */
  failing = new Set<string>()
  private statusListener: ((s: EngineStatus) => void) | undefined
  private gen = { archive: 0, data: 0, hota: 0, map: 0, prepare: 0 }

  private async load(slot: 'archive' | 'data' | 'hota' | 'map', name: string): Promise<LoadResult> {
    const g = ++this.gen[slot]
    this.calls.push(`${slot}:${name}`)
    await new Promise((r) => setTimeout(r, this.loadDelay))
    if (g !== this.gen[slot]) return { ok: false, error: { level: 'warn', code: 'SUPERSEDED', message: 'superseded' } }
    if (this.failing.has(name)) return { ok: false, error: { level: 'error', code: 'TRUNCATED', message: 'unexpected end of data' } }
    return { ok: true, identity: `id-${name}`, fromCache: false, warnings: [] }
  }
  loadArchive = (_b: Blob, n?: string) => this.load('archive', n ?? '')
  loadDataArchive = (_b: Blob, n?: string) => this.load('data', n ?? '')
  loadHotaArchive = (_b: Blob, n?: string) => this.load('hota', n ?? '')
  loadMap = (_b: Blob, n?: string) => this.load('map', n ?? '')
  /** Spec 007: prepared handles not yet shown or discarded, and the map shown last. */
  prepared = new Set<PreparedMap>()
  shownMap: string | null = null
  prepareMap = async (_b: Blob, n?: string): Promise<PrepareResult> => {
    const name = n ?? ''
    const g = ++this.gen.prepare
    this.calls.push(`prepare:${name}`)
    await new Promise((r) => setTimeout(r, this.loadDelay))
    if (g !== this.gen.prepare) return { ok: false, error: { level: 'warn', code: 'SUPERSEDED', message: 'superseded' } }
    if (this.failing.has(name)) return { ok: false, error: { level: 'error', code: 'TRUNCATED', message: 'unexpected end of data' } }
    const prepared: PreparedMap = { name, identity: `id-${name}`, size: 36, levels: 1 }
    this.prepared.add(prepared)
    return { ok: true, prepared, fromCache: false, warnings: [] }
  }
  showPreparedMap = (p: PreparedMap, level: number | { random: number }, placement: { mode: string; fx?: number; fy?: number; seed?: number }) => {
    if (!this.prepared.delete(p)) return undefined
    this.calls.push(`show:${p.name}`)
    this.shownMap = p.name
    return this.placeView(level, placement)
  }
  discardPreparedMap = (p: PreparedMap) => {
    if (this.prepared.delete(p)) this.calls.push(`discard:${p.name}`)
  }
  setObjectsVisible = (v: boolean) => void (this.objects = v)
  setUserScale = (s: 1 | 2 | 3) => void (this.scale = s)
  placeView = (level: number | { random: number }, placement: { mode: string; fx?: number; fy?: number; seed?: number }) => {
    this.placements.push({ level, placement })
    const fx = placement.mode === 'coords' ? (placement.fx as number) : placement.mode === 'centre' ? 0.5 : ((placement.seed as number) % 100) / 100
    return { level: typeof level === 'number' ? level : level.random % 2, fx, fy: fx }
  }
  resize = () => {}
  setVisible = (v: boolean) => void (this.visible = v)
  setPaused = (p: boolean) => void (this.paused = p)
  setFrameLimit = (fps: number) => void (this.frameLimit = fps)
  forgetCache = async () => void this.forgot++
  onStatus = (l: (s: EngineStatus) => void) => ((this.statusListener = l), () => true)
  emitDiagnostic(code: string) {
    this.statusListener?.({ state: 'ready', archive: null, dataArchive: null, hotaArchive: null, map: null, diagnostics: [{ level: 'warn', code, message: code }] })
  }
  stats = () => ({ paused: this.paused, visible: this.visible, preparedMaps: this.prepared.size }) as unknown as EngineStats
}

/** Timers that run only when flushed. */
export class FakeTimers implements Timers {
  private next = 1
  pending = new Map<number, () => void>()
  delays = new Map<number, number>()
  set(cb: () => void, ms: number): number {
    const h = this.next++
    this.pending.set(h, cb)
    this.delays.set(h, ms)
    return h
  }
  clear(h: number): void {
    this.pending.delete(h)
    this.delays.delete(h)
  }
}

export const KINDS: Record<string, FileKind> = {
  'H3sprite.lod': { kind: 'spriteArchive' },
  'H3bitmap.lod': { kind: 'dataArchive' },
  'HotA.lod': { kind: 'hotaArchive' },
  'a.h3m': { kind: 'map', version: 'SoD' },
  'b.h3m': { kind: 'map', version: 'AB' },
  'hota.h3m': { kind: 'unsupportedMap', versionCode: 0x20, format: 'HotA' },
  'junk.bin': { kind: 'unknown' },
}

export function setup(extra: Partial<ControllerDeps> = {}) {
  const engine = new FakeEngine()
  const timers = new FakeTimers()
  const overlay: OverlayState[] = []
  const remembered: RememberedFile[] = []
  let now = 0
  const deps: ControllerDeps = {
    host: 'wallpaper-engine',
    createEngine: () => engine,
    fileUrl: (v) => (v === '' ? null : `file:///${v}`),
    readFile: async (url) => {
      const name = url.split('/').pop() as string
      if (name === 'gone.lod') throw new UserFileError('missing', url, 'missing')
      return new Blob([name])
    },
    classify: async (blob, name) => KINDS[name] ?? KINDS[await blob.text()] ?? { kind: 'unknown' },
    overlay: { render: (s) => void overlay.push(s), texts: () => [], dispose: () => {} },
    timers,
    now: () => now,
    seed: 7,
    environmentLanguage: () => 'de-DE',
    remembered: {
      load: async () => [...remembered],
      save: async (f) => void remembered.push(f),
      clear: async () => void remembered.splice(0),
    },
    ...extra,
  }
  const c = createController(deps)
  return { c, engine, timers, overlay, remembered, setNow: (t: number) => (now = t) }
}

