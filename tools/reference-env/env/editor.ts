// The original map editor on its own virtual display.
import { basename, join } from 'node:path'
import { viewMapping } from '../analysis/geometry.ts'
import { regionHash, waitUntilStable } from '../analysis/stability.ts'
import { EDITOR_LAYOUT, EDITOR_OVERLAYS, EDITOR_SCREEN, type EditorOverlay } from '../data/editor-layout.ts'
import { EDITOR_EXE } from '../data/staging-whitelist.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Level, Point, Rect, ReferenceConfig, TileMapping, VisibleRange } from '../model/types.ts'
import { mkdirSync } from 'node:fs'
import { grabRaw, writePng, type RawFrame } from './grab.ts'
import { createInput, type Input } from './input.ts'
import { runProcess, sleep } from './process.ts'
import { stagingRoot } from './session.ts'
import { applyStaging, planStaging } from './staging.ts'
import { killAll, launch, wineContext } from './wine.ts'
import { startDisplay, type VirtualDisplay } from './xvfb.ts'

const FULL: Rect = { x: 0, y: 0, w: EDITOR_SCREEN.width, h: EDITOR_SCREEN.height }

export interface EditorSession {
  display: VirtualDisplay
  input: Input
  grab(rect?: Rect): Promise<RawFrame>
  close(): Promise<void>
}

export interface EditorView {
  origin: Point
  visible: VisibleRange
  mapping: TileMapping
}

export async function openEditor(cfg: ReferenceConfig, mapPath: string, timeoutMs: number): Promise<EditorSession> {
  const root = stagingRoot(cfg.stateDir)
  applyStaging(planStaging(cfg.bundleDir, mapPath), root)
  const wine = wineContext(cfg.stateDir, cfg.wineBinary)
  await killAll(wine)
  const display = await startDisplay(EDITOR_SCREEN)
  const session: EditorSession = {
    display,
    input: createInput(display.display),
    grab: (rect = FULL) => grabRaw(display.display, rect),
    close: async () => {
      await killAll(wine)
      await display.stop()
    },
  }
  try {
    const winPath = `Z:${join(root, 'Maps', basename(mapPath)).replace(/\//g, '\\')}`
    launch(wine, EDITOR_EXE, { display: display.display, cwd: root, loadDllLog: false, args: [winPath], keepLocale: true })
    const env = { ...process.env, DISPLAY: display.display }
    const deadline = Date.now() + timeoutMs
    let geometry = ''
    for (;;) {
      const r = await runProcess('xdotool', ['search', '--name', basename(mapPath, '.h3m')], { env, check: false, timeoutMs: 5000 })
      const id = r.stdout.toString().trim().split('\n').filter(Boolean).at(-1)
      if (id !== undefined) {
        const g = await runProcess('xdotool', ['getwindowgeometry', '--shell', id], { env, check: false, timeoutMs: 5000 })
        geometry = g.stdout.toString()
        break
      }
      if (Date.now() > deadline) throw new RefError(ERROR_CODES.LAUNCH_TIMEOUT, 'map editor window did not appear', { step: 'editor: open map' })
      await sleep(500)
    }
    const w = EDITOR_LAYOUT.window
    const want = `X=${w.x}\nY=${w.y}\nWIDTH=${w.w}\nHEIGHT=${w.h}`
    if (!want.split('\n').every((l) => geometry.includes(l))) {
      throw new RefError(ERROR_CODES.POSITION_MISMATCH, 'map editor window has an unexpected position or size', { details: { geometry } })
    }
    await session.input.move(EDITOR_LAYOUT.cursorPark)
    await waitUntilStable(() => session.grab(), { timeoutMs, step: 'editor: open map', intervalMs: 400 })
    return session
  } catch (err) {
    await session.close()
    throw err
  }
}

async function toggle(session: EditorSession, p: Point, probe: Rect, what: string): Promise<void> {
  const before = await session.grab()
  await session.input.click(p)
  await session.input.move(EDITOR_LAYOUT.cursorPark)
  await sleep(800)
  const after = await session.grab()
  if (regionHash(before.rgb, before.width, probe) === regionHash(after.rgb, after.width, probe)) {
    throw new RefError(ERROR_CODES.INPUT_IGNORED, `editor did not react to ${what}`)
  }
}

