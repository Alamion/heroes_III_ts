/// <reference lib="dom" />
// Host invariants 1–10 (spec 004 contracts/host-bridge.md): checked through a host driver against a
// built package in headless Chromium.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { en, format } from '../../../src/adapters/shared/strings.ts'
import { log } from '../../../src/core/util/log.ts'
import { encodePng } from '../../shared/png.ts'
import type { HeadlessRenderer } from '../../shared/render-page.ts'
import type { HostDriver, HostFiles, HostPage } from './drivers.ts'
import { setHidden } from './drivers.ts'

export interface InvariantResult {
  id: number
  name: string
  outcome: 'pass' | 'fail' | 'skip'
  details: string[]
}

export interface FileSet {
  spriteArchive: string
  dataArchive: string
  map: string
  bad: { hotaMap: string; truncatedMap: string; randomBytes: string; missing: string }
}

interface Snapshot {
  phase: string
  slots: Record<string, { status: string; name: string | null; identity: string | null }>
  settings: Record<string, unknown>
  messages: { code: string }[]
  language: string
  view: { fx: number; fy: number } | null
  engine: { scheduledFrames: number; pendingCallbacks: number; surface: { width: number; height: number }; camera: { level: number; offsetX: number; offsetY: number; scale: number; width: number; height: number }; visible: boolean; paused: boolean } | null
}

type Wallpaper = { __h3wallpaper: { controller: { state(): Snapshot; idle(): Promise<void> }; engine(): { renderNow(a: { step: number }): boolean; setPaused(p: boolean): void } | undefined; clock: { advance(ms: number): void } | undefined }; __cspViolations: string[] }

const SEED = 20260917
const CLOCK_START = 1_000_000

export const state = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as unknown as Wallpaper).__h3wallpaper.controller.state())
const idle = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as Wallpaper).__h3wallpaper.controller.idle())
const overlayText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText)

async function waitPhase(page: Page, phase: string, timeoutMs: number): Promise<Snapshot> {
  await page.waitForFunction((p) => (window as unknown as Wallpaper).__h3wallpaper.controller.state().phase === p, phase, { timeout: timeoutMs }).catch(() => undefined)
  return state(page)
}

async function waitMessage(page: Page, code: string, timeoutMs: number): Promise<boolean> {
  return page
    .waitForFunction((c) => (window as unknown as Wallpaper).__h3wallpaper.controller.state().messages.some((m) => m.code === c), code, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

/** Draws a fixed animation step with the host page's engine and reads it back (rows top first). */
async function pageFrame(page: Page): Promise<{ width: number; height: number; rgba: Uint8Array; camera: NonNullable<Snapshot['engine']>['camera'] }> {
  const r = await page.evaluate(() => {
    const w = (window as unknown as Wallpaper).__h3wallpaper
    const engine = w.engine()
    if (engine === undefined) throw new Error('no engine')
    engine.setPaused(true)
    engine.renderNow({ step: 3 })
    const canvas = document.getElementById('map') as HTMLCanvasElement
    const gl = canvas.getContext('webgl') as WebGLRenderingContext
    const px = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const row = canvas.width * 4
    const flipped = new Uint8Array(px.length)
    for (let y = 0; y < canvas.height; y++) flipped.set(px.subarray((canvas.height - 1 - y) * row, (canvas.height - y) * row), y * row)
    let bin = ''
    for (let i = 0; i < flipped.length; i += 0x8000) bin += String.fromCharCode(...flipped.subarray(i, i + 0x8000))
    return { width: canvas.width, height: canvas.height, base64: btoa(bin), camera: w.controller.state().engine?.camera }
  })
  if (r.camera === undefined) throw new Error('no camera')
  return { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.base64, 'base64')), camera: r.camera }
}

export interface InvariantContext {
  driver: HostDriver
  files: FileSet
  renderer: HeadlessRenderer | undefined
  reportDir: string
}

type Check = (ctx: InvariantContext, hp: HostPage, fail: (msg: string) => void) => Promise<void>

const all = (files: FileSet): HostFiles => ({ spriteArchive: files.spriteArchive, dataArchive: files.dataArchive, map: files.map })

