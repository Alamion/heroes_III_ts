// Wallpaper controller (spec 004 contracts/host-bridge.md): the host-neutral part of every adapter.
// Hosts translate their signals into calls here; the controller validates and coalesces settings,
// reads and classifies user files, drives the engine and shows the overlay. It holds no rendering,
// parsing or game logic (FR-008). All platform dependencies are injected, so it runs in Node tests
// with a fake engine; browser defaults are wired in browser-controller.ts.

import type { MapSummary } from '../../core/formats/h3m/summary.ts'
import type { LevelChoice, ViewPlacement } from '../../core/render/view-placement.ts'
import { log } from '../../core/util/log.ts'
import { hashInts } from '../../core/util/rng.ts'
import type { Engine, EngineStats, EngineStatus, LoadResult, UserScale } from '../../runtime/engine.ts'
import { summarizeMapFile } from '../../runtime/file-kind.ts'
import type { FileKind } from '../../runtime/file-kind.ts'
import type { CatalogueEntry } from '../../runtime/catalogue.ts'
import { displayName, UserFileError } from './file-url.ts'
import type { FileSlot, MessageCode, UserMessage } from './messages.ts'
import type { Overlay } from './overlay.ts'
import { mapFilter, passesFilter, Rotation } from '../../runtime/rotation.ts'
import { defaultSettings, FILE_SETTING_KEYS, validateSettings } from './settings.ts'
import type { SettingKey, WallpaperSettings } from './settings.ts'
import { format, pickLanguage } from './strings.ts'
import type { StringKey } from './strings.ts'
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
  | 'prepareMap'
  | 'showPreparedMap'
  | 'discardPreparedMap'
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
  /**
   * Spec 007: the maps of a `mapfolder` value (already turned into a URL by `fileUrl`) — a listed folder
   * or a .zip. Hosts without it cannot use a folder from their settings.
   */
  openCatalogue?: (url: string, name: string) => Promise<CatalogueEntry[]>
  /** Reads a map's summary for the folder filters (default: summarizeMapFile). */
  summarize?: (blob: Blob, name: string) => Promise<MapSummary>
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
  /** Where the map comes from (spec 007). */
  source: WallpaperSettings['mapsource']
  folder: FolderSnapshot | null
}

