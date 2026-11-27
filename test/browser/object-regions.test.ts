// Spec 010 first runtime scenario: actual module worker, regional navigation and pixel oracle.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Engine } from '../../src/runtime/engine.ts'
import { exposeFiles, hasChromium, openSession } from '../../tools/shared/browser.ts'
import type { HeadlessSession } from '../../tools/shared/browser.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'
import { hotaArchivePath, requireGameFile } from '../../tools/shared/game-files.ts'

declare global {
  interface Window {
    __regionalEngine?: Engine
    __wholeEngine?: Engine
    __regionFiles?: Record<string, Blob>
    __regionReferenceCanvas?: HTMLCanvasElement
    __createRegionalEngine?: typeof import('../../src/runtime/engine.ts')['createEngine']
  }
}

const chromium = hasChromium()
if (!chromium) process.stderr.write('[region browser test skipped] Chromium not found (set H3_CHROMIUM)\n')

async function initializeEngines(session: HeadlessSession, entries: [string, string][], width = 640, height = 480, persistent = false) {
  await session.page.goto(new URL('render.html', session.server.url).toString())
  // A page-side module import must not be rewritten by Vitest's server-side transformer.
  const moduleUrl = new URL(`/@fs${resolve('src/runtime/engine.ts')}`, session.server.url).toString()
  await session.page.evaluate(`import(${JSON.stringify(moduleUrl)}).then(m => { window.__createRegionalEngine = m.createEngine })`)
  await session.page.evaluate(async ({ entries, width, height, persistent }) => {
    const createEngine = window.__createRegionalEngine!
    const blobs: Record<string, Blob> = {}
    for (const [name, url] of entries) blobs[name] = await (await fetch(url)).blob()
    window.__regionFiles = blobs
    const canvas = document.getElementById('map') as HTMLCanvasElement
    window.__regionReferenceCanvas = document.createElement('canvas')
    for (const regional of [true, false]) {
      const e = createEngine({
        canvas: regional ? canvas : window.__regionReferenceCanvas,
        objectRegions: regional, preserveDrawingBuffer: true, cache: regional && persistent, seed: 71,
      })
      e.resize(width, height, 1)
      e.setPaused(true)
      if (regional) window.__regionalEngine = e
      else window.__wholeEngine = e
      if (blobs.hota !== undefined) {
        const r = await e.loadHotaArchive(blobs.hota, 'HotA.lod')
        if (!r.ok) throw new Error(JSON.stringify(r.error))
      }
      for (const [method, file] of [
        ['loadArchive', 'sprites'], ['loadDataArchive', 'data'], ['loadMap', 'map'],
      ] as const) {
        const r = await e[method](blobs[file]!, file)
        if (!r.ok) throw new Error(JSON.stringify(r.error))
      }
    }
  }, { entries, width, height, persistent })
  mkdirSync('check-reports/region-atlas', { recursive: true })
}

async function compareView(session: HeadlessSession, level: number, x: number, y: number) {
  await session.page.evaluate(({ level, x, y }) => {
    for (const e of [window.__regionalEngine!, window.__wholeEngine!]) e.setMapping(level, { x, y }, { x: 0, y: 0 })
  }, { level, x, y })
  await session.page.waitForFunction(() => window.__regionalEngine?.stats().objectRegionPending === false)
  return session.page.evaluate(async () => {
    const engines = [window.__regionalEngine!, window.__wholeEngine!]
    const digests: string[] = []
    for (const e of engines) {
      if (!e.renderNow({ step: 3, tick: 7 })) throw new Error('view not ready')
      const canvas = e === window.__regionalEngine
        ? document.getElementById('map') as HTMLCanvasElement
        : window.__regionReferenceCanvas!
      const gl = canvas.getContext('webgl')!
      const bytes = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      digests.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(','))
    }
    return { regional: engines[0]!.stats(), whole: engines[1]!.stats(), digests }
  })
}

