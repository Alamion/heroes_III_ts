import { createHash } from 'node:crypto'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Rect } from '../model/types.ts'

export interface StableOptions {
  consecutive?: number
  intervalMs?: number
  timeoutMs: number
  step: string
}

export interface Grabbed {
  width: number
  rgb: Buffer
}

/** Grabs until `consecutive` identical frames in a row; returns the stable frame. */
export async function waitUntilStable<T extends Grabbed>(grab: () => Promise<T>, opts: StableOptions): Promise<T> {
  const consecutive = opts.consecutive ?? 3
  const interval = opts.intervalMs ?? 250
  const deadline = Date.now() + opts.timeoutMs
  let prev = await grab()
  let same = 1
  while (same < consecutive) {
    if (Date.now() > deadline) {
      throw new RefError(ERROR_CODES.NAVIGATION_TIMEOUT, `screen did not settle during "${opts.step}"`, {
        step: opts.step,
      })
    }
    await new Promise((r) => setTimeout(r, interval))
    const next = await grab()
    same = next.rgb.equals(prev.rgb) ? same + 1 : 1
    prev = next
  }
  return prev
}

/** sha1 of the RGB bytes inside `rect` of a frame `width` pixels wide. */
export function regionHash(rgb: Buffer, width: number, rect: Rect): string {
  const h = createHash('sha1')
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const start = (y * width + rect.x) * 3
    h.update(rgb.subarray(start, start + rect.w * 3))
  }
  return h.digest('hex')
}
