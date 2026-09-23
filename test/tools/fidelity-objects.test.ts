// Fidelity state search with objects (spec 003 T058): fabricated captures are software renders of the
// synthetic map with known palette step and per-object frames.
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseDef } from '../../src/core/formats/def/def.ts'
import type { DefSprite } from '../../src/core/formats/def/def.ts'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { parseArtTraits } from '../../src/core/formats/text/artraits.ts'
import { parseObjectsTxt } from '../../src/core/formats/text/objects-txt.ts'
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
import { runFidelity } from '../../tools/checks/fidelity/run.ts'
import type { MapContext, ObjectContext } from '../../tools/checks/fidelity/masks.ts'
import type { LoadedCapture } from '../../tools/checks/fidelity/captures.ts'
import type { HeadlessRenderer } from '../../tools/shared/render-page.ts'
import type { CaptureRecord } from '../../tools/reference-env/model/types.ts'
import { syntheticDataArchive, syntheticTerrainArchive, syntheticTerrainMap } from '../fixtures/synthetic/terrain-archive.ts'

const W = 592
const H = 544

async function setup() {
  const sprites = await LodArchive.open(new MemorySource('s.lod', syntheticTerrainArchive()))
  const data = await LodArchive.open(new MemorySource('d.lod', syntheticDataArchive()))
  const inputs = []
  for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await sprites.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
  const atlas = buildAtlas(inputs)
  const state = fromH3m(parseH3m(gunzipSync(syntheticTerrainMap(36, true)), 's.h3m'), { sha256: 'x', name: 's.h3m', version: 'SoD' }, 1)
  const { objects } = buildRenderObjects(state, { templates: parseObjectsTxt(await data.read('Objects.txt')), artifactClasses: parseArtTraits(await data.read('artraits.txt')) }, createRng(1))
  const defs: DefSprite[] = []
  for (const n of new Set(objects.map((o) => o.def))) if (sprites.has(n)) defs.push(parseDef(await sprites.read(n), n))
  const oc: ObjectContext = { seed: 1, objects, index: new ObjectIndex(objects, state.size, state.levels), atlas: buildObjectAtlas(defs), flagColors: flagColors({ 'game.pal': parseRiffPal(await data.read('game.pal'), 'game.pal') }, toDisplayColor), missing: [] }
  const ctx: MapContext = { mapPath: 's.h3m', archivePath: 's.lod', archivePaths: ['s.lod'], sha256: 'x', state, atlas, objects: [new Map(), new Map()], floating: { levels: [{ z: 0, tiles: [], footprint: new Map() }, { z: 1, tiles: [], footprint: new Map() }], warnings: [] } }
  const origin = { x: 1, y: 1 }
  const cam = cameraForMapping(0, origin, { x: 0, y: 0 }, W, H)
  const plan = buildDrawPlan(state, atlas.layout, 0, visibleRange(cam, 1))
  const render = (step: number, frames: Map<number, number>) => rasterizeScene(plan, atlas, palettesAt(atlas.layout, atlas.palettes, step), cam, { plan: buildObjectPlan(oc.index, oc.atlas.layout, 0, plan.range, 0, { frames }), atlas: oc.atlas, flagColors: oc.flagColors })
  const animated = (buildObjectPlan(oc.index, oc.atlas.layout, 0, plan.range, 0, { drawList: true }).entries ?? []).filter((e) => e.frameCount > 1)
  const record = { kind: 'still', level: 0, display: { width: W, height: H, depth: 24 }, mapping: { tileSize: 32, originTile: origin, originPixel: { x: 0, y: 0 }, viewport: { x: 0, y: 0, w: W, h: H } }, visible: { x0: 1, y0: 1, x1: 19, y1: 17, partialEdges: [] } } as unknown as CaptureRecord
  const renderer = {} as HeadlessRenderer
  return { ctx, oc, render, animated, record, renderer }
}

describe('fidelity with objects', async () => {
  const s = await setup()

  it('recovers the palette step and every animated object frame of a still', async () => {
    expect(s.animated.length).toBeGreaterThan(2)
    const truth = new Map(s.animated.map((e, i) => [e.index, (i * 5 + 3) % e.frameCount]))
    const image = s.render(7, truth)
    const capture: LoadedCapture = { kind: 'still', dir: '', record: s.record, image: { width: W, height: H, channels: 4, data: image }, volatile: null }
    const r = await runFidelity({ capture, ctx: s.ctx, renderer: s.renderer, region: undefined, ui: null, verifyGpu: false, objects: s.oc })
    expect(r.outcome).toBe('pass')
    expect(r.paletteStep % 12).toBe(7 % 12)
    expect(r.pixels.comparedObject).toBeGreaterThan(0)
    expect(Object.keys(r.objectFramesByObject ?? {}).length).toBe(s.animated.length)
  }, 300_000)

  it('fails a still whose object is drawn with a wrong frame everywhere', async () => {
    const truth = new Map(s.animated.map((e) => [e.index, 0]))
    const image = s.render(0, truth)
    // Break one animated object's pixels: paint its sprite area black in the capture.
    const e = s.animated[0] as (typeof s.animated)[number]
    const x0 = e.screenX + 32 * 0
    for (let y = Math.max(0, e.screenY); y < Math.min(H, e.screenY + e.height); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + e.width); x++) image.set([1, 2, 3], (y * W + x) * 4)
    const capture: LoadedCapture = { kind: 'still', dir: '', record: s.record, image: { width: W, height: H, channels: 4, data: image }, volatile: null }
    const r = await runFidelity({ capture, ctx: s.ctx, renderer: s.renderer, region: undefined, ui: null, verifyGpu: false, objects: s.oc })
    expect(r.outcome).toBe('fail')
  }, 300_000)
})
