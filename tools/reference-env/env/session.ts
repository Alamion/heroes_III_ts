// One running instance of the original game on its own virtual display, driven to a map view.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLevel } from '../analysis/level-detect.ts'
import type { LevelDetection } from '../analysis/level-detect.ts'
import { drawnEdges, findViewRect, rectToViewOrigin, shroudFraction, viewRectProblem } from '../analysis/minimap.ts'
import { tileToMinimapPoint, viewMapping } from '../analysis/geometry.ts'
import { assertNoForbiddenDlls, parseLoadedDlls } from '../analysis/loaddll.ts'
import { regionHash, waitUntilStable } from '../analysis/stability.ts'
import { GAME_LAYOUT, GAME_SCREEN, GAME_VIEW } from '../data/game-layout.ts'
import { CHEAT_INPUT, FIXED_START } from '../data/settings-profile.ts'
import { GAME_EXE } from '../data/staging-whitelist.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { Level, Point, Rect, ReferenceConfig, StartMode, StartSetup, TileMapping, VisibleRange } from '../model/types.ts'
import { PROBES } from './calibration.ts'
import { grabRaw, writePng, type RawFrame } from './grab.ts'
import { createInput, type Input } from './input.ts'
import { sleep } from './process.ts'
import { applyStaging, planStaging } from './staging.ts'
import { killAll, launch, wineContext, type LaunchedApp, type WineContext } from './wine.ts'
import { startDisplay, type VirtualDisplay } from './xvfb.ts'

export const FULL_SCREEN: Rect = { x: 0, y: 0, w: GAME_SCREEN.width, h: GAME_SCREEN.height }
const OK_PROBE_RECT: Rect = { x: GAME_LAYOUT.scenarioIntroOk.x - 30, y: GAME_LAYOUT.scenarioIntroOk.y - 14, w: 60, h: 28 }
const RIGHT_PANEL: Rect = { x: 608, y: 0, w: 192, h: 600 }
/** Screen regions that identify menu screens (the cursor is parked away from them first). */
const MENU_BUTTONS_RECT: Rect = { x: 540, y: 30, w: 230, h: 540 }
const SCENARIO_BUTTONS_RECT: Rect = { x: 410, y: 530, w: 340, h: 50 }
/**
 * "Scenario name" field. It shows the map's name when the scenario is listed and is empty on the
 * random-map screen the game falls back to when no scenario could be listed.
 */
const SCENARIO_NAME_RECT: Rect = { x: 420, y: 48, w: 280, h: 22 }

export function stagingRoot(stateDir: string): string {
  return join(stateDir, 'game-root')
}

export interface ViewState {
  level: Level
  origin: Point
  visible: VisibleRange
  mapping: TileMapping
  minimapRect: Rect
  drawnEdges: { left: boolean; top: boolean; right: boolean; bottom: boolean }
}

export interface GameSession {
  display: VirtualDisplay
  input: Input
  wine: WineContext
  app: LaunchedApp
  startSetup: StartSetup
  /** Local state dir (failure and debug screenshots). */
  stateDir: string
  /** Save a screenshot after every step (`--debug-steps`). */
  debugSteps: boolean
  grab(rect?: Rect): Promise<RawFrame>
  loadedDlls(): string[]
  close(): Promise<void>
}

export interface OpenOptions {
  mapPath: string
  start: StartMode
  /** Probe hashes from calibration; when absent (during calibration) they are recorded instead. */
  probes: Record<string, string> | undefined
  stepTimeoutMs: number
  debugSteps?: boolean
}

async function stable(session: { grab(rect?: Rect): Promise<RawFrame> }, step: string, timeoutMs: number, rect: Rect = FULL_SCREEN): Promise<RawFrame> {
  return waitUntilStable(() => session.grab(rect), { consecutive: 3, intervalMs: 300, timeoutMs, step })
}

