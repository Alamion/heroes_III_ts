import type { Readable } from 'node:stream'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import { runProcess, sleep, spawnLongRunning } from './process.ts'

export interface VirtualDisplay {
  display: string
  width: number
  height: number
  depth: number
  stop(): Promise<void>
}

function readDisplayNumber(stream: Readable, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('Xvfb did not report a display number')), timeoutMs)
    stream.on('data', (d: Buffer) => {
      buf += d.toString()
      const m = /^(\d+)\n/.exec(buf)
      if (m?.[1] !== undefined) {
        clearTimeout(timer)
        resolvePromise(m[1])
      }
    })
    stream.on('end', () => reject(new Error('Xvfb exited before reporting a display number')))
  })
}

export async function startDisplay(opts: { width: number; height: number; depth?: number }): Promise<VirtualDisplay> {
  const depth = opts.depth ?? 24
  // fd 3 of the child is a pipe; Xvfb writes the chosen display number there.
  const proc = spawnLongRunning(
    'Xvfb',
    ['-displayfd', '3', '-screen', '0', `${opts.width}x${opts.height}x${depth}`, '-nolisten', 'tcp'],
    { stdio: 'ignore', extraFds: 1 },
  )
  const fd3 = proc.child.stdio[3] as Readable | null
  if (fd3 === null) throw new RefError(ERROR_CODES.DISPLAY_FAILED, 'cannot open Xvfb display fd')
  let display: string
  try {
    display = `:${await readDisplayNumber(fd3, 10_000)}`
  } catch (err) {
    proc.kill()
    throw new RefError(ERROR_CODES.DISPLAY_FAILED, `Xvfb failed to start: ${(err as Error).message}`, { cause: err })
  }
  const env = { ...process.env, DISPLAY: display }
  for (let i = 0; ; i++) {
    const r = await runProcess('xdotool', ['getdisplaygeometry'], { env, check: false, timeoutMs: 5000 })
    if (r.code === 0) break
    if (i > 50) {
      proc.kill()
      throw new RefError(ERROR_CODES.DISPLAY_FAILED, `display ${display} not reachable`)
    }
    await sleep(100)
  }
  log.debug('virtual display up', { display, ...opts })
  return {
    display,
    width: opts.width,
    height: opts.height,
    depth,
    stop: async () => {
      proc.kill()
      await Promise.race([proc.exited, sleep(3000)])
    },
  }
}
