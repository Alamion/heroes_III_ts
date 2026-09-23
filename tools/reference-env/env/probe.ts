// Recognising game screens on builds whose menus animate (spec 005 FR-021).
//
// The Complete edition draws its menus still, so a hash of a screen region identifies them. HotA
// animates the whole main menu — clouds, water and the dragon move behind the buttons, and 42 000
// of the button column's 124 200 pixels change between frames (measured 2026-09-23). A plain hash
// therefore never matches twice. Calibration records which pixels of the region hold still and
// hashes only those; navigation compares the same pixels. The mask is derived from game output,
// so it lives in the state directory and is never committed (constitution I).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng } from '../../shared/png.ts'
import type { Baseline, Rect } from '../model/types.ts'

export interface Frame {
  width: number
  rgb: Buffer
}

export function probeDir(stateDir: string, baseline: Baseline): string {
  return join(stateDir, `probes-${baseline}`)
}

export function probeMaskPath(stateDir: string, baseline: Baseline, id: string): string {
  return join(probeDir(stateDir, baseline), `${id}.png`)
}

/** Pixels that are identical in every frame (1 = stable), in the frames' own coordinates. */
export function stableMask(frames: readonly Frame[], rect: Rect): Uint8Array {
  const mask = new Uint8Array(rect.w * rect.h).fill(1)
  const first = frames[0]
  if (first === undefined) return mask
  for (const f of frames.slice(1)) {
    for (let p = 0; p < mask.length; p++) {
      const i = p * 3
      if (f.rgb[i] !== first.rgb[i] || f.rgb[i + 1] !== first.rgb[i + 1] || f.rgb[i + 2] !== first.rgb[i + 2]) mask[p] = 0
    }
  }
  return mask
}

/** sha1 over the pixels the mask keeps; without a mask, over every pixel of the frame. */
export function maskedHash(frame: Frame, mask: Uint8Array | undefined): string {
  const h = createHash('sha1')
  if (mask === undefined) {
    h.update(frame.rgb)
    return h.digest('hex')
  }
  const kept = Buffer.alloc(3)
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== 1) continue
    kept[0] = frame.rgb[p * 3] as number
    kept[1] = frame.rgb[p * 3 + 1] as number
    kept[2] = frame.rgb[p * 3 + 2] as number
    h.update(kept)
  }
  return h.digest('hex')
}

export function writeProbeMask(stateDir: string, baseline: Baseline, id: string, mask: Uint8Array, rect: Rect): string {
  mkdirSync(probeDir(stateDir, baseline), { recursive: true })
  const data = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) data[i] = mask[i] === 1 ? 255 : 0
  const path = probeMaskPath(stateDir, baseline, id)
  writeFileSync(path, encodePng({ width: rect.w, height: rect.h, channels: 1, data }))
  return path
}

export function readProbeMask(stateDir: string, baseline: Baseline, id: string): Uint8Array | undefined {
  const path = probeMaskPath(stateDir, baseline, id)
  if (!existsSync(path)) return undefined
  const img = decodePng(new Uint8Array(readFileSync(path)))
  const mask = new Uint8Array(img.width * img.height)
  for (let p = 0; p < mask.length; p++) mask[p] = (img.data[p * img.channels] as number) > 127 ? 1 : 0
  return mask
}

/** How many pixels of a region are usable for recognition; a screen with too few is not reliable. */
export function stablePixelCount(mask: Uint8Array): number {
  let n = 0
  for (const v of mask) if (v === 1) n++
  return n
}

/**
 * Pixels that hold still across `frames` and are not near-black. Videos have none of these (their
 * only constant areas are black letterbox), a drawn menu has many, so this separates "the intro is
 * still playing" from "a menu is up" on builds where nothing on screen ever settles completely.
 */
export function stableLitPixels(frames: readonly Frame[], pixels: number): number {
  const first = frames[0]
  if (first === undefined || frames.length < 2) return 0
  let count = 0
  for (let p = 0; p < pixels; p++) {
    const i = p * 3
    let same = true
    for (let f = 1; f < frames.length; f++) {
      const g = frames[f] as Frame
      if (g.rgb[i] !== first.rgb[i] || g.rgb[i + 1] !== first.rgb[i + 1] || g.rgb[i + 2] !== first.rgb[i + 2]) {
        same = false
        break
      }
    }
    if (!same) continue
    if (((first.rgb[i] as number) + (first.rgb[i + 1] as number) + (first.rgb[i + 2] as number)) / 3 > LIT_THRESHOLD) count++
  }
  return count
}

/** Above this average channel value a pixel counts as lit (not letterbox black). */
const LIT_THRESHOLD = 40
