// US3 (spec 005 FR-008, SC-003): HotA support is additive — base-game renders did not move.
//
// The digests in base-render-baseline.json were taken from the base-game code before spec 005
// changed anything (tasks.md T002). Re-rendering the same regions with the same time and seed must
// reproduce them exactly. Skips with a message when the game files are absent.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { animationStep } from '../../src/core/render/palette.ts'
import { encodePng } from '../../tools/shared/png.ts'
import { requireGameFile, requireTestMap } from '../../tools/shared/game-files.ts'
import { HeadlessRenderer } from '../../tools/shared/render-page.ts'

interface Baseline {
  map: string
  seed: number
  renders: { name: string; level: number; region: string; time: number; bytes: number; sha256: string }[]
}

const baseline = JSON.parse(readFileSync(join('test', 'real', 'base-render-baseline.json'), 'utf8')) as Baseline
const map = requireTestMap()
const sprites = requireGameFile('h3sprite.lod')
const data = requireGameFile('h3bitmap.lod')
const ready = map !== null && sprites !== null && data !== null
if (!ready) process.stderr.write('[real-file test skipped] base render baseline: needs test_map.h3m, h3sprite.lod and h3bitmap.lod\n')

describe.skipIf(!ready)('base-game renders are unchanged by HotA support', () => {
  it('reproduces every pre-feature render byte for byte', async () => {
    const differing: string[] = []
    for (const r of baseline.renders) {
      const [x0, y0, x1, y1] = r.region.split(',').map(Number) as [number, number, number, number]
      const width = (x1 - x0 + 1) * TILE_SIZE
      const height = (y1 - y0 + 1) * TILE_SIZE
      // One renderer per region with a viewport of exactly that size, as the CLI does: the
      // viewport is part of what the engine renders.
      const renderer = await HeadlessRenderer.open({ mode: 'dev', width: Math.max(width, 64), height: Math.max(height, 64) })
      try {
        // Same call the CLI made when the baseline was taken: a palette step derived from the
        // time, the step as the object tick, and the data archive resolved by the page.
        const step = animationStep(r.time)
        const frame = await renderer.render({
          archive: sprites as string,
          map: map as string,
          width,
          height,
          level: r.level,
          originTile: { x: x0, y: y0 },
          originPixel: { x: 0, y: 0 },
          step,
          tick: step,
          seed: baseline.seed,
          objects: true,
        })
        const png = encodePng({ width, height, channels: 4, data: frame.rgba })
        const sha = createHash('sha256').update(png).digest('hex')
        if (sha !== r.sha256) differing.push(`${r.name}: ${sha.slice(0, 12)} != ${r.sha256.slice(0, 12)}`)
      } finally {
        await renderer.close()
      }
    }
    expect(differing).toEqual([])
  }, 600_000)

  it('keeps the stored PNGs available for a visual diff when the report folder survives', () => {
    // Not a failure when the folder was cleaned: the digests above are the proof, the PNGs only
    // make a difference easier to look at.
    const dir = join('check-reports', 'baseline-005')
    if (!existsSync(dir)) return
    for (const r of baseline.renders) expect(existsSync(join(dir, `${r.name}.png`))).toBe(true)
  })
})
