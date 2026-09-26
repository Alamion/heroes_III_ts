/// <reference lib="dom" />
// Host invariants (spec 004 contracts/host-bridge.md 1–13, spec 007 contracts/host-bridge.md 14–20, spec 006: 21):
// checked through a host driver against a built package in headless Chromium.

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { en, format } from '../../../src/adapters/shared/strings.ts'
import { log } from '../../../src/core/util/log.ts'
import { encodePng } from '../../shared/png.ts'
import { mapBytes } from '../../../test/fixtures/synthetic/map-folder.ts'
import type { HeadlessRenderer } from '../../shared/render-page.ts'
import type { HostDriver, HostFiles, HostFolder, HostPage } from './drivers.ts'
import { setHidden } from './drivers.ts'
import { NEW_ISSUE_URL } from '../../../src/adapters/shared/project.ts'
import { packageVersion } from '../../package/cli.ts'

export interface InvariantResult {
  id: number
  name: string
  outcome: 'pass' | 'fail' | 'skip'
  details: string[]
  /** Wall time of the invariant, page open to close (spec 006 T066). */
  ms?: number
  /** Where the time went: page open, and waits by call site (spec 006 T066). */
  profile?: WaitProfile
}

/** Waits of one invariant, grouped by call site (file:line). */
export interface WaitProfile {
  openMs: number
  waits: { where: string; kind: 'function' | 'timeout' | 'evaluate'; count: number; ms: number; timedOut: number }[]
}

/** The first stack frame outside Playwright and this profiler: the invariant or driver line. */
function callSite(): string {
  const lines = (new Error().stack ?? '').split('\n').slice(1)
  for (const l of lines) {
    // Skip the profiler's own frames (callSite and the wrappers installed by profilePage).
    if (/callSite|p\.waitForFunction|p\.waitForTimeout|p\.evaluate/.test(l)) continue
    const m = /(tools\/checks\/hosts\/[\w.-]+\.ts):(\d+)/.exec(l)
    if (m !== null) return `${m[1]?.split('/').pop()}:${m[2]}`
  }
  return 'unknown'
}

/**
 * Wraps a page's waits so every waitForFunction, waitForTimeout and long evaluate is timed by call site,
 * and a wait that ended by its timeout — not its condition — is counted (spec 006 T066: the host
 * simulations spent most of their time waiting).
 */
function profilePage(page: Page, profile: WaitProfile): void {
  const record = (where: string, kind: WaitProfile['waits'][number]['kind'], ms: number, timedOut: boolean) => {
    let w = profile.waits.find((x) => x.where === where && x.kind === kind)
    if (w === undefined) profile.waits.push((w = { where, kind, count: 0, ms: 0, timedOut: 0 }))
    w.count++
    w.ms += ms
    if (timedOut) w.timedOut++
  }
  const p = page as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  const wff = p.waitForFunction?.bind(page) as (...a: unknown[]) => Promise<unknown>
  p.waitForFunction = async (...a: unknown[]) => {
    const where = callSite()
    const t0 = Date.now()
    try {
      const r = await wff(...a)
      record(where, 'function', Date.now() - t0, false)
      return r
    } catch (err) {
      const timedOut = err instanceof Error && /Timeout/i.test(err.name + err.message)
      record(where, 'function', Date.now() - t0, timedOut)
      throw err
    }
  }
  const wft = p.waitForTimeout?.bind(page) as (...a: unknown[]) => Promise<unknown>
  p.waitForTimeout = async (...a: unknown[]) => {
    const where = callSite()
    const t0 = Date.now()
    try {
      return await wft(...a)
    } finally {
      record(where, 'timeout', Date.now() - t0, false)
    }
  }
  const ev = p.evaluate?.bind(page) as (...a: unknown[]) => Promise<unknown>
  p.evaluate = async (...a: unknown[]) => {
    const t0 = Date.now()
    try {
      return await ev(...a)
    } finally {
      const ms = Date.now() - t0
      // Only slow evaluates are waits in disguise (controller.idle(), decodes).
      if (ms >= 500) record(callSite(), 'evaluate', ms, false)
    }
  }
}

