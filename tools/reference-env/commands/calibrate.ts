// Records local probe hashes (derived from game output, never committed) and verifies the
// measured layout on Arrogance.h3m: navigation, reveal, level toggle, minimap positioning. When
// test_map.h3m (144×144) is present, also checks minimap reading at scale 1 (spec 003 T029).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Command, ParsedArgs } from '../cli.ts'
import { calibrationPath, readCalibration, writeCalibration } from '../env/calibration.ts'
import { writePng } from '../env/grab.ts'
import { acquireLock } from '../env/lock.ts'
import { openGame, positionView, readView, revealMap, saveFailureShot, showLevel, waitForMessageClear } from '../env/session.ts'
import type { GameSession } from '../env/session.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { Baseline, Calibration } from '../model/types.ts'
import { requireAmendment } from '../env/amendment.ts'
import { assertMapFitsBaseline, baselineOf, config, levelTerrains, stagedHashes, targetContext } from './common.ts'
import type { TargetContext } from './common.ts'
import type { ReferenceConfig } from '../model/types.ts'
import { requireTestMap } from '../../shared/game-files.ts'

/** Calibration needs a two-level map with a scenario intro message that this build can open. */
const CALIBRATION_MAP: Record<Baseline, string> = { complete: 'Arrogance.h3m', hota: 'test_map_hota.h3m' }

export const calibrateCommand: Command = async (args) => {
  const cfg = config()
  const baseline = baselineOf(args)
  requireAmendment(cfg.repoRoot, baseline)
  if (!args.flags.has('map')) args.flags.set('map', [CALIBRATION_MAP[baseline]])
  args.flags.set('x', ['0'])
  args.flags.set('y', ['0'])
  const ctx = await targetContext(cfg, args)
  assertMapFitsBaseline(ctx.map, baseline)
  if (!ctx.map.hasUnderground) throw new RefError(ERROR_CODES.USAGE, `calibration needs a two-level map (default ${CALIBRATION_MAP[baseline]})`)
  const lock = await acquireLock(cfg.stateDir, cfg.timeouts.lockWait, 'calibrate')
  const spikes = join(cfg.stateDir, 'spikes', baseline === 'complete' ? 'calibrate' : `calibrate-${baseline}`)
  mkdirSync(spikes, { recursive: true })
  try {
    const { session, recordedProbes } = await openGame(cfg, {
      baseline,
      mapPath: ctx.mapPath,
      start: 'fixed',
      probes: undefined,
      stepTimeoutMs: cfg.timeouts.step,
    })
    try {
      const hashes = await stagedHashes(cfg, baseline)
      const revealed = await revealMap(session)
      await waitForMessageClear(revealed)
      const terrain = await levelTerrains(ctx.mapPath)
      // The game starts on the level of the human player's town; Arrogance starts on the surface.
      const surfaceLevel = await showLevel(session, 0, ctx.map.sizeTiles, terrain)

      const size = ctx.map.sizeTiles
      const checks: { level: 0 | 1; target: { x: number; y: number }; origin: { x: number; y: number } }[] = []
      const targets = [
        { x: 0, y: 0 },
        { x: Math.floor(size / 2), y: Math.floor(size / 2) },
        { x: size - 1, y: size - 1 },
        { x: 3, y: size - 4 },
      ]
      for (const target of targets) {
        const view = await positionView(session, 0, target, size)
        checks.push({ level: 0, target, origin: view.origin })
        await writePng(await session.grab(), join(spikes, `surface-${target.x}-${target.y}.png`))
      }
      const undergroundLevel = await showLevel(session, 1, size, terrain)
      const under = await session.grab()
      const underView = await readView(session, 1, size)
      await writePng(under, join(spikes, 'underground.png'))

      const cal: Calibration = {
        baseline,
        gameExecutable: baseline === 'hota' ? 'hota' : 'original',
        launchMode: 'direct',
        gameExeSha256: hashes.game,
        editorExeSha256: hashes.editor,
        positioningMethod: 'minimap-click',
        probes: recordedProbes,
        loadedDlls: session.loadedDlls(),
        measuredAt: new Date().toISOString(),
      }
      writeCalibration(cfg.stateDir, baseline, cal)
      log.info(`calibration written; screenshots in ${spikes}`)
      return {
        ok: true,
        baseline,
        calibrationPath: calibrationPath(cfg.stateDir, baseline),
        positioningMethod: cal.positioningMethod,
        revealCode: revealed.code,
        checks,
        undergroundOrigin: underView.origin,
        levelDetection: { surface: surfaceLevel, underground: undergroundLevel },
        minimapScale1: await scaleOneCheck(cfg, baseline),
      }
    } catch (err) {
      await saveFailureShot(cfg.stateDir, session, err)
      throw err
    } finally {
      await session.close()
    }
  } finally {
    lock.release()
  }
}

/**
 * Minimap reading at scale 1 px per tile (144×144 maps): positions a top-edge and a mid-map view on
 * test_map.h3m and reads the origins back. Skipped when the map is absent.
 */
async function scaleOneCheck(cfg: ReferenceConfig, baseline: Baseline): Promise<Record<string, unknown>> {
  // The 144×144 case is already covered by the HotA calibration map itself.
  if (baseline !== 'complete') return { skipped: 'covered by the calibration map of this baseline' }
  const path = requireTestMap()
  if (path === null) return { skipped: 'test_map.h3m not found' }
  const args: ParsedArgs = { command: 'calibrate', flags: new Map([['map', [path]], ['x', ['0']], ['y', ['0']]]) }
  const ctx: TargetContext = await targetContext(cfg, args)
  const { session } = await openGame(cfg, { baseline, mapPath: ctx.mapPath, start: 'fixed', probes: readCalibrationProbes(cfg, baseline), stepTimeoutMs: cfg.timeouts.step })
  try {
    const revealed = await revealMap(session)
    await waitForMessageClear(revealed)
    const size = ctx.map.sizeTiles
    const out: { target: { x: number; y: number }; origin: { x: number; y: number } }[] = []
    for (const target of [{ x: 118, y: 5 }, { x: 72, y: 72 }]) {
      const view = await positionView(session as GameSession, 0, target, size)
      out.push({ target, origin: view.origin })
    }
    return { ok: true, views: out }
  } catch (err) {
    await saveFailureShot(cfg.stateDir, session, err)
    throw err
  } finally {
    await session.close()
  }
}

function readCalibrationProbes(cfg: ReferenceConfig, baseline: Baseline): Record<string, string> {
  const cal = readCalibration(cfg.stateDir, baseline)
  if (cal === undefined) throw new RefError(ERROR_CODES.CALIBRATION_MISSING, 'calibration was not written')
  return cal.probes
}
