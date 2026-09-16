// Local calibration: probe hashes derived from game output. Lives in stateDir, never in the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Calibration } from '../model/types.ts'

export function calibrationPath(stateDir: string): string {
  return join(stateDir, 'calibration.json')
}

export function readCalibration(stateDir: string): Calibration | undefined {
  const path = calibrationPath(stateDir)
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')) as Calibration
}

export function requireCalibration(stateDir: string, gameExeSha256: string): Calibration {
  const cal = readCalibration(stateDir)
  if (cal === undefined) {
    throw new RefError(ERROR_CODES.CALIBRATION_MISSING, 'no calibration found: run `yarn ref calibrate`')
  }
  if (cal.gameExeSha256 !== gameExeSha256) {
    throw new RefError(ERROR_CODES.CALIBRATION_MISSING, 'calibration belongs to a different Heroes3.exe: run `yarn ref calibrate`', {
      details: { calibrated: cal.gameExeSha256, current: gameExeSha256 },
    })
  }
  const missing = REQUIRED_PROBES.filter((p) => cal.probes[p] === undefined)
  if (missing.length > 0) {
    throw new RefError(ERROR_CODES.CALIBRATION_MISSING, `calibration lacks probes ${missing.join(', ')}: run \`yarn ref calibrate\``)
  }
  return cal
}

/** Probes a capture needs; calibrations written by older tooling lack some of them. */
export const REQUIRED_PROBES = ['mainMenu', 'newGameMenu', 'scenarioScreen', 'scenarioIntroOk'] as const

export function writeCalibration(stateDir: string, cal: Calibration): string {
  const path = calibrationPath(stateDir)
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
