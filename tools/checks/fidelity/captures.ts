// Loads reference captures (item 1 store) for fidelity checks, plus the viewport UI ornament mask
// derived at run time from the local stills (research.md "Implementation findings").

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findCaptures, scanRecords } from '../../reference-env/store/lookup.ts'
import type { CaptureRecord, FrameTimeline } from '../../reference-env/model/types.ts'
import { decodePng } from '../../shared/png.ts'
import type { PngImage } from '../../shared/png.ts'
import type { Region } from '../../shared/cli-runner.ts'

export interface LoadedStill {
  kind: 'still'
  dir: string
  record: CaptureRecord
  image: PngImage
  /** One byte per screen pixel, 255 = volatile. */
  volatile: Uint8Array | null
}

export interface LoadedClip {
  kind: 'clip'
  dir: string
  record: CaptureRecord
  timeline: FrameTimeline
  /** Decoded lazily per frame. */
  frame(index: number): PngImage
}

export type LoadedCapture = LoadedStill | LoadedClip

function gray(img: PngImage): Uint8Array {
  if (img.channels === 1) return img.data
  const out = new Uint8Array(img.width * img.height)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * img.channels] as number
  return out
}

export function loadCapture(dir: string, record: CaptureRecord): LoadedCapture {
  if (record.kind === 'still') {
    const image = decodePng(new Uint8Array(readFileSync(join(dir, record.files.still ?? 'still.png'))))
    const maskFile = record.files.volatileMask
    const volatile = maskFile !== undefined && existsSync(join(dir, maskFile)) ? gray(decodePng(new Uint8Array(readFileSync(join(dir, maskFile))))) : null
    return { kind: 'still', dir, record, image, volatile }
  }
  const timeline = JSON.parse(readFileSync(join(dir, record.files.timeline ?? 'frames.json'), 'utf8')) as FrameTimeline
  return {
    kind: 'clip',
    dir,
    record,
    timeline,
    frame: (index) => decodePng(new Uint8Array(readFileSync(join(dir, (timeline.frames[index] as { file: string }).file)))),
  }
}

export function findFor(capturesDir: string, map: string, level: 0 | 1, region: Region, kind: 'still' | 'clip' | undefined): { dir: string; record: CaptureRecord }[] {
  return findCaptures(capturesDir, { map, level, region, source: 'game', ...(kind !== undefined ? { kind } : {}) }).map((m) => ({ dir: m.dir, record: m.record }))
}

export function allGameCaptures(capturesDir: string, map: string): { dir: string; record: CaptureRecord }[] {
  const m = map.normalize('NFC').toLowerCase().replace(/\.h3m$/, '')
  return scanRecords(capturesDir).filter(({ record: r }) => r.source === 'game' && (r.map.key.toLowerCase() === m || r.map.name.toLowerCase().replace(/\.h3m$/, '') === m))
}

export const UI_CORNER = 64

export interface UiMask {
  width: number
  height: number
  /** Viewport-sized, 1 = UI ornament pixel. */
  mask: Uint8Array
}

/**
 * Pixels of the four viewport corner squares that are identical in all local game stills of at
 * least three distinct views: the adventure-map UI ornaments, in viewport coordinates. Null when
 * too few stills exist.
 */
export function uiCornerMask(capturesDir: string): UiMask | null {
  const stills = scanRecords(capturesDir).filter(({ record: r }) => r.source === 'game' && r.kind === 'still')
  const sample = stills[0]
  if (sample === undefined) return null
  const viewport = sample.record.mapping.viewport
  const screen = sample.record.display
  const views = new Map<string, { dir: string; record: CaptureRecord }>()
  for (const s of stills) {
    const v = s.record.mapping.viewport
    if (v.x !== viewport.x || v.y !== viewport.y || v.w !== viewport.w || v.h !== viewport.h) continue
    views.set(`${s.record.map.key}:${s.record.level}:${s.record.mapping.originTile.x},${s.record.mapping.originTile.y}`, s)
  }
  if (views.size < 3) return null
  const images = [...views.values()].slice(0, 24).map((s) => decodePng(new Uint8Array(readFileSync(join(s.dir, s.record.files.still ?? 'still.png')))))
  const mask = new Uint8Array(viewport.w * viewport.h)
  const first = images[0] as PngImage
  const corners = [
    [viewport.x, viewport.y],
    [viewport.x + viewport.w - UI_CORNER, viewport.y],
    [viewport.x, viewport.y + viewport.h - UI_CORNER],
    [viewport.x + viewport.w - UI_CORNER, viewport.y + viewport.h - UI_CORNER],
  ] as const
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + UI_CORNER; y++) {
      for (let x = cx; x < cx + UI_CORNER; x++) {
        const i = (y * screen.width + x) * first.channels
        const same = images.every((img) => img.data[i] === first.data[i] && img.data[i + 1] === first.data[i + 1] && img.data[i + 2] === first.data[i + 2])
        if (same) mask[(y - viewport.y) * viewport.w + (x - viewport.x)] = 1
      }
    }
  }
  return { width: viewport.w, height: viewport.h, mask }
}
