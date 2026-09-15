// Headless Chromium for render, fidelity and budget checks (research.md §2): playwright-core
// drives the system Chromium with SwiftShader WebGL, so output does not depend on the GPU.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { log } from '../../src/core/util/log.ts'
import { TOOL_ERROR_CODES, ToolError } from './errors.ts'

export const DEFAULT_CHROMIUM = '/usr/bin/chromium-browser'

export function chromiumPath(env: Record<string, string | undefined> = process.env): string {
  return env.H3_CHROMIUM ?? DEFAULT_CHROMIUM
}

export function hasChromium(env: Record<string, string | undefined> = process.env): boolean {
  return existsSync(chromiumPath(env))
}

export const SWIFTSHADER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-gpu-driver-bug-workarounds',
  '--force-color-profile=srgb',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]

export async function launchBrowser(): Promise<Browser> {
  const path = chromiumPath()
  if (!existsSync(path)) {
    throw new ToolError(TOOL_ERROR_CODES.PREREQ_MISSING, `Chromium not found at ${path} (set H3_CHROMIUM)`)
  }
  const { chromium } = await import('playwright-core')
  return chromium.launch({ executablePath: path, headless: true, args: SWIFTSHADER_ARGS })
}

export interface PageServer {
  url: string
  close(): Promise<void>
}

/**
 * Serves the harness pages. `preview` serves the production build in dist/ (built if missing
 * or when `rebuild` is set); `dev` runs the Vite dev server (no build step).
 */
export async function startServer(mode: 'dev' | 'preview', opts: { rebuild?: boolean; repoRoot?: string } = {}): Promise<PageServer> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd())
  const vite = await import('vite')
  const configFile = resolve(repoRoot, 'vite.config.ts')
  if (mode === 'preview') {
    if (opts.rebuild === true || !existsSync(resolve(repoRoot, 'dist', 'render.html'))) {
      log.info('building dist/ for headless checks')
      await vite.build({ configFile, logLevel: 'warn' })
    }
    const server = await vite.preview({ configFile, logLevel: 'warn', preview: { port: 0, host: '127.0.0.1', strictPort: false } })
    const url = server.resolvedUrls?.local[0]
    if (url === undefined) throw new ToolError(TOOL_ERROR_CODES.FAILED, 'vite preview did not report a URL')
    return { url, close: () => server.close() }
  }
  const server = await vite.createServer({ configFile, logLevel: 'warn', server: { port: 0, host: '127.0.0.1' } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new ToolError(TOOL_ERROR_CODES.FAILED, 'vite dev server did not report a URL')
  return { url, close: () => server.close() }
}

let exposeCounter = 0

/**
 * Makes local files available to the page at `<origin>/__files/<n>/<name>` without copying them
 * anywhere (request interception). Returns the URL path per file.
 */
export async function exposeFiles(context: BrowserContext, files: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const byRoute = new Map<string, string>()
  files.forEach((file) => {
    const route = `/__files/${exposeCounter++}/${encodeURIComponent(basename(file))}`
    map.set(file, route)
    byRoute.set(route, file)
  })
  await context.route('**/__files/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const file = byRoute.get(path)
    if (file === undefined) {
      // Another exposeFiles call may own this path.
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, body: await readFile(file), contentType: 'application/octet-stream' })
  })
  return map
}

export interface HeadlessSession {
  browser: Browser
  context: BrowserContext
  page: Page
  server: PageServer
  close(): Promise<void>
}

export async function openSession(opts: {
  mode: 'dev' | 'preview'
  viewport: { width: number; height: number }
  dpr?: number
  rebuild?: boolean
}): Promise<HeadlessSession> {
  const server = await startServer(opts.mode, opts.rebuild === undefined ? {} : { rebuild: opts.rebuild })
  let browser: Browser | undefined
  try {
    browser = await launchBrowser()
    const context = await browser.newContext({ viewport: opts.viewport, deviceScaleFactor: opts.dpr ?? 1 })
    const page = await context.newPage()
    page.on('console', (msg) => log.debug(`[page ${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => log.warn(`[page error] ${err.message}`))
    const b = browser
    return {
      browser: b,
      context,
      page,
      server,
      close: async () => {
        await b.close()
        await server.close()
      },
    }
  } catch (err) {
    await browser?.close()
    await server.close()
    throw err
  }
}
