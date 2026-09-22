import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { LodArchive } from '../../../src/core/formats/lod/lod.ts'
import { parseDef } from '../../../src/core/formats/def/def.ts'
import { parseH3m } from '../../../src/core/formats/h3m/h3m.ts'
import { buildAtlas, toDisplayColor } from '../../../src/core/render/atlas.ts'
import { borderFrame, buildDrawPlan, maxQuads, VERTEX_SIZE, VERTICES_PER_QUAD } from '../../../src/core/render/draw-plan.ts'
import { cameraForMapping, clampCamera, rangeContains, visibleRange } from '../../../src/core/render/camera.ts'
import { allAnimationStates, animationStep, nextStepTime, paletteRowsAt, palettesAt } from '../../../src/core/render/palette.ts'
import { rotatePalette } from '../../../src/core/render/palette-math.ts'
import { rasterize } from '../../../src/core/render/software.ts'
import { terrainLayerDefs, TERRAINS } from '../../../src/core/data/terrain.ts'
import { MemorySource } from '../../../src/core/util/byte-source.ts'
import { syntheticTerrainArchive, syntheticTerrainMap } from '../../fixtures/synthetic/terrain-archive.ts'
import { buildMap } from '../../fixtures/synthetic/h3m.ts'

async function syntheticAtlas() {
  const lod = await LodArchive.open(new MemorySource('syn.lod', syntheticTerrainArchive()))
  const inputs = []
  for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await lod.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
  return buildAtlas(inputs)
}

describe('atlas', () => {
  it('packs every frame once into a power-of-two page with RGB565 palettes', async () => {
    const atlas = await syntheticAtlas()
    expect(atlas.layout.size).toBe(1024)
    expect(atlas.layout.cellCount).toBe(10 * 80 + 4 * 13 + 3 * 17 + 36)
    expect(atlas.layout.sprites['watrtl.def']?.cells).toHaveLength(80)
    const row = atlas.layout.sprites['grastl.def']?.row as number
    const [r, g, b] = toDisplayColor(0x12, 0x34, 0x56)
    expect([r, g, b]).toEqual([16, 53, 82])
    expect(atlas.palettes[(row * 256 + 7) * 4 + 3]).toBe(255)
    const river = atlas.layout.sprites['clrrvr.def']?.row as number
    expect(atlas.palettes[(river * 256 + 0) * 4 + 3]).toBe(0)
    expect(atlas.palettes[(river * 256 + 1) * 4 + 3]).toBe(64)
  })
})

describe('camera', () => {
  it('covers the viewport with a margin, including outside the map', () => {
    const cam = cameraForMapping(0, { x: 0, y: 0 }, { x: 40, y: 0 }, 100, 64)
    expect(visibleRange(cam, 0)).toEqual({ x0: -2, y0: 0, x1: 1, y1: 1 })
    expect(visibleRange(cam, 1)).toEqual({ x0: -3, y0: -1, x1: 2, y1: 2 })
    expect(rangeContains({ x0: -3, y0: -1, x1: 2, y1: 2 }, visibleRange(cam, 0))).toBe(true)
  })

  it('clamps to the map plus border and centres maps smaller than the window', () => {
    const big = clampCamera({ level: 0, offsetX: -1000, offsetY: 5000, width: 320, height: 320, scale: 1 }, 36, 2)
    expect(big.offsetX).toBe(-64)
    expect(big.offsetY).toBe(38 * 32 - 320)
    const small = clampCamera({ level: 0, offsetX: 0, offsetY: 0, width: 4000, height: 2000, scale: 1 }, 36, 2)
    expect(small.offsetX).toBe(Math.round((-64 + 38 * 32 - 4000) / 2))
  })
})

describe('palette animation', () => {
  it('rotates the last colour of a range to its start each step, with the range length as cycle', () => {
    const pal = new Uint8Array(768).map((_, i) => i % 256)
    const one = rotatePalette(pal, [{ start: 10, length: 4 }], 1)
    expect([one[30], one[33], one[36], one[39]]).toEqual([pal[39], pal[30], pal[33], pal[36]])
    expect(rotatePalette(pal, [{ start: 10, length: 4 }], 4)).toEqual(pal)
    expect(rotatePalette(pal, [{ start: 10, length: 4 }], -1)[30]).toBe(pal[33])
  })

  it('derives steps from time with 180 ms steps and a joint period of 36 (LCM of 12, 9, 6)', async () => {
    expect(animationStep(0)).toBe(0)
    expect(animationStep(179.9)).toBe(0)
    expect(animationStep(180)).toBe(1)
    expect(nextStepTime(200)).toBe(360)
    expect(allAnimationStates()).toHaveLength(36)
    const atlas = await syntheticAtlas()
    const rows = paletteRowsAt(atlas.layout, atlas.palettes, 3)
    expect(rows.map((r) => r.row).sort()).toEqual(['watrtl.def', 'lavatl.def', 'clrrvr.def', 'mudrvr.def', 'lavrvr.def'].map((n) => atlas.layout.sprites[n]?.row).sort())
    expect(palettesAt(atlas.layout, atlas.palettes, 36)).toEqual(palettesAt(atlas.layout, atlas.palettes, 0))
    expect(palettesAt(atlas.layout, atlas.palettes, 18)).not.toEqual(palettesAt(atlas.layout, atlas.palettes, 0))
  })
})

