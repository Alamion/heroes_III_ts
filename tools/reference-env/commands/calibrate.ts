// Records local probe hashes (derived from game output, never committed) and verifies the
// measured layout on Arrogance.h3m: navigation, reveal, level toggle, minimap positioning.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { regionHash } from '../analysis/stability.ts'
import { GAME_VIEW } from '../data/game-layout.ts'
import { PROBES, calibrationPath, writeCalibration } from '../env/calibration.ts'
import { writePng } from '../env/grab.ts'
import { acquireLock } from '../env/lock.ts'
import { openGame, positionView, readView, revealMap, saveFailureShot, waitForMessageClear } from '../env/session.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { Calibration } from '../model/types.ts'
import { config, stagedHashes, targetContext } from './common.ts'

export const calibrateCommand: Command = async (args) => {
  const cfg = config()
  if (!args.flags.has('map')) args.flags.set('map', ['Arrogance.h3m'])
  args.flags.set('x', ['0'])
  args.flags.set('y', ['0'])
  const ctx = await targetContext(cfg, args)
  if (!ctx.map.hasUnderground) throw new RefError(ERROR_CODES.USAGE, 'calibration needs a two-level map with a scenario intro message (default Arrogance.h3m)')
  const lock = await acquireLock(cfg.stateDir, cfg.timeouts.lockWait, 'calibrate')
  const spikes = join(cfg.stateDir, 'spikes', 'calibrate')
  mkdirSync(spikes, { recursive: true })
  try {
    const { session, recordedProbes } = await openGame(cfg, {
      mapPath: ctx.mapPath,
      start: 'fixed',
      probes: undefined,
      stepTimeoutMs: cfg.timeouts.step,
    })
    try {
      const hashes = await stagedHashes(cfg)
      const revealed = await revealMap(session)
      await waitForMessageClear(revealed)

      // The game starts on the level of the human player's town; Arrogance starts on the surface.
      const surface = await session.grab()
      recordedProbes[PROBES.levelSurface] = regionHash(surface.rgb, surface.width, GAME_VIEW.levelToggleProbe)

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
      await session.input.click(GAME_VIEW.levelToggle)
      await session.input.move({ x: 690, y: 470 })
      await new Promise((r) => setTimeout(r, 1000))
      const under = await session.grab()
      if (regionHash(under.rgb, under.width, GAME_VIEW.levelToggleProbe) === recordedProbes[PROBES.levelSurface]) {
        throw new RefError(ERROR_CODES.POSITION_MISMATCH, 'level toggle did not change the toggle button look')
      }
      const underView = await readView(session, 1, size)
      await writePng(under, join(spikes, 'underground.png'))

      const cal: Calibration = {
        gameExecutable: 'original',
        launchMode: 'direct',
        gameExeSha256: hashes.game,
        editorExeSha256: hashes.editor,
        positioningMethod: 'minimap-click',
        probes: recordedProbes,
        loadedDlls: session.loadedDlls(),
        measuredAt: new Date().toISOString(),
      }
      writeCalibration(cfg.stateDir, cal)
      log.info(`calibration written; screenshots in ${spikes}`)
      return {
        ok: true,
        calibrationPath: calibrationPath(cfg.stateDir),
        positioningMethod: cal.positioningMethod,
        revealCode: revealed.code,
        checks,
        undergroundOrigin: underView.origin,
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
