/// <reference lib="dom" />
// Host drivers for `yarn verify hosts` (spec 004 T029–T030, T038, T055, T064): each opens a built
// package the way its host does and delivers files, settings, pause and language like the host.

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { SETTINGS } from '../../../src/adapters/shared/settings.ts'
import { log } from '../../../src/core/util/log.ts'
import type { HostId } from '../../package/build.ts'
import { serveStatic } from './static-server.ts'
import type { StaticServer } from './static-server.ts'

export interface HostFiles {
  spriteArchive?: string
  dataArchive?: string
  map?: string
}

export interface OpenOptions {
  seed: number
  /** BCP 47 locale of the page (navigator.language). */
  locale: string
  /** Manual engine clock start (ms). */
  clockMs: number
  noCache?: boolean
  viewport?: { width: number; height: number }
}

export interface HostPage {
  page: Page
  context: BrowserContext
  close(): Promise<void>
}

export interface HostDriver {
  host: HostId
  /** Whether a setting can name a file that does not exist (not in the browser version). */
  supportsMissingPath: boolean
  open(opts: OpenOptions): Promise<HostPage>
  /** Delivers files the host way (settings, picker or drop). */
  supplyFiles(hp: HostPage, files: HostFiles): Promise<void>
  /** Delivers non-file settings the host way. */
  setSettings(hp: HostPage, raw: Record<string, string | number | boolean>): Promise<void>
  setPaused(hp: HostPage, paused: boolean): Promise<void>
  /** Uses the host's "new random place now" control. */
  newRandomPlace(hp: HostPage): Promise<void>
  setLanguage?(hp: HostPage, tag: string): Promise<void>
  dispose(): Promise<void>
}

/** Page-side globals installed before any page script runs. */
async function newHostPage(browser: Browser, opts: OpenOptions): Promise<HostPage> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 640, height: 480 }, deviceScaleFactor: 1, locale: opts.locale })
  const page = await context.newPage()
  page.on('crash', () => log.error('host page crashed'))
  page.on('pageerror', (err) => log.warn(`[page error] ${err.message}`))
  await page.addInitScript((o) => {
    const w = window as unknown as Record<string, unknown>
    w.__h3testHook = true
    w.__h3testOptions = { seed: o.seed, clockMs: o.clockMs, ...(o.noCache === true ? { noCache: true } : {}) }
    w.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (e) => (w.__cspViolations as string[]).push(`${e.violatedDirective} ${e.blockedURI}`))
    if (o.noCache === true) {
      try {
        Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
      } catch {
        // ignore
      }
    }
  }, opts)
  return { page, context, close: () => context.close() }
}

const SETTING_OF_SLOT = { spriteArchive: 'spritearchive', dataArchive: 'dataarchive', map: 'mapfile' } as const

// --- Browser version ------------------------------------------------------------------------------

export async function webDriver(browser: Browser, packageDir: string): Promise<HostDriver> {
  const server: StaticServer = await serveStatic(packageDir, '/heroes_III_ts/')
  const url = `http://127.0.0.1:${server.port}/heroes_III_ts/`
  let useDrop = false
  return {
    host: 'web',
    supportsMissingPath: false,
    async open(opts) {
      const hp = await newHostPage(browser, opts)
      await hp.page.goto(url)
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      return hp
    },
    async supplyFiles(hp, files) {
      const paths = Object.values(files).filter((p): p is string => p !== undefined)
      // Alternate between the picker and a drop of all files at once.
      useDrop = !useDrop
      if (!useDrop) {
        await hp.page.setInputFiles('input[type=file]', paths)
        return
      }
      // Files reach the page through a test-only input (Playwright passes local paths without copying
      // them through DevTools; the page CSP forbids fetching them), then drop as one DataTransfer.
      await hp.page.evaluate(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.id = '__h3drop'
        input.hidden = true
        document.body.append(input)
      })
      await hp.page.setInputFiles('#__h3drop', paths)
      await hp.page.evaluate(() => {
        const input = document.getElementById('__h3drop') as HTMLInputElement
        const dt = new DataTransfer()
        for (const f of Array.from(input.files ?? [])) dt.items.add(f)
        input.remove()
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      })
    },
    async setSettings(hp, raw) {
      for (const [key, value] of Object.entries(raw)) {
        const id = `#h3p-${key}`
        await hp.page.evaluate(
          ({ id, value }) => {
            const el = document.querySelector(id) as HTMLInputElement | HTMLSelectElement | null
            if (el === null) throw new Error(`panel control ${id} not found`)
            if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value === true
            else el.value = String(value)
            el.dispatchEvent(new Event(el instanceof HTMLInputElement && el.type === 'range' ? 'input' : 'change', { bubbles: true }))
          },
          { id, value },
        )
        // The panel re-renders (e.g. shows the sliders) after the controller applied the change.
        await hp.page.evaluate(() => (window as unknown as { __h3wallpaper: { controller: { idle(): Promise<void> } } }).__h3wallpaper.controller.idle())
      }
    },
    async setPaused(hp, paused) {
      await setHidden(hp.page, paused)
    },
    async newRandomPlace(hp) {
      await hp.page.click('#h3p-viewreroll')
    },
    dispose: () => server.close(),
  }
}

