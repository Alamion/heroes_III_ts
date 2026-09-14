import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { buildVolatileMask } from '../analysis/volatile-mask.ts'
import { GAME_SCREEN } from '../data/game-layout.ts'
import { writeGrayPng, writePng } from '../env/grab.ts'
import { sleep } from '../env/process.ts'
import { cropForRegion } from '../analysis/geometry.ts'
import { writeCaptureAtomically, captureDir, captureId } from '../store/capture-store.ts'
import type { CaptureMatch, CaptureRecord } from '../model/types.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { config } from './common.ts'
import { gameRecordBase, runGameCapture } from './session.ts'

export const stillCommand: Command = async (args) => {
  const cfg = config()
  const capture = await runGameCapture(cfg, args, 'still', cfg.timeouts.still, async (s) => {
    // Frames for the volatile mask: ~2 s of grabs.
    const frames = []
    for (let i = 0; i < 12; i++) {
      frames.push(await s.session.grab())
      await sleep(170)
    }
    const still = frames[0]
    if (still === undefined) throw new RefError(ERROR_CODES.GRAB_FAILED, 'no frames grabbed')
    const mask = buildVolatileMask(
      frames.map((f) => f.rgb),
      GAME_SCREEN.width,
      GAME_SCREEN.height,
    )
    const createdAt = new Date()
    const id = captureId(createdAt, s.view.visible)
    const record: CaptureRecord = {
      ...(await gameRecordBase(cfg, s, id, createdAt, 'still')),
      files: { still: 'still.png', volatileMask: 'volatile-mask.png' },
    }
    const dir = captureDir(cfg.capturesDir, s.ctx.map.key, s.ctx.level, 'game', 'still', id)
    await writeCaptureAtomically(dir, record, async (tmp) => {
      await writePng(still, join(tmp, 'still.png'))
      await writeGrayPng(mask, GAME_SCREEN.width, GAME_SCREEN.height, join(tmp, 'volatile-mask.png'))
    })
    const match: CaptureMatch = {
      id,
      dir,
      record,
      crop: cropForRegion(record.mapping, { x0: record.requested.x, y0: record.requested.y, x1: record.requested.x, y1: record.requested.y }),
    }
    return match
  })
  return { ok: true, capture }
}
