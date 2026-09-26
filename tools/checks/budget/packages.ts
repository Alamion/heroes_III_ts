// Budgets of built packages (spec 004 T049): shipped JS size per package, and cold/warm start of the
// browser and Wallpaper Engine packages as a user starts them (files through the page picker, or
// host properties naming local files read from file://), with CPU throttling.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { readPackageDir } from '../packages/index.ts'
import { runtimeGzipBytes } from '../../package/cli.ts'
import type { HostId } from '../../package/build.ts'
import { serveStatic } from '../hosts/static-server.ts'
import { entry, LIMITS } from './evaluate.ts'
import type { BudgetEntry } from './evaluate.ts'

export function packageSizeEntries(outDir: string, hosts: readonly HostId[]): BudgetEntry[] {
  return hosts
    .filter((h) => existsSync(join(outDir, h)))
    .map((h) => entry('runtime-js-gzip', runtimeGzipBytes(readPackageDir(join(outDir, h))), LIMITS.runtimeJsGzipBytes, 'bytes', `package:${h}`, 'all shipped JS incl. the embedded decode worker'))
}

interface Files {
  archive: string
  dataArchive: string
  map: string
}

type Wallpaper = { __h3wallpaper: { controller: { state(): { phase: string; engine: { framesPresented: number; objectPages: number } | null } } } }

async function throttled(context: BrowserContext, rate: number): Promise<Page> {
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await page.addInitScript(() => {
    ;(window as unknown as { __h3testHook: boolean }).__h3testHook = true
  })
  return page
}

async function untilShown(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = (window as unknown as Wallpaper).__h3wallpaper.controller.state()
      return s.phase === 'showing' && (s.engine?.framesPresented ?? 0) > 0 && (s.engine?.objectPages ?? 0) > 0
    },
    null,
    { timeout: 120_000, polling: 20 },
  )
}

async function webStart(page: Page, url: string, files: Files, supply: boolean): Promise<number> {
  await page.goto(url)
  await page.waitForFunction(() => (window as unknown as Partial<Wallpaper>).__h3wallpaper !== undefined)
  const t0 = await page.evaluate(() => performance.now())
  if (supply) await page.setInputFiles('input[type=file]', [files.archive, files.dataArchive, files.map])
  await untilShown(page)
  return (await page.evaluate(() => performance.now())) - t0
}

async function weStart(page: Page, url: string, files: Files): Promise<number> {
  await page.goto(url)
  await page.waitForFunction(() => (window as unknown as Partial<Wallpaper>).__h3wallpaper !== undefined)
  const t0 = await page.evaluate(() => performance.now())
  await page.evaluate((f) => {
    const l = (window as unknown as { wallpaperPropertyListener: { applyUserProperties(p: unknown): void } }).wallpaperPropertyListener
    l.applyUserProperties({ spritearchive: { value: f.archive }, dataarchive: { value: f.dataArchive }, mapfile: { value: f.map }, viewmode: { value: 'centre' } })
  }, files)
  await untilShown(page)
  return (await page.evaluate(() => performance.now())) - t0
}

export async function packageStartEntries(browser: Browser, fileBrowser: Browser, outDir: string, files: Files, mapName: string, viewport: { width: number; height: number }, rate: number): Promise<BudgetEntry[]> {
  const out: BudgetEntry[] = []
  const contextOpts = { viewport, screen: viewport, deviceScaleFactor: 1 }
  if (existsSync(join(outDir, 'web'))) {
    const server = await serveStatic(resolve(outDir, 'web'), '/heroes_III_ts/')
    const url = `http://127.0.0.1:${server.port}/heroes_III_ts/`
    const context = await browser.newContext(contextOpts)
    try {
      const cold = await webStart(await throttled(context, rate), url, files, true)
      // Warm: the same browser profile remembers the files and the decoded data.
      const warm = await webStart(await throttled(context, rate), url, files, false)
      out.push(entry('cold-start', cold, LIMITS.coldStartMs, 'ms', `${mapName} (package:web)`), entry('warm-start', warm, LIMITS.warmStartMs, 'ms', `${mapName} (package:web)`))
    } finally {
      await context.close()
      await server.close()
    }
  }
  if (existsSync(join(outDir, 'wallpaper-engine'))) {
    const url = pathToFileURL(resolve(outDir, 'wallpaper-engine', 'index.html')).href
    const context = await fileBrowser.newContext(contextOpts)
    try {
      const cold = await weStart(await throttled(context, rate), url, files)
      // Warm: files are read again from their paths; decoded data comes from the cache.
      const warm = await weStart(await throttled(context, rate), url, files)
      out.push(entry('cold-start', cold, LIMITS.coldStartMs, 'ms', `${mapName} (package:wallpaper-engine)`), entry('warm-start', warm, LIMITS.warmStartMs, 'ms', `${mapName} (package:wallpaper-engine)`, 'includes reading the archives from disk'))
    } finally {
      await context.close()
    }
  }
  return out
}