/** Emulates the page being hidden or shown (the browser's visibility signal). */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

// --- Wallpaper Engine ----------------------------------------------------------------------------

export async function wallpaperEngineDriver(browser: Browser, packageDir: string): Promise<HostDriver> {
  const url = pathToFileURL(resolve(packageDir, 'index.html')).href
  // The action checkbox: every toggle is a click.
  const toggles = new Map<HostPage, boolean>()
  return {
    host: 'wallpaper-engine',
    supportsMissingPath: true,
    async open(opts) {
      const hp = await newHostPage(browser, opts)
      await hp.page.goto(url)
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      // Wallpaper Engine sends every property once at load, files empty.
      await hp.page.evaluate(() => {
        const l = (window as unknown as { wallpaperPropertyListener: { applyUserProperties(p: unknown): void; applyGeneralProperties(p: unknown): void } }).wallpaperPropertyListener
        l.applyUserProperties({ spritearchive: { value: '' }, dataarchive: { value: '' }, mapfile: { value: '' }, level: { value: 'random' }, viewmode: { value: 'random' }, viewx: { value: 50 }, viewy: { value: 50 }, scale: { value: '1' }, objects: { value: true }, viewreroll: { value: false } })
        l.applyGeneralProperties({ fps: 30 })
      })
      return hp
    },
    async supplyFiles(hp, files) {
      const props: Record<string, { value: string }> = {}
      for (const [slot, path] of Object.entries(files)) if (path !== undefined) props[SETTING_OF_SLOT[slot as keyof HostFiles]] = { value: path }
      await hp.page.evaluate((p) => (window as unknown as { wallpaperPropertyListener: { applyUserProperties(p: unknown): void } }).wallpaperPropertyListener.applyUserProperties(p), props)
    },
    async setSettings(hp, raw) {
      const props = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { value: v }]))
      await hp.page.evaluate((p) => (window as unknown as { wallpaperPropertyListener: { applyUserProperties(p: unknown): void } }).wallpaperPropertyListener.applyUserProperties(p), props)
    },
    async setPaused(hp, paused) {
      await hp.page.evaluate((p) => (window as unknown as { wallpaperPropertyListener: { setPaused(p: boolean): void } }).wallpaperPropertyListener.setPaused(p), paused)
    },
    async newRandomPlace(hp) {
      const value = !(toggles.get(hp) ?? false)
      toggles.set(hp, value)
      await hp.page.evaluate((v) => (window as unknown as { wallpaperPropertyListener: { applyUserProperties(p: unknown): void } }).wallpaperPropertyListener.applyUserProperties({ viewreroll: { value: v } }), value)
    },
    dispose: async () => {},
  }
}

// --- Lively --------------------------------------------------------------------------------------

