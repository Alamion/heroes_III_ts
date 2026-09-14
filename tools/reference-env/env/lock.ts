import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import { sleep } from './process.ts'

export interface Lock {
  path: string
  release(): void
}

interface LockInfo {
  pid: number
  startedAt: string
  command: string
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLock(path: string): LockInfo | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo
  } catch {
    return undefined
  }
}

export function lockPath(stateDir: string): string {
  return join(stateDir, 'capture.lock')
}

export function readActiveLock(stateDir: string): LockInfo | undefined {
  const info = readLock(lockPath(stateDir))
  return info !== undefined && pidAlive(info.pid) ? info : undefined
}

export async function acquireLock(
  stateDir: string,
  waitMs: number,
  command: string,
  pollMs = 1000,
): Promise<Lock> {
  mkdirSync(stateDir, { recursive: true })
  const path = lockPath(stateDir)
  const deadline = Date.now() + waitMs
  const mine: LockInfo = { pid: process.pid, startedAt: new Date().toISOString(), command }
  let announced = false
  for (;;) {
    try {
      writeFileSync(path, JSON.stringify(mine), { flag: 'wx' })
      return {
        path,
        release: () => {
          if (readLock(path)?.pid === process.pid) unlinkSync(path)
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const holder = readLock(path)
    if (holder === undefined || !pidAlive(holder.pid)) {
      log.warn('taking over stale capture lock', holder)
      try {
        unlinkSync(path)
      } catch {
        // Another process removed it first; retry the exclusive create.
      }
      continue
    }
    if (Date.now() >= deadline) {
      throw new RefError(ERROR_CODES.LOCKED, `another capture is running (pid ${holder.pid}, ${holder.command})`, {
        details: { ...holder },
      })
    }
    if (!announced) {
      log.info('waiting for capture lock', holder)
      announced = true
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }
}
