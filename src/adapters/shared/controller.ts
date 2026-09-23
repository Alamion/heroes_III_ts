// Wallpaper controller (spec 004 contracts/host-bridge.md): the host-neutral part of every adapter.
// Hosts translate their signals into calls here; the controller validates and coalesces settings,
// reads and classifies user files, drives the engine and shows the overlay. It holds no rendering,
// parsing or game logic (FR-008). All platform dependencies are injected, so it runs in Node tests
// with a fake engine; browser defaults are wired in browser-controller.ts.

import type { LevelChoice, ViewPlacement } from '../../core/render/view-placement.ts'
import { log } from '../../core/util/log.ts'
import type { Engine, EngineStats, EngineStatus, LoadResult, UserScale } from '../../runtime/engine.ts'
import type { FileKind } from '../../runtime/file-kind.ts'
import { displayName, UserFileError } from './file-url.ts'
import type { FileSlot, MessageCode, UserMessage } from './messages.ts'
import type { Overlay } from './overlay.ts'
import { defaultSettings, FILE_SETTING_KEYS, validateSettings } from './settings.ts'
import type { SettingKey, WallpaperSettings } from './settings.ts'
import { pickLanguage } from './strings.ts'
import type { Language } from './strings.ts'

export const COALESCE_MS = 150
/** Warm-start budget (constitution): a slower start without a cache explains itself. */
export const WARM_START_BUDGET_MS = 2000

export type HostName = 'web' | 'wallpaper-engine' | 'lively' | 'kde'
export type RawSettings = Partial<Record<SettingKey, unknown>> & Record<string, unknown>

/** The engine surface the controller uses (a fake implements it in tests). */
export type ControllerEngine = Pick<
  Engine,
  | 'loadArchive'
  | 'loadDataArchive'
  | 'loadHotaArchive'
  | 'loadMap'
  | 'setObjectsVisible'
  | 'setUserScale'
  | 'placeView'
  | 'resize'
  | 'setVisible'
  | 'setPaused'
  | 'setFrameLimit'
  | 'forgetCache'
  | 'onStatus'
  | 'stats'
>

export interface RememberedFile {
  slot: FileSlot
  name: string
  blob: Blob
}

export interface RememberedFiles {
  load(): Promise<RememberedFile[]>
  save(file: RememberedFile): Promise<void>
  clear(): Promise<void>
}

export interface Timers {
  set(cb: () => void, ms: number): number
  clear(handle: number): void
}

export interface ControllerDeps {
  host: HostName
  createEngine: () => ControllerEngine
  /** Host setting value → URL; null when the setting is empty. */
  fileUrl: (value: string) => string | null
  readFile: (url: string) => Promise<Blob>
  classify: (blob: Blob, name: string) => Promise<FileKind>
  overlay: Overlay | undefined
  timers: Timers
  now: () => number
  /** Seed of the random starting view; every later draw derives its own seed from it. */
  seed: number
  /** Language of the environment (navigator.language) when the host gives none. */
  environmentLanguage: () => string | null
  remembered?: RememberedFiles
  /** Whether the decode cache works (for the slow-start explanation). */
  cacheAvailable?: () => Promise<boolean>
  /** Hides or shows the canvas while the placeholder is up. */
  setCanvasHidden?: (hidden: boolean) => void
}

export interface SlotState {
  status: 'missing' | 'reading' | 'loading' | 'loaded' | 'failed'
  name: string | null
  identity: string | null
}

export interface ControllerSnapshot {
  phase: 'waiting' | 'loading' | 'showing' | 'problem'
  slots: Record<FileSlot, SlotState>
  settings: WallpaperSettings
  messages: UserMessage[]
  language: Language
  hostPaused: boolean
  hidden: boolean
  view: { fx: number; fy: number; level: number } | null
  engine: EngineStats | null
}