export interface FileSet {
  spriteArchive: string
  dataArchive: string
  /** Optional HotA archive (spec 005); present only when the HotA install is configured. */
  hotaArchive?: string
  map: string
  bad: { wogMap: string; truncatedMap: string; randomBytes: string; missing: string }
  /** Spec 007: synthetic map folders (test/fixtures/synthetic/map-folder.ts HOST_FOLDERS). */
  folders: Record<'mixed' | 'five' | 'sizes' | 'half' | 'broken' | 'empty', HostFolder>
}

interface Snapshot {
  phase: string
  slots: Record<string, { status: string; name: string | null; identity: string | null }>
  settings: Record<string, unknown>
  messages: { code: string }[]
  language: string
  view: { fx: number; fy: number } | null
  source?: string
  folder?: { name: string; entries: number | null; shown: { path: string; title: string } | null; failed: number; switching: boolean } | null
  engine: { scheduledFrames: number; pendingCallbacks: number; gpuBytes?: number; preparedMaps?: number; surface: { width: number; height: number }; camera: { level: number; offsetX: number; offsetY: number; scale: number; width: number; height: number }; visible: boolean; paused: boolean } | null
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
  /** Invariant ids to run (`--only`); all when undefined. */
  only?: ReadonlySet<number>
  /** Invariants run at once (spec 006 T068); 1 = one after another. Serial invariants always run alone. */
  jobs?: number
}

type Check = (ctx: InvariantContext, hp: HostPage, fail: (msg: string) => void) => Promise<void>

const all = (files: FileSet): HostFiles => ({ spriteArchive: files.spriteArchive, dataArchive: files.dataArchive, map: files.map })

async function loaded(ctx: InvariantContext, hp: HostPage, fail: (m: string) => void): Promise<Snapshot> {
  await ctx.driver.supplyFiles(hp, all(ctx.files))
  // The three supplied files loaded (the data archive may arrive after the map is already shown). The
  // HotA slot is not supplied here and stays "missing": waiting for every slot made each call run into
  // its 60 s timeout (spec 006 T067, measured).
  await hp.page
    .waitForFunction(() => {
      const st = (window as unknown as Wallpaper).__h3wallpaper.controller.state()
      return st.phase === 'showing' && (['spriteArchive', 'dataArchive', 'map'] as const).every((k) => st.slots[k]?.status === 'loaded')
    }, null, { timeout: 60_000 })
    .catch(() => undefined)
  await idle(hp.page)
  const s = await state(hp.page)
  if (s.phase !== 'showing') fail(`not showing after files: phase ${s.phase}, messages ${JSON.stringify(s.messages)}`)
  return s
}

/** Spec 007: archives only, then a folder the host way; waits until a map of it is shown. */
async function folderShown(ctx: InvariantContext, hp: HostPage, folder: HostFolder, fail: (m: string) => void, expectShown = true): Promise<Snapshot> {
  await ctx.driver.supplyFiles(hp, { spriteArchive: ctx.files.spriteArchive, dataArchive: ctx.files.dataArchive })
  await ctx.driver.supplyFolder(hp, folder)
  await hp.page
    .waitForFunction(
      (want) => {
        const st = (window as unknown as Wallpaper).__h3wallpaper.controller.state()
        return want ? st.phase === 'showing' && st.folder?.shown != null && st.folder.switching === false : st.phase === 'problem'
      },
      expectShown,
      { timeout: 60_000 },
    )
    .catch(() => undefined)
  await idle(hp.page)
  const s = await state(hp.page)
  if (expectShown && s.folder?.shown == null) fail(`no map of the folder shown: phase ${s.phase}, folder ${JSON.stringify(s.folder)}, messages ${JSON.stringify(s.messages)}`)
  return s
}

