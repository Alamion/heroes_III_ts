// Spec 007 contracts/engine-api.md: a map prepared off-screen replaces the shown one in one step.
// Synthetic files through the dev harness; skips with a message when Chromium is unavailable.
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exposeFiles, hasChromium, openSession } from '../../tools/shared/browser.ts'
import type { HeadlessSession } from '../../tools/shared/browser.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'

const chromium = hasChromium()
if (!chromium) process.stderr.write('[browser tests skipped] Chromium not found (set H3_CHROMIUM)\n')

type Handle = { name: string; identity: string; size: number; levels: number }
interface H3Global {
  __h3: {
    engine: {
      loadArchive(b: Blob, n: string): Promise<{ ok: boolean }>
      loadDataArchive(b: Blob, n: string): Promise<{ ok: boolean }>
      loadMap(b: Blob, n: string): Promise<{ ok: boolean }>
      prepareMap(b: Blob, n: string): Promise<{ ok: true; prepared: Handle } | { ok: false; error: { code: string } }>
      showPreparedMap(h: Handle, level: number, placement: { mode: 'coords'; fx: number; fy: number }): { level: number; fx: number; fy: number } | undefined
      discardPreparedMap(h: Handle): void
      placeView(level: number, placement: { mode: 'coords'; fx: number; fy: number }): unknown
      renderNow(anim: { step: number; tick?: number }): boolean
      status(): { map: string | null; diagnostics: { code: string }[] }
    }
    stats(): { preparedMaps: number; gpuBytes: number; objectPages: number; objectQuads: number; camera: { level: number; offsetX: number; offsetY: number } }
  }
}
declare global {
  interface Window {
    __prepared?: Handle
    __files?: Record<string, Blob>
  }
}