export async function openGame(config: ReferenceConfig, opts: OpenOptions): Promise<{ session: GameSession; recordedProbes: Record<string, string> }> {
  const recordedProbes: Record<string, string> = {}
  const root = stagingRoot(config.stateDir)
  applyStaging(planStaging(config.bundleDir, opts.mapPath), root)
  const wine = wineContext(config.stateDir, config.wineBinary)
  await killAll(wine)
  const display = await startDisplay(GAME_SCREEN)
  const input = createInput(display.display)
  let app: LaunchedApp | undefined
  const session: GameSession = {
    display,
    input,
    wine,
    get app() {
      return app as LaunchedApp
    },
    startSetup: opts.start === 'fixed' ? { mode: 'fixed', choices: { ...FIXED_START.description } } : { mode: 'random' },
    stateDir: config.stateDir,
    debugSteps: opts.debugSteps === true,
    grab: (rect = FULL_SCREEN) => grabRaw(display.display, rect),
    loadedDlls: () => (app === undefined ? [] : parseLoadedDlls(readFileSync(app.logPath, 'utf8'))),
    close: async () => {
      await killAll(wine)
      app?.proc.kill()
      await display.stop()
    },
  }
  try {
    app = launch(wine, GAME_EXE, { display: display.display, cwd: root, loadDllLog: true })
    await sleep(GAME_LAYOUT.introSkipAfterMs)
    if (opts.probes === undefined) {
      await skipIntro(session, opts.stepTimeoutMs * 4)
      await record(session, PROBES.mainMenu, MENU_BUTTONS_RECT, recordedProbes, opts.stepTimeoutMs)
    } else {
      // Keep clicking through the logos and intro until the main menu is recognised.
      await awaitScreen(session, PROBES.mainMenu, MENU_BUTTONS_RECT, opts, 'main menu', opts.stepTimeoutMs * 4, () =>
        session.input.click(GAME_LAYOUT.introSkip),
      )
    }
    assertNoForbiddenDlls(session.loadedDlls(), { allowHdMod: false })

    await menuStep(session, GAME_LAYOUT.mainNewGame, PROBES.newGameMenu, MENU_BUTTONS_RECT, opts, recordedProbes, 'main menu: new game')
    await menuStep(session, GAME_LAYOUT.newGameScenario, PROBES.scenarioScreen, SCENARIO_BUTTONS_RECT, opts, recordedProbes, 'new game: scenario')
    await assertScenarioListed(session)
    if (opts.start === 'fixed') await applyFixedStart(session, opts.stepTimeoutMs)

    await input.click(GAME_LAYOUT.scenarioBegin)
    // Adventure map animates; wait for the static right-hand panel instead of the whole screen.
    await sleep(1500)
    await stable(session, 'scenario: begin', opts.stepTimeoutMs, RIGHT_PANEL)
    await debugShot(session, 'scenario-begun')
    await dismissIntroMessage(session, opts, recordedProbes)
    await input.move(GAME_LAYOUT.cursorPark)
    await debugShot(session, 'intro-dismissed')
    return { session, recordedProbes }
  } catch (err) {
    await saveFailureShot(config.stateDir, session, err)
    const crashed = await gameExited(session)
    await session.close()
    throw crashed ? crashError(err) : err
  }
}

/** True when the game process has already exited (e.g. crashed under Wine). */
export async function gameExited(session: GameSession): Promise<boolean> {
  const app = session.app as LaunchedApp | undefined
  if (app === undefined) return false
  const code = await Promise.race([app.proc.exited, sleep(10).then(() => undefined)])
  return code !== undefined
}

export function crashError(cause: unknown): RefError {
  return new RefError(ERROR_CODES.GAME_CRASHED, `Heroes3.exe exited unexpectedly (${cause instanceof Error ? cause.message : String(cause)})`, { cause })
}

/** Calibration only: without probes, the main menu is the first screen that stops changing. */
async function skipIntro(session: GameSession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let prev: Buffer | undefined
  let same = 0
  while (Date.now() < deadline) {
    const frame = await session.grab()
    same = prev !== undefined && frame.rgb.equals(prev) ? same + 1 : 0
    prev = frame.rgb
    // ~4 s without a change: video frames can repeat for a moment, the menu does not change at all.
    if (same >= 6) return
    if (same === 0) await session.input.click(GAME_LAYOUT.introSkip)
    await sleep(700)
  }
  const exited = await Promise.race([session.app.proc.exited, sleep(10).then(() => undefined)])
  if (exited !== undefined) {
    throw new RefError(ERROR_CODES.LAUNCH_TIMEOUT, `Heroes3.exe exited with code ${exited} before the main menu`, {
      step: 'intro',
      details: { log: session.app.logPath },
    })
  }
  throw new RefError(ERROR_CODES.INPUT_IGNORED, 'the main menu did not appear (intro not skipped)', { step: 'intro', details: { log: session.app.logPath } })
}

