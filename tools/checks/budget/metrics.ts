// Page metrics for budget checks (tasks.md T092): headless Chromium at a fixed viewport with CPU
// throttling, files supplied through the harness file inputs like a user would.

import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core'
import type { MapMeasurement, FrameWork } from './evaluate.ts'

interface H3Page {
  __h3: {
    engine: {
      status(): { state: string; diagnostics: { message: string }[] }
      setMapping(level: number, tile: { x: number; y: number }, pixel: { x: number; y: number }): void
      renderNow(anim: { step: number }): boolean
    }
    stats(): { framesPresented: number; scheduledFrames: number; pendingCallbacks: number; surface: { width: number; height: number }; gpuBytes: number; drawCalls: number; vertices: number; vertexCapacity: number; lastFrameCpuMs: number; animatedRowsInView: number }
  }
}

export interface MetricsOptions {
  browser: Browser
  baseUrl: string
  viewport: { width: number; height: number }
  throttle: number
}

async function newPage(opts: MetricsOptions, context?: BrowserContext): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const ctx = context ?? (await opts.browser.newContext({ viewport: opts.viewport, screen: opts.viewport, deviceScaleFactor: 1 }))
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle })
  await page.goto(new URL('index.html?test=1', opts.baseUrl).toString())
  await page.waitForFunction(() => (globalThis as unknown as Partial<H3Page>).__h3 !== undefined)
  return { context: ctx, page, cdp }
}

async function loadFiles(page: Page, archive: string, map: string): Promise<number> {
  const t0 = await page.evaluate(() => performance.now())
  await page.setInputFiles('#archive', archive)
  await page.setInputFiles('#mapfile', map)
  await page.waitForFunction(
    () => {
      const h = (globalThis as unknown as H3Page).__h3
      return h.engine.status().state === 'ready' && h.stats().framesPresented > 0
    },
    null,
    { timeout: 120_000, polling: 20 },
  )
  const t1 = await page.evaluate(() => performance.now())
  return t1 - t0
}

const stats = (page: Page) => page.evaluate(() => (globalThis as unknown as H3Page).__h3.stats())

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    // Runs in the page; tools have no DOM types.
    const doc = (globalThis as unknown as { document: { dispatchEvent(e: unknown): void } }).document
    Object.defineProperty(doc, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true })
    doc.dispatchEvent(new (globalThis as unknown as { Event: new (t: string) => unknown }).Event('visibilitychange'))
  }, hidden)
}

export async function measureMap(opts: MetricsOptions, name: string, archive: string, map: string, idleWindowMs = 5000): Promise<MapMeasurement> {
  // Cold: a fresh context has an empty IndexedDB.
  const cold = await newPage(opts)
  try {
    const coldStartMs = await loadFiles(cold.page, archive, map)
    // Warm: reload in the same context; decoded data comes from the cache.
    await cold.page.close()
    const warm = await newPage(opts, cold.context)
    const warmStartMs = await loadFiles(warm.page, archive, map)
    await warm.page.waitForTimeout(500)

    const s0 = await stats(warm.page)
    const metrics = (await warm.cdp.send('Performance.getMetrics')).metrics
    const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0

    const idleStart = s0.scheduledFrames
    await warm.page.waitForTimeout(idleWindowMs)
    const s1 = await stats(warm.page)

    await setHidden(warm.page, true)
    const h0 = await stats(warm.page)
    await warm.page.waitForTimeout(3000)
    const h1 = await stats(warm.page)
    await setHidden(warm.page, false)

    return {
      map: name,
      coldStartMs,
      warmStartMs,
      memoryBytes: heap + s1.gpuBytes,
      surface: s1.surface,
      display: { width: opts.viewport.width, height: opts.viewport.height, dpr: 1 },
      hiddenFrames: h1.scheduledFrames - h0.scheduledFrames,
      hiddenPending: h0.pendingCallbacks,
      idleFrames: s1.scheduledFrames - idleStart,
      idleWindowMs,
      animatedInView: s1.animatedRowsInView > 0,
    }
  } finally {
    await cold.context.close()
  }
}

/** Frame work at a fixed view (tile 10, 10 at the top-left) over `frames` renders with changing steps. */
export async function measureFrameWork(opts: MetricsOptions, archive: string, map: string, frames = 60): Promise<FrameWork> {
  const p = await newPage(opts)
  try {
    await loadFiles(p.page, archive, map)
    return await p.page.evaluate((n) => {
      const h = (globalThis as unknown as H3Page).__h3
      h.engine.setMapping(0, { x: 10, y: 10 }, { x: 0, y: 0 })
      const cpu: number[] = []
      for (let i = 0; i < n; i++) {
        h.engine.renderNow({ step: i })
        cpu.push(h.stats().lastFrameCpuMs)
      }
      cpu.sort((a, b) => a - b)
      const s = h.stats()
      return { drawCalls: s.drawCalls, vertices: s.vertexCapacity, gpuBytes: s.gpuBytes, medianFrameCpuMs: cpu[Math.floor(cpu.length / 2)] as number }
    }, frames)
  } finally {
    await p.context.close()
  }
}
