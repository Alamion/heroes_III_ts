// Engine additions for platform adapters (spec 004 T012): user scale, last-wins loads, cache
// clearing and decode sharing between pages. Synthetic files; skips without Chromium.
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { exposeFiles, hasChromium, openSession } from '../../tools/shared/browser.ts'
import type { HeadlessSession } from '../../tools/shared/browser.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'

const chromium = hasChromium()
if (!chromium) process.stderr.write('[browser tests skipped] Chromium not found (set H3_CHROMIUM)\n')

interface LoadResultLike {
  ok: boolean
  fromCache?: boolean
  error?: { code?: string }
}
interface EngineLike {
  loadArchive(b: Blob, n: string): Promise<LoadResultLike>
  loadMap(b: Blob, n: string): Promise<LoadResultLike>
  setUserScale(s: 1 | 2 | 3): void
  placeView(level: number, p: { mode: 'coords'; fx: number; fy: number }): unknown
  setMapping(level: number, t: { x: number; y: number }, p: { x: number; y: number }): void
  renderNow(anim: { step: number }): boolean
  forgetCache(): Promise<void>
  stats(): { camera: { offsetX: number; offsetY: number; scale: number; level: number }; surface: { width: number; height: number } }
}
type H3 = { __h3: { engine: EngineLike } }

describe.skipIf(!chromium)('engine additions for adapters', () => {
  let session: HeadlessSession
  let files: ReturnType<typeof writeSyntheticFiles>
  let urls: Map<string, string>
  const MAP_A = 'synthetic-36.h3m'
  const MAP_B = 'synthetic-40.h3m'

  const open = async (page: Page) => {
    await page.goto(new URL('index.html?test=1', session.server.url).toString())
    await page.waitForFunction(() => (globalThis as unknown as Partial<H3>).__h3 !== undefined)
  }
  const load = (page: Page, kind: 'archive' | 'map', path: string, name: string) =>
    page.evaluate(
      async ({ kind, url, name }) => {
        const blob = await (await fetch(url)).blob()
        const e = (globalThis as unknown as H3).__h3.engine
        return kind === 'archive' ? e.loadArchive(blob, name) : e.loadMap(blob, name)
      },
      { kind, url: urls.get(path) as string, name },
    )
  beforeAll(async () => {
    files = writeSyntheticFiles([
      { name: MAP_A, size: 36, underground: true },
      { name: MAP_B, size: 40, underground: false },
    ])
    session = await openSession({ mode: 'preview', viewport: { width: 320, height: 240 } })
    urls = await exposeFiles(session.context, [files.archive, files.maps[MAP_A] as string, files.maps[MAP_B] as string])
    await open(session.page)
  }, 120_000)

  afterAll(async () => {
    await session?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  it('draws scale ×2 as a nearest-neighbour enlargement of scale ×1', async () => {
    const page = session.page
    expect((await load(page, 'archive', files.archive, 'sprites.lod')).ok).toBe(true)
    expect((await load(page, 'map', files.maps[MAP_A] as string, MAP_A)).ok).toBe(true)
    // Render and read back in one task so the scheduler cannot draw another animation step between.
    const draw = (scale: 1 | 2) =>
      page.evaluate((scale) => {
        const e = (globalThis as unknown as H3).__h3.engine as EngineLike & { setPaused(p: boolean): void }
        e.setPaused(true)
        e.setUserScale(scale)
        e.placeView(0, { mode: 'coords', fx: 0.25, fy: 0.25 })
        e.renderNow({ step: 2 })
        const canvas = document.getElementById('map') as HTMLCanvasElement
        const gl = canvas.getContext('webgl') as WebGLRenderingContext
        const px = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
        return { cam: e.stats().camera, frame: { width: canvas.width, height: canvas.height, data: Array.from(px) } }
      }, scale)
    const { cam: cam1, frame: one } = await draw(1)
    const { cam: cam2, frame: two } = await draw(2)
    expect(cam2.scale).toBe(2 * cam1.scale)
    // Compare the ×2 frame with ×1 pixels at the same world position (both bottom-up rows).
    const w = one.width
    const h = one.height
    let mismatches = 0
    let compared = 0
    for (let y2 = 0; y2 < h; y2 += 3) {
      for (let x2 = 0; x2 < w; x2 += 3) {
        const worldX = cam2.offsetX + Math.floor(x2 / 2)
        const worldYTop = cam2.offsetY + Math.floor((h - 1 - y2) / 2)
        const x1 = worldX - cam1.offsetX
        const yTop1 = worldYTop - cam1.offsetY
        if (x1 < 0 || x1 >= w || yTop1 < 0 || yTop1 >= h) continue
        const i1 = ((h - 1 - yTop1) * w + x1) * 4
        const i2 = (y2 * w + x2) * 4
        compared++
        if (one.data[i1] !== two.data[i2] || one.data[i1 + 1] !== two.data[i2 + 1] || one.data[i1 + 2] !== two.data[i2 + 2]) {
          mismatches++
        }
      }
    }
    expect(compared).toBeGreaterThan(500)
    expect(mismatches).toBe(0)
    await page.evaluate(() => {
      const e = (globalThis as unknown as H3).__h3.engine as EngineLike & { setPaused(p: boolean): void }
      e.setUserScale(1)
      e.setPaused(false)
    })
  }, 60_000)

  it('drops the result of an older map load when a newer one started', async () => {
    const results = await session.page.evaluate(
      async ({ a, b }) => {
        const e = (globalThis as unknown as H3).__h3.engine
        const [blobA, blobB] = await Promise.all([(await fetch(a)).blob(), (await fetch(b)).blob()])
        return Promise.all([e.loadMap(blobA, 'a.h3m'), e.loadMap(blobB, 'b.h3m')])
      },
      { a: urls.get(files.maps[MAP_A] as string) as string, b: urls.get(files.maps[MAP_B] as string) as string },
    )
    expect(results[0]).toMatchObject({ ok: false, error: { code: 'SUPERSEDED' } })
    expect(results[1]).toMatchObject({ ok: true })
    const size = await session.page.evaluate(() => (globalThis as unknown as { __h3: { engine: { world(): { size: number } } } }).__h3.engine.world().size)
    expect(size).toBe(40)
  }, 60_000)

  it('forgets cached data', async () => {
    const page = session.page
    await page.reload()
    await page.waitForFunction(() => (globalThis as unknown as Partial<H3>).__h3 !== undefined)
    expect(await load(page, 'archive', files.archive, 'sprites.lod')).toMatchObject({ ok: true, fromCache: true })
    await page.evaluate(() => (globalThis as unknown as H3).__h3.engine.forgetCache())
    await page.reload()
    await page.waitForFunction(() => (globalThis as unknown as Partial<H3>).__h3 !== undefined)
    expect(await load(page, 'archive', files.archive, 'sprites.lod')).toMatchObject({ ok: true, fromCache: false })
  }, 60_000)

  it('decodes once when two pages of one origin load the same archive together', async () => {
    await session.page.evaluate(() => (globalThis as unknown as H3).__h3.engine.forgetCache())
    const second = await session.context.newPage()
    await open(second)
    await session.page.reload()
    await session.page.waitForFunction(() => (globalThis as unknown as Partial<H3>).__h3 !== undefined)
    const [a, b] = await Promise.all([load(session.page, 'archive', files.archive, 'sprites.lod'), load(second, 'archive', files.archive, 'sprites.lod')])
    expect(a.ok && b.ok).toBe(true)
    expect([a.fromCache, b.fromCache].sort()).toEqual([false, true])
    await second.close()
  }, 60_000)
})