async function assertScenarioListed(session: GameSession): Promise<void> {
  const f = await session.grab()
  // Count yellow text pixels: measured 401 with a listed scenario name, 0 on the random-map screen.
  let text = 0
  const r = SCENARIO_NAME_RECT
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * f.width + x) * 3
      if ((f.rgb[i] as number) > 180 && (f.rgb[i + 1] as number) > 150 && (f.rgb[i + 2] as number) < 140) text++
    }
  }
  if (text < 40) {
    throw new RefError(ERROR_CODES.MAP_UNSUPPORTED, 'the game did not list the staged map as a scenario (random-map screen shown)', {
      step: 'new game: scenario',
      details: { namePixels: text },
    })
  }
}

/** Neutral cursor spot in menus: no button under it, so no hover highlight in probe regions. */
const MENU_NEUTRAL: Point = GAME_LAYOUT.introSkip

async function record(session: GameSession, id: string, rect: Rect, recorded: Record<string, string>, timeoutMs: number): Promise<void> {
  await session.input.move(MENU_NEUTRAL)
  const f = await waitUntilStable(() => session.grab(), { consecutive: 5, intervalMs: 400, timeoutMs, step: `record ${id}` })
  recorded[id] = regionHash(f.rgb, f.width, rect)
}

async function awaitScreen(
  session: GameSession,
  id: string,
  rect: Rect,
  opts: OpenOptions,
  step: string,
  timeoutMs: number,
  whileWaiting?: () => Promise<void>,
): Promise<void> {
  const known = opts.probes?.[id] as string
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const f = await session.grab()
    if (regionHash(f.rgb, f.width, rect) === known) return
    if (Date.now() > deadline) {
      const exited = await Promise.race([session.app.proc.exited, sleep(10).then(() => undefined)])
      if (exited !== undefined) {
        throw new RefError(ERROR_CODES.LAUNCH_TIMEOUT, `Heroes3.exe exited with code ${exited} during "${step}"`, { step, details: { log: session.app.logPath } })
      }
      throw new RefError(ERROR_CODES.NAVIGATION_TIMEOUT, `screen "${step}" was not reached`, { step })
    }
    if (whileWaiting !== undefined) await whileWaiting()
    await sleep(500)
  }
}

/** Clicks a menu button and waits for the expected screen (recording it during calibration). */
async function menuStep(
  session: GameSession,
  click: Point,
  id: string,
  rect: Rect,
  opts: OpenOptions,
  recorded: Record<string, string>,
  step: string,
): Promise<void> {
  if (opts.probes === undefined) {
    await clickAndSettle(session, click, step, opts.stepTimeoutMs)
    await record(session, id, rect, recorded, opts.stepTimeoutMs)
    return
  }
  await session.input.click(click)
  await session.input.move(MENU_NEUTRAL)
  await awaitScreen(session, id, rect, opts, step, opts.stepTimeoutMs)
}

async function clickAndSettle(session: GameSession, p: Point, step: string, timeoutMs: number): Promise<RawFrame> {
  const before = await session.grab()
  await session.input.click(p)
  // Wait for the screen to change (the game may redraw late), then for it to settle.
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await sleep(300)
    const now = await session.grab()
    if (!now.rgb.equals(before.rgb)) break
    if (Date.now() > deadline) throw new RefError(ERROR_CODES.INPUT_IGNORED, `screen did not change after "${step}"`, { step })
  }
  return stable(session, step, Math.max(1000, deadline - Date.now()))
}

async function applyFixedStart(session: GameSession, timeoutMs: number): Promise<void> {
  await clickAndSettle(session, GAME_LAYOUT.scenarioAdvancedOptions, 'scenario: advanced options', timeoutMs)
  for (const y of GAME_LAYOUT.advancedRowsY) {
    const clicks: [number, number][] = [
      [GAME_LAYOUT.advancedTownNextX, FIXED_START.townClicks],
      [GAME_LAYOUT.advancedHeroNextX, FIXED_START.heroClicks],
      [GAME_LAYOUT.advancedBonusNextX, FIXED_START.bonusClicks],
    ]
    for (const [x, n] of clicks) {
      for (let i = 0; i < n; i++) {
        await session.input.click({ x, y })
        await sleep(350)
      }
    }
  }
  await session.input.move(GAME_LAYOUT.cursorPark)
  await stable(session, 'scenario: fixed start applied', timeoutMs)
}

