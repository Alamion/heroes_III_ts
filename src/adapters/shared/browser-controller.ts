// Browser wiring of the wallpaper controller: engine, file reading, overlay, visibility, resize and
// the test hook (spec 004 contracts/host-bridge.md "Test hook"). Every host entry calls this.

import { ManualClock } from '../../core/util/clock.ts'
import { log } from '../../core/util/log.ts'
import { createEngine } from '../../runtime/engine.ts'
import type { Engine } from '../../runtime/engine.ts'
import { classifyFile } from '../../runtime/file-kind.ts'
import { installLogger } from '../../runtime/logger.ts'
import { openCatalogueAt } from '../../runtime/catalogue.ts'
import { createController } from './controller.ts'
import type { HostName, RememberedFiles, WallpaperController } from './controller.ts'
import { browserReadDeps, readUserFile } from './file-url.ts'
import { createOverlay } from './overlay.ts'

export interface TestOptions {
  /** Seed of the random starting view. */
  seed?: number
  /** Start a manual clock at this time (frames only change when checks advance it). */
  clockMs?: number
  /** Disable the decode cache (invariant 9). */
  noCache?: boolean
  /**
   * Extra delay in ms before reading a file whose name ends with the key resolves, so a check can
   * force the order in which host files arrive (invariant 13). Test mode only.
   */
  readDelays?: Record<string, number>
  /**
   * Real milliseconds per controller millisecond (spec 007 invariant 19): 1/600 turns the one-minute map
   * interval into 100 ms, so a check can watch the map timer without waiting. Test mode only.
   */
  timeScale?: number
}

declare global {
  interface Window {
    __h3testHook?: boolean
    __h3testOptions?: TestOptions
    __h3wallpaper?: { controller: WallpaperController; engine: () => Engine | undefined; clock: ManualClock | undefined }
  }
}

export interface BrowserControllerOptions {
  host: HostName
  canvas: HTMLCanvasElement
  overlayRoot: HTMLElement
  fileUrl: (value: string) => string | null
  remembered?: RememberedFiles
  workerFactory?: () => Worker
  /** false: the host cannot open a map folder from its settings (the browser supplies folders itself). */
  folderSettings?: boolean
  /** false: the host cannot list a file:// folder, so its folder setting must name a .zip (Wallpaper Engine). */
  folderListing?: boolean
}

function testMode(): boolean {
  try {
    if (window.__h3testHook === true || new URLSearchParams(location.search).get('h3test') === '1') return true
    // Hosts give no URL control: `localStorage.setItem('h3dynam:test', '1')` in DevTools, then reload.
    return localStorage.getItem('h3dynam:test') === '1'
  } catch {
    return false
  }
}

function randomSeed(): number {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] as number
}

async function probeCache(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('h3dynam-probe')
      req.onsuccess = () => {
        req.result.close()
        resolve(true)
      }
      req.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

export interface BrowserController {
  controller: WallpaperController
  /** The real engine (browser adapter: scrolling and level keys). */
  engine: () => Engine | undefined
}

export function createBrowserController(opts: BrowserControllerOptions): BrowserController {
  const test = testMode()
  const testOptions: TestOptions = test ? (window.__h3testOptions ?? {}) : {}
  installLogger({ level: test ? 'info' : 'warn' })
  const clock = testOptions.clockMs !== undefined ? new ManualClock(testOptions.clockMs) : undefined
  let engine: Engine | undefined
  const timeScale = testOptions.timeScale !== undefined && testOptions.timeScale > 0 ? testOptions.timeScale : 1
  const readFile = (url: string): Promise<Blob> => {
    const read = readUserFile(url, browserReadDeps())
    const delay = Object.entries(testOptions.readDelays ?? {}).find(([name]) => decodeURIComponent(url).endsWith(name))?.[1] ?? 0
    return delay === 0 ? read : read.then((blob) => new Promise<Blob>((resolve) => window.setTimeout(() => resolve(blob), delay)))
  }
  const controller = createController({
    host: opts.host,
    createEngine: () => {
      engine = createEngine({
        canvas: opts.canvas,
        preserveDrawingBuffer: test,
        cache: testOptions.noCache !== true,
        ...(clock !== undefined ? { clock } : {}),
        ...(opts.workerFactory !== undefined ? { workerFactory: opts.workerFactory } : {}),
      })
      return engine
    },
    fileUrl: opts.fileUrl,
    readFile,
    // Spec 007: a folder value is listed through the page's own reader, or read as a .zip.
    ...(opts.folderSettings !== false ? { openCatalogue: (url: string, name: string) => openCatalogueAt(url, name, { readFile, listing: opts.folderListing !== false }) } : {}),
    classify: classifyFile,
    overlay: createOverlay(opts.overlayRoot),
    timers: { set: (cb, ms) => window.setTimeout(cb, ms * timeScale), clear: (h) => window.clearTimeout(h) },
    now: () => performance.now() / timeScale,
    seed: testOptions.seed ?? randomSeed(),
    environmentLanguage: () => navigator.language ?? null,
    cacheAvailable: probeCache,
    setCanvasHidden: (hidden) => {
      opts.canvas.hidden = hidden
    },
    ...(opts.remembered !== undefined ? { remembered: opts.remembered } : {}),
  })

  const resize = (): void => controller.resize(opts.canvas.clientWidth || window.innerWidth, opts.canvas.clientHeight || window.innerHeight, window.devicePixelRatio || 1)
  new ResizeObserver(resize).observe(document.documentElement)
  document.addEventListener('visibilitychange', () => controller.setHidden(document.visibilityState === 'hidden'))
  controller.setHidden(document.visibilityState === 'hidden')

  if (test) window.__h3wallpaper = { controller, engine: () => engine, clock }
  const started = controller.start().then(resize)
  started.catch((err: unknown) => log.error('wallpaper start failed', String(err)))
  return { controller, engine: () => engine }
}
