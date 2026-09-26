// Fractional device scales (e.g. 1.5 on a large monitor): the image must be the nearest-neighbour
// upscale of the scale-1 image — every device pixel shows the world pixel under its centre. This
// catches lines between tiles (a cell sampling its neighbour) and cropped animation frames moving by a
// device pixel between frames (spec 004 research "Pixel mapping at fractional display scales").
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { hasChromium } from '../../tools/shared/browser.ts'
import { HeadlessRenderer } from '../../tools/shared/render-page.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'

const chromium = hasChromium()
if (!chromium) process.stderr.write('[browser tests skipped] Chromium not found (set H3_CHROMIUM)\n')

/** Scaled view: this tile at the device origin, shifted by a fraction of a device pixel's worth. */
const ORIGIN = { x: 8, y: 10 }
/** The scale-1 reference starts one tile earlier and covers VIEW + 2 tiles, so the scaled view stays inside. */
const VIEW = 8 * TILE_SIZE
const REF = VIEW + 2 * TILE_SIZE

describe.skipIf(!chromium)('fractional device scale', () => {
  let renderer: HeadlessRenderer
  let files: ReturnType<typeof writeSyntheticFiles>

  beforeAll(async () => {
    files = writeSyntheticFiles([{ name: 'synthetic-36.h3m', size: 36, underground: false }])
    renderer = await HeadlessRenderer.open({ width: 512, height: 512 })
  }, 120_000)

  afterAll(async () => {
    await renderer?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  const render = (originTile: { x: number; y: number }, shift: number, scale: number, size: number, tick: number) =>
    renderer.render({ archive: files.archive, map: files.maps['synthetic-36.h3m'] as string, dataArchive: files.dataArchive, width: size, height: size, level: 0, originTile, originPixel: { x: shift, y: shift }, step: 0, tick, seed: 1, scale })

  it.each([
    [1.5, 1.5],
    [1.5, 0],
    [1.25, 0.25],
    [1.75, 0.75],
  ])('scale %s (shift %s) equals the nearest-neighbour upscale of scale 1 at every animation tick', async (scale, shift) => {
    const size = Math.floor(VIEW * scale)
    // World pixel (relative to the reference's top-left) under the centre of device pixel p; a centre
    // exactly on a pixel boundary belongs to the next pixel.
    const world = (p: number) => Math.floor(TILE_SIZE - shift / scale + (p + 0.5) / scale + 1e-9)
    for (let tick = 0; tick < 6; tick++) {
      const ref = await render({ x: ORIGIN.x - 1, y: ORIGIN.y - 1 }, 0, 1, REF, tick)
      const scaled = await render(ORIGIN, shift, scale, size, tick)
      expect(scaled.stats.objectQuads).toBeGreaterThan(0)
      let wrong = 0
      for (let y = 0; y < size; y++) {
        const wy = world(y)
        for (let x = 0; x < size; x++) {
          const r = (wy * REF + world(x)) * 4
          const o = (y * size + x) * 4
          if (ref.rgba[r] !== scaled.rgba[o] || ref.rgba[r + 1] !== scaled.rgba[o + 1] || ref.rgba[r + 2] !== scaled.rgba[o + 2]) wrong++
        }
      }
      expect({ tick, wrong }).toEqual({ tick, wrong: 0 })
    }
  }, 120_000)
})
