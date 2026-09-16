// Render page for headless checks (contracts/engine-api.md "Render-to-image entry"): renders one
// frame for given files, level, mapping and animation step, then exposes the pixels.

import { createEngine } from '../../runtime/engine.ts'
import type { Engine } from '../../runtime/engine.ts'

export interface RenderParams {
  archiveUrl: string
  mapUrl: string
  archiveName: string
  mapName: string
  width: number
  height: number
  level: number
  originTile: { x: number; y: number }
  originPixel: { x: number; y: number }
  step?: number
  timeMs?: number
  useWorker?: boolean
  cache?: boolean
  /** h3bitmap.lod; objects are drawn only with it. */
  dataArchiveUrl?: string
  dataArchiveName?: string
  seed?: number
  /** Object tick (default: the palette step). */
  tick?: number
  /** false: terrain only. */
  objects?: boolean
  /** Frame overrides as [render-object index, frame] pairs (fidelity state search). */
  objectFrames?: [number, number][]
  drawList?: boolean
}

export interface RenderResult {
  ok: boolean
  error?: unknown
  /** RGBA pixels, row 0 at the top, base64. */
  rgbaBase64?: string
  stats?: ReturnType<Engine['stats']>
  drawList?: ReturnType<Engine['drawList']>
  diagnostics?: ReturnType<Engine['status']>['diagnostics']
}

declare global {
  interface Window {
    __h3render?: {
      render(params: RenderParams): Promise<RenderResult>
      engine(): Engine | undefined
    }
  }
}

const canvas = document.getElementById('map') as HTMLCanvasElement
let engine: Engine | undefined
let loaded: { archive: string; map: string; data: string | undefined } | undefined
let engineSeed: number | undefined

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
  return res.blob()
}

window.__h3render = {
  engine: () => engine,
  async render(p: RenderParams): Promise<RenderResult> {
    canvas.style.width = `${p.width}px`
    canvas.style.height = `${p.height}px`
    const seed = p.seed ?? 1
    if (engine !== undefined && engineSeed !== seed) {
      engine.dispose()
      engine = undefined
      loaded = undefined
    }
    if (engine === undefined) {
      engineSeed = seed
      // A manual scheduler host: checks draw explicitly with renderNow.
      engine = createEngine({
        canvas,
        preserveDrawingBuffer: true,
        useWorker: p.useWorker ?? true,
        cache: p.cache ?? false,
        logger: { level: 'warn' },
        seed,
        schedulerHost: { requestFrame: () => 0, cancelFrame: () => {}, setTimer: () => 0, clearTimer: () => {} },
      })
    }
    const e = engine
    e.resize(p.width, p.height, 1)
    if (loaded?.archive !== p.archiveUrl) {
      const r = await e.loadArchive(await fetchBlob(p.archiveUrl), p.archiveName)
      if (!r.ok) return { ok: false, error: r.error }
    }
    if (loaded?.map !== p.mapUrl) {
      const r = await e.loadMap(await fetchBlob(p.mapUrl), p.mapName)
      if (!r.ok) return { ok: false, error: r.error }
    }
    if (p.dataArchiveUrl !== undefined && loaded?.data !== p.dataArchiveUrl) {
      const r = await e.loadDataArchive(await fetchBlob(p.dataArchiveUrl), p.dataArchiveName ?? 'h3bitmap.lod')
      if (!r.ok) return { ok: false, error: r.error }
    }
    loaded = { archive: p.archiveUrl, map: p.mapUrl, data: p.dataArchiveUrl }
    e.setObjectsVisible(p.objects !== false)
    e.setMapping(p.level, p.originTile, p.originPixel)
    const anim =
      p.step !== undefined
        ? { step: p.step, ...(p.tick !== undefined ? { tick: p.tick } : {}), ...(p.objectFrames !== undefined ? { objectFrames: new Map(p.objectFrames) } : {}) }
        : { timeMs: p.timeMs ?? 0 }
    const drawn = e.renderNow(anim)
    if (!drawn) return { ok: false, error: 'renderer not ready' }
    const gl = canvas.getContext('webgl') as WebGLRenderingContext
    const pixels = new Uint8Array(p.width * p.height * 4)
    gl.readPixels(0, 0, p.width, p.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    // readPixels returns rows bottom-up.
    const flipped = new Uint8Array(pixels.length)
    const row = p.width * 4
    for (let y = 0; y < p.height; y++) flipped.set(pixels.subarray((p.height - 1 - y) * row, (p.height - y) * row), y * row)
    return { ok: true, rgbaBase64: toBase64(flipped), stats: e.stats(), diagnostics: e.status().diagnostics, ...(p.drawList === true ? { drawList: e.drawList() } : {}) }
  },
}