describe.skipIf(!chromium)('regional objects in the actual engine', () => {
  let session: HeadlessSession
  let files: ReturnType<typeof writeSyntheticFiles>

  beforeAll(async () => {
    files = writeSyntheticFiles([
      { name: 'regions.h3m', size: 72, underground: true },
      { name: 'next.h3m', size: 36, underground: true },
    ])
    session = await openSession({ mode: 'dev', viewport: { width: 640, height: 480 } })
    const paths = [files.archive, files.dataArchive, files.maps['regions.h3m']!, files.maps['next.h3m']!]
    const urls = await exposeFiles(session.context, paths)
    await initializeEngines(session, [
      ['sprites', urls.get(paths[0]!)!], ['data', urls.get(paths[1]!)!], ['map', urls.get(paths[2]!)!],
      ['next', urls.get(paths[3]!)!],
    ], 640, 480, true)
  }, 180_000)

  afterAll(async () => {
    await session?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  const settled = () => session.page.waitForFunction(() => window.__regionalEngine?.stats().objectRegionPending === false)

  it('matches whole-map pixels across distant views and both levels', async () => {
    for (const [level, x, y] of [[0, 0, 0], [0, 35, 45], [1, 4, 4], [1, 35, 45]] as const) {
      const result = await compareView(session, level, x, y)
      expect(result.digests[0]).toBe(result.digests[1])
      expect(result.regional.objectRegion?.level).toBe(level)
      expect(result.regional.objectAtlasBytes).toBeGreaterThan(0)
      expect(result.regional.camera).toEqual(result.regional.requestedCamera)
      await session.page.screenshot({ path: `check-reports/region-atlas/synthetic-${level}-${x}-${y}.png` })
    }
  }, 180_000)

  it('keeps the old complete frame and finishes on the latest rapid request', async () => {
    const result = await session.page.evaluate(async () => {
      const e = window.__regionalEngine!
      e.renderNow({ step: 0, tick: 0 })
      const before = e.stats().camera
      e.setMapping(0, { x: 0, y: 0 }, { x: 0, y: 0 })
      const pending = e.stats()
      const rendered = e.renderNow({ step: 0, tick: 0 })
      // Let the serialized refresh post its request; worker replies are tasks, so the following
      // continuation changes the target before that first response can be applied.
      await Promise.resolve()
      for (let i = 0; i < 10; i++) e.setMapping(i % 2, { x: 3 + i * 4, y: 4 + i * 3 }, { x: 0, y: 0 })
      return { before, pending, rendered }
    })
    expect(result.pending.objectRegionPending).toBe(true)
    expect(result.pending.camera).toEqual(result.before)
    expect(result.rendered).toBe(false)
    await settled()
    const stats = await session.page.evaluate(() => window.__regionalEngine!.stats())
    expect(stats.camera.level).toBe(1)
    expect(stats.camera.offsetX).toBe(39 * 32)
    expect(stats.camera.offsetY).toBe(31 * 32)
    expect(stats.camera).toEqual(stats.requestedCamera)
  }, 120_000)

  it('prepares the future region and atomically swaps a complete folder map', async () => {
    const result = await session.page.evaluate(async () => {
      const e = window.__regionalEngine!
      const before = e.stats()
      const view = { level: 1, placement: { mode: 'coords' as const, fx: 0.25, fy: 0.75 } }
      const prepared = await e.prepareMap(window.__regionFiles!.next!, 'next.h3m', view)
      if (!prepared.ok) return { ok: false, code: prepared.error.code }
      const during = e.stats()
      const placed = e.showPreparedMap(prepared.prepared, view.level, view.placement)
      const after = e.stats()
      return { ok: true, before, during, placed, after, drawn: e.renderNow({ step: 3, tick: 7 }), map: e.status().map }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.code)
    expect(result.during!.camera).toEqual(result.before!.camera)
    expect(result.during!.objectRegion).toEqual(result.before!.objectRegion)
    expect(result.placed).toMatchObject({ level: 1 })
    expect(result.after!.objectRegion?.level).toBe(1)
    expect(result.after!.objectRegionPending).toBe(false)
    expect(result.after!.camera).toEqual(result.after!.requestedCamera)
    expect(result.drawn).toBe(true)
    expect(result.map).toBe('next.h3m')
  })

  it('loads only the requested initial region, not an unused centre atlas first', async () => {
    const result = await session.page.evaluate(async () => {
      const requests: { level: number }[] = []
      const original = Worker.prototype.postMessage
      Worker.prototype.postMessage = function (this: Worker, ...args: [message: unknown, options?: StructuredSerializeOptions | Transferable[]]) {
        const request = args[0] as { kind?: string; region?: { level: number } }
        if (request.kind === 'buildObjects' && request.region !== undefined) requests.push(request.region)
        Reflect.apply(original, this, args)
      }
      const e = window.__createRegionalEngine!({ canvas: document.createElement('canvas'), objectRegions: true, cache: false })
      try {
        const files = window.__regionFiles!
        e.resize(480, 400, 1)
        await e.loadArchive(files.sprites!, 'sprites')
        await e.loadDataArchive(files.data!, 'data')
        const loaded = await e.loadMap(files.map!, 'map', { level: 1, placement: { mode: 'coords', fx: 0.1, fy: 0.8 } })
        await e.whenViewReady()
        return { requests, loaded, stats: e.stats() }
      } finally {
        e.dispose()
        Worker.prototype.postMessage = original
      }
    })
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]!.level).toBe(1)
    expect(result.loaded).toMatchObject({ ok: true, view: { level: 1, fx: 0.1, fy: 0.8 } })
    expect(result.stats.objectRegion?.level).toBe(1)
  })

  it('rejects an off-screen preparation after the selected view changes', async () => {
    const result = await session.page.evaluate(async () => {
      const e = window.__regionalEngine!
      const before = e.stats().camera
      const prepared = await e.prepareMap(window.__regionFiles!.map!, 'regions.h3m', {
        level: 0, placement: { mode: 'coords', fx: 0, fy: 0 },
      })
      if (!prepared.ok) throw new Error(prepared.error.message)
      const placed = e.showPreparedMap(prepared.prepared, 1, { mode: 'coords', fx: 1, fy: 1 })
      return { placed, before, after: e.stats().camera, count: e.stats().preparedMaps }
    })
    expect(result.placed).toBeUndefined()
    expect(result.after).toEqual(result.before)
    expect(result.count).toBe(0)
  })

  it('settles resize/scale, restores context, and does not render while paused', async () => {
    const before = await session.page.evaluate(() => window.__regionalEngine!.stats().framesPresented)
    const result = await session.page.evaluate(async () => {
      const e = window.__regionalEngine!
      e.resize(480, 320, 1)
      e.setUserScale(2)
      const ready = await e.whenViewReady()
      return { ready, stats: e.stats() }
    })
    expect(result.ready).toBe(true)
    expect(result.stats.framesPresented).toBe(before)
    expect(result.stats.objectRegionPending).toBe(false)
    expect(result.stats.camera.width).toBe(480)
    expect(result.stats.camera.scale).toBe(2)
    await session.page.evaluate(async () => {
      const canvas = document.getElementById('map') as HTMLCanvasElement
      const extension = canvas.getContext('webgl')!.getExtension('WEBGL_lose_context')!
      await new Promise<void>((resolve) => {
        canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
        canvas.addEventListener('webglcontextlost', () => window.setTimeout(() => extension.restoreContext(), 50), { once: true })
        extension.loseContext()
      })
    })
    await session.page.waitForFunction(() => window.__regionalEngine!.status().state === 'ready')
    const restored = await session.page.evaluate(async () => {
      const e = window.__regionalEngine!
      const ready = await e.whenViewReady()
      return { ready, drawn: e.renderNow({ step: 3, tick: 7 }), stats: e.stats() }
    })
    expect(restored.ready).toBe(true)
    expect(restored.drawn).toBe(true)
    expect(restored.stats.objectRegionPending).toBe(false)
  })

  it('keeps GPU residency and persisted atlas slots bounded through twenty navigation cycles', async () => {
    const result = await session.page.evaluate(async () => {
      const e = window.__regionalEngine!
      const bytes: number[] = []
      for (let cycle = 0; cycle < 20; cycle++) {
        for (const [level, x, y] of [[0, 0, 0], [1, 10, 10]] as const) {
          e.setMapping(level, { x, y }, { x: 0, y: 0 })
          if (!(await e.whenViewReady()) || !e.renderNow({ step: 3, tick: 7 })) throw new Error('region not ready')
        }
        bytes.push(e.stats().gpuBytes)
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('h3dynam')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction('objects', 'readonly').objectStore('objects').getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      db.close()
      return { bytes, keys }
    })
    expect(result.bytes[19]).toBe(result.bytes[0])
    expect(result.keys).toHaveLength(2) // original and prepared map, one region slot each
    expect(result.keys.every((key) => String(key).includes('region-slot-v1'))).toBe(true)
    writeFileSync('check-reports/region-atlas/navigation-bounds.json', JSON.stringify(result, null, 2))
  }, 120_000)
})

const realSprites = requireGameFile('h3sprite.lod')
const realData = requireGameFile('h3bitmap.lod')
const realMap = requireGameFile('test_map_hota.h3m')
const realHota = hotaArchivePath()
const realAvailable = chromium && realSprites !== null && realData !== null && realMap !== null && realHota !== undefined
if (!realAvailable) process.stderr.write('[real region scenario skipped] Chromium and local base/data/HotA archives plus test_map_hota.h3m required\n')

describe.skipIf(!realAvailable)('regional HotA review scenario (local files)', () => {
  let session: HeadlessSession

  afterAll(async () => { await session?.close() })

  it('matches real HotA dense views on both levels with view-bound GPU residency', async () => {
    const evidence = []
    for (const width of [960, 480]) {
      session = await openSession({ mode: 'dev', viewport: { width, height: 540 } })
      const paths = [realSprites!, realData!, realMap!, realHota!]
      const urls = await exposeFiles(session.context, paths)
      await initializeEngines(session, [
        ['sprites', urls.get(paths[0]!)!], ['data', urls.get(paths[1]!)!],
        ['map', urls.get(paths[2]!)!], ['hota', urls.get(paths[3]!)!],
      ], width, 540)
      for (const [level, x, y] of [[0, 7, 65], [1, 0, 110], [1, 20, 110], [0, 70, 40]] as const) {
        const result = await compareView(session, level, x, y)
        expect(result.digests[0]).toBe(result.digests[1])
        expect(result.regional.objectRegion?.level).toBe(level)
        expect(result.regional.objectRegionPending).toBe(false)
        expect(result.regional.objectAtlasBytes).toBeLessThan(result.whole.gpuBytes)
        expect(result.regional.objectQuads).toBeGreaterThan(0)
        evidence.push({ width, level, x, y, ...result })
        await session.page.screenshot({ path: `check-reports/region-atlas/hota-${width}-${level}-${x}-${y}.png` })
      }
      await session.close()
    }
    writeFileSync('check-reports/region-atlas/hota-results.json', JSON.stringify(evidence, null, 2))
  }, 300_000)
})
