// Shared pipeline for game captures: prerequisites → lock → game → reveal → level → position.
import type { ParsedArgs } from '../cli.ts'
import { GAME_LAYOUT, GAME_SCREEN } from '../data/game-layout.ts'
import { SETTINGS_PROFILE } from '../data/settings-profile.ts'
import { GAME_EXE } from '../data/staging-whitelist.ts'
import { requireCalibration } from '../env/calibration.ts'
import { acquireLock } from '../env/lock.ts'
import { crashError, gameExited, openGame, positionView, revealMap, saveFailureShot, showLevel, waitForMessageClear, type GameSession, type ViewState } from '../env/session.ts'
import type { LevelDetection } from '../analysis/level-detect.ts'
import { buildMapContext } from '../../checks/fidelity/masks.ts'
import { verifyMapping } from '../analysis/mapping-verify.ts'
import { mappingCheckInput } from '../analysis/mapping-verify-terrain.ts'
import { resolveGameFile } from '../../shared/game-files.ts'
import { toolVersions } from '../env/tooling.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { CaptureRecord, CaptureVerification, FileHash, Kind, ReferenceConfig, StartMode, TileMapping } from '../model/types.ts'
import { requirePrereqs } from './doctor.ts'
import { flag, levelTerrains, opt, stagedHashes, startMode, targetContext, type TargetContext } from './common.ts'

export interface CaptureState {
  ctx: TargetContext
  session: GameSession
  view: ViewState
  level: LevelDetection
  revealCode: string
  hashes: { game: string; archives: FileHash[] }
}

async function withTimeout<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RefError(ERROR_CODES.LAUNCH_TIMEOUT, `${what} exceeded ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function runGameCapture<T>(
  cfg: ReferenceConfig,
  args: ParsedArgs,
  kind: Kind,
  timeoutMs: number,
  grab: (state: CaptureState) => Promise<T>,
): Promise<T> {
  await requirePrereqs(cfg, ['bundle-found', 'wine', 'xvfb', 'xdotool', 'ffmpeg', 'prefix', 'captures-gitignored'])
  const ctx = await targetContext(cfg, args)
  const start = startMode(opt(args, 'start'))
  const lock = await acquireLock(cfg.stateDir, cfg.timeouts.lockWait, `${kind} ${ctx.map.name}`)
  try {
    // The original game occasionally crashes under Wine while loading a map; retry once.
    for (let attempt = 1; ; attempt++) {
      try {
        return await captureAttempt(cfg, ctx, start, kind, timeoutMs, grab, flag(args, 'debug-steps'))
      } catch (err) {
        if (attempt >= 2 || !(err instanceof RefError) || err.code !== ERROR_CODES.GAME_CRASHED) throw err
        log.warn(`game crashed (${err.message}); retrying the capture once`)
      }
    }
  } finally {
    lock.release()
  }
}

async function captureAttempt<T>(
  cfg: ReferenceConfig,
  ctx: TargetContext,
  start: StartMode,
  kind: Kind,
  timeoutMs: number,
  grab: (state: CaptureState) => Promise<T>,
  debugSteps: boolean,
): Promise<T> {
  let session: GameSession | undefined
  try {
    const work = (async () => {
      const hashes = await stagedHashes(cfg)
      const cal = requireCalibration(cfg.stateDir, hashes.game)
      const terrain = await levelTerrains(ctx.mapPath)
      const opened = await openGame(cfg, { mapPath: ctx.mapPath, start, probes: cal.probes, stepTimeoutMs: cfg.timeouts.step, debugSteps })
      session = opened.session
      const revealed = await revealMap(session)
      const level = await showLevel(session, ctx.level, ctx.map.sizeTiles, terrain)
      const view = await positionView(session, ctx.level, ctx.target, ctx.map.sizeTiles)
      log.info('view positioned', { origin: view.origin, visible: view.visible, level })
      await waitForMessageClear(revealed)
      return grab({ ctx, session, view, level, revealCode: revealed.code, hashes })
    })()
    // If the timeout wins, `work` still settles later; swallow that late result (already reported).
    work.catch(() => undefined)
    return await withTimeout(timeoutMs, `${kind} capture`, work)
  } catch (err) {
    // `session` is assigned inside the async work; TS cannot see that across the closure.
    const s = session as GameSession | undefined
    if (s !== undefined) {
      await saveFailureShot(cfg.stateDir, s, err)
      if (!(err instanceof RefError && err.code === ERROR_CODES.GAME_CRASHED) && (await gameExited(s))) throw crashError(err)
    }
    throw err
  } finally {
    const s = session as GameSession | undefined
    if (s !== undefined) await s.close()
  }
}

/**
 * Verifies a grab against the project's terrain render at the recorded mapping (FR-019). Throws
 * MAPPING_UNVERIFIED when a one-tile shift explains the pixels clearly better.
 */
export async function verifyGrabMapping(s: CaptureState, mapping: TileMapping, screen: { width: number; rgb: Uint8Array }): Promise<NonNullable<CaptureVerification['mapping']>> {
  const ctx = await buildMapContext(s.ctx.mapPath, resolveGameFile('h3sprite.lod'))
  const r = verifyMapping(mappingCheckInput(ctx, s.ctx.level, mapping, screen))
  log.info('mapping verification', { ...r })
  const result = { method: 'terrain-render' as const, compared: r.comparedRecorded, differingRecorded: r.differingRecorded, bestShift: r.bestShift, bestDiffering: r.bestDiffering }
  if (!r.ok) {
    throw new RefError(ERROR_CODES.MAPPING_UNVERIFIED, `the capture matches the terrain better one tile off (${r.bestShift.dx}, ${r.bestShift.dy}) than at the recorded mapping`, { step: 'verify mapping', details: result })
  }
  return result
}

export function verificationBase(s: CaptureState): CaptureVerification {
  return {
    minimapRect: { ...s.view.minimapRect, drawnEdges: s.view.drawnEdges },
    level: { method: 'minimap-terrain', agreement: s.level.agreement, margin: s.level.margin },
  }
}

export async function gameRecordBase(
  cfg: ReferenceConfig,
  s: CaptureState,
  id: string,
  createdAt: Date,
  kind: Kind,
): Promise<Omit<CaptureRecord, 'files'>> {
  const { visible, mapping } = s.view
  const req = s.ctx.target
  const contains = req.x >= visible.x0 && req.x <= visible.x1 && req.y >= visible.y0 && req.y <= visible.y1
  return {
    schemaVersion: 1,
    id,
    createdAt: createdAt.toISOString(),
    source: 'game',
    kind,
    map: s.ctx.map,
    level: s.ctx.level,
    requested: req,
    ...(contains ? {} : { clamped: true }),
    visible,
    mapping,
    positionSource: 'minimap-rect',
    startSetup: s.session.startSetup,
    visibility: { method: 'cheat', code: s.revealCode, verified: true },
    cursor: { drawnByX: false, parkedAt: GAME_LAYOUT.cursorPark },
    executable: { file: GAME_EXE, sha256: s.hashes.game, label: 'Heroes3.exe (original)' },
    archives: s.hashes.archives,
    settings: { profileId: SETTINGS_PROFILE.profileId, values: Object.fromEntries(SETTINGS_PROFILE.overrides.map((o) => [o.name, o.value])) },
    display: { ...GAME_SCREEN },
    tooling: await toolVersions(cfg.repoRoot, cfg.wineBinary),
  }
}
