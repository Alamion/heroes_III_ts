// Project logger (constitution VII): level-gated, with an injectable sink so core code never
// touches the console or process streams directly.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export type LogSink = (level: LogLevel, message: string, data?: unknown) => void

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

let currentLevel: LogLevel = 'warn'
let sink: LogSink = () => {}

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(ORDER, value)
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

/** Replaces the output sink; returns the previous one. */
export function setLogSink(next: LogSink): LogSink {
  const prev = sink
  sink = next
  return prev
}

function write(level: LogLevel, message: string, data?: unknown): void {
  if (ORDER[level] > ORDER[currentLevel]) return
  sink(level, message, data)
}

export const log = {
  error: (message: string, data?: unknown): void => write('error', message, data),
  warn: (message: string, data?: unknown): void => write('warn', message, data),
  info: (message: string, data?: unknown): void => write('info', message, data),
  debug: (message: string, data?: unknown): void => write('debug', message, data),
}
