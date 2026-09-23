// Wallpaper controller with a fake engine, reader and classifier (spec 004 T023).
import { describe, expect, it } from 'vitest'
import { createController } from '../../src/adapters/shared/controller.ts'
import type { ControllerDeps, ControllerEngine, RememberedFile, Timers } from '../../src/adapters/shared/controller.ts'
import { UserFileError } from '../../src/adapters/shared/file-url.ts'
import type { OverlayState } from '../../src/adapters/shared/overlay.ts'
import type { EngineStats, EngineStatus, LoadResult } from '../../src/runtime/engine.ts'
import type { FileKind } from '../../src/runtime/file-kind.ts'

class FakeEngine implements ControllerEngine {
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
  private gen = { archive: 0, data: 0, hota: 0, map: 0 }

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
  stats = () => ({ paused: this.paused, visible: this.visible }) as unknown as EngineStats
}

/** Timers that run only when flushed. */
class FakeTimers implements Timers {
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

const KINDS: Record<string, FileKind> = {
  'H3sprite.lod': { kind: 'spriteArchive' },
  'H3bitmap.lod': { kind: 'dataArchive' },
  'a.h3m': { kind: 'map', version: 'SoD' },
  'b.h3m': { kind: 'map', version: 'AB' },
  'hota.h3m': { kind: 'unsupportedMap', versionCode: 0x20, format: 'HotA' },
  'junk.bin': { kind: 'unknown' },
}

function setup(extra: Partial<ControllerDeps> = {}) {
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

const ALL_FILES = { spritearchive: 'H3sprite.lod', dataarchive: 'H3bitmap.lod', mapfile: 'a.h3m' }

describe('wallpaper controller', () => {
  it('waits with a placeholder and a paused engine while files are missing', async () => {
    const { c, engine, overlay } = setup()
    await c.start()
    expect(c.state().phase).toBe('waiting')
    expect(engine.paused).toBe(true)
    expect(overlay.at(-1)?.missing).toEqual(['spriteArchive', 'dataArchive', 'map'])
  })

  it('loads host files, shows the map and places the view once', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings({ ...ALL_FILES, scale: 2 })
    await c.idle()
    const s = c.state()
    expect(s.phase).toBe('showing')
    expect(s.slots.map).toMatchObject({ status: 'loaded', name: 'a.h3m', identity: 'id-a.h3m' })
    expect(engine.paused).toBe(false)
    expect(engine.scale).toBe(2)
    expect(engine.placements).toHaveLength(1)
    expect(engine.placements[0]?.placement).toMatchObject({ mode: 'random' })
  })

  it('coalesces a burst of slider events into one application', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings({ ...ALL_FILES, viewmode: 'coords' })
    await c.idle()
    const before = engine.placements.length
    for (let i = 0; i < 20; i++) c.applySettings({ viewx: i })
    await c.flushSettings()
    expect(engine.placements.length).toBe(before + 1)
    expect(engine.placements.at(-1)?.placement).toEqual({ mode: 'coords', fx: 0.19, fy: 0.5 })
  })

  it('re-rolls the random view only on map change or switching to random', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings(ALL_FILES)
    await c.idle()
    const random = engine.placements.filter((p) => (p.placement as { mode: string }).mode === 'random').length
    c.applySettings({ scale: 3, level: 'underground', viewx: 10 })
    await c.idle()
    expect(engine.placements.filter((p) => (p.placement as { mode: string }).mode === 'random').length).toBe(random)
    expect(engine.placements.at(-1)).toMatchObject({ level: 1, placement: { mode: 'coords' } })
    c.applySettings({ mapfile: 'b.h3m' })
    await c.idle()
    expect(engine.placements.filter((p) => (p.placement as { mode: string }).mode === 'random').length).toBe(random + 1)
    expect(engine.calls.filter((x) => x.startsWith('archive:'))).toHaveLength(1)
  })

  it('reports wrong kinds, unsupported maps and missing files, and uses a wrong-slot file where it fits', async () => {
    const { c } = setup()
    await c.start()
    c.applySettings({ spritearchive: 'a.h3m', mapfile: 'hota.h3m', dataarchive: 'gone.lod' })
    await c.idle()
    const s = c.state()
    const codes = s.messages.map((m) => m.code).sort()
    expect(codes).toEqual(['FILE_MISSING', 'UNSUPPORTED_MAP', 'WRONG_KIND'])
    expect(s.messages.find((m) => m.code === 'WRONG_KIND')).toMatchObject({ expected: 'spriteArchive', found: 'map' })
    expect(s.phase).toBe('problem')
  })