describe('draw plan', () => {
  it('uses the measured border pattern', () => {
    expect(borderFrame(5, -1, 36)).toBe(21)
    expect(borderFrame(5, 36, 36)).toBe(29)
    expect(borderFrame(-1, 6, 36)).toBe(34)
    expect(borderFrame(36, 6, 36)).toBe(26)
    expect(borderFrame(-1, -1, 36)).toBe(16)
    expect(borderFrame(36, 36, 36)).toBe(18)
    expect(borderFrame(14, -8, 36)).toBe(2)
    expect(borderFrame(14, 37, 36)).toBe(6)
    expect(borderFrame(-5, -6, 36)).toBe(2 * 4 + 3)
  })

  it('emits flips, animated tiles and layer order, and its size depends on the range only', async () => {
    const atlas = await syntheticAtlas()
    const small = parseH3m(new Uint8Array(gunzipSync(syntheticTerrainMap(36, true))), 's.h3m')
    const large = parseH3m(new Uint8Array(gunzipSync(syntheticTerrainMap(252, true))), 'l.h3m')
    const range = { x0: 3, y0: 4, x1: 20, y1: 15 }
    const a = buildDrawPlan({ size: 36, levels: 2, terrain: small.tiles }, atlas.layout, 1, range)
    const b = buildDrawPlan({ size: 252, levels: 2, terrain: large.tiles }, atlas.layout, 1, range)
    expect(a.layerQuads).toEqual(b.layerQuads)
    expect(a.vertices).toEqual(b.vertices)
    expect(a.quadCount).toBeLessThanOrEqual(maxQuads(range))
    expect(a.warnings).toEqual([])
    expect(a.animatedRows.length).toBeGreaterThan(0)
    expect(a.animatedTileMask.some((v) => v === 1)).toBe(true)

    const flipMap = buildMap({ version: 'SoD', size: 4, underground: false, tile: (x) => [2, 1, 0, 0, 0, 0, x === 1 ? 1 : 0] })
    const plan = buildDrawPlan({ size: 4, levels: 1, terrain: flipMap.tiles }, atlas.layout, 0, { x0: 0, y0: 0, x1: 1, y1: 0 }, false)
    const quad = (q: number) => plan.vertices.subarray(q * VERTICES_PER_QUAD * VERTEX_SIZE, (q + 1) * VERTICES_PER_QUAD * VERTEX_SIZE)
    // Same frame; the second tile is horizontally flipped (negative cell width).
    expect(quad(0)[6]).toBe(32)
    expect(quad(1)[6]).toBe(-32)
    expect([quad(1)[4], quad(1)[5], quad(1)[7]]).toEqual([quad(0)[4], quad(0)[5], quad(0)[7]])
    expect(plan.layerQuads).toEqual({ terrain: 2, river: 0, road: 0, border: 0 })
  })

  it('rasterizes flipped frames as mirrored pixels', async () => {
    const atlas = await syntheticAtlas()
    const map = buildMap({ version: 'SoD', size: 2, underground: false, tile: (x) => [2, 5, 0, 0, 0, 0, x === 1 ? 3 : 0] })
    const cam = cameraForMapping(0, { x: 0, y: 0 }, { x: 0, y: 0 }, 64, 32)
    const plan = buildDrawPlan({ size: 2, levels: 1, terrain: map.tiles }, atlas.layout, 0, visibleRange(cam, 0), false)
    const img = rasterize(plan, atlas, atlas.palettes, cam)
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const a = (y * 64 + x) * 4
        const b = ((31 - y) * 64 + 32 + 31 - x) * 4
        expect([img[b], img[b + 1], img[b + 2]]).toEqual([img[a], img[a + 1], img[a + 2]])
      }
  })
})
