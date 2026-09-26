// Headless browser integration of the engine through the dev harness page (tasks.md T081).
// Uses synthetic files; skips with a message when Chromium is unavailable.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exposeFiles, hasChromium, openSession } from '../../tools/shared/browser.ts'
import type { HeadlessSession } from '../../tools/shared/browser.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'

const chromium = hasChromium()
if (!chromium) process.stderr.write('[browser tests skipped] Chromium not found (set H3_CHROMIUM)\n')

interface H3Global {
  __h3: {
    engine: {
      loadArchive(b: Blob, n: string): Promise<{ ok: boolean; fromCache?: boolean; error?: unknown }>
      loadMap(b: Blob, n: string): Promise<{ ok: boolean; fromCache?: boolean; error?: unknown }>
      scrollBy(x: number, y: number): void
      toggleLevel(): void
      setVisible(v: boolean): void
      setPaused(p: boolean): void
      renderNow(anim: { step: number }): boolean
      status(): { state: string; map: string | null; diagnostics: { code: string; message: string }[] }
    }
    stats(): { scheduledFrames: number; pendingCallbacks: number; framesPresented: number; surface: { width: number; height: number }; camera: { level: number; offsetX: number }; planBuilds: number }
  }
}

describe.skipIf(!chromium)('engine in the browser', () => {
  let session: HeadlessSession
  let files: ReturnType<typeof writeSyntheticFiles>
  let urls: Map<string, string>
  let badMap: string

  beforeAll(async () => {
    files = writeSyntheticFiles([{ name: 'synthetic-36.h3m', size: 36, underground: true }])
    badMap = join(files.dir, 'broken.h3m')
    writeFileSync(badMap, Uint8Array.of(0x20, 0, 0, 0, 9, 9, 9))
    session = await openSession({ mode: 'preview', viewport: { width: 640, height: 480 } })
    urls = await exposeFiles(session.context, [files.archive, files.maps['synthetic-36.h3m'] as string, badMap])
    await session.page.goto(new URL('index.html?test=1', session.server.url).toString())
    await session.page.waitForFunction(() => (globalThis as unknown as Partial<H3Global>).__h3 !== undefined)
  }, 120_000)

  afterAll(async () => {
    await session?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  const load = (kind: 'archive' | 'map', path: string, name: string) =>
    session.page.evaluate(
      async ({ kind, url, name }) => {
        const blob = await (await fetch(url)).blob()
        const e = (globalThis as unknown as H3Global).__h3.engine
        return kind === 'archive' ? e.loadArchive(blob, name) : e.loadMap(blob, name)
      },
      { kind, url: urls.get(path) as string, name },
    )
  const stats = () => session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.stats())
  const pixels = () =>
    session.page.evaluate(() => {
      const canvas = document.getElementById('map') as HTMLCanvasElement
      const gl = canvas.getContext('webgl') as WebGLRenderingContext
      const px = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let h = 0
      for (let i = 0; i < px.length; i += 7) h = (h * 31 + (px[i] as number)) >>> 0
      return h
    })
  const waitFrames = () => session.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))

  it('loads files, draws, scrolls and switches level', async () => {
    expect((await load('archive', files.archive, 'synthetic-sprites.lod')).ok).toBe(true)
    const r = await load('map', files.maps['synthetic-36.h3m'] as string, 'synthetic-36.h3m')
    expect(r).toMatchObject({ ok: true, fromCache: false })
    await waitFrames()
    const s1 = await stats()
    expect(s1.framesPresented).toBeGreaterThan(0)
    expect(s1.surface).toEqual({ width: 640, height: 480 })
    const before = await pixels()
    await session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.engine.scrollBy(96, 0))
    await waitFrames()
    expect((await stats()).camera.offsetX).toBe(s1.camera.offsetX + 96)
    expect(await pixels()).not.toBe(before)
    await session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.engine.toggleLevel())
    await waitFrames()
    expect((await stats()).camera.level).toBe(1)
  }, 60_000)

  it('stops frames and timers while hidden and resumes when visible', async () => {
    await session.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const hidden = await stats()
    expect(hidden.pendingCallbacks).toBe(0)
    await session.page.waitForTimeout(1000)
    expect((await stats()).scheduledFrames).toBe(hidden.scheduledFrames)
    await session.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFrames()
    expect((await stats()).scheduledFrames).toBeGreaterThan(hidden.scheduledFrames)
  }, 30_000)

  it('reports unreadable and wrong-slot files without losing the current map', async () => {
    const bad = await load('map', badMap, 'broken.h3m')
    expect(bad.ok).toBe(false)
    const wrongArchive = await load('archive', files.maps['synthetic-36.h3m'] as string, 'synthetic-36.h3m')
    expect(wrongArchive.ok).toBe(false)
    const wrongMap = await load('map', files.archive, 'synthetic-sprites.lod')
    expect(wrongMap.ok).toBe(false)
    const status = await session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.engine.status())
    expect(status.map).toBe('synthetic-36.h3m')
    expect(status.state).toBe('ready')
    expect(status.diagnostics.map((d) => d.message).join('\n')).toMatch(/LOD archive|map file/)
  }, 30_000)

  it('recovers from a lost WebGL context with an identical frame', async () => {
    // Draw at a fixed animation step so time passing between frames cannot change the image.
    const drawAtStep = () => session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.engine.renderNow({ step: 3 }))
    // Paused: the scheduler must not draw another step between the draw and the readback.
    await session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.engine.setPaused(true))
    expect(await drawAtStep()).toBe(true)
    const before = await pixels()
    await session.page.evaluate(() => {
      const gl = (document.getElementById('map') as HTMLCanvasElement).getContext('webgl') as WebGLRenderingContext
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext === null) throw new Error('WEBGL_lose_context unavailable')
      ext.loseContext()
      ;(globalThis as unknown as { __lose: WEBGL_lose_context }).__lose = ext
    })
    await session.page.waitForTimeout(200)
    await session.page.evaluate(() => (globalThis as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext())
    await session.page.waitForFunction(() => (globalThis as unknown as H3Global).__h3.engine.status().state === 'ready')
    expect(await drawAtStep()).toBe(true)
    expect(await pixels()).toBe(before)
    await session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.engine.setPaused(false))
  }, 30_000)

  it('reuses decoded data from the local cache on reload', async () => {
    await session.page.reload()
    await session.page.waitForFunction(() => (globalThis as unknown as Partial<H3Global>).__h3 !== undefined)
    expect(await load('archive', files.archive, 'synthetic-sprites.lod')).toMatchObject({ ok: true, fromCache: true })
    expect(await load('map', files.maps['synthetic-36.h3m'] as string, 'synthetic-36.h3m')).toMatchObject({ ok: true, fromCache: true })
  }, 30_000)
})
