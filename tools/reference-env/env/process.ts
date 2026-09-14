import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'

export type Env = Record<string, string | undefined>

export interface RunOptions {
  env?: Env
  cwd?: string
  timeoutMs?: number
  input?: Buffer | string
  /** Throw PROCESS_FAILED on non-zero exit (default true). */
  check?: boolean
}

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    // Group already gone; fall back to the direct child.
    child.kill(signal)
  }
}

export function runProcess(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { env = process.env, cwd, timeoutMs = 60_000, input, check = true } = opts
  log.debug('run', { cmd, args })
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { env, cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killGroup(child, 'SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      const code = (e as NodeJS.ErrnoException).code === 'ENOENT' ? ERROR_CODES.PREREQ_MISSING : ERROR_CODES.PROCESS_FAILED
      reject(new RefError(code, `cannot run ${cmd}: ${e.message}`, { cause: e }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const result = { code: code ?? -1, stdout: Buffer.concat(out), stderr: err }
      if (timedOut) {
        reject(new RefError(ERROR_CODES.PROCESS_FAILED, `${cmd} timed out after ${timeoutMs} ms`, { details: { args } }))
      } else if (check && result.code !== 0) {
        reject(
          new RefError(ERROR_CODES.PROCESS_FAILED, `${cmd} exited with ${result.code}`, {
            details: { args, stderr: err.slice(-2000) },
          }),
        )
      } else {
        resolvePromise(result)
      }
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

export interface LongRunning {
  child: ChildProcess
  exited: Promise<number>
  kill(): void
}

export function spawnLongRunning(
  cmd: string,
  args: string[],
  opts: { env?: Env; cwd?: string; stdio?: 'ignore' | 'pipe'; extraFds?: number } = {},
): LongRunning {
  const extra: ('pipe' | 'ignore')[] = Array.from({ length: opts.extraFds ?? 0 }, () => 'pipe')
  const base = opts.stdio ?? 'ignore'
  const child = spawn(cmd, args, {
    env: opts.env ?? process.env,
    cwd: opts.cwd,
    detached: true,
    stdio: [base === 'pipe' ? 'pipe' : 'ignore', base, base, ...extra],
  })
  const exited = new Promise<number>((res) => {
    child.on('exit', (code) => res(code ?? -1))
    child.on('error', () => res(-1))
  })
  return {
    child,
    exited,
    kill: () => killGroup(child, 'SIGTERM'),
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
