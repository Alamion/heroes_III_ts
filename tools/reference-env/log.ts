// Level-gated logger. Writes to stderr only; stdout is reserved for the command's JSON result.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

let current: LogLevel = 'info'

export function isLogLevel(value: string): value is LogLevel {
  return value in ORDER
}

export function setLogLevel(level: LogLevel): void {
  current = level
}

function write(level: LogLevel, message: string, data?: unknown): void {
  if (ORDER[level] > ORDER[current]) return
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`
  process.stderr.write(`[${level}] ${message}${suffix}\n`)
}

export const log = {
  error: (message: string, data?: unknown) => write('error', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  info: (message: string, data?: unknown) => write('info', message, data),
  debug: (message: string, data?: unknown) => write('debug', message, data),
}
