// Merges identical consecutive frames of a fixed-rate grab into a timeline of distinct frames.
import { createHash } from 'node:crypto'
import type { FrameTimeline, TimelineFrame } from '../model/types.ts'

export interface DistinctFrame {
  index: number
  rgb: Buffer
  md5: string
  tStartMs: number
  tEndMs: number
}

export interface TimelineResult {
  frames: DistinctFrame[]
  shortestStepMs: number
  resolvesAllSteps: boolean
}

export class FrameTimelineBuilder {
  readonly grabFps: number
  private readonly frames: DistinctFrame[] = []
  private count = 0

  constructor(grabFps: number) {
    this.grabFps = grabFps
  }

  /** Adds the next grabbed frame; its time is its index at the fixed grab rate. */
  push(rgb: Buffer): void {
    const t = (this.count * 1000) / this.grabFps
    this.count++
    const md5 = createHash('md5').update(rgb).digest('hex')
    const last = this.frames.at(-1)
    if (last !== undefined && last.md5 === md5) {
      last.tEndMs = (this.count * 1000) / this.grabFps
      return
    }
    this.frames.push({ index: this.frames.length, rgb, md5, tStartMs: t, tEndMs: (this.count * 1000) / this.grabFps })
  }

  finish(): TimelineResult {
    const interval = 1000 / this.grabFps
    // First and last frames are truncated by the recording window; exclude them from step length.
    const inner = this.frames.slice(1, -1)
    const shortestStepMs = inner.length > 0 ? Math.min(...inner.map((f) => f.tEndMs - f.tStartMs)) : Infinity
    return {
      frames: this.frames,
      shortestStepMs,
      resolvesAllSteps: Number.isFinite(shortestStepMs) && interval <= shortestStepMs / 2,
    }
  }
}

export function toTimeline(grabFps: number, frames: DistinctFrame[], fileOf: (index: number) => string): FrameTimeline {
  const out: TimelineFrame[] = frames.map((f) => ({ index: f.index, file: fileOf(f.index), tStartMs: f.tStartMs, tEndMs: f.tEndMs, md5: f.md5 }))
  return { grabFps, frames: out }
}

/** The distinct frame shown at time `t` (ms from the start of the clip). */
export function frameAt(timeline: FrameTimeline, t: number): TimelineFrame | undefined {
  return timeline.frames.find((f) => t >= f.tStartMs && t < f.tEndMs)
}