/** The editor opens on the surface; switch once for the underground. */
export async function showEditorLevel(session: EditorSession, level: Level): Promise<void> {
  if (level === 1) await toggle(session, EDITOR_LAYOUT.undergroundToggle, EDITOR_LAYOUT.undergroundToggleProbe, 'the underground toggle')
}

export async function setOverlays(session: EditorSession, overlays: EditorOverlay[]): Promise<void> {
  for (const o of overlays) {
    const p = EDITOR_OVERLAYS[o]
    await toggle(session, p, { x: p.x - 12, y: p.y - 12, w: 24, h: 24 }, `the ${o} toggle`)
  }
}

export function expectedEditorOrigin(target: Point, mapSize: number): Point {
  const clamp = (v: number, span: number) => Math.max(0, Math.min(v, Math.max(0, mapSize - span)))
  return {
    x: clamp(target.x - EDITOR_LAYOUT.clickCentre.x, EDITOR_LAYOUT.viewTiles.w),
    y: clamp(target.y - EDITOR_LAYOUT.clickCentre.y, EDITOR_LAYOUT.viewTiles.h),
  }
}

/**
 * Top-left tile of the view rectangle on the editor minimap. The editor draws the dashed rectangle by
 * inverting the terrain colour, so a line pixel is one whose inverse equals an adjacent pixel.
 */
export function editorViewOrigin(frame: { width: number; rgb: Buffer }, mapSize: number): Point | undefined {
  const mm = EDITOR_LAYOUT.minimap
  const at = (x: number, y: number) => (y * frame.width + x) * 3
  const invertedNeighbour = (x: number, y: number): boolean => {
    const i = at(x, y)
    const inv = [255 - (frame.rgb[i] as number), 255 - (frame.rgb[i + 1] as number), 255 - (frame.rgb[i + 2] as number)]
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < mm.x || ny < mm.y || nx >= mm.x + mm.w || ny >= mm.y + mm.h) continue
      const j = at(nx, ny)
      if (frame.rgb[j] === inv[0] && frame.rgb[j + 1] === inv[1] && frame.rgb[j + 2] === inv[2]) return true
    }
    return false
  }
  // Count line pixels per row and column; the rectangle's top row and left column have the most.
  const rows = new Map<number, number>()
  const cols = new Map<number, number>()
  for (let y = mm.y; y < mm.y + mm.h; y++) {
    for (let x = mm.x; x < mm.x + mm.w; x++) {
      if (!invertedNeighbour(x, y)) continue
      rows.set(y, (rows.get(y) ?? 0) + 1)
      cols.set(x, (cols.get(x) ?? 0) + 1)
    }
  }
  const minLine = 6
  const lineRows = [...rows].filter(([, n]) => n >= minLine).map(([y]) => y)
  const lineCols = [...cols].filter(([, n]) => n >= minLine).map(([x]) => x)
  if (lineRows.length === 0 || lineCols.length === 0) return undefined
  const scale = mm.w / mapSize
  return { x: Math.round((Math.min(...lineCols) - mm.x) / scale), y: Math.round((Math.min(...lineRows) - mm.y) / scale) }
}

export async function positionEditorView(session: EditorSession, target: Point, mapSize: number, debugDir?: string): Promise<EditorView> {
  const mm = EDITOR_LAYOUT.minimap
  const click = {
    x: mm.x + Math.floor(((target.x + 0.5) * mm.w) / mapSize),
    y: mm.y + Math.floor(((target.y + 0.5) * mm.h) / mapSize),
  }
  await session.input.click(click)
  await session.input.move(EDITOR_LAYOUT.cursorPark)
  await sleep(1000)
  const frame = await waitUntilStable(() => session.grab(), { timeoutMs: 15_000, step: 'editor: position', intervalMs: 300 })
  const want = expectedEditorOrigin(target, mapSize)
  const got = editorViewOrigin(frame, mapSize)
  if (got === undefined || got.x !== want.x || got.y !== want.y) {
    if (debugDir !== undefined) {
      mkdirSync(debugDir, { recursive: true })
      await writePng(frame, join(debugDir, `editor-position-mismatch-${target.x}-${target.y}.png`))
    }
    throw new RefError(ERROR_CODES.POSITION_MISMATCH, `editor view did not move to the expected origin`, { details: { want, got } })
  }
  const { visible, mapping } = viewMapping(got, EDITOR_LAYOUT.originTilePixel, EDITOR_LAYOUT.viewport, mapSize)
  return { origin: got, visible, mapping }
}