async function loaded(ctx: InvariantContext, hp: HostPage, fail: (m: string) => void): Promise<Snapshot> {
  await ctx.driver.supplyFiles(hp, all(ctx.files))
  // All three files loaded (the data archive may arrive after the map is already shown).
  await hp.page
    .waitForFunction(() => {
      const st = (window as unknown as Wallpaper).__h3wallpaper.controller.state()
      return st.phase === 'showing' && Object.values(st.slots).every((x) => x.status === 'loaded')
    }, null, { timeout: 60_000 })
    .catch(() => undefined)
  await idle(hp.page)
  const s = await state(hp.page)
  if (s.phase !== 'showing') fail(`not showing after files: phase ${s.phase}, messages ${JSON.stringify(s.messages)}`)
  return s
}

const CHECKS: { id: number; name: string; run: Check; hosts?: readonly string[]; opts?: { locale?: string; noCache?: boolean } }[] = [
  {
    id: 1,
    name: 'placeholder without files, no frames',
    run: async (_ctx, hp, fail) => {
      await hp.page.waitForTimeout(800)
      const s = await state(hp.page)
      if (s.phase !== 'waiting') fail(`phase ${s.phase}`)
      if ((s.engine?.scheduledFrames ?? 0) !== 0) fail(`${s.engine?.scheduledFrames} frames drawn without files`)
      if ((s.engine?.pendingCallbacks ?? 0) !== 0) fail(`${s.engine?.pendingCallbacks} callbacks pending without files`)
      const text = await overlayText(hp.page)
      if (!text.includes(en.placeholder_title)) fail('placeholder title not shown')
    },
  },
  {
    id: 2,
    name: 'files load; ×1 frame equals the engine render',
    run: async (ctx, hp, fail) => {
      await loaded(ctx, hp, fail)
      await ctx.driver.setSettings(hp, { viewmode: 'coords', viewx: 30, viewy: 40 })
      await idle(hp.page)
      if (ctx.renderer === undefined) return
      const frame = await pageFrame(hp.page)
      const ref = await ctx.renderer.render({
        archive: ctx.files.spriteArchive,
        map: ctx.files.map,
        dataArchive: ctx.files.dataArchive,
        width: frame.width,
        height: frame.height,
        level: frame.camera.level,
        originTile: { x: 0, y: 0 },
        originPixel: { x: -frame.camera.offsetX, y: -frame.camera.offsetY },
        step: 3,
      })
      let differing = 0
      for (let i = 0; i < ref.rgba.length; i += 4) if (ref.rgba[i] !== frame.rgba[i] || ref.rgba[i + 1] !== frame.rgba[i + 1] || ref.rgba[i + 2] !== frame.rgba[i + 2]) differing++
      if (differing > 0) {
        fail(`${differing} pixels differ from the engine render`)
        writeFileSync(join(ctx.reportDir, `${ctx.driver.host}-host.png`), encodePng({ width: frame.width, height: frame.height, channels: 4, data: frame.rgba }))
        writeFileSync(join(ctx.reportDir, `${ctx.driver.host}-engine.png`), encodePng({ width: frame.width, height: frame.height, channels: 4, data: ref.rgba }))
      }
    },
  },
  {
    id: 3,
    name: 'paused or hidden: no frames, no callbacks',
    run: async (ctx, hp, fail) => {
      await loaded(ctx, hp, fail)
      for (const how of ['host', 'hidden'] as const) {
        if (how === 'host') await ctx.driver.setPaused(hp, true)
        else await setHidden(hp.page, true)
        await hp.page.waitForTimeout(100)
        const a = await state(hp.page)
        await hp.page.evaluate(() => (window as unknown as Wallpaper).__h3wallpaper.clock?.advance(5000))
        await hp.page.waitForTimeout(2000)
        const b = await state(hp.page)
        if ((a.engine?.pendingCallbacks ?? 1) !== 0) fail(`${how}: ${a.engine?.pendingCallbacks} callbacks pending`)
        if (b.engine?.scheduledFrames !== a.engine?.scheduledFrames) fail(`${how}: frames drawn while inactive`)
        if (how === 'host') await ctx.driver.setPaused(hp, false)
        else await setHidden(hp.page, false)
        await hp.page.waitForTimeout(200)
        const c = await state(hp.page)
        if ((c.engine?.scheduledFrames ?? 0) <= (b.engine?.scheduledFrames ?? 0)) fail(`${how}: no frame after resume`)
      }
    },
  },
  {
    id: 4,
    name: 'settings apply live without re-decoding',
    run: async (ctx, hp, fail) => {
      const s0 = await loaded(ctx, hp, fail)
      await hp.page.evaluate(() => {
        const w = window as unknown as Wallpaper & { __phases: string[] }
        w.__phases = []
        setInterval(() => w.__phases.push(w.__h3wallpaper.controller.state().phase), 20)
      })
      const t0 = Date.now()
      await ctx.driver.setSettings(hp, { scale: 2, level: 'underground', objects: false, viewmode: 'centre' })
      await idle(hp.page)
      const s1 = await state(hp.page)
      if (Date.now() - t0 > 1000 + 500) fail(`settings took ${Date.now() - t0} ms`)
      if (s1.engine?.camera.scale !== 2) fail(`scale ${s1.engine?.camera.scale}`)
      if (s1.engine?.camera.level !== 1) fail(`level ${s1.engine?.camera.level}`)
      if (s1.settings.objects !== false) fail('objects still on')
      for (const slot of ['spriteArchive', 'dataArchive', 'map']) if (s1.slots[slot]?.identity !== s0.slots[slot]?.identity) fail(`${slot} reloaded`)
      const phases = await hp.page.evaluate(() => (window as unknown as { __phases: string[] }).__phases)
      if (phases.some((p) => p !== 'showing')) fail(`left the map while applying settings: ${[...new Set(phases)].join(',')}`)
    },
  },
  {
    id: 4.1,
    name: '"new random place" control moves the view without re-decoding',
    run: async (ctx, hp, fail) => {
      const s0 = await loaded(ctx, hp, fail)
      let previous = s0.view
      for (let i = 0; i < 2; i++) {
        await ctx.driver.newRandomPlace(hp)
        await hp.page.waitForFunction((v) => JSON.stringify((window as unknown as Wallpaper).__h3wallpaper.controller.state().view) !== v, JSON.stringify(previous), { timeout: 3000 }).catch(() => fail(`click ${i + 1}: view did not change`))
        await idle(hp.page)
        const s = await state(hp.page)
        for (const slot of ['spriteArchive', 'dataArchive', 'map']) if (s.slots[slot]?.identity !== s0.slots[slot]?.identity) fail(`${slot} reloaded`)
        previous = s.view
      }
    },
  },
  {
    id: 5,
    name: 'Russian texts for ru-RU',
    opts: { locale: 'ru-RU' },
    run: async (ctx, hp, fail) => {
      await ctx.driver.setLanguage?.(hp, 'ru-RU')
      await hp.page.waitForTimeout(300)
      const text = await overlayText(hp.page)
      if (!text.includes(format('ru', 'placeholder_title'))) fail('Russian placeholder not shown')
      if (text.includes(en.placeholder_hint)) fail('English hint shown')
      const s = await state(hp.page)
      if (s.language !== 'ru') fail(`language ${s.language}`)
    },
  },
  {
    id: 5.1,
    name: 'English texts for de-DE',
    opts: { locale: 'de-DE' },
    run: async (ctx, hp, fail) => {
      await ctx.driver.setLanguage?.(hp, 'de-DE')
      await hp.page.waitForTimeout(300)
      const text = await overlayText(hp.page)
      if (!text.includes(en.placeholder_title)) fail('English placeholder not shown')
    },
  },
  {
    id: 6,
    name: 'bad files produce messages, page stays responsive',
    run: async (ctx, hp, fail) => {
      const bad = ctx.files.bad
      const cases: [HostFiles, string][] = [
        [{ map: bad.hotaMap }, 'UNSUPPORTED_MAP'],
        [{ spriteArchive: bad.randomBytes }, 'UNKNOWN_FILE'],
        [{ spriteArchive: ctx.files.spriteArchive, map: bad.truncatedMap }, 'CORRUPT_FILE'],
      ]
      if (ctx.driver.supportsMissingPath) cases.push([{ dataArchive: bad.missing }, 'FILE_MISSING'])
      for (const [files, code] of cases) {
        await ctx.driver.supplyFiles(hp, files)
        if (!(await waitMessage(hp.page, code, 10_000))) fail(`no ${code} for ${JSON.stringify(files)}; messages ${JSON.stringify((await state(hp.page)).messages)}`)
      }
      const t = Date.now()
      await hp.page.evaluate(() => 1 + 1)
      if (Date.now() - t > 1000) fail('page unresponsive')
    },
  },
  {
    id: 7,
    name: 'surface within viewport × DPR',
    run: async (ctx, hp, fail) => {
      await loaded(ctx, hp, fail)
      for (const size of [{ width: 800, height: 600 }, { width: 320, height: 200 }]) {
        await hp.page.setViewportSize(size)
        await ctx.driver.setSettings(hp, { scale: 3 })
        await idle(hp.page)
        await hp.page.waitForTimeout(300)
        const s = await state(hp.page)
        const surface = s.engine?.surface
        if (surface === undefined || surface.width > size.width || surface.height > size.height) fail(`surface ${JSON.stringify(surface)} for viewport ${JSON.stringify(size)}`)
      }
    },
  },
  {
    id: 8,
    name: 'one catch-up frame after a clock jump',
    run: async (ctx, hp, fail) => {
      await loaded(ctx, hp, fail)
      await hp.page.waitForTimeout(500)
      const a = await state(hp.page)
      await hp.page.evaluate(() => (window as unknown as Wallpaper).__h3wallpaper.clock?.advance(600_000))
      await hp.page.waitForTimeout(1500)
      const b = await state(hp.page)
      const drawn = (b.engine?.scheduledFrames ?? 0) - (a.engine?.scheduledFrames ?? 0)
      if (drawn !== 1) fail(`${drawn} frames after a 10 min clock jump`)
    },
  },
  {
    id: 9,
    name: 'works without IndexedDB',
    opts: { noCache: true },
    run: async (ctx, hp, fail) => {
      const t0 = Date.now()
      await loaded(ctx, hp, fail)
      const took = Date.now() - t0
      await idle(hp.page)
      const messages = (await state(hp.page)).messages.map((m) => m.code)
      // The slow-start explanation is expected only when the start exceeded the warm-start budget.
      const allowed = took > 2000 ? ['CACHE_UNAVAILABLE'] : []
      const unexpected = messages.filter((c) => !allowed.includes(c))
      if (unexpected.length > 0) fail(`messages ${JSON.stringify(unexpected)} after a ${took} ms start`)
    },
  },
  {
    id: 10,
    name: 'no CSP violations',
    run: async (ctx, hp, fail) => {
      await loaded(ctx, hp, fail)
      const v = await hp.page.evaluate(() => (window as unknown as Wallpaper).__cspViolations)
      if (v.length > 0) fail(`CSP violations: ${v.join('; ')}`)
    },
  },
  {
    id: 11,
    name: 'browser: remembered files survive a reload; forget returns the placeholder',
    hosts: ['web'],
    run: async (ctx, hp, fail) => {
      await loaded(ctx, hp, fail)
      await hp.page.evaluate(() => (window as unknown as Wallpaper).__h3wallpaper.controller.idle())
      await hp.page.reload()
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      const s = await waitPhase(hp.page, 'showing', 10_000)
      if (s.phase !== 'showing') fail(`not showing after reload: ${s.phase}`)
      await hp.page.click('#h3p-forget', { force: true })
      const w = await waitPhase(hp.page, 'waiting', 5_000)
      if (w.phase !== 'waiting') fail(`not waiting after forget: ${w.phase}`)
      await hp.page.reload()
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      await hp.page.waitForTimeout(800)
      const r = await state(hp.page)
      if (r.phase !== 'waiting') fail(`files came back after forget: ${r.phase}`)
    },
  },
]

