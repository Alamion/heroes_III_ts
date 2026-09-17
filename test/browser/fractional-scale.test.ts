// Fractional device scales (e.g. 1.5 on a large monitor): every device pixel of a tile samples a texel
// of that tile's own atlas cell. Before vertices were snapped to device pixels, quad edges on pixel
// centres sampled the neighbouring cell and drew a line between tiles.
import { readFileSync, rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { fromH3m } from '../../src/core/state/world.ts'
import { hasChromium } from '../../tools/shared/browser.ts'
import { HeadlessRenderer } from '../../tools/shared/render-page.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'

const chromium = hasChromium()
if (!chromium) process.stderr.write('[browser tests skipped] Chromium not found (set H3_CHROMIUM)\n')

const TILES = 8
const ORIGIN = { x: 4, y: 4 }

describe.skipIf(!chromium)('fractional device scale', () => {
  let renderer: HeadlessRenderer
  let files: ReturnType<typeof writeSyntheticFiles>

  beforeAll(async () => {
    files = writeSyntheticFiles([{ name: 'synthetic-36.h3m', size: 36, underground: false }])
    renderer = await HeadlessRenderer.open({ rebuild: true, width: 512, height: 512 })
  }, 120_000)

  afterAll(async () => {
    await renderer?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  const render = (scale: number, shift: number, size: number) =>
    renderer.render({ archive: files.archive, map: files.maps['synthetic-36.h3m'] as string, dataArchive: null, objects: false, width: size, height: size, level: 0, originTile: ORIGIN, originPixel: { x: shift, y: shift }, step: 0, scale })

  // Tiles whose pixels are terrain only: river and road overlays (roads 16 px down) are sampled
  // independently of the terrain below, so their mixes need not appear in the 1:1 reference.
  const plainTiles = () => {
    const map = fromH3m(parseH3m(gunzipSync(readFileSync(files.maps['synthetic-36.h3m'] as string)), 'synthetic-36.h3m'), { sha256: 'x', name: 'synthetic-36.h3m', version: 'SoD' }, 1)
    const size = map.size
    const at = (x: number, y: number) => ((ORIGIN.y + y) * size + ORIGIN.x + x) * 7
    const plain = (x: number, y: number) => y >= 0 && map.terrain[at(x, y) + 2] === 0 && map.terrain[at(x, y) + 4] === 0 && (y === 0 || map.terrain[at(x, y - 1) + 4] === 0)
    return (x: number, y: number) => x >= 0 && y >= 0 && x < TILES && y < TILES && plain(x, y)
  }

  it.each([
    [1.5, 1.5],
    [1.25, 0.25],
    [1.75, 0.75],
  ])('scale %s with tile edges on pixel centres samples only the own tile', async (scale, shift) => {
    const world = TILES * TILE_SIZE
    const ref = await render(1, 0, world)
    const size = Math.floor((world - 2 * TILE_SIZE) * scale)
    const scaled = await render(scale, shift, size)
    // World pixel of the viewport's left edge relative to ORIGIN, and the snapped device edge of tile t.
    const off = -shift / scale
    const edge = (t: number) => Math.floor((t * TILE_SIZE - off) * scale + 0.5)
    // Device pixel → [tile, texel candidates] along one axis (±1 texel of interpolation slack).
    const axis = (p: number): [number, number[]] => {
      let t = Math.floor((p / scale + off) / TILE_SIZE)
      while (edge(t + 1) <= p) t++
      while (edge(t) > p) t--
      const texel = Math.floor(((p + 0.5 - edge(t)) / (edge(t + 1) - edge(t))) * TILE_SIZE)
      return [t, [texel - 1, texel, texel + 1].filter((v) => v >= 0 && v < TILE_SIZE)]
    }
    const plain = plainTiles()
    let foreign = 0
    let checked = 0
    // Partly visible tiles at the viewport edge are outside the reference render.
    for (let y = 0; y < size; y++) {
      const [ty, rows] = axis(y)
      if (ty < 0 || ty >= TILES) continue
      for (let x = 0; x < size; x++) {
        const [tx, cols] = axis(x)
        if (!plain(tx, ty)) continue
        checked++
        const o = (y * size + x) * 4
        const match = rows.some((ry) =>
          cols.some((cx) => {
            const r = ((ty * TILE_SIZE + ry) * world + tx * TILE_SIZE + cx) * 4
            return ref.rgba[r] === scaled.rgba[o] && ref.rgba[r + 1] === scaled.rgba[o + 1] && ref.rgba[r + 2] === scaled.rgba[o + 2]
          }),
        )
        if (!match) foreign++
      }
    }
    expect(checked).toBeGreaterThan(size * size * 0.5)
    expect(foreign).toBe(0)
  }, 60_000)
})