export async function livelyDriver(browser: Browser, packageDir: string): Promise<HostDriver> {
  // Lively serves a copy of the wallpaper folder on a virtual https host; files chosen with
  // "Browse" are copied into its folder. Here: a temp copy served on http://<name>.localhost.
  const dir = mkdtempSync(join(tmpdir(), 'h3-lively-'))
  cpSync(packageDir, dir, { recursive: true })
  const server = await serveStatic(dir, '/')
  const url = `http://h3lively.localhost:${server.port}/index.html`
  const properties = JSON.parse(readFileSync(join(dir, 'LivelyProperties.json'), 'utf8')) as Record<string, { type: string; value: unknown; items?: string[] }>
  const deliver = (hp: HostPage, name: string, value: unknown) =>
    hp.page.evaluate(({ name, value }) => (window as unknown as { livelyPropertyListener(n: string, v: unknown): void }).livelyPropertyListener(name, value), { name, value })
  const toLively = (key: string, value: string | number | boolean): unknown => {
    const def = SETTINGS.find((d) => d.key === key)
    if (def?.type === 'enum') return def.options.findIndex((o) => o.value === String(value))
    return value
  }
  return {
    host: 'lively',
    supportsMissingPath: true,
    async open(opts) {
      const hp = await newHostPage(browser, opts)
      await hp.page.goto(url)
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      // After NavigationCompleted Lively sends every control once.
      for (const [name, p] of Object.entries(properties)) {
        if (p.type === 'button' || p.type === 'label') continue
        await deliver(hp, name, p.value)
      }
      return hp
    },
    async supplyFiles(hp, files) {
      mkdirSync(join(dir, 'userfiles'), { recursive: true })
      for (const [slot, path] of Object.entries(files)) {
        if (path === undefined) continue
        const name = basename(path)
        if (existsSync(path)) copyFileSync(path, join(dir, 'userfiles', name))
        await deliver(hp, SETTING_OF_SLOT[slot as keyof HostFiles], `userfiles\\${name}`)
      }
    },
    async setSettings(hp, raw) {
      for (const [k, v] of Object.entries(raw)) await deliver(hp, k, toLively(k, v))
    },
    async setPaused(hp, paused) {
      await hp.page.evaluate((p) => (window as unknown as { livelyWallpaperPlaybackChanged(d: string): void }).livelyWallpaperPlaybackChanged(JSON.stringify({ IsPaused: p })), paused)
    },
    async newRandomPlace(hp) {
      await deliver(hp, 'viewreroll', true)
    },
    dispose: async () => {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

// --- KDE Plasma ----------------------------------------------------------------------------------

export async function kdeDriver(browser: Browser, packageDir: string): Promise<HostDriver> {
  const url = pathToFileURL(resolve(packageDir, 'contents/web/index.html')).href
  // QML always sends the full configuration.
  const config = new Map<HostPage, { settings: Record<string, unknown>; language: string }>()
  const apply = (hp: HostPage) => hp.page.evaluate((json) => (window as unknown as { h3wallpaper: { apply(j: string): void } }).h3wallpaper.apply(json), JSON.stringify(config.get(hp)))
  return {
    host: 'kde',
    supportsMissingPath: true,
    async open(opts) {
      const hp = await newHostPage(browser, opts)
      await hp.page.goto(url)
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      config.set(hp, { settings: { spritearchive: '', dataarchive: '', mapfile: '', level: 'random', viewmode: 'random', viewx: 50, viewy: 50, scale: '1', objects: true, viewreroll: 0 }, language: opts.locale })
      await apply(hp)
      return hp
    },
    async supplyFiles(hp, files) {
      const c = config.get(hp) as { settings: Record<string, unknown> }
      for (const [slot, path] of Object.entries(files)) if (path !== undefined) c.settings[SETTING_OF_SLOT[slot as keyof HostFiles]] = pathToFileURL(path).href
      await apply(hp)
    },
    async setSettings(hp, raw) {
      Object.assign((config.get(hp) as { settings: Record<string, unknown> }).settings, raw)
      await apply(hp)
    },
    async setPaused(hp, paused) {
      await hp.page.evaluate((p) => (window as unknown as { h3wallpaper: { setPaused(p: boolean): void } }).h3wallpaper.setPaused(p), paused)
    },
    async newRandomPlace(hp) {
      const c = config.get(hp) as { settings: Record<string, unknown> }
      c.settings.viewreroll = Number(c.settings.viewreroll ?? 0) + 1
      await apply(hp)
    },
    async setLanguage(hp, tag) {
      ;(config.get(hp) as { language: string }).language = tag
      await apply(hp)
    },
    dispose: async () => {},
  }
}

export const DRIVERS: Record<HostId, (browser: Browser, packageDir: string) => Promise<HostDriver>> = {
  web: webDriver,
  'wallpaper-engine': wallpaperEngineDriver,
  lively: livelyDriver,
  kde: kdeDriver,
}
