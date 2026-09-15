// `yarn verify determinism` (SC-008): the same region rendered in fresh pages is pixel-identical.

import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { flag, intOpt, opt, parseRegion } from '../shared/cli-runner.ts'
import { hasChromium } from '../shared/browser.ts'
import { requireGameFile } from '../shared/game-files.ts'
import { HeadlessRenderer } from '../shared/render-page.ts'
import { writeSyntheticFiles } from '../../test/fixtures/synthetic/terrain-archive.ts'

export async function determinismCommand(args: ParsedArgs): Promise<CommandResult> {
  if (!hasChromium()) return { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no-chromium' }
  const runs = intOpt(args, 'runs', 10)
  const region = parseRegion(opt(args, 'region') ?? '0,0,19,16')
  const level = intOpt(args, 'level', 0)
  let archive = opt(args, 'archive') === undefined ? requireGameFile('h3sprite.lod') : opt(args, 'archive') ?? null
  let map = opt(args, 'map') === undefined ? requireGameFile('Arrogance.h3m') : opt(args, 'map') ?? null
  let synthetic: { dir: string } | undefined
  if (archive === null || map === null) {
    const files = writeSyntheticFiles()
    synthetic = files
    archive = files.archive
    map = files.maps['synthetic-36.h3m'] as string
  }
  const width = (region.x1 - region.x0 + 1) * TILE_SIZE
  const height = (region.y1 - region.y0 + 1) * TILE_SIZE
  const hashes: string[] = []
  try {
    for (let i = 0; i < runs; i++) {
      // A fresh browser and page per run: nothing may leak between renders.
      const renderer = await HeadlessRenderer.open({ rebuild: i === 0 && flag(args, 'rebuild'), width, height })
      try {
        const frame = await renderer.render({ archive, map, width, height, level, originTile: { x: region.x0, y: region.y0 }, originPixel: { x: 0, y: 0 }, step: 5 })
        hashes.push(createHash('sha256').update(frame.rgba).digest('hex'))
      } finally {
        await renderer.close()
      }
    }
  } finally {
    if (synthetic !== undefined) rmSync(synthetic.dir, { recursive: true, force: true })
  }
  const distinct = new Set(hashes)
  return { ok: distinct.size === 1, outcome: distinct.size === 1 ? 'pass' : 'fail', runs, synthetic: synthetic !== undefined, region, level, distinctImages: distinct.size, hashes }
}
