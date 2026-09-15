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
}

export interface RenderResult {
  ok: boolean
  error?: unknown
  /** RGBA pixels, row 0 at the top, base64. */
  rgbaBase64?: string
  stats?: ReturnType<Engine['stats']>
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
let loaded: { archive: string; map: string } | undefined

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
    if (engine === undefined) {
      // A manual scheduler host: checks draw explicitly with renderNow.
      engine = createEngine({
        canvas,
        preserveDrawingBuffer: true,
        useWorker: p.useWorker ?? true,
        cache: p.cache ?? false,
        logger: { level: 'warn' },
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
    loaded = { archive: p.archiveUrl, map: p.mapUrl }
    e.setMapping(p.level, p.originTile, p.originPixel)
    const drawn = e.renderNow(p.step !== undefined ? { step: p.step } : { timeMs: p.timeMs ?? 0 })
    if (!drawn) return { ok: false, error: 'renderer not ready' }
    const gl = canvas.getContext('webgl') as WebGLRenderingContext
    const pixels = new Uint8Array(p.width * p.height * 4)
    gl.readPixels(0, 0, p.width, p.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    // readPixels returns rows bottom-up.
    const flipped = new Uint8Array(pixels.length)
    const row = p.width * 4
    for (let y = 0; y < p.height; y++) flipped.set(pixels.subarray((p.height - 1 - y) * row, (p.height - y) * row), y * row)
    return { ok: true, rgbaBase64: toBase64(flipped), stats: e.stats() }
  },
}
