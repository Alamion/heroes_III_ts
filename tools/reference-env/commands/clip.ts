import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { FrameTimelineBuilder, toTimeline } from '../analysis/frame-timeline.ts'
import { cropForRegion } from '../analysis/geometry.ts'
import { GAME_VIEW } from '../data/game-layout.ts'
import { grabStream, writePng } from '../env/grab.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { CaptureMatch, CaptureRecord } from '../model/types.ts'
import { captureDir, captureId, writeCaptureAtomically } from '../store/capture-store.ts'
import { config, intOpt } from './common.ts'
import { gameRecordBase, runGameCapture } from './session.ts'

export const CLIP_FPS = 60

export const clipCommand: Command = async (args) => {
  const cfg = config()
  const durationMs = intOpt(args, 'duration')
  if (durationMs < 500 || durationMs > 60_000) throw new RefError(ERROR_CODES.USAGE, '--duration must be 500–60000 ms')
  const capture = await runGameCapture(cfg, args, 'clip', cfg.timeouts.clipBase + cfg.timeouts.still + durationMs, async (s) => {
    const vp = GAME_VIEW.viewport
    const builder = new FrameTimelineBuilder(CLIP_FPS)
    const grabbed = await grabStream(s.session.display.display, vp, CLIP_FPS, durationMs, (rgb) => builder.push(rgb))
    const result = builder.finish()
    log.info('clip grabbed', { grabbed, distinct: result.frames.length, shortestStepMs: result.shortestStepMs })

    const createdAt = new Date()
    const id = captureId(createdAt, s.view.visible)
    const fileOf = (i: number) => `frames/${String(i).padStart(4, '0')}.png`
    const timeline = toTimeline(CLIP_FPS, result.frames, fileOf)
    const record: CaptureRecord = {
      ...(await gameRecordBase(cfg, s, id, createdAt, 'clip')),
      files: { frames: 'frames', timeline: 'frames.json' },
      clip: {
        grabFps: CLIP_FPS,
        durationMs,
        distinctFrames: result.frames.length,
        shortestStepMs: Number.isFinite(result.shortestStepMs) ? result.shortestStepMs : durationMs,
        resolvesAllSteps: result.resolvesAllSteps,
      },
    }
    // Clip frames are cropped to the viewport: pixel coordinates are relative to the crop.
    record.mapping = { ...record.mapping, originPixel: { x: record.mapping.originPixel.x - vp.x, y: record.mapping.originPixel.y - vp.y }, viewport: { x: 0, y: 0, w: vp.w, h: vp.h } }
    const dir = captureDir(cfg.capturesDir, s.ctx.map.key, s.ctx.level, 'game', 'clip', id)
    await writeCaptureAtomically(dir, record, async (tmp) => {
      mkdirSync(join(tmp, 'frames'))
      for (const f of result.frames) await writePng({ width: vp.w, height: vp.h, rgb: f.rgb }, join(tmp, fileOf(f.index)))
      writeFileSync(join(tmp, 'frames.json'), `${JSON.stringify(timeline, null, 2)}\n`)
    })
    const match: CaptureMatch = {
      id,
      dir,
      record,
      crop: cropForRegion(record.mapping, { x0: s.ctx.target.x, y0: s.ctx.target.y, x1: s.ctx.target.x, y1: s.ctx.target.y }),
    }
    return match
  })
  return { ok: true, capture }
}