  it('keeps the previous map when a newer map fails', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings(ALL_FILES)
    await c.idle()
    engine.failing.add('b.h3m')
    c.applySettings({ mapfile: 'b.h3m' })
    await c.idle()
    // The engine keeps the old world; the slot reports the failure with a message.
    expect(c.state().messages.map((m) => m.code)).toContain('CORRUPT_FILE')
  })

  it('drops a superseded file read', async () => {
    const { c, engine } = setup()
    engine.loadDelay = 5
    await c.start()
    c.applySettings(ALL_FILES)
    await c.flushSettings()
    c.applySettings({ mapfile: 'b.h3m' })
    await c.idle()
    expect(c.state().slots.map).toMatchObject({ status: 'loaded', name: 'b.h3m' })
  })

  it('pauses on host pause or hidden page and resumes', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings(ALL_FILES)
    await c.idle()
    c.setHostPaused(true)
    expect(engine.paused).toBe(true)
    c.setHostPaused(false)
    c.setHidden(true)
    expect(engine.paused).toBe(false)
    expect(engine.visible).toBe(false)
    c.setHidden(false)
    expect(engine.visible).toBe(true)
    c.setFrameLimit(30)
    expect(engine.frameLimit).toBe(30)
  })

  it('shows terrain with a message when the data archive is missing', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings({ spritearchive: 'H3sprite.lod', mapfile: 'a.h3m' })
    await c.idle()
    engine.emitDiagnostic('DATA_ARCHIVE_MISSING')
    expect(c.state().phase).toBe('showing')
    expect(c.state().messages.map((m) => m.code)).toEqual(['DATA_ARCHIVE_MISSING'])
    c.applySettings({ dataarchive: 'H3bitmap.lod' })
    await c.idle()
    expect(c.state().messages).toEqual([])
  })

  it('classifies supplied files, remembers them and forgets them', async () => {
    const first = setup()
    await first.c.start()
    await first.c.supplyFiles([new File(['x'], 'a.h3m'), new File(['x'], 'H3sprite.lod'), new File(['x'], 'junk.bin')])
    expect(first.c.state().phase).toBe('showing')
    expect(first.remembered.map((f) => f.slot).sort()).toEqual(['map', 'spriteArchive'])
    expect(first.c.state().messages.map((m) => m.code)).toEqual(['UNKNOWN_FILE'])

    const second = setup()
    second.remembered.push(...first.remembered)
    await second.c.start()
    expect(second.c.state().phase).toBe('showing')
    await second.c.forgetFiles()
    expect(second.c.state().phase).toBe('waiting')
    expect(second.remembered).toEqual([])
    expect(second.engine.forgot).toBe(1)
  })

  it('follows the host language, then the environment', async () => {
    const { c, overlay } = setup()
    await c.start()
    expect(c.state().language).toBe('en')
    c.setLanguage('ru-RU')
    expect(c.state().language).toBe('ru')
    expect(overlay.length).toBeGreaterThan(0)
  })

  it('keeps showing without a message when the cache is unavailable but the start is fast', async () => {
    const { c } = setup({ cacheAvailable: async () => false })
    await c.start()
    c.applySettings(ALL_FILES)
    await c.idle()
    expect(c.state().messages).toEqual([])
  })

  it('explains a slow start without a cache', async () => {
    let calls = 0
    // Each clock read moves 3 s on: the start takes longer than the warm-start budget.
    const t = setup({ cacheAvailable: async () => false, now: () => 3000 * calls++ })
    await t.c.start()
    t.c.applySettings(ALL_FILES)
    await t.c.idle()
    expect(t.c.state().messages.map((m) => m.code)).toContain('CACHE_UNAVAILABLE')
  })

  it('reports an unavailable WebGL context', async () => {
    const { c } = setup({
      createEngine: () => {
        throw new Error('WebGL 1.0 is not available')
      },
    })
    await c.start()
    expect(c.state().phase).toBe('problem')
    expect(c.state().messages.map((m) => m.code)).toEqual(['WEBGL_UNAVAILABLE'])
  })
})

