// Shared pipeline for game captures: prerequisites → lock → game → reveal → level → position.
import type { ParsedArgs } from '../cli.ts'
import { GAME_LAYOUT, GAME_SCREEN } from '../data/game-layout.ts'
import { SETTINGS_PROFILE } from '../data/settings-profile.ts'
import { GAME_EXE } from '../data/staging-whitelist.ts'
import { PROBES, requireCalibration } from '../env/calibration.ts'
import { acquireLock } from '../env/lock.ts'
import { openGame, positionView, revealMap, saveFailureShot, showLevel, waitForMessageClear, type GameSession, type ViewState } from '../env/session.ts'
import { toolVersions } from '../env/tooling.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { CaptureRecord, FileHash, Kind, ReferenceConfig } from '../model/types.ts'
import { requirePrereqs } from './doctor.ts'
import { opt, stagedHashes, startMode, targetContext, type TargetContext } from './common.ts'

export interface CaptureState {
  ctx: TargetContext
  session: GameSession
  view: ViewState
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
  let session: GameSession | undefined
  try {
    const work = (async () => {
      const hashes = await stagedHashes(cfg)
      const cal = requireCalibration(cfg.stateDir, hashes.game)
      const opened = await openGame(cfg, { mapPath: ctx.mapPath, start, probes: cal.probes, stepTimeoutMs: cfg.timeouts.step })
      session = opened.session
      const revealed = await revealMap(session)
      const surfaceProbe = cal.probes[PROBES.levelSurface]
      if (surfaceProbe === undefined) throw new RefError(ERROR_CODES.CALIBRATION_MISSING, 'calibration lacks the level probe')
      await showLevel(session, ctx.level, surfaceProbe)
      const view = await positionView(session, ctx.level, ctx.target, ctx.map.sizeTiles)
      log.info('view positioned', { origin: view.origin, visible: view.visible })
      await waitForMessageClear(revealed)
      return grab({ ctx, session, view, revealCode: revealed.code, hashes })
    })()
    // If the timeout wins, `work` still settles later; swallow that late result (already reported).
    work.catch(() => undefined)
    return await withTimeout(timeoutMs, `${kind} capture`, work)
  } catch (err) {
    const s = session as GameSession | undefined
    if (s !== undefined) await saveFailureShot(cfg.stateDir, s, err)
    throw err
  } finally {
    // `session` is assigned inside the async work; TS cannot see that across the closure.
    const s = session as GameSession | undefined
    if (s !== undefined) await s.close()
    lock.release()
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