/** Uses the host's "next map" control and waits for another map (or the same, for a one-map folder). */
async function nextShown(ctx: InvariantContext, hp: HostPage): Promise<string | undefined> {
  const before = (await state(hp.page)).folder?.shown?.path
  await ctx.driver.nextMap(hp)
  await hp.page
    .waitForFunction((b) => {
      const f = (window as unknown as Wallpaper).__h3wallpaper.controller.state().folder
      return f?.shown != null && f.shown.path !== b && !f.switching
    }, before, { timeout: 15_000 })
    .catch(() => undefined)
  await idle(hp.page)
  return (await state(hp.page)).folder?.shown?.path
}

const MIXED_USABLE = ['small.h3m', 'medium two.h3m', 'Карты/Большая.h3m', 'nested/deeper/xl.H3M', 'nested/odd.h3m']

/**
 * `serial`: the invariant measures time, frames or a race, so it runs alone after the parallel pool
 * (spec 006 T068) — a loaded CPU would make it flaky, not wrong.
 */
const CHECKS: { id: number; name: string; run: Check; hosts?: readonly string[]; serial?: boolean; opts?: { locale?: string; noCache?: boolean; readDelays?: Record<string, number>; timeScale?: number } }[] = [
  {
    id: 1,
    serial: true,
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
    serial: true,
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
    serial: true,
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
    serial: true,
    name: 'bad files produce messages, page stays responsive',
    run: async (ctx, hp, fail) => {
      const bad = ctx.files.bad
      const cases: [HostFiles, string][] = [
        // HotA maps are supported since spec 005; WoG is still an unsupported format.
        [{ map: bad.wogMap }, 'UNSUPPORTED_MAP'],
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
    serial: true,
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
  {
    id: 11.1,
    name: 'spec 007: browser: the chosen map folder survives a reload; forget clears it',
    hosts: ['web'],
    run: async (ctx, hp, fail) => {
      const s = await folderShown(ctx, hp, ctx.files.folders.five, fail)
      if (s.folder?.entries !== 5) fail(`${s.folder?.entries} maps`)
      // Remembering happens in the background after the pick.
      await hp.page.waitForTimeout(500)
      await hp.page.reload()
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      await hp.page
        .waitForFunction(() => (window as unknown as Wallpaper).__h3wallpaper.controller.state().folder?.shown != null, null, { timeout: 30_000 })
        .catch(() => undefined)
      const r = await state(hp.page)
      if (r.source !== 'folder' || r.folder?.entries !== 5 || r.phase !== 'showing') fail(`after reload: source ${String(r.source)}, folder ${JSON.stringify(r.folder)}, phase ${r.phase}`)
      await hp.page.click('#h3p-forget', { force: true })
      await waitPhase(hp.page, 'waiting', 5_000)
      await hp.page.reload()
      await hp.page.waitForFunction(() => (window as unknown as { __h3wallpaper?: unknown }).__h3wallpaper !== undefined)
      await hp.page.waitForTimeout(800)
      const f = await state(hp.page)
      if (f.folder?.entries != null && f.folder.entries > 0) fail(`the folder came back after forget: ${JSON.stringify(f.folder)}`)
    },
  },
  {
    id: 12,
    name: 'the optional HotA archive loads, and is never asked for when unset (spec 005 FR-025, FR-026)',
    run: async (ctx, hp, fail) => {
      // Unset: the placeholder lists the files it wants by their kind labels, and the optional
      // archive's label must not be among them. Read it before any file arrives, while the list is
      // shown; matching "HotA" anywhere would also hit a map's file name or the help text.
      await hp.page.waitForFunction((label) => document.body.innerText.includes(label), en.kind_spriteArchive, { timeout: 30_000 }).catch(() => undefined)
      const waiting = await overlayText(hp.page)
      if (!waiting.includes(en.kind_spriteArchive)) fail(`the placeholder does not list the missing files: ${waiting.slice(0, 200)}`)
      if (waiting.includes(en.kind_hotaArchive)) fail(`the placeholder asks for the optional HotA archive: ${waiting.slice(0, 200)}`)
      // The base-game files alone still reach 'showing'.
      await ctx.driver.supplyFiles(hp, { spriteArchive: ctx.files.spriteArchive, dataArchive: ctx.files.dataArchive, map: ctx.files.map })
      const ready = await waitPhase(hp.page, 'showing', 120_000)
      if (ready.phase !== 'showing') fail(`base-game files did not reach showing: ${ready.phase}`)
      const hota = ctx.files.hotaArchive
      if (hota === undefined) return
      await ctx.driver.supplyFiles(hp, { hotaArchive: hota })
      const loaded = await hp.page
        .waitForFunction(() => (window as unknown as Wallpaper).__h3wallpaper.controller.state().slots.hotaArchive?.status === 'loaded', undefined, { timeout: 180_000 })
        .then(() => true)
        .catch(() => false)
      if (!loaded) fail(`the HotA archive did not load: ${JSON.stringify((await state(hp.page)).slots.hotaArchive)}`)
    },
  },
  {
    id: 13,
    serial: true,
    name: 'every file setting arriving at once still resolves HotA sprites (spec 005 FR-004)',
    // The HotA archive is the largest file and could win the race by luck; holding its read back
    // makes the check fail deterministically whenever the controller loads the slots together.
    opts: { readDelays: { 'HotA.lod': 4000 } },
    run: async (ctx, hp, fail) => {
      const hota = ctx.files.hotaArchive
      if (hota === undefined) return
      // A host hands over all four file settings in one go. The HotA archive goes in front of every
      // archive set, so it has to be in place before the sprite archive is decoded; loading them
      // together used to decode without it and silently drop every HotA-only sprite (measured on a
      // real KDE session, 2026-09-23). Invariant 12 supplies the archive separately and cannot see
      // this.
      const missing: string[] = []
      hp.page.on('console', (m) => {
        const t = m.text()
        if (/sprite\(s\) not found/i.test(t)) missing.push(t.slice(0, 200))
      })
      await ctx.driver.supplyFiles(hp, { ...all(ctx.files), hotaArchive: hota })
      const shown = await waitPhase(hp.page, 'showing', 180_000)
      if (shown.phase !== 'showing') fail(`files supplied together did not reach showing: ${shown.phase}`)
      const slots = (await state(hp.page)).slots
      if (slots.hotaArchive?.status !== 'loaded') fail(`the HotA archive did not load: ${JSON.stringify(slots.hotaArchive)}`)
      await idle(hp.page)
      if (missing.length > 0) fail(`sprites unresolved although the HotA archive is loaded: ${missing[0] as string}`)
    },
  },
  {
    id: 14,
    name: 'spec 007: a map folder (or .zip) shows a random map of it; other files are ignored',
    run: async (ctx, hp, fail) => {
      const s = await folderShown(ctx, hp, ctx.files.folders.mixed, fail)
      if (s.source !== 'folder') fail(`source ${String(s.source)}`)
      if (s.folder?.entries !== MIXED_USABLE.length) fail(`${s.folder?.entries} maps listed, expected ${MIXED_USABLE.length}`)
      const shown = s.folder?.shown?.path
      if (shown === undefined || !MIXED_USABLE.includes(shown)) fail(`shown ${String(shown)} is not a usable map of the folder`)
      if (s.messages.length > 0) fail(`messages ${JSON.stringify(s.messages)}`)
      // The same seed picks the same map on a fresh page.
      const again = await ctx.driver.open({ seed: SEED, clockMs: CLOCK_START, locale: 'en-US' })
      try {
        const s2 = await folderShown(ctx, again, ctx.files.folders.mixed, fail)
        if (s2.folder?.shown?.path !== shown) fail(`same seed showed ${String(s2.folder?.shown?.path)}, first ${String(shown)}`)
      } finally {
        await again.close()
      }
    },
  },
  {
    id: 14.1,
    name: 'spec 007: a map added to the folder is a candidate after a restart',
    // Only hosts that list a folder; Wallpaper Engine takes a .zip (invariant 14.3).
    hosts: ['kde'],
    run: async (ctx, hp, fail) => {
      const dir = mkdtempSync(join(tmpdir(), 'h3-folder-'))
      try {
        cpSync(ctx.files.folders.five.dir, dir, { recursive: true })
        const s = await folderShown(ctx, hp, { dir, zip: ctx.files.folders.five.zip }, fail)
        if (s.folder?.entries !== 5) fail(`${s.folder?.entries} maps before adding one`)
        writeFileSync(join(dir, 'added.h3m'), mapBytes({ path: 'added.h3m', size: 40 }))
        const again = await ctx.driver.open({ seed: SEED, clockMs: CLOCK_START, locale: 'en-US' })
        try {
          const s2 = await folderShown(ctx, again, { dir, zip: ctx.files.folders.five.zip }, fail)
          if (s2.folder?.entries !== 6) fail(`${s2.folder?.entries} maps after adding one and restarting`)
        } finally {
          await again.close()
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  },
  {
    id: 14.2,
    name: 'spec 007: two screens rotate independently and share the decode cache without errors',
    hosts: ['kde', 'wallpaper-engine'],
    run: async (ctx, hp, fail) => {
      const errors: string[] = []
      const second = await ctx.driver.open({ seed: SEED + 1, clockMs: CLOCK_START, locale: 'en-US' })
      try {
        for (const p of [hp, second]) p.page.on('pageerror', (e) => errors.push(e.message))
        // Both screens start together, as Plasma starts one page per screen.
        const [a, b] = await Promise.all([folderShown(ctx, hp, ctx.files.folders.five, fail), folderShown(ctx, second, ctx.files.folders.five, fail)])
        if (a.phase !== 'showing' || b.phase !== 'showing') fail(`phases ${a.phase} / ${b.phase}`)
        const seqA = [a.folder?.shown?.path]
        const seqB = [b.folder?.shown?.path]
        for (let i = 0; i < 3; i++) {
          seqA.push(await nextShown(ctx, hp))
          seqB.push(await nextShown(ctx, second))
        }
        if (JSON.stringify(seqA) === JSON.stringify(seqB)) fail(`both screens showed the same sequence: ${JSON.stringify(seqA)}`)
        if (errors.length > 0) fail(`page errors: ${errors.join('; ')}`)
      } finally {
        await second.close()
      }
    },
  },
  {
    id: 14.3,
    name: 'spec 007: a folder path on Wallpaper Engine asks for a .zip at once instead of timing out',
    hosts: ['wallpaper-engine'],
    run: async (ctx, hp, fail) => {
      await ctx.driver.supplyFiles(hp, { spriteArchive: ctx.files.spriteArchive, dataArchive: ctx.files.dataArchive })
      const t0 = Date.now()
      await ctx.driver.setSettings(hp, { mapsource: 'folder', mapfolder: ctx.files.folders.five.dir })
      const shown = await waitMessage(hp.page, 'FOLDER_NEEDS_ZIP', 10_000)
      const elapsed = Date.now() - t0
      // The archives may still be loading when the message appears; the phase settles after them.
      await idle(hp.page)
      const s = await state(hp.page)
      if (!shown) fail(`no FOLDER_NEEDS_ZIP message: phase ${s.phase}, messages ${JSON.stringify(s.messages)}`)
      else if (elapsed > 5_000) fail(`the message took ${elapsed} ms`)
      if (s.phase !== 'problem') fail(`phase ${s.phase}, expected problem`)
    },
  },
  {
    id: 15,
    name: 'spec 007: "next map" shows every map once per cycle, never twice in a row',
    run: async (ctx, hp, fail) => {
      const s = await folderShown(ctx, hp, ctx.files.folders.five, fail)
      const seq = [s.folder?.shown?.path]
      for (let i = 0; i < 9; i++) seq.push(await nextShown(ctx, hp))
      for (const cycle of [seq.slice(0, 5), seq.slice(5, 10)]) if (new Set(cycle).size !== 5) fail(`a cycle repeated a map: ${JSON.stringify(seq)}`)
      for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) fail(`the same map twice in a row: ${JSON.stringify(seq)}`)
    },
  },
  {
    id: 16,
    serial: true,
    name: 'spec 007: map switches never show an empty frame; memory stays flat',
    run: async (ctx, hp, fail) => {
      await folderShown(ctx, hp, ctx.files.folders.five, fail)
      // Samples every animation frame: the phase and the centre of the canvas (preserved drawing buffer).
      await hp.page.evaluate(() => {
        const w = window as unknown as Wallpaper & { __switchSamples: { phase: string; hidden: boolean; black: boolean }[] }
        w.__switchSamples = []
        const canvas = document.getElementById('map') as HTMLCanvasElement
        const gl = canvas.getContext('webgl') as WebGLRenderingContext
        const px = new Uint8Array(8 * 8 * 4)
        const tick = () => {
          gl.readPixels(Math.floor(canvas.width / 2) - 4, Math.floor(canvas.height / 2) - 4, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px)
          let sum = 0
          for (let i = 0; i < px.length; i += 4) sum += (px[i] as number) + (px[i + 1] as number) + (px[i + 2] as number)
          w.__switchSamples.push({ phase: w.__h3wallpaper.controller.state().phase, hidden: canvas.hidden, black: sum === 0 })
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const measure = () =>
        hp.page.evaluate(async () => {
          // Retained memory: collect first (the check's browser exposes gc), then let the collector finish.
          const gc = (globalThis as unknown as { gc?: () => void }).gc
          for (let i = 0; i < 3; i++) {
            gc?.()
            await new Promise((r) => setTimeout(r, 50))
          }
          const st = (window as unknown as Wallpaper).__h3wallpaper.controller.state()
          const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          return { gpu: st.engine?.gpuBytes ?? 0, heap: mem?.usedJSHeapSize ?? 0, prepared: st.engine?.preparedMaps ?? 0 }
        })
      let first: { gpu: number; heap: number } | undefined
      for (let i = 0; i < 100; i++) {
        await nextShown(ctx, hp)
        if (i === 9) first = await measure()
      }
      const last = await measure()
      const samples = await hp.page.evaluate(() => (window as unknown as { __switchSamples: { phase: string; hidden: boolean; black: boolean }[] }).__switchSamples)
      const bad = samples.filter((x) => x.phase !== 'showing' || x.hidden || x.black)
      if (samples.length < 100) fail(`only ${samples.length} frame samples`)
      if (bad.length > 0) fail(`${bad.length} of ${samples.length} sampled frames were empty or the placeholder: ${JSON.stringify(bad.slice(0, 3))}`)
      if (last.prepared !== 0) fail(`${last.prepared} prepared maps left over`)
      if (first !== undefined && first.gpu > 0 && Math.abs(last.gpu - first.gpu) > first.gpu * 0.1) fail(`GPU memory ${first.gpu} → ${last.gpu} bytes over 90 switches`)
      if (first !== undefined && first.heap > 0 && last.heap > first.heap * 1.1) fail(`JS heap ${first.heap} → ${last.heap} bytes over 90 switches`)
    },
  },
  {
    id: 17,
    name: 'spec 007: size and underground filters; an impossible filter says so',
    run: async (ctx, hp, fail) => {
      // The browser panel shows the filters only with the folder source, so the source comes first.
      await ctx.driver.setSettings(hp, { mapsource: 'folder' })
      await ctx.driver.setSettings(hp, { mapsizemax: 's' })
      await folderShown(ctx, hp, ctx.files.folders.sizes, fail)
      const seen = new Set<string>()
      seen.add((await state(hp.page)).folder?.shown?.path ?? '')
      for (let i = 0; i < 4; i++) seen.add((await nextShown(ctx, hp)) ?? '')
      if ([...seen].some((p) => !['s1.h3m', 's2.h3m'].includes(p))) fail(`maps outside the S filter: ${[...seen].join(', ')}`)
      const other = await ctx.driver.open({ seed: SEED, clockMs: CLOCK_START, locale: 'en-US' })
      try {
        await ctx.driver.setSettings(other, { mapsource: 'folder' })
        await ctx.driver.setSettings(other, { mapsizemin: 'h' })
        await folderShown(ctx, other, ctx.files.folders.sizes, fail, false)
        if (!(await waitMessage(other.page, 'FOLDER_FILTERED', 10_000))) fail(`no FOLDER_FILTERED: ${JSON.stringify((await state(other.page)).messages)}`)
        await ctx.driver.setSettings(other, { mapsizemin: 's' })
        const s = await waitPhase(other.page, 'showing', 30_000)
        if (s.phase !== 'showing') fail(`relaxing the filter did not show a map: ${s.phase}`)
      } finally {
        await other.close()
      }
    },
  },
  {
    id: 18,
    name: 'spec 007: broken maps are skipped silently; broken-only and empty folders say so',
    run: async (ctx, hp, fail) => {
      await folderShown(ctx, hp, ctx.files.folders.half, fail)
      for (let i = 0; i < 5; i++) {
        const p = await nextShown(ctx, hp)
        if (p === undefined || !p.startsWith('good')) fail(`showed ${String(p)}`)
      }
      const msgs = (await state(hp.page)).messages
      if (msgs.length > 0) fail(`messages for skipped maps: ${JSON.stringify(msgs)}`)
      for (const [name, code] of [['broken', 'FOLDER_UNREADABLE'], ['empty', 'FOLDER_EMPTY']] as const) {
        const other = await ctx.driver.open({ seed: SEED, clockMs: CLOCK_START, locale: 'en-US' })
        try {
          await folderShown(ctx, other, ctx.files.folders[name], fail, false)
          if (!(await waitMessage(other.page, code, 15_000))) fail(`${name}: no ${code}: ${JSON.stringify((await state(other.page)).messages)}`)
        } finally {
          await other.close()
        }
      }
    },
  },
  {
    id: 19,
    serial: true,
    name: 'spec 007: the map interval counts visible time only',
    // One controller minute = 100 ms, so the interval of 1 minute can be watched.
    opts: { timeScale: 1 / 600 },
    run: async (ctx, hp, fail) => {
      await folderShown(ctx, hp, ctx.files.folders.five, fail)
      await ctx.driver.setSettings(hp, { maprotation: 1 })
      await hp.page.evaluate(() => {
        const w = window as unknown as Wallpaper & { __shownLog: string[] }
        w.__shownLog = []
        setInterval(() => {
          const p = w.__h3wallpaper.controller.state().folder?.shown?.path ?? ''
          if (w.__shownLog.at(-1) !== p) w.__shownLog.push(p)
        }, 10)
      })
      await hp.page.waitForTimeout(1200)
      const visible = await hp.page.evaluate(() => (window as unknown as { __shownLog: string[] }).__shownLog.length)
      if (visible < 3) fail(`only ${visible - 1} map changes in 1.2 s at a 100 ms interval`)
      for (const how of ['host', 'hidden'] as const) {
        if (how === 'host') await ctx.driver.setPaused(hp, true)
        else await setHidden(hp.page, true)
        // A switch that started while visible may still finish; only new switches count (spec 006 T067:
        // a fixed 150 ms made this race-prone under load).
        await hp.page
          .waitForFunction(() => (window as unknown as Wallpaper).__h3wallpaper.controller.state().folder?.switching === false, null, { timeout: 5_000 })
          .catch(() => undefined)
        await hp.page.waitForTimeout(150)
        const a = await hp.page.evaluate(() => (window as unknown as { __shownLog: string[] }).__shownLog.length)
        await hp.page.waitForTimeout(1000)
        const b = await hp.page.evaluate(() => (window as unknown as { __shownLog: string[] }).__shownLog.length)
        if (b !== a) fail(`${how}: ${b - a} map change(s) while not visible`)
        if (how === 'host') await ctx.driver.setPaused(hp, false)
        else await setHidden(hp.page, false)
        await hp.page.waitForTimeout(600)
        const c = await hp.page.evaluate(() => (window as unknown as { __shownLog: string[] }).__shownLog.length)
        if (c <= b) fail(`${how}: no map change after becoming visible again`)
      }
    },
  },
  {
    id: 20,
    name: 'spec 007: settings of the previous version keep the single map',
    run: async (ctx, hp, fail) => {
      const s = await loaded(ctx, hp, fail)
      if (s.source !== 'single') fail(`source ${String(s.source)}`)
      if (s.folder !== null && s.folder !== undefined) fail(`a folder is open: ${JSON.stringify(s.folder)}`)
      if (s.slots.map?.status !== 'loaded') fail(`map ${JSON.stringify(s.slots.map)}`)
    },
  },
  {
    id: 21,
    name: 'spec 006: the browser panel shows the version and links the issue forms',
    hosts: ['web'],
    run: async (_ctx, hp, fail) => {
      const version = packageVersion(process.cwd())
      const footer = await hp.page.locator('.h3p-footer').textContent({ timeout: 10_000 }).catch(() => null)
      if (footer === null || !footer.includes(`Version ${version}`)) fail(`footer "${String(footer)}" lacks "Version ${version}"`)
      const link = hp.page.locator('#h3p-report')
      const href = await link.getAttribute('href').catch(() => null)
      if (href !== NEW_ISSUE_URL) fail(`report link ${String(href)}`)
      if ((await link.getAttribute('target').catch(() => null)) !== '_blank') fail('report link does not open a new tab')
    },
  },
]

export async function runInvariants(ctx: InvariantContext): Promise<InvariantResult[]> {
  const selected = CHECKS.filter((c) => (c.hosts === undefined || c.hosts.includes(ctx.driver.host)) && (ctx.only === undefined || ctx.only.has(c.id)))
  const jobs = Math.max(1, ctx.jobs ?? 1)
  const byId = new Map<number, InvariantResult>()
  // A pool of `jobs` invariants at a time, each in its own browser context; then the serial ones alone.
  const pool = jobs === 1 ? selected : selected.filter((c) => c.serial !== true)
  const queue = [...pool]
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let c = queue.shift(); c !== undefined; c = queue.shift()) byId.set(c.id, await runCheck(ctx, c))
    }),
  )
  if (jobs > 1) for (const c of selected.filter((x) => x.serial === true)) byId.set(c.id, await runCheck(ctx, c))
  return selected.map((c) => byId.get(c.id) as InvariantResult)
}

async function runCheck(ctx: InvariantContext, check: (typeof CHECKS)[number]): Promise<InvariantResult> {
  {
    const details: string[] = []
    let hp: HostPage | undefined
    const started = Date.now()
    const profile: WaitProfile = { openMs: 0, waits: [] }
    try {
      hp = await ctx.driver.open({
        seed: SEED,
        clockMs: CLOCK_START,
        locale: check.opts?.locale ?? 'en-US',
        ...(check.opts?.noCache === true ? { noCache: true } : {}),
        ...(check.opts?.readDelays !== undefined ? { readDelays: check.opts.readDelays } : {}),
        ...(check.opts?.timeScale !== undefined ? { timeScale: check.opts.timeScale } : {}),
      })
      profile.openMs = Date.now() - started
      profilePage(hp.page, profile)
      await check.run(ctx, hp, (m) => details.push(m))
      const csp = await hp.page.evaluate(() => (window as unknown as Wallpaper).__cspViolations)
      if (check.id !== 10 && csp.length > 0) details.push(`CSP violations: ${csp.join('; ')}`)
    } catch (err) {
      details.push(`error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      await hp?.close().catch((err: unknown) => details.push(`page closed unexpectedly: ${err instanceof Error ? err.message : String(err)}`))
    }
    const ms = Date.now() - started
    profile.waits.sort((a, b) => b.ms - a.ms)
    const timeouts = profile.waits.filter((w) => w.timedOut > 0)
    log.info(`${ctx.driver.host} invariant ${check.id}: ${details.length === 0 ? 'pass' : details.join('; ').slice(0, 300)} (${(ms / 1000).toFixed(1)} s)`)
    for (const w of timeouts) log.warn(`${ctx.driver.host} invariant ${check.id}: ${w.timedOut}× wait at ${w.where} ended by timeout (${(w.ms / 1000).toFixed(1)} s)`)
    return { id: check.id, name: check.name, outcome: details.length === 0 ? 'pass' : 'fail', details, ms, profile }
  }
}
