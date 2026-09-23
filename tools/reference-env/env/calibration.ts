// Local calibration: probe hashes derived from game output. Lives in stateDir, never in the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { baselineProfile } from '../data/baselines.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Baseline, Calibration } from '../model/types.ts'

/** Each baseline keeps its own probes: the two builds draw different menus. */
export function calibrationPath(stateDir: string, baseline: Baseline): string {
  return join(stateDir, baselineProfile(baseline).calibrationFile)
}

export function readCalibration(stateDir: string, baseline: Baseline): Calibration | undefined {
  const path = calibrationPath(stateDir, baseline)
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')) as Calibration
}

export function requireCalibration(stateDir: string, baseline: Baseline, gameExeSha256: string): Calibration {
  const profile = baselineProfile(baseline)
  const suffix = baseline === 'complete' ? '' : ` --baseline ${baseline}`
  const cal = readCalibration(stateDir, baseline)
  if (cal === undefined) {
    throw new RefError(ERROR_CODES.CALIBRATION_MISSING, `no ${baseline} calibration found: run \`yarn ref calibrate${suffix}\``)
  }
  if (cal.gameExeSha256 !== gameExeSha256) {
    throw new RefError(ERROR_CODES.CALIBRATION_MISSING, `calibration belongs to a different ${profile.gameExe}: run \`yarn ref calibrate${suffix}\``, {
      details: { baseline, calibrated: cal.gameExeSha256, current: gameExeSha256 },
    })
  }
  const missing = REQUIRED_PROBES.filter((p) => cal.probes[p] === undefined)
  if (missing.length > 0) {
    throw new RefError(ERROR_CODES.CALIBRATION_MISSING, `calibration lacks probes ${missing.join(', ')}: run \`yarn ref calibrate${suffix}\``)
  }
  return cal
}

/** Probes a capture needs; calibrations written by older tooling lack some of them. */
export const REQUIRED_PROBES = ['mainMenu', 'newGameMenu', 'scenarioScreen', 'scenarioIntroOk'] as const

export function writeCalibration(stateDir: string, baseline: Baseline, cal: Calibration): string {
  const path = calibrationPath(stateDir, baseline)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(cal, null, 2)}\n`)
  return path
}

/** Probe ids used by the game session. */
export const PROBES = {
  /** Button column of the main menu. */
  mainMenu: 'mainMenu',
  /** Button column of the "new game" submenu. */
  newGameMenu: 'newGameMenu',
  /** Begin/Back buttons of the scenario selection screen. */
  scenarioScreen: 'scenarioScreen',
  /** OK button of the scenario intro message (absent on maps without one). */
  scenarioIntroOk: 'scenarioIntroOk',
} as const