describe.skipIf(!chromium)('engine prepareMap / showPreparedMap (spec 007)', () => {
  let session: HeadlessSession
  let files: ReturnType<typeof writeSyntheticFiles>
  let urls: Map<string, string>

  const MAPS = [
    { name: 'a-36.h3m', size: 36, underground: true },
    { name: 'b-48.h3m', size: 48, underground: false },
    { name: 'c-40.h3m', size: 40, underground: true },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `lru-${i}.h3m`, size: 24 + i, underground: false })),
  ]

  const openPage = async () => {
    await session.page.goto(new URL('index.html?test=1', session.server.url).toString())
    await session.page.waitForFunction(() => (globalThis as unknown as Partial<H3Global>).__h3 !== undefined)
    await session.page.evaluate(async (entries) => {
      window.__files = {}
      for (const [name, url] of entries) window.__files[name] = await (await fetch(url)).blob()
    }, [
      ['sprites', urls.get(files.archive) as string],
      ['data', urls.get(files.dataArchive) as string],
      ...MAPS.map((m) => [m.name, urls.get(files.maps[m.name] as string) as string]),
    ] as [string, string][])
  }

  beforeAll(async () => {
    files = writeSyntheticFiles(MAPS)
    session = await openSession({ mode: 'preview', viewport: { width: 640, height: 480 } })
    urls = await exposeFiles(session.context, [files.archive, files.dataArchive, ...MAPS.map((m) => files.maps[m.name] as string)])
    await openPage()
  }, 180_000)

  afterAll(async () => {
    await session?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  const stats = () => session.page.evaluate(() => (globalThis as unknown as H3Global).__h3.stats())
  /** Draws a fixed animation step and hashes the frame, so two engines' frames compare exactly. */
  const frameHash = () =>
    session.page.evaluate(() => {
      const h3 = (globalThis as unknown as H3Global).__h3
      h3.engine.renderNow({ step: 0, tick: 0 })
      const canvas = document.getElementById('map') as HTMLCanvasElement
      const gl = canvas.getContext('webgl') as WebGLRenderingContext
      const px = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let h = 0
      for (let i = 0; i < px.length; i++) h = (h * 31 + (px[i] as number)) >>> 0
      return h
    })

  it('keeps the shown map while preparing and swaps terrain, objects and camera in one step', async () => {
    await session.page.evaluate(async () => {
      const e = (globalThis as unknown as H3Global).__h3.engine
      const f = window.__files as Record<string, Blob>
      await e.loadArchive(f.sprites as Blob, 'sprites.lod')
      await e.loadDataArchive(f.data as Blob, 'data.lod')
      await e.loadMap(f['a-36.h3m'] as Blob, 'a-36.h3m')
      e.placeView(0, { mode: 'coords', fx: 0.3, fy: 0.3 })
    })
    const beforeHash = await frameHash()
    const before = await stats()
    expect(before.objectPages).toBeGreaterThan(0)

    const r = await session.page.evaluate(async () => {
      const e = (globalThis as unknown as H3Global).__h3.engine
      const r = await e.prepareMap((window.__files as Record<string, Blob>)['b-48.h3m'] as Blob, 'b-48.h3m')
      if (r.ok) window.__prepared = r.prepared
      return { ok: r.ok, map: e.status().map }
    })
    expect(r).toEqual({ ok: true, map: 'a-36.h3m' })
    const during = await stats()
    expect(during.preparedMaps).toBe(1)
    expect(during.camera).toEqual(before.camera)
    expect(await frameHash()).toBe(beforeHash)

    const shown = await session.page.evaluate(() => {
      const e = (globalThis as unknown as H3Global).__h3.engine
      return { placed: e.showPreparedMap(window.__prepared as Handle, 0, { mode: 'coords', fx: 0.5, fy: 0.5 }), map: e.status().map }
    })
    expect(shown.map).toBe('b-48.h3m')
    expect(shown.placed).toMatchObject({ level: 0 })
    const swappedHash = await frameHash()
    const swapped = await stats()
    expect(swapped.preparedMaps).toBe(0)
    expect(swappedHash).not.toBe(beforeHash)

    // The same map loaded directly gives the same frame and the same GPU memory.
    await session.page.evaluate(async () => {
      const e = (globalThis as unknown as H3Global).__h3.engine
      await e.loadMap((window.__files as Record<string, Blob>)['b-48.h3m'] as Blob, 'b-48.h3m')
      e.placeView(0, { mode: 'coords', fx: 0.5, fy: 0.5 })
    })
    expect(await frameHash()).toBe(swappedHash)
    const direct = await stats()
    expect(Math.abs(direct.gpuBytes - swapped.gpuBytes)).toBeLessThanOrEqual(direct.gpuBytes * 0.01)
    expect(direct.objectQuads).toBe(swapped.objectQuads)
  }, 60_000)

  it('stale handles, discards and superseded prepares', async () => {
    const r = await session.page.evaluate(async () => {
      const e = (globalThis as unknown as H3Global).__h3.engine
      const f = window.__files as Record<string, Blob>
      const again = e.showPreparedMap(window.__prepared as Handle, 0, { mode: 'coords', fx: 0.5, fy: 0.5 })
      const c = await e.prepareMap(f['c-40.h3m'] as Blob, 'c-40.h3m')
      const afterPrepare = (globalThis as unknown as H3Global).__h3.stats().preparedMaps
      if (c.ok) e.discardPreparedMap(c.prepared)
      const afterDiscard = (globalThis as unknown as H3Global).__h3.stats().preparedMaps
      const [first, second] = await Promise.all([e.prepareMap(f['a-36.h3m'] as Blob, 'a-36.h3m'), e.prepareMap(f['c-40.h3m'] as Blob, 'c-40.h3m')])
      if (second.ok) e.discardPreparedMap(second.prepared)
      return {
        again,
        afterPrepare,
        afterDiscard,
        first: first.ok ? 'ok' : first.error.code,
        second: second.ok,
        left: (globalThis as unknown as H3Global).__h3.stats().preparedMaps,
        map: e.status().map,
      }
    })
    expect(r).toEqual({ again: undefined, afterPrepare: 1, afterDiscard: 0, first: 'SUPERSEDED', second: true, left: 0, map: 'b-48.h3m' })
  }, 60_000)

  it('without a data archive a prepared map has no objects and reports the missing archive', async () => {
    await openPage()
    const r = await session.page.evaluate(async () => {
      const h3 = (globalThis as unknown as H3Global).__h3
      const f = window.__files as Record<string, Blob>
      await h3.engine.loadArchive(f.sprites as Blob, 'sprites.lod')
      const p = await h3.engine.prepareMap(f['a-36.h3m'] as Blob, 'a-36.h3m')
      if (!p.ok) return { ok: false }
      const placed = h3.engine.showPreparedMap(p.prepared, 1, { mode: 'coords', fx: 0.5, fy: 0.5 })
      await new Promise((res) => setTimeout(res, 50))
      return { ok: true, placed: placed !== undefined, pages: h3.stats().objectPages, codes: h3.engine.status().diagnostics.map((d) => d.code) }
    })
    expect(r).toMatchObject({ ok: true, placed: true, pages: 0 })
    expect((r as { codes: string[] }).codes).toContain('DATA_ARCHIVE_MISSING')
  }, 60_000)

  it('the decode cache keeps worlds and object atlases of the 8 most recent maps only (research R10)', async () => {
    await openPage()
    const counts = await session.page.evaluate(async () => {
      const h3 = (globalThis as unknown as H3Global).__h3
      const f = window.__files as Record<string, Blob>
      await h3.engine.loadArchive(f.sprites as Blob, 'sprites.lod')
      await h3.engine.loadDataArchive(f.data as Blob, 'data.lod')
      for (let i = 0; i < 10; i++) {
        const p = await h3.engine.prepareMap(f[`lru-${i}.h3m`] as Blob, `lru-${i}.h3m`)
        if (p.ok) h3.engine.showPreparedMap(p.prepared, 0, { mode: 'coords', fx: 0.5, fy: 0.5 })
      }
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('h3dynam')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const count = (store: string) =>
        new Promise<number>((res, rej) => {
          const r = db.transaction(store, 'readonly').objectStore(store).count()
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        })
      const out = { world: await count('world'), objects: await count('objects'), recent: await count('recent'), atlas: await count('atlas') }
      db.close()
      return out
    })
    // Earlier tests on this page cached a few more maps; all of them count towards the bound.
    expect(counts.recent).toBe(8)
    expect(counts.world).toBe(8)
    expect(counts.objects).toBe(8)
    expect(counts.atlas).toBeGreaterThan(0)
  }, 120_000)
})