export async function runInvariants(ctx: InvariantContext): Promise<InvariantResult[]> {
  const results: InvariantResult[] = []
  for (const check of CHECKS) {
    if (check.hosts !== undefined && !check.hosts.includes(ctx.driver.host)) continue
    const details: string[] = []
    let hp: HostPage | undefined
    try {
      hp = await ctx.driver.open({ seed: SEED, clockMs: CLOCK_START, locale: check.opts?.locale ?? 'en-US', ...(check.opts?.noCache === true ? { noCache: true } : {}) })
      await check.run(ctx, hp, (m) => details.push(m))
      const csp = await hp.page.evaluate(() => (window as unknown as Wallpaper).__cspViolations)
      if (check.id !== 10 && csp.length > 0) details.push(`CSP violations: ${csp.join('; ')}`)
    } catch (err) {
      details.push(`error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      await hp?.close().catch((err: unknown) => details.push(`page closed unexpectedly: ${err instanceof Error ? err.message : String(err)}`))
    }
    log.info(`${ctx.driver.host} invariant ${check.id}: ${details.length === 0 ? 'pass' : details.join('; ').slice(0, 300)}`)
    results.push({ id: check.id, name: check.name, outcome: details.length === 0 ? 'pass' : 'fail', details })
  }
  return results
}