describe('wallpaper controller: data archive arriving late', () => {
  it('does not report a missing data archive while it is still loading', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings({ spritearchive: 'H3sprite.lod', mapfile: 'a.h3m' })
    await c.idle()
    // The data archive setting is being read when the engine reports it missing.
    engine.loadDelay = 20
    c.applySettings({ dataarchive: 'H3bitmap.lod' })
    const pending = c.flushSettings()
    engine.emitDiagnostic('DATA_ARCHIVE_MISSING')
    await pending
    await c.idle()
    expect(c.state().messages).toEqual([])
  })
})

describe('wallpaper controller: random place timer (spec 004 FR-003a)', () => {
  const runTimers = (timers: FakeTimers) => {
    const cbs = [...timers.pending.values()]
    timers.pending.clear()
    timers.delays.clear()
    cbs.forEach((cb) => cb())
  }

  it('moves the random view every N minutes only while active', async () => {
    const { c, engine, timers } = setup()
    await c.start()
    c.applySettings({ ...ALL_FILES, viewinterval: 5 })
    await c.idle()
    const randoms = () => engine.placements.filter((p) => (p.placement as { mode: string }).mode === 'random').length
    const before = randoms()
    expect(timers.pending.size).toBe(1)
    runTimers(timers)
    expect(randoms()).toBe(before + 1)
    expect(timers.pending.size).toBe(1)
    c.setHostPaused(true)
    expect(timers.pending.size).toBe(0)
    c.setHostPaused(false)
    expect(timers.pending.size).toBe(1)
    c.applySettings({ viewmode: 'centre' })
    await c.idle()
    expect(timers.pending.size).toBe(0)
  })

  it('places the same fractions again when the scale or the viewport changes', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings(ALL_FILES)
    await c.idle()
    const view = c.state().view
    c.applySettings({ scale: 3 })
    await c.idle()
    expect(engine.placements.at(-1)?.placement).toEqual({ mode: 'coords', fx: view?.fx, fy: view?.fy })
    const count = engine.placements.length
    c.resize(800, 600, 2)
    expect(engine.placements).toHaveLength(count + 1)
    expect(c.state().view).toEqual(view)
  })

  it('draws a new random place on demand, only in random mode, and restarts the interval', async () => {
    const { c, engine, timers, setNow } = setup()
    await c.start()
    c.applySettings({ ...ALL_FILES, viewinterval: 5 })
    await c.idle()
    const randoms = () => engine.placements.filter((p) => (p.placement as { mode: string }).mode === 'random').length
    const before = randoms()
    const view = c.state().view
    setNow(4 * 60_000)
    c.newRandomPlace()
    expect(randoms()).toBe(before + 1)
    expect(c.state().view).not.toEqual(view)
    expect([...timers.delays.values()]).toEqual([5 * 60_000])
    c.applySettings({ viewmode: 'centre' })
    await c.idle()
    c.newRandomPlace()
    expect(randoms()).toBe(before + 1)
  })

  it('draws a random level only with the "random" level setting, and can return to it', async () => {
    const { c, engine } = setup()
    await c.start()
    c.applySettings(ALL_FILES)
    await c.idle()
    expect(engine.placements.at(-1)?.level).toMatchObject({ random: expect.any(Number) })
    const drawn = c.state().view?.level
    c.applySettings({ scale: 2, viewx: 20 })
    await c.idle()
    expect(c.state().view?.level).toBe(drawn)
    c.applySettings({ level: 'underground' })
    await c.idle()
    expect(engine.placements.at(-1)?.level).toBe(1)
    c.applySettings({ viewmode: 'centre' })
    await c.idle()
    c.applySettings({ viewmode: 'random' })
    await c.idle()
    expect(engine.placements.at(-1)?.level).toBe(1)
    c.applySettings({ level: 'random' })
    await c.idle()
    expect(engine.placements.at(-1)?.level).toMatchObject({ random: expect.any(Number) })
  })

  it('counts the interval from the last draw, so a place due while paused changes on resume', async () => {
    const { c, engine, timers, setNow } = setup()
    await c.start()
    c.applySettings({ ...ALL_FILES, viewinterval: 5 })
    await c.idle()
    const randoms = () => engine.placements.filter((p) => (p.placement as { mode: string }).mode === 'random').length
    const before = randoms()
    setNow(2 * 60_000)
    c.setHostPaused(true)
    expect(timers.pending.size).toBe(0)
    setNow(10 * 60_000)
    c.setHostPaused(false)
    expect([...timers.delays.values()]).toEqual([0])
    runTimers(timers)
    expect(randoms()).toBe(before + 1)
    expect([...timers.delays.values()]).toEqual([5 * 60_000])
  })
})
