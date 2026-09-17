// Drives the render page (src/adapters/dev-harness/render.html) in headless Chromium: loads game
// files by request interception and returns RGBA frames.

import { basename } from 'node:path'
import { exposeFiles, openSession } from './browser.ts'
import type { HeadlessSession } from './browser.ts'
import { TOOL_ERROR_CODES, ToolError } from './errors.ts'
import { resolveGameFile } from './game-files.ts'

/** A game file path, or null when it is not installed (no skip message). */
function requireGameFileQuiet(name: string): string | null {
  try {
    return resolveGameFile(name)
  } catch {
    return null
  }
}

/** The render page's global (see src/adapters/dev-harness/render.ts); tools have no DOM types. */
interface RenderPageGlobal {
  __h3render: {
    render(p: Record<string, unknown>): Promise<{ ok: boolean; error?: unknown; rgbaBase64?: string; stats?: unknown; drawList?: unknown; diagnostics?: unknown }>
  }
}

export interface RenderRequest {
  archive: string
  map: string
  width: number
  height: number
  level: number
  originTile: { x: number; y: number }
  originPixel: { x: number; y: number }
  step?: number
  timeMs?: number
  /** h3bitmap.lod for objects; default: found in the game install, or none (terrain only). */
  dataArchive?: string | null
  seed?: number
  tick?: number
  objects?: boolean
  objectFrames?: [number, number][]
  drawList?: boolean
  /** Device pixels per world pixel (default 1). */
  scale?: number
}

export interface RenderedFrame {
  width: number
  height: number
  rgba: Uint8Array
  stats: Record<string, unknown>
  drawList?: Record<string, unknown>[]
  diagnostics?: Record<string, unknown>[]
}

export class HeadlessRenderer {
  private readonly session: HeadlessSession
  private readonly routes = new Map<string, string>()

  private constructor(session: HeadlessSession) {
    this.session = session
  }

  static async open(opts: { mode?: 'dev' | 'preview'; rebuild?: boolean; width?: number; height?: number } = {}): Promise<HeadlessRenderer> {
    const session = await openSession({ mode: opts.mode ?? 'preview', viewport: { width: opts.width ?? 800, height: opts.height ?? 600 }, ...(opts.rebuild !== undefined ? { rebuild: opts.rebuild } : {}) })
    return new HeadlessRenderer(session)
  }

  private async route(file: string): Promise<string> {
    let r = this.routes.get(file)
    if (r === undefined) {
      const map = await exposeFiles(this.session.context, [file])
      r = map.get(file) as string
      // Each exposeFiles call registers its own route; keep all of them.
      this.routes.set(file, r)
    }
    return r
  }

  async render(req: RenderRequest): Promise<RenderedFrame> {
    const { page, server } = this.session
    if (!page.url().includes('render.html')) {
      await page.goto(new URL('render.html', server.url).toString())
      await page.waitForFunction(() => (globalThis as unknown as RenderPageGlobal).__h3render !== undefined)
    }
    const archiveUrl = await this.route(req.archive)
    const mapUrl = await this.route(req.map)
    const dataPath = req.dataArchive === undefined ? requireGameFileQuiet('h3bitmap.lod') : req.dataArchive
    const dataUrl = dataPath === null ? undefined : await this.route(dataPath)
    const result = await page.evaluate(
      (p) => (globalThis as unknown as RenderPageGlobal).__h3render.render(p),
      {
        archiveUrl,
        mapUrl,
        archiveName: basename(req.archive),
        mapName: basename(req.map),
        width: req.width,
        height: req.height,
        level: req.level,
        originTile: req.originTile,
        originPixel: req.originPixel,
        ...(req.step !== undefined ? { step: req.step } : {}),
        ...(req.timeMs !== undefined ? { timeMs: req.timeMs } : {}),
        ...(dataUrl !== undefined && dataPath !== null ? { dataArchiveUrl: dataUrl, dataArchiveName: basename(dataPath) } : {}),
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        ...(req.tick !== undefined ? { tick: req.tick } : {}),
        ...(req.objects !== undefined ? { objects: req.objects } : {}),
        ...(req.objectFrames !== undefined ? { objectFrames: req.objectFrames } : {}),
        ...(req.drawList === true ? { drawList: true } : {}),
        ...(req.scale !== undefined ? { scale: req.scale } : {}),
      },
    )
    if (!result.ok || result.rgbaBase64 === undefined) {
      throw new ToolError(TOOL_ERROR_CODES.FAILED, `render page failed: ${JSON.stringify(result.error)}`)
    }
    return {
      width: req.width,
      height: req.height,
      rgba: new Uint8Array(Buffer.from(result.rgbaBase64, 'base64')),
      stats: (result.stats ?? {}) as Record<string, unknown>,
      ...(Array.isArray(result.drawList) ? { drawList: result.drawList as Record<string, unknown>[] } : {}),
      ...(Array.isArray(result.diagnostics) ? { diagnostics: result.diagnostics as Record<string, unknown>[] } : {}),
    }
  }

  async close(): Promise<void> {
    await this.session.close()
  }
}