async function dismissIntroMessage(session: GameSession, opts: OpenOptions, recorded: Record<string, string>): Promise<void> {
  const frame = await session.grab()
  const hash = regionHash(frame.rgb, frame.width, OK_PROBE_RECT)
  const known = opts.probes?.[PROBES.scenarioIntroOk]
  if (known === undefined) {
    // Calibration run on a map known to show an intro message.
    recorded[PROBES.scenarioIntroOk] = hash
    await session.input.click(GAME_LAYOUT.scenarioIntroOk)
  } else if (hash === known) {
    await session.input.click(GAME_LAYOUT.scenarioIntroOk)
  } else {
    log.info('no scenario intro message detected')
    return
  }
  await sleep(1000)
  const again = await session.grab()
  if (regionHash(again.rgb, again.width, OK_PROBE_RECT) === hash) {
    throw new RefError(ERROR_CODES.INPUT_IGNORED, 'scenario intro message did not close', { step: 'scenario: intro message' })
  }
}

export interface Revealed {
  code: string
  /** When the cheat reply appeared; it covers part of the viewport until GAME_LAYOUT.messageClearMs later. */
  at: number
}

/** Waits until the cheat reply drawn over the viewport has cleared. */
export async function waitForMessageClear(revealed: Revealed): Promise<void> {
  const remaining = revealed.at + GAME_LAYOUT.messageClearMs - Date.now()
  if (remaining > 0) {
    log.info(`waiting ${remaining} ms for the cheat reply to clear`)
    await sleep(remaining)
  }
}

/** Reveals the whole map with the cheat code; verifies on the minimap. */
export async function revealMap(session: GameSession): Promise<Revealed> {
  const mm = GAME_LAYOUT.minimap
  const before = shroudFraction(await session.grab(), mm, GAME_LAYOUT.shroudColor)
  for (const code of CHEAT_INPUT.codes) {
    await session.input.key(CHEAT_INPUT.messageLineKey)
    await sleep(400)
    await session.input.keyDown(CHEAT_INPUT.holdKey)
    await sleep(150)
    try {
      await session.input.typeSlowly(code, CHEAT_INPUT.keyDelayMs)
    } finally {
      await session.input.keyUp(CHEAT_INPUT.holdKey)
    }
    await sleep(200)
    await session.input.key('Return')
    const at = Date.now()
    await sleep(1500)
    const after = shroudFraction(await session.grab(), mm, GAME_LAYOUT.shroudColor)
    log.debug('reveal attempt', { code, before, after })
    await debugShot(session, `reveal-${code}`)
    if (after < 0.02 || after < before * 0.25) {
      await session.input.move(GAME_LAYOUT.cursorPark)
      log.info('map revealed', { code })
      return { code, at }
    }
  }
  throw new RefError(ERROR_CODES.REVEAL_FAILED, 'no cheat code revealed the map', {
    details: { shroudBefore: before, codes: CHEAT_INPUT.codes },
  })
}

/**
 * Which level the game shows, from the minimap compared with each level's terrain
 * (`terrain[z][y * size + x]`). Independent of the interface colour (spec 003 research §11).
 */
export async function currentLevel(session: GameSession, size: number, terrain: readonly Uint8Array[]): Promise<LevelDetection> {
  const f = await session.grab()
  return detectLevel(f, GAME_LAYOUT.minimap, size, terrain, [GAME_LAYOUT.viewRectColor])
}

/** Switches to `level` and verifies it on the minimap; returns the final detection. */
export async function showLevel(session: GameSession, level: Level, size: number, terrain: readonly Uint8Array[]): Promise<LevelDetection> {
  let detected = await currentLevel(session, size, terrain)
  log.debug('level detection', { ...detected })
  for (let attempt = 0; detected.level !== level && attempt < 2; attempt++) {
    if (detected.level === null) {
      throw new RefError(ERROR_CODES.LEVEL_UNKNOWN, 'the minimap matches no level clearly', { step: 'level', details: { ...detected } })
    }
    await session.input.click(GAME_VIEW.levelToggle)
    await session.input.move(GAME_LAYOUT.cursorPark)
    await sleep(1000)
    detected = await currentLevel(session, size, terrain)
    log.debug('level detection after toggle', { ...detected })
  }
  await debugShot(session, `level-${level}`)
  if (detected.level !== level) {
    throw new RefError(ERROR_CODES.LEVEL_MISMATCH, `could not switch to level ${level}`, { step: 'level', details: { ...detected } })
  }
  return detected
}

