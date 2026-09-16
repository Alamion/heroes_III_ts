export const ERROR_CODES = {
  USAGE: 'USAGE',
  CONFIG_INVALID: 'CONFIG_INVALID',
  PREREQ_MISSING: 'PREREQ_MISSING',
  HASH_MISMATCH: 'HASH_MISMATCH',
  LOCKED: 'LOCKED',
  DISPLAY_FAILED: 'DISPLAY_FAILED',
  LAUNCH_TIMEOUT: 'LAUNCH_TIMEOUT',
  NAVIGATION_TIMEOUT: 'NAVIGATION_TIMEOUT',
  INPUT_IGNORED: 'INPUT_IGNORED',
  MAP_UNSUPPORTED: 'MAP_UNSUPPORTED',
  REVEAL_FAILED: 'REVEAL_FAILED',
  POSITION_MISMATCH: 'POSITION_MISMATCH',
  GRAB_FAILED: 'GRAB_FAILED',
  CALIBRATION_MISSING: 'CALIBRATION_MISSING',
  PROCESS_FAILED: 'PROCESS_FAILED',
  GAME_CRASHED: 'GAME_CRASHED',
  LEVEL_UNKNOWN: 'LEVEL_UNKNOWN',
  LEVEL_MISMATCH: 'LEVEL_MISMATCH',
  MAPPING_UNVERIFIED: 'MAPPING_UNVERIFIED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export class RefError extends Error {
  readonly code: ErrorCode
  readonly step: string | undefined
  readonly details: Record<string, unknown> | undefined

  constructor(
    code: ErrorCode,
    message: string,
    opts: { step?: string; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause })
    this.name = 'RefError'
    this.code = code
    this.step = opts.step
    this.details = opts.details
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.step !== undefined ? { step: this.step } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    }
  }
}