export interface WallpaperController {
  start(): Promise<void>
  applySettings(raw: RawSettings): void
  /** Applies coalesced settings now (tests and page unload). */
  flushSettings(): Promise<void>
  supplyFiles(files: readonly (Blob & { name?: string })[]): Promise<void>
  setHostPaused(paused: boolean): void
  setHidden(hidden: boolean): void
  setFrameLimit(fps: number): void
  setLanguage(tag: string | null): void
  /** Draws a new random place (and random level) now; only in the random view mode. */
  newRandomPlace(): void
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  forgetFiles(): Promise<void>
  state(): ControllerSnapshot
  /** Resolves when no file read, load or settings flush is pending. */
  idle(): Promise<void>
  onChange(listener: (s: ControllerSnapshot) => void): () => void
  engine(): ControllerEngine | undefined
}

const SLOT_OF_SETTING: Record<(typeof FILE_SETTING_KEYS)[number], FileSlot> = {
  spritearchive: 'spriteArchive',
  dataarchive: 'dataArchive',
  hotaarchive: 'hotaArchive',
  mapfile: 'map',
}
const REQUIRED_SLOTS: readonly FileSlot[] = ['spriteArchive', 'map']
const ALL_SLOTS: readonly FileSlot[] = ['spriteArchive', 'dataArchive', 'hotaArchive', 'map']
/**
 * Slots the placeholder asks for while it waits. The HotA archive is left out on purpose: most
 * users play base-game maps and would only be puzzled by it. A HotA map that needs it says so
 * through its own message instead (spec 005 SC-007).
 */
const PROMPTED_SLOTS: readonly FileSlot[] = ['spriteArchive', 'dataArchive', 'map']

function kindSlot(kind: FileKind): FileSlot | undefined {
  if (kind.kind === 'hotaArchive') return 'hotaArchive'
  return kind.kind === 'spriteArchive' || kind.kind === 'dataArchive' || kind.kind === 'map' ? kind.kind : undefined
}

function errorDetail(r: Extract<LoadResult, { ok: false }>): string {
  return r.error.message
}

