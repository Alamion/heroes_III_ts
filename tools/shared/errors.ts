// Errors for the inspect/verify CLIs (tool layer; parsers use core FormatError).

export const TOOL_ERROR_CODES = {
  USAGE: 'USAGE',
  PREREQ_MISSING: 'PREREQ_MISSING',
  NOT_FOUND: 'NOT_FOUND',
  FAILED: 'FAILED',
} as const

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES]

export class ToolError extends Error {
  readonly code: ToolErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: ToolErrorCode, message: string, opts: { details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, { cause: opts.cause })
    this.name = 'ToolError'
    this.code = code
    this.details = opts.details
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) }
  }
}

export function usage(message: string): ToolError {
  return new ToolError(TOOL_ERROR_CODES.USAGE, message)
}