type FolderPage = { __h3wallpaper: { controller: { state(): { phase: string; folder: { shown: { path: string } | null; switching: boolean } | null; engine: { framesPresented: number; gpuBytes: number } | null }; nextMap(): void } } }

/**
 * Spec 007 SC-001, research R6: the Wallpaper Engine package started with a map folder instead of one
 * map (first map within the start-up budgets, the same seed so the warm start shows the same map), and
 * the peak of JS heap + GPU memory across map switches within the memory budget.
 */
export async function folderStartEntries(fileBrowser: Browser, outDir: string, files: { archive: string; dataArchive: string }, folder: string, label: string, viewport: { width: number; height: number }, rate: number): Promise<BudgetEntry[]> {
  if (!existsSync(join(outDir, 'wallpaper-engine'))) return [{ id: 'folder-warm-start', status: 'skip', note: 'Wallpaper Engine package not built' }]
  const url = pathToFileURL(resolve(outDir, 'wallpaper-engine', 'index.html')).href
  const context = await fileBrowser.newContext({ viewport, screen: viewport, deviceScaleFactor: 1 })
  const start = async (): Promise<{ page: Page; ms: number }> => {
    const page = await throttled(context, rate)
    await page.addInitScript(() => {
      ;(window as unknown as { __h3testOptions: unknown }).__h3testOptions = { seed: 20260925 }
    })
    await page.goto(url)
    await page.waitForFunction(() => (window as unknown as Partial<FolderPage>).__h3wallpaper !== undefined)
    const t0 = await page.evaluate(() => performance.now())
    await page.evaluate(
      (f) =>
        (window as unknown as { wallpaperPropertyListener: { applyUserProperties(p: unknown): void } }).wallpaperPropertyListener.applyUserProperties({
          spritearchive: { value: f.archive },
          dataarchive: { value: f.dataArchive },
          mapsource: { value: 'folder' },
          mapfolder: { value: f.folder },
        }),
      { ...files, folder },
    )
    await page.waitForFunction(
      () => {
        const s = (window as unknown as FolderPage).__h3wallpaper.controller.state()
        return s.phase === 'showing' && s.folder?.shown != null && (s.engine?.framesPresented ?? 0) > 0
      },
      null,
      { timeout: 120_000, polling: 20 },
    )
    return { page, ms: (await page.evaluate(() => performance.now())) - t0 }
  }
  try {
    const cold = await start()
    await cold.page.close()
    const warm = await start()
    // Peak memory while switching: sampled every 25 ms over five switches.
    const peak = await warm.page.evaluate(async () => {
      const c = (window as unknown as FolderPage).__h3wallpaper.controller
      const mem = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) + (c.state().engine?.gpuBytes ?? 0)
      let max = mem()
      const timer = setInterval(() => (max = Math.max(max, mem())), 25)
      for (let i = 0; i < 5; i++) {
        const before = c.state().folder?.shown?.path
        c.nextMap()
        const t = performance.now()
        while (performance.now() - t < 30_000) {
          await new Promise((r) => setTimeout(r, 25))
          const f = c.state().folder
          if (f !== null && f.shown?.path !== before && !f.switching) break
        }
      }
      clearInterval(timer)
      return max
    })
    return [
      entry('cold-start', cold.ms, LIMITS.coldStartMs, 'ms', `${label} (package:wallpaper-engine, folder)`, 'listing, first header and first map'),
      entry('warm-start', warm.ms, LIMITS.warmStartMs, 'ms', `${label} (package:wallpaper-engine, folder)`, 'same seed, so the same first map from the cache'),
      entry('memory', peak, LIMITS.memoryBytes, 'bytes', `${label} (package:wallpaper-engine, folder)`, 'peak JS heap + GPU over five map switches'),
    ]
  } finally {
    await context.close()
  }
}