export function createController(deps: ControllerDeps): WallpaperController {
  let engine: ControllerEngine | undefined
  let settings = defaultSettings()
  let pending: Partial<WallpaperSettings> = {}
  let flushTimer: number | undefined
  let flushing: Promise<void> = Promise.resolve()
  const slots: Record<FileSlot, SlotState> = {
    spriteArchive: { status: 'missing', name: null, identity: null },
    dataArchive: { status: 'missing', name: null, identity: null },
    hotaArchive: { status: 'missing', name: null, identity: null },
    map: { status: 'missing', name: null, identity: null },
  }
  /** Generation per slot: a read or load that finishes after a newer one started is dropped. */
  const generation: Record<FileSlot, number> = { spriteArchive: 0, dataArchive: 0, hotaArchive: 0, map: 0 }
  let hostLanguage: string | null = null
  let hostPaused = false
  let hidden = false
  let frameLimit = 0
  let view: { fx: number; fy: number; level: number } | null = null
  /** Timer that moves the random view to a new place (settings.viewinterval minutes). */
  let rerollTimer: { handle: number; minutes: number } | undefined
  /** Number of random draws so far (seeds differ per draw) and when the last random place was drawn. */
  let draws = 0
  let lastDrawAt: number | null = null
  let startedAt: number | null = null
  let slowStartChecked = false
  let nextMessageId = 1
  let messages: { id: number; message: UserMessage; sticky: boolean; slot: FileSlot | null }[] = []
  const seenDiagnostics = new WeakSet<object>()
  const work = new Set<Promise<unknown>>()
  const listeners = new Set<(s: ControllerSnapshot) => void>()

  const language = (): Language => pickLanguage(hostLanguage ?? deps.environmentLanguage())
  const showing = (): boolean => REQUIRED_SLOTS.every((s) => slots[s].status === 'loaded')
  const phase = (): ControllerSnapshot['phase'] => {
    if (showing()) return 'showing'
    if (ALL_SLOTS.some((s) => slots[s].status === 'reading' || slots[s].status === 'loading')) return 'loading'
    if (REQUIRED_SLOTS.some((s) => slots[s].status === 'failed') || messages.some((m) => m.message.code === 'WEBGL_UNAVAILABLE')) return 'problem'
    return 'waiting'
  }

  const track = <T>(p: Promise<T>): Promise<T> => {
    work.add(p)
    p.finally(() => work.delete(p)).catch(() => undefined)
    return p
  }

  const snapshot = (): ControllerSnapshot => ({
    phase: phase(),
    slots: { spriteArchive: { ...slots.spriteArchive }, dataArchive: { ...slots.dataArchive }, hotaArchive: { ...slots.hotaArchive }, map: { ...slots.map } },
    settings: { ...settings },
    messages: messages.map((m) => m.message),
    language: language(),
    hostPaused,
    hidden,
    view: view === null ? null : { ...view },
    engine: engine === undefined ? null : engine.stats(),
  })

  const syncEngineActivity = (): void => {
    if (engine === undefined) return
    // Nothing to draw before both required files are in: no frames, no timers (invariant 1).
    engine.setPaused(hostPaused || !showing())
    engine.setVisible(!hidden)
    syncRerollTimer()
  }

  /**
   * The re-roll timer runs only while the random view is shown and active (constitution IV). It counts
   * from the last draw, so time spent paused or covered still counts: a place that became due meanwhile
   * is replaced as soon as the wallpaper is active again.
   */
  const syncRerollTimer = (): void => {
    const minutes = settings.viewinterval
    const wanted = engine !== undefined && showing() && !hostPaused && !hidden && settings.viewmode === 'random' && minutes > 0
    if (rerollTimer !== undefined && (!wanted || rerollTimer.minutes !== minutes)) {
      deps.timers.clear(rerollTimer.handle)
      rerollTimer = undefined
    }
    if (!wanted || rerollTimer !== undefined) return
    const now = deps.now()
    lastDrawAt ??= now
    rerollTimer = {
      minutes,
      handle: deps.timers.set(
        () => {
          rerollTimer = undefined
          applyView(true)
          refresh()
        },
        Math.max(0, lastDrawAt + minutes * 60_000 - now),
      ),
    }
  }

  const refresh = (): void => {
    const isShowing = showing()
    deps.setCanvasHidden?.(!isShowing)
    syncEngineActivity()
    const loadingSlot = ALL_SLOTS.find((s) => slots[s].status === 'reading' || slots[s].status === 'loading')
    deps.overlay?.render(
      {
        missing: isShowing ? null : PROMPTED_SLOTS.filter((s) => slots[s].status === 'missing' || slots[s].status === 'failed'),
        loading: isShowing || loadingSlot === undefined ? null : (slots[loadingSlot].name ?? ''),
        messages: messages.map(({ id, message, sticky }) => ({ id, message, sticky })),
      },
      language(),
    )
    if (listeners.size > 0) {
      const s = snapshot()
      listeners.forEach((l) => l(s))
    }
  }

  const addMessage = (message: UserMessage, slot: FileSlot | null = null): void => {
    const logLine = `${message.code}${message.file !== undefined ? ` ${message.file}` : ''}${message.detail !== undefined ? `: ${message.detail}` : ''}`
    if (message.level === 'error') log.error(logLine)
    else if (message.level === 'warn') log.warn(logLine)
    else log.info(logLine)
    // One message per code and slot: a newer one replaces the older.
    messages = messages.filter((m) => !(m.message.code === message.code && m.slot === slot))
    messages.push({ id: nextMessageId++, message, sticky: !showing() && message.level === 'error', slot })
  }
  const clearMessages = (pred: (m: (typeof messages)[number]) => boolean): void => {
    messages = messages.filter((m) => !pred(m))
  }

  const nextSeed = (): number => (deps.seed + draws++ * 0x9e3779b1) >>> 0

  /**
   * Positions the view: on start, map change, switching to a random place and timer (`reroll`), or
   * keeping the current fractions. A random level is drawn on the same occasions and when the level
   * setting changes to "random" (`levelChanged`); otherwise the drawn level stays.
   */
  const applyView = (reroll: boolean, levelChanged = false): void => {
    if (engine === undefined || slots.map.status !== 'loaded') return
    const drawPlace = settings.viewmode === 'random' && (reroll || view === null)
    let placement: ViewPlacement
    if (settings.viewmode === 'coords') placement = { mode: 'coords', fx: settings.viewx / 100, fy: settings.viewy / 100 }
    else if (settings.viewmode === 'centre') placement = { mode: 'centre' }
    else if (drawPlace) placement = { mode: 'random', seed: nextSeed() }
    else placement = { mode: 'coords', fx: (view as { fx: number }).fx, fy: (view as { fy: number }).fy }
    let level: LevelChoice
    if (settings.level === 'surface') level = 0
    else if (settings.level === 'underground') level = 1
    else level = reroll || levelChanged || view === null ? { random: nextSeed() } : view.level
    const r = engine.placeView(level, placement)
    if (r === undefined) return
    view = { fx: r.fx, fy: r.fy, level: r.level }
    if (drawPlace) {
      lastDrawAt = deps.now()
      // The interval restarts from this draw (refresh re-arms the timer).
      if (rerollTimer !== undefined) {
        deps.timers.clear(rerollTimer.handle)
        rerollTimer = undefined
      }
    }
  }

  const checkSlowStart = (): void => {
    if (slowStartChecked || startedAt === null || !showing()) return
    slowStartChecked = true
    const took = deps.now() - startedAt
    if (took <= WARM_START_BUDGET_MS || deps.cacheAvailable === undefined) return
    void track(
      deps.cacheAvailable().then((ok) => {
        if (ok) return
        addMessage({ code: 'CACHE_UNAVAILABLE', level: 'info' })
        refresh()
      }),
    )
  }

  const loadIntoSlot = async (slot: FileSlot, blob: Blob, name: string, gen: number): Promise<boolean> => {
    if (engine === undefined) return false
    slots[slot] = { status: 'loading', name, identity: null }
    refresh()
    const r =
      slot === 'spriteArchive'
        ? await engine.loadArchive(blob, name)
        : slot === 'dataArchive'
          ? await engine.loadDataArchive(blob, name)
          : slot === 'hotaArchive'
            ? await engine.loadHotaArchive(blob, name)
            : await engine.loadMap(blob, name)
    if (gen !== generation[slot]) return false
    if (!r.ok) {
      if (r.error.code === 'SUPERSEDED') return false
      slots[slot] = { status: 'failed', name, identity: null }
      addMessage({ code: 'CORRUPT_FILE', level: 'error', file: name, detail: errorDetail(r) }, slot)
      refresh()
      return false
    }
    slots[slot] = { status: 'loaded', name, identity: r.identity }
    clearMessages((m) => m.slot === slot || (slot === 'dataArchive' && m.message.code === 'DATA_ARCHIVE_MISSING'))
    if (slot === 'map') {
      applyView(true)
    }
    if (showing()) {
      engine.setUserScale(settings.scale as UserScale)
      engine.setObjectsVisible(settings.objects)
    }
    checkSlowStart()
    refresh()
    return true
  }

  /** Reads a file named by a host setting and loads it into its slot. */
  const loadFromSetting = async (slot: FileSlot, value: string | null): Promise<void> => {
    const gen = ++generation[slot]
    const url = value === null ? null : deps.fileUrl(value)
    clearMessages((m) => m.slot === slot)
    if (url === null) {
      slots[slot] = { status: 'missing', name: null, identity: null }
      refresh()
      return
    }
    const name = displayName(value ?? url)
    slots[slot] = { status: 'reading', name, identity: null }
    startedAt ??= deps.now()
    refresh()
    let blob: Blob
    let kind: FileKind
    try {
      blob = await deps.readFile(url)
      if (gen !== generation[slot]) return
      kind = await deps.classify(blob, name)
    } catch (err) {
      if (gen !== generation[slot]) return
      const code: MessageCode = err instanceof UserFileError && err.reason === 'missing' ? 'FILE_MISSING' : 'FILE_UNREADABLE'
      slots[slot] = { status: 'failed', name, identity: null }
      addMessage({ code, level: 'error', file: name, detail: err instanceof Error ? err.message : String(err) }, slot)
      refresh()
      return
    }
    if (gen !== generation[slot]) return
    const found = kindSlot(kind)
    if (found !== slot) {
      slots[slot] = { status: 'failed', name, identity: null }
      if (kind.kind === 'unsupportedMap') addMessage({ code: 'UNSUPPORTED_MAP', level: 'error', file: name, format: kind.format ?? `0x${kind.versionCode.toString(16)}` }, slot)
      else if (found === undefined) addMessage({ code: 'UNKNOWN_FILE', level: 'error', file: name, ...(kind.kind === 'unknownArchive' ? { detail: kind.reason } : {}) }, slot)
      else addMessage({ code: 'WRONG_KIND', level: 'error', file: name, expected: slot, found }, slot)
      refresh()
      // A file of another kind still helps when its own slot is empty.
      if (found !== undefined && slots[found].status === 'missing') await loadIntoSlot(found, blob, name, ++generation[found])
      return
    }
    await loadIntoSlot(slot, blob, name, gen)
  }

  const applyPatch = async (patch: Partial<WallpaperSettings>): Promise<void> => {
    const prev = settings
    settings = { ...settings, ...patch }
    const loads: Promise<void>[] = []
    for (const key of FILE_SETTING_KEYS) {
      if (key in patch && patch[key] !== prev[key]) loads.push(loadFromSetting(SLOT_OF_SETTING[key], settings[key]))
    }
    if (engine !== undefined) {
      if (patch.scale !== undefined && patch.scale !== prev.scale) engine.setUserScale(settings.scale)
      if (patch.objects !== undefined && patch.objects !== prev.objects) engine.setObjectsVisible(settings.objects)
      const modeChanged = patch.viewmode !== undefined && patch.viewmode !== prev.viewmode
      const coordsChanged = settings.viewmode === 'coords' && ((patch.viewx !== undefined && patch.viewx !== prev.viewx) || (patch.viewy !== undefined && patch.viewy !== prev.viewy))
      const levelChanged = patch.level !== undefined && patch.level !== prev.level
      const scaleChanged = patch.scale !== undefined && patch.scale !== prev.scale
      // Switching to "random" draws a new place; slider, scale and level changes never re-roll. A scale
      // change places the same fractions again, so the reachable range of the new view size is used.
      if (modeChanged && settings.viewmode === 'random') {
        applyView(true)
      } else if (modeChanged || coordsChanged || levelChanged || scaleChanged) {
        applyView(false, levelChanged)
      }
    }
    refresh()
    await Promise.all(loads)
  }

  const flush = (): Promise<void> => {
    if (flushTimer !== undefined) {
      deps.timers.clear(flushTimer)
      flushTimer = undefined
    }
    const patch = pending
    pending = {}
    if (Object.keys(patch).length === 0) return flushing
    flushing = track(flushing.then(() => applyPatch(patch)))
    return flushing
  }

  const onEngineStatus = (s: EngineStatus): void => {
    for (const d of s.diagnostics) {
      if (seenDiagnostics.has(d)) continue
      seenDiagnostics.add(d)
      if (d.code === 'DATA_ARCHIVE_MISSING') {
        // Only when no data archive is on its way (it often arrives after the sprite archive and map).
        if (slots.dataArchive.status === 'missing') addMessage({ code: 'DATA_ARCHIVE_MISSING', level: 'warn' }, 'dataArchive')
      } else if (d.code === 'CONTEXT_LOST') {
        addMessage({ code: 'CONTEXT_LOST', level: 'warn' })
      } else {
        // Load failures are reported from load results; the rest (missing sprites, LOD warnings) is logged only.
        log.debug(`engine diagnostic ${d.code}: ${d.message}`)
        continue
      }
      refresh()
    }
  }

  const controller: WallpaperController = {
    async start() {
      try {
        engine = deps.createEngine()
      } catch (err) {
        addMessage({ code: 'WEBGL_UNAVAILABLE', level: 'error', detail: err instanceof Error ? err.message : String(err) })
        refresh()
        return
      }
      engine.onStatus(onEngineStatus)
      engine.setFrameLimit(frameLimit)
      engine.setUserScale(settings.scale)
      engine.setObjectsVisible(settings.objects)
      refresh()
      if (deps.remembered !== undefined) {
        const files = await track(deps.remembered.load().catch((err: unknown) => (log.warn('remembered files unavailable', String(err)), [] as RememberedFile[])))
        if (files.length > 0) startedAt ??= deps.now()
        await Promise.all(files.map((f) => loadIntoSlot(f.slot, f.blob, f.name, ++generation[f.slot])))
      }
      await flush()
    },
    applySettings(raw) {
      const { patch, ignored } = validateSettings(raw)
      if (ignored.length > 0) log.debug(`ignored settings: ${ignored.join(', ')}`)
      pending = { ...pending, ...patch }
      if (engine === undefined) return
      if (flushTimer !== undefined) deps.timers.clear(flushTimer)
      flushTimer = deps.timers.set(() => {
        flushTimer = undefined
        void flush()
      }, COALESCE_MS)
    },
    flushSettings: () => flush(),
    async supplyFiles(files) {
      startedAt ??= deps.now()
      await track(
        Promise.all(
          files.map(async (file) => {
            const name = file.name ?? 'file'
            let kind: FileKind
            try {
              kind = await deps.classify(file, name)
            } catch (err) {
              addMessage({ code: 'FILE_UNREADABLE', level: 'error', file: name, detail: err instanceof Error ? err.message : String(err) })
              refresh()
              return
            }
            const slot = kindSlot(kind)
            if (slot === undefined) {
              if (kind.kind === 'unsupportedMap') addMessage({ code: 'UNSUPPORTED_MAP', level: 'error', file: name, format: kind.format ?? `0x${kind.versionCode.toString(16)}` })
              else addMessage({ code: 'UNKNOWN_FILE', level: 'error', file: name, ...(kind.kind === 'unknownArchive' ? { detail: kind.reason } : {}) })
              refresh()
              return
            }
            const ok = await loadIntoSlot(slot, file, name, ++generation[slot])
            if (ok && deps.remembered !== undefined) await deps.remembered.save({ slot, name, blob: file }).catch((err: unknown) => log.warn('could not remember file', String(err)))
          }),
        ),
      )
    },
    setHostPaused(paused) {
      hostPaused = paused
      syncEngineActivity()
    },
    setHidden(h) {
      hidden = h
      syncEngineActivity()
    },
    setFrameLimit(fps) {
      frameLimit = Number.isFinite(fps) && fps > 0 ? fps : 0
      engine?.setFrameLimit(frameLimit)
    },
    setLanguage(tag) {
      hostLanguage = tag
      refresh()
    },
    newRandomPlace() {
      if (settings.viewmode !== 'random' || slots.map.status !== 'loaded') return
      applyView(true)
      refresh()
    },
    resize(w, h, dpr) {
      if (engine === undefined) return
      engine.resize(w, h, dpr)
      // The view fractions refer to the reachable range, which depends on the view size.
      applyView(false)
    },
    async forgetFiles() {
      await Promise.all([deps.remembered?.clear(), engine?.forgetCache()])
      for (const slot of ALL_SLOTS) {
        generation[slot]++
        slots[slot] = { status: 'missing', name: null, identity: null }
      }
      messages = []
      view = null
      startedAt = null
      slowStartChecked = false
      refresh()
    },
    state: snapshot,
    async idle() {
      for (let i = 0; i < 20 && (work.size > 0 || flushTimer !== undefined); i++) {
        if (flushTimer !== undefined) await flush()
        await Promise.all([...work])
      }
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    engine: () => engine,
  }
  return controller
}
