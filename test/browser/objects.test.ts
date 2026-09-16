// WebGL object pass against the reference software rasterizer (spec 003 T040), synthetic files.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasChromium } from '../../tools/shared/browser.ts'
import { HeadlessRenderer } from '../../tools/shared/render-page.ts'
import { parseDef } from '../../src/core/formats/def/def.ts'
import type { DefSprite } from '../../src/core/formats/def/def.ts'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { parseObjectsTxt } from '../../src/core/formats/text/objects-txt.ts'
import { parseArtTraits } from '../../src/core/formats/text/artraits.ts'
import { parseRiffPal } from '../../src/core/formats/pal/riff-pal.ts'
import { flagColors } from '../../src/core/data/players.ts'
import { terrainLayerDefs, TERRAINS } from '../../src/core/data/terrain.ts'
import { buildAtlas, toDisplayColor } from '../../src/core/render/atlas.ts'
import { cameraForMapping, visibleRange } from '../../src/core/render/camera.ts'
import { buildDrawPlan } from '../../src/core/render/draw-plan.ts'
import { buildObjectAtlas } from '../../src/core/render/object-atlas.ts'
import { buildObjectPlan } from '../../src/core/render/object-plan.ts'
import { palettesAt } from '../../src/core/render/palette.ts'
import { rasterizeScene } from '../../src/core/render/software.ts'
import { ObjectIndex } from '../../src/core/state/object-index.ts'
import { buildRenderObjects } from '../../src/core/state/render-objects.ts'
import { fromH3m } from '../../src/core/state/world.ts'
import { MemorySource } from '../../src/core/util/byte-source.ts'
import { createRng } from '../../src/core/util/rng.ts'
import { writeLod } from '../fixtures/synthetic/lod.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'

const chromium = hasChromium()

describe.skipIf(!chromium)('WebGL objects (synthetic)', () => {
  let files: ReturnType<typeof writeSyntheticFiles>
  let renderer: HeadlessRenderer
  beforeAll(async () => {
    files = writeSyntheticFiles([{ name: 'objects.h3m', size: 36, underground: true }])
    renderer = await HeadlessRenderer.open({ rebuild: true, width: 640, height: 480 })
  }, 300_000)
  afterAll(async () => {
    await renderer?.close()
    if (files !== undefined) rmSync(files.dir, { recursive: true, force: true })
  })

  async function reference(mapPath: string, spritePath: string, level: number, originTile: { x: number; y: number }, step: number, tick: number) {
    const sprites = await LodArchive.open(new MemorySource('s.lod', new Uint8Array(readFileSync(spritePath))))
    const data = await LodArchive.open(new MemorySource('d.lod', new Uint8Array(readFileSync(files.dataArchive))))
    const inputs = []
    for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await sprites.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
    const atlas = buildAtlas(inputs)
    const state = fromH3m(parseH3m(gunzipSync(readFileSync(mapPath)), 'objects.h3m'), { sha256: 'x', name: 'objects.h3m', version: 'SoD' }, 1)
    const { objects } = buildRenderObjects(state, { templates: parseObjectsTxt(await data.read('Objects.txt')), artifactClasses: parseArtTraits(await data.read('artraits.txt')) }, createRng(1))
    const defs: DefSprite[] = []
    for (const n of new Set(objects.map((o) => o.def))) if (sprites.has(n)) defs.push(parseDef(await sprites.read(n), n))
    const objectAtlas = buildObjectAtlas(defs)
    const cam = cameraForMapping(level, originTile, { x: 0, y: 0 }, 640, 480)
    const plan = buildDrawPlan(state, atlas.layout, level, visibleRange(cam, 1))
    const index = new ObjectIndex(objects, state.size, state.levels)
    const oplan = buildObjectPlan(index, objectAtlas.layout, level, plan.range, tick)
    const colors = flagColors({ 'game.pal': parseRiffPal(await data.read('game.pal'), 'game.pal') }, toDisplayColor)
    return rasterizeScene(plan, atlas, palettesAt(atlas.layout, atlas.palettes, step), cam, { plan: oplan, atlas: objectAtlas, flagColors: colors })
  }

  it('equals the software rasterizer bit for bit at several views and ticks', async () => {
    const map = files.maps['objects.h3m'] as string
    for (const [level, origin, step, tick] of [[0, { x: -2, y: -1 }, 0, 0], [0, { x: 8, y: 10 }, 5, 7], [1, { x: 15, y: 18 }, 11, 3]] as const) {
      const frame = await renderer.render({ archive: files.archive, map, dataArchive: files.dataArchive, width: 640, height: 480, level, originTile: origin, originPixel: { x: 0, y: 0 }, step, tick, seed: 1 })
      expect(frame.stats.objectQuads).toBeGreaterThan(0)
      const ref = await reference(map, files.archive, level, origin, step, tick)
      let diff = 0
      for (let i = 0; i < ref.length; i += 4) if (frame.rgba[i] !== ref[i] || frame.rgba[i + 1] !== ref[i + 1] || frame.rgba[i + 2] !== ref[i + 2]) diff++
      expect(diff).toBe(0)
    }
  }, 300_000)

  it('reports a missing sprite and still renders the rest', async () => {
    // Archive without the synthetic tree sprite.
    const lod = await LodArchive.open(new MemorySource('s.lod', new Uint8Array(readFileSync(files.archive))))
    const entries = []
    for (const e of lod.entries) if (e.name.toLowerCase() !== 'syntree.def') entries.push({ name: e.name, data: await lod.read(e), compress: true })
    const partial = join(files.dir, 'partial.lod')
    writeFileSync(partial, writeLod(entries))
    const frame = await renderer.render({ archive: partial, map: files.maps['objects.h3m'] as string, dataArchive: files.dataArchive, width: 640, height: 480, level: 0, originTile: { x: 0, y: 0 }, originPixel: { x: 0, y: 0 }, step: 0, tick: 0, seed: 1 })
    expect(frame.stats.objectQuads).toBeGreaterThan(0)
    expect(JSON.stringify(frame.diagnostics)).toContain('syntree.def')
  }, 300_000)
})