/** Reads the current view from the minimap rectangle. */
export async function readView(session: GameSession, level: Level, mapSize: number): Promise<ViewState> {
  const f = await session.grab()
  const rect = findViewRect(f, GAME_LAYOUT.minimap, GAME_LAYOUT.viewRectColor)
  if (rect === undefined) throw new RefError(ERROR_CODES.POSITION_MISMATCH, 'view rectangle not found on the minimap')
  const edges = drawnEdges(f, rect, GAME_LAYOUT.viewRectColor)
  const problem = viewRectProblem(rect, GAME_LAYOUT.minimap, mapSize, GAME_VIEW.viewTiles, edges)
  if (problem !== null) {
    throw new RefError(ERROR_CODES.POSITION_MISMATCH, `implausible view rectangle on the minimap (${problem})`, { details: { rect, edges } })
  }
  const view = rectToViewOrigin(rect, GAME_LAYOUT.minimap, mapSize, GAME_VIEW.viewTiles, edges)
  const origin = { x: view.originX, y: view.originY }
  const { visible, mapping } = viewMapping(origin, GAME_VIEW.originTilePixel, GAME_VIEW.viewport, mapSize)
  return { level, origin, visible, mapping, minimapRect: rect, drawnEdges: edges }
}

/** Centres the view on `target` via minimap clicks, correcting sub-tile rounding on odd map sizes. */
export async function positionView(session: GameSession, level: Level, target: Point, mapSize: number): Promise<ViewState> {
  const half = { x: Math.floor(GAME_VIEW.viewTiles.w / 2), y: Math.floor(GAME_VIEW.viewTiles.h / 2) }
  const want = { x: target.x - half.x, y: target.y - half.y }
  let click = tileToMinimapPoint(target, mapSize, GAME_LAYOUT.minimap)
  let view: ViewState | undefined
  for (let attempt = 0; attempt < 4; attempt++) {
    await session.input.click(click)
    await session.input.move(GAME_LAYOUT.cursorPark)
    await sleep(1200)
    view = await readView(session, level, mapSize)
    const dx = want.x - view.origin.x
    const dy = want.y - view.origin.y
    if (dx === 0 && dy === 0) {
      await debugShot(session, 'positioned')
      return view
    }
    log.debug('position correction', { attempt, want, got: view.origin })
    // Move the click by the tile difference in minimap pixels (at least one pixel per axis).
    const scale = GAME_LAYOUT.minimap.w / mapSize
    const step = (d: number) => (d === 0 ? 0 : Math.sign(d) * Math.max(1, Math.round(Math.abs(d) * scale)))
    click = { x: click.x + step(dx), y: click.y + step(dy) }
  }
  throw new RefError(ERROR_CODES.POSITION_MISMATCH, `view did not centre on tile (${target.x}, ${target.y})`, {
    details: { want, got: view?.origin },
  })
}

/** With `--debug-steps`: saves the current screen as `<stamp>-step-<name>.png` in the failures folder. */
export async function debugShot(session: GameSession, step: string): Promise<void> {
  if (!session.debugSteps) return
  try {
    const dir = join(session.stateDir, 'failures')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-step-${step.replace(/[^a-z0-9-]/gi, '_')}.png`)
    await writePng(await session.grab(), file)
    log.info(`debug step screenshot: ${file}`)
  } catch (err) {
    log.warn(`could not save debug screenshot: ${(err as Error).message}`)
  }
}

/** Saves the current screen after a failure (local diagnostics; derived from game output). */
export async function saveFailureShot(stateDir: string, session: GameSession, err: unknown): Promise<void> {
  try {
    const dir = join(stateDir, 'failures')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${err instanceof RefError ? err.code : 'ERROR'}.png`)
    await writePng(await session.grab(), file)
    log.error(`failure screenshot: ${file}`)
  } catch (shotErr) {
    log.warn(`could not save failure screenshot: ${(shotErr as Error).message}`)
  }
}
