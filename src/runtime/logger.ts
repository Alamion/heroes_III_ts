// Browser log sink: level-gated console output (production builds default to warnings only).

import { setLogLevel, setLogSink } from '../core/util/log.ts'
import type { LogLevel } from '../core/util/log.ts'

export interface Logger {
  level: LogLevel
  sink?: (level: LogLevel, message: string, data?: unknown) => void
}

export function installLogger(logger: Logger): void {
  setLogLevel(logger.level)
  setLogSink(
    logger.sink ??
      ((level, message, data) => {
        const args: unknown[] = data === undefined ? [`[h3] ${message}`] : [`[h3] ${message}`, data]
        if (level === 'error') console.error(...args)
        else if (level === 'warn') console.warn(...args)
        else console.info(...args)
      }),
  )
}