export interface FolderSnapshot {
  name: string
  /** Maps found; null while the folder is being listed. */
  entries: number | null
  shown: { path: string; title: string; size: number; levels: number } | null
  failed: number
  filtered: number
  switching: boolean
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
  /** "Next map now" (spec 007): only with the folder source; ignored while a switch is in progress. */
  nextMap(): void
  /**
   * Browser (spec 007): a folder or .zip the user picked or dropped, or the remembered folder. Switches
   * the source to the folder and shows a map from it.
   */
  supplyFolder(name: string, entries: () => Promise<CatalogueEntry[]>): Promise<void>
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

/** A map folder of this session (spec 007 data-model "Rotation", "CatalogueEntry"). */
interface FolderState {
  gen: number
  /** The `mapfolder` value it came from, or null for a folder the browser supplied. */
  value: string | null
  name: string
  /** null while the folder is being listed. */
  entries: CatalogueEntry[] | null
  rotation: Rotation | null
  summaries: Map<number, MapSummary>
  /** Entries that cannot be shown this session, with the reason. */
  failed: Map<number, string>
  shown: { id: number; path: string; summary: MapSummary } | null
  switching: boolean
}

const FOLDER_CODES: readonly MessageCode[] = ['FOLDER_EMPTY', 'FOLDER_FILTERED', 'FOLDER_UNREADABLE']

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
  /** Spec 007: the map folder, which source the engine shows, and the map timer (active time only). */
  let folder: FolderState | null = null
  let folderGen = 0
  let displayed: 'single' | 'folder' | null = null
  /** The single map as last loaded, so switching back from a folder needs no new read. */
  let singleMap: { blob: Blob; name: string } | undefined
  let mapTimer: { handle: number; minutes: number } | undefined
  let activeSince: number | null = null
  let activeMs = 0
  const summarize = deps.summarize ?? summarizeMapFile
  /** Resolves once start() has applied the first settings (a folder supplied earlier waits for it). */
  let markStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => (markStarted = resolve))
  const seenDiagnostics = new WeakSet<object>()
  const work = new Set<Promise<unknown>>()
  const listeners = new Set<(s: ControllerSnapshot) => void>()

  const language = (): Language => pickLanguage(hostLanguage ?? deps.environmentLanguage())
  /** A map is in the engine: the single map, or a map of the folder (spec 007). */
  const mapShown = (): boolean => displayed === 'folder' || slots.map.status === 'loaded'
  const showing = (): boolean => slots.spriteArchive.status === 'loaded' && mapShown()
  const folderBusy = (): boolean => folder !== null && (folder.entries === null || folder.switching)
  const phase = (): ControllerSnapshot['phase'] => {
    if (showing()) return 'showing'
    if (ALL_SLOTS.some((s) => slots[s].status === 'reading' || slots[s].status === 'loading') || folderBusy()) return 'loading'
    if (REQUIRED_SLOTS.some((s) => slots[s].status === 'failed') || messages.some((m) => m.message.code === 'WEBGL_UNAVAILABLE' || FOLDER_CODES.includes(m.message.code))) return 'problem'
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
    source: settings.mapsource,
    folder: folderSnapshot(),
  })

  const folderSnapshot = (): FolderSnapshot | null => {
    if (folder === null) return null
    const f = folder
    const filtered = f.entries === null ? 0 : f.entries.filter((e) => !f.failed.has(e.id) && f.summaries.has(e.id) && !eligible(f)(e.id)).length
    return {
      name: f.name,
      entries: f.entries === null ? null : f.entries.length,
      shown: f.shown === null ? null : { path: f.shown.path, title: f.shown.summary.title, size: f.shown.summary.size, levels: f.shown.summary.levels },
      failed: f.failed.size,
      filtered,
      switching: f.switching,
    }
  }

  const syncEngineActivity = (): void => {
    if (engine === undefined) return
    // Nothing to draw before both required files are in: no frames, no timers (invariant 1).
    engine.setPaused(hostPaused || !showing())
    engine.setVisible(!hidden)
    syncRerollTimer()
    syncMapTimer()
  }

  /**
   * Spec 007 research R8: the map timer counts active time only — shown, not paused, not hidden — so
   * nothing is read or prepared while the wallpaper cannot be seen. Elapsed time is banked when it stops.
   */
  const mapTimerWanted = (): boolean =>
    engine !== undefined && settings.mapsource === 'folder' && displayed === 'folder' && folder !== null && folder.shown !== null && !folder.switching && !hostPaused && !hidden && settings.maprotation > 0
  const syncMapTimer = (): void => {
    const minutes = settings.maprotation
    const wanted = mapTimerWanted()
    if (mapTimer !== undefined && (!wanted || mapTimer.minutes !== minutes)) {
      deps.timers.clear(mapTimer.handle)
      mapTimer = undefined
    }
    if (!wanted || mapTimer === undefined) {
      if (activeSince !== null) activeMs += deps.now() - activeSince
      activeSince = null
    }
    if (!wanted || mapTimer !== undefined) return
    activeSince = deps.now()
    mapTimer = {
      minutes,
      handle: deps.timers.set(
        () => {
          mapTimer = undefined
          void track(pickNext())
        },
        Math.max(0, minutes * 60_000 - activeMs),
      ),
    }
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
   * Chooses the view for a placement: on start, map change, switching to a random place and timer
   * (`reroll`), or keeping the current fractions. A random level is drawn on the same occasions and when
   * the level setting changes to "random" (`levelChanged`); otherwise the drawn level stays.
   */
  const choosePlacement = (reroll: boolean, levelChanged: boolean): { level: LevelChoice; placement: ViewPlacement; drawPlace: boolean } => {
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
    return { level, placement, drawPlace }
  }

  const commitView = (r: { fx: number; fy: number; level: number } | undefined, drawPlace: boolean): void => {
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

  /** Positions the view on the map the engine shows (see choosePlacement). */
  const applyView = (reroll: boolean, levelChanged = false): void => {
    if (engine === undefined || !mapShown()) return
    const c = choosePlacement(reroll, levelChanged)
    commitView(engine.placeView(c.level, c.placement), c.drawPlace)
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
      displayed = 'single'
      singleMap = { blob, name }
      applyView(true)
    }
    // HotA maps of the folder that were waiting for the archive become eligible (spec 007 edge case).
    if (slot === 'hotaArchive' && settings.mapsource === 'folder' && folder !== null && folder.shown === null && folder.entries !== null && folder.entries.length > 0) void track(pickNext())
    if (showing()) {
      engine.setUserScale(settings.scale as UserScale)
      engine.setObjectsVisible(settings.objects)
    }
    checkSlowStart()
    refresh()
    return true
  }

  /**
   * Runs slot loads with the HotA archive first. It goes in front of every archive set (spec 005
   * FR-004), so it has to be in place before the archives that are decoded against it. Every caller
   * hands over several files at once — a host's settings, a drop of several files, the remembered
   * files — and loading them together decoded the sprite archive without HotA and silently dropped
   * every HotA-only sprite (found on a real KDE session, 2026-09-23).
   */
  const hotaFirst = async (loads: readonly { slot: FileSlot; load: () => Promise<unknown> }[]): Promise<void> => {
    for (const l of loads) if (l.slot === 'hotaArchive') await l.load()
    await Promise.all(loads.filter((l) => l.slot !== 'hotaArchive').map((l) => l.load()))
  }

  // --- Map folder (spec 007) ---------------------------------------------------------------------

  const clearFolderMessages = (): void => clearMessages((m) => FOLDER_CODES.includes(m.message.code))

  /** An entry may be picked: not failed and, once its summary is known, inside the filters. */
  const eligible =
    (f: FolderState) =>
    (id: number): boolean => {
      if (f.failed.has(id)) return false
      const summary = f.summaries.get(id)
      if (summary === undefined) return true
      return passesFilter(summary, mapFilter(settings)) && (!summary.needsHota || slots.hotaArchive.status === 'loaded')
    }

  const markFailed = (f: FolderState, entry: CatalogueEntry, err: unknown): void => {
    const reason = err instanceof Error ? err.message : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : String(err)
    f.failed.set(entry.id, reason)
    log.warn(`map skipped: ${entry.path}: ${reason}`)
  }

  const describeFilter = (): string => {
    const f = mapFilter(settings)
    const t = (k: string): string => format(language(), k as StringKey)
    return `${t(`mapsize_${f.sizeMin}`)} – ${t(`mapsize_${f.sizeMax}`)}, ${t(`mapunderground_${f.underground}`)}`
  }

  /** No entry can be shown (after a full pass): a message while nothing shows, a log line otherwise. */
  const reportNoMap = (f: FolderState): void => {
    const entries = f.entries ?? []
    const known = entries.filter((e) => !f.failed.has(e.id) && f.summaries.has(e.id))
    const hotaOnly = known.length > 0 && known.every((e) => (f.summaries.get(e.id) as MapSummary).needsHota && passesFilter(f.summaries.get(e.id) as MapSummary, mapFilter(settings)))
    let message: UserMessage
    if (known.length > 0) {
      message = { code: 'FOLDER_FILTERED', level: 'error', file: f.name, detail: hotaOnly ? format(language(), 'kind_hotaArchive') : describeFilter() }
    } else {
      const first = [...f.failed.values()][0] ?? ''
      message = { code: 'FOLDER_UNREADABLE', level: 'error', file: f.name, detail: `${f.failed.size}/${entries.length}: ${first}` }
    }
    if (showing()) log.warn(`${message.code} ${f.name}: ${message.detail ?? ''}`)
    else addMessage(message)
  }

  const dropFolder = (): void => {
    folderGen++
    folder = null
    clearFolderMessages()
  }

  /** Lists a folder (or takes the browser's entries); the map is picked separately by pickNext. */
  const openFolder = async (value: string | null, name: string, list: (() => Promise<CatalogueEntry[]>) | null): Promise<void> => {
    const gen = ++folderGen
    const f: FolderState = { gen, value, name, entries: null, rotation: null, summaries: new Map(), failed: new Map(), shown: null, switching: false }
    folder = f
    clearFolderMessages()
    if (list === null) {
      f.entries = []
      refresh()
      return
    }
    startedAt ??= deps.now()
    refresh()
    let entries: CatalogueEntry[]
    try {
      entries = await list()
    } catch (err) {
      if (gen !== folderGen) return
      f.entries = []
      addMessage({ code: 'FOLDER_EMPTY', level: 'error', file: name, detail: err instanceof Error ? err.message : String(err) })
      refresh()
      return
    }
    if (gen !== folderGen) return
    f.entries = entries
    // Its own seed stream, so the map order does not depend on how many places were drawn before.
    f.rotation = new Rotation(entries.length, hashInts(deps.seed, 0x6d6170))
    log.info(`map folder ${name}: ${entries.length} map(s)`)
    if (entries.length === 0 && !showing()) addMessage({ code: 'FOLDER_EMPTY', level: 'error', file: name })
    else if (entries.length === 0) log.warn(`FOLDER_EMPTY ${name}`)
    refresh()
  }

  /** Opens the folder named by the settings (a URL through the host) or, without one, waits. */
  const openFolderFromSettings = (): Promise<void> => {
    const value = settings.mapfolder
    const url = value === null ? null : deps.fileUrl(value)
    if (value === null || url === null) return openFolder(null, '', null)
    const name = displayName(value)
    if (deps.openCatalogue === undefined) return openFolder(value, name, () => Promise.reject(new Error('this host cannot open map folders')))
    const open = deps.openCatalogue
    return openFolder(value, name, () => open(url, name))
  }

  /**
   * Picks the next map of the folder and shows it (research R5, R6): read → summary → filters →
   * prepare off-screen → one-step swap. Failures move on to the next entry; the current map keeps
   * running until the new one is ready.
   */
  const pickNext = async (): Promise<void> => {
    const f = folder
    if (engine === undefined || f === null || f.entries === null || f.rotation === null || f.switching || f.entries.length === 0) return
    const e = engine
    const rotation = f.rotation
    const entries = f.entries
    f.switching = true
    refresh()
    let retry: number | undefined
    try {
      for (let attempt = 0; attempt < entries.length * 2 + 4; attempt++) {
        if (f !== folder) return
        const id = retry ?? rotation.next(eligible(f))
        retry = undefined
        if (id === undefined) {
          reportNoMap(f)
          return
        }
        // The only usable map is already shown: a new place instead of a reload.
        if (f.shown !== null && id === f.shown.id && displayed === 'folder') {
          rotation.markShown(id)
          applyView(true)
          return
        }
        const entry = entries[id] as CatalogueEntry
        const name = displayName(entry.path)
        let blob: Blob
        try {
          blob = await entry.read()
        } catch (err) {
          markFailed(f, entry, err)
          continue
        }
        if (f !== folder) return
        let summary = f.summaries.get(id)
        if (summary === undefined) {
          try {
            summary = await summarize(blob, name)
          } catch (err) {
            markFailed(f, entry, err)
            continue
          }
          f.summaries.set(id, summary)
        }
        if (!eligible(f)(id)) continue
        const r = await e.prepareMap(blob, name)
        if (f !== folder) {
          if (r.ok) e.discardPreparedMap(r.prepared)
          return
        }
        if (!r.ok) {
          // Archives changed while preparing: the same map again, with the new archives.
          if (r.error.code === 'SUPERSEDED') retry = id
          else markFailed(f, entry, r.error)
          continue
        }
        if (!eligible(f)(id)) {
          e.discardPreparedMap(r.prepared)
          continue
        }
        const c = choosePlacement(true, false)
        const placed = e.showPreparedMap(r.prepared, c.level, c.placement)
        if (placed === undefined) {
          retry = id
          continue
        }
        displayed = 'folder'
        f.shown = { id, path: entry.path, summary }
        rotation.markShown(id)
        commitView(placed, c.drawPlace)
        activeMs = 0
        activeSince = null
        clearFolderMessages()
        e.setUserScale(settings.scale as UserScale)
        e.setObjectsVisible(settings.objects)
        log.info(`map shown: ${summary.title !== '' ? summary.title : name} (${entry.path}, ${summary.size}×${summary.size}, ${summary.levels} level(s))`)
        checkSlowStart()
        return
      }
      log.warn(`no map of ${f.name} could be prepared after several attempts`)
    } finally {
      f.switching = false
      refresh()
    }
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
    const loads: { slot: FileSlot; load: () => Promise<void> }[] = []
    const folderSource = settings.mapsource === 'folder'
    for (const key of FILE_SETTING_KEYS) {
      if (!(key in patch) || patch[key] === prev[key]) continue
      // With the folder source the single map waits until the source switches back (FR-021).
      if (key === 'mapfile' && folderSource) continue
      const slot = SLOT_OF_SETTING[key]
      loads.push({ slot, load: () => loadFromSetting(slot, settings[key]) })
    }
    // Spec 007: the map source, the folder and its filters.
    const sourceChanged = patch.mapsource !== undefined && patch.mapsource !== prev.mapsource
    const folderChanged = patch.mapfolder !== undefined && patch.mapfolder !== prev.mapfolder
    const filterChanged = (['mapsizemin', 'mapsizemax', 'mapunderground'] as const).some((k) => patch[k] !== undefined && patch[k] !== prev[k])
    let folderWork: Promise<void> | undefined
    let pick = false
    if (folderSource) {
      // A folder the browser supplied stays until another one is chosen.
      const supplied = folder !== null && folder.value === null && folder.entries !== null && folder.entries.length > 0
      if (folderChanged || folder === null || (sourceChanged && !supplied)) {
        folderWork = openFolderFromSettings()
        pick = true
      } else if (sourceChanged || (filterChanged && folder.shown === null)) {
        pick = true
      } else if (filterChanged && folder.shown !== null && !passesFilter(folder.shown.summary, mapFilter(settings))) {
        pick = true
      }
      if (filterChanged) clearFolderMessages()
    } else if (sourceChanged) {
      dropFolder()
      if (displayed === 'folder') {
        if (settings.mapfile !== null) loads.push({ slot: 'map', load: () => loadFromSetting('map', settings.mapfile) })
        else if (singleMap !== undefined) {
          const m = singleMap
          loads.push({ slot: 'map', load: () => loadIntoSlot('map', m.blob, m.name, ++generation.map).then(() => undefined) })
        }
      }
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
    // The folder is listed while the archives load; a map is picked once both are done.
    await Promise.all([hotaFirst(loads), folderWork])
    if (pick) await pickNext()
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
        markStarted()
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
        // With the folder source the remembered single map is kept for a later switch back, not shown.
        const folderFirst = (pending.mapsource ?? settings.mapsource) === 'folder'
        const map = files.find((f) => f.slot === 'map')
        if (folderFirst && map !== undefined) singleMap = { blob: map.blob, name: map.name }
        const now = folderFirst ? files.filter((f) => f.slot !== 'map') : files
        await hotaFirst(now.map((f) => ({ slot: f.slot, load: () => loadIntoSlot(f.slot, f.blob, f.name, ++generation[f.slot]) })))
      }
      await flush()
      markStarted()
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
        (async () => {
          const classified = await Promise.all(
            files.map(async (file) => {
              const name = file.name ?? 'file'
              let kind: FileKind
              try {
                kind = await deps.classify(file, name)
              } catch (err) {
                addMessage({ code: 'FILE_UNREADABLE', level: 'error', file: name, detail: err instanceof Error ? err.message : String(err) })
                refresh()
                return undefined
              }
              const slot = kindSlot(kind)
              if (slot === undefined) {
                if (kind.kind === 'unsupportedMap') addMessage({ code: 'UNSUPPORTED_MAP', level: 'error', file: name, format: kind.format ?? `0x${kind.versionCode.toString(16)}` })
                else addMessage({ code: 'UNKNOWN_FILE', level: 'error', file: name, ...(kind.kind === 'unknownArchive' ? { detail: kind.reason } : {}) })
                refresh()
                return undefined
              }
              // A single dropped map means "this map": the folder source gives way (spec 007).
              if (slot === 'map' && settings.mapsource === 'folder') {
                settings = { ...settings, mapsource: 'single' }
                dropFolder()
              }
              return {
                slot,
                load: async () => {
                  const ok = await loadIntoSlot(slot, file, name, ++generation[slot])
                  if (ok && deps.remembered !== undefined) await deps.remembered.save({ slot, name, blob: file }).catch((err: unknown) => log.warn('could not remember file', String(err)))
                },
              }
            }),
          )
          await hotaFirst(classified.filter((c) => c !== undefined))
        })(),
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
      if (settings.viewmode !== 'random' || !mapShown()) return
      applyView(true)
      refresh()
    },
    nextMap() {
      if (settings.mapsource !== 'folder' || folder === null || folder.switching) return
      void track(pickNext())
    },
    async supplyFolder(name, entries) {
      startedAt ??= deps.now()
      await track(
        (async () => {
          await started
          // After the first settings, so a stored "single" applied at start does not undo it.
          settings = { ...settings, mapsource: 'folder' }
          await openFolder(null, name, entries)
          await pickNext()
        })(),
      )
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
      // A supplied folder is forgotten with the files; a folder from the settings is listed again.
      if (folder !== null && folder.value === null) dropFolder()
      displayed = null
      singleMap = undefined
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
