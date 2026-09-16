// Fidelity comparison rules with fabricated captures (tasks.md T088): the "capture" is a software
// render of a synthetic map, modified to simulate differences.
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { parseDef } from '../../src/core/formats/def/def.ts'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { buildAtlas } from '../../src/core/render/atlas.ts'
import type { Atlas } from '../../src/core/render/atlas.ts'
import { cameraForMapping, visibleRange } from '../../src/core/render/camera.ts'
import { buildDrawPlan } from '../../src/core/render/draw-plan.ts'
import { palettesAt } from '../../src/core/render/palette.ts'
import { rasterize } from '../../src/core/render/software.ts'
import { placeMask } from '../../src/core/state/footprint.ts'
import type { Footprint } from '../../src/core/state/footprint.ts'
import { terrainLayerDefs, TERRAINS } from '../../src/core/data/terrain.ts'
import { MemorySource } from '../../src/core/util/byte-source.ts'
import { classifyPixels, countDiffs, decideOutcome, evaluateClipSteps, PIXEL, tileStats } from '../../tools/checks/fidelity/compare.ts'
import type { CaptureSampler } from '../../tools/checks/fidelity/compare.ts'
import { mayBeMisaligned, selectCaptures } from '../../tools/checks/fidelity/captures.ts'
import type { CaptureRecord } from '../../tools/reference-env/model/types.ts'
import { syntheticTerrainArchive, syntheticTerrainMap } from '../fixtures/synthetic/terrain-archive.ts'

const W = 320
const H = 240

async function setup() {
  const lod = await LodArchive.open(new MemorySource('syn.lod', syntheticTerrainArchive()))
  const inputs = []
  for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await lod.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
  const atlas: Atlas = buildAtlas(inputs)
  const map = parseH3m(new Uint8Array(gunzipSync(syntheticTerrainMap(36, false))), 's.h3m')
  const src = { size: 36, levels: 1, terrain: map.tiles }
  const cam = cameraForMapping(0, { x: 2, y: 3 }, { x: 0, y: 0 }, W, H)
  const plan = buildDrawPlan(src, atlas.layout, 0, visibleRange(cam, 1))
  const pw = plan.range.x1 - plan.range.x0 + 1
  const animatedTile = (tx: number, ty: number) => plan.animatedTileMask[(ty - plan.range.y0) * pw + (tx - plan.range.x0)] === 1
  const render = (step: number) => rasterize(plan, atlas, palettesAt(atlas.layout, atlas.palettes, step), cam)
  const region = { x0: 2, y0: 3, x1: 2 + W / 32 - 1, y1: 3 + Math.ceil(H / 32) - 1 }
  const asCapture = (rgba: Uint8Array): CaptureSampler => ({ data: rgba, channels: 4, stride: W, x0: 0, y0: 0 })
  const base = { width: W, height: H, offsetX: cam.offsetX, offsetY: cam.offsetY, mapSize: 36, region, ui: null, volatile: null, objects: new Map() as Footprint, floating: new Map() as Footprint, animatedTile }
  return { atlas, plan, render, asCapture, base, animatedTile }
}

function solid(w: number, h: number) {
  return { name: 's', width: w, height: h, mask: new Uint8Array(w * h).fill(1) }
}

describe('fidelity comparison', () => {
  it('passes an identical capture and fails a wrong palette step on animated tiles', async () => {
    const s = await setup()
    const capture = s.asCapture(s.render(5))
    const ex = classifyPixels(s.base)
    expect(ex.counts.comparedAnimated).toBeGreaterThan(0)
    expect(countDiffs(ex, capture, s.render(5), W)).toBe(0)
    expect(decideOutcome(0, ex.counts.comparedInMap, ex.counts.inMap)).toBe('pass')
    const wrong = countDiffs(ex, capture, s.render(6), W)
    expect(wrong).toBeGreaterThan(0)
    expect(countDiffs(ex, capture, s.render(6), W, true)).toBe(wrong)
    expect(decideOutcome(wrong, ex.counts.comparedInMap, ex.counts.inMap)).toBe('fail')
  })

  it('compares animated tiles even when the capture marks them volatile', async () => {
    const s = await setup()
    const volatile = new Uint8Array(W * H).fill(1)
    const ex = classifyPixels({ ...s.base, volatile })
    expect(ex.counts.comparedAnimated).toBeGreaterThan(0)
    expect(ex.counts.compared).toBe(ex.counts.comparedAnimated)
    expect(ex.counts.volatile).toBe(ex.counts.inMap - ex.counts.comparedAnimated)
  })

  it('lists the tile of a deliberately flipped frame', async () => {
    const s = await setup()
    const capture = s.render(0)
    // Mirror tile (4, 5) horizontally inside the fabricated capture.
    const tx = (4 - 2) * 32
    const ty = (5 - 3) * 32
    const copy = capture.slice()
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) copy.set(capture.subarray(((ty + y) * W + tx + 31 - x) * 4, ((ty + y) * W + tx + 31 - x) * 4 + 4), ((ty + y) * W + tx + x) * 4)
    const ex = classifyPixels(s.base)
    const tiles = tileStats(ex, s.asCapture(copy), s.render(0), W).filter((t) => t.differing > 0)
    expect(tiles.map((t) => `${t.x},${t.y}`)).toEqual(['4,5'])
  })

  it('reports not-checkable when objects or floating tiles leave too little to compare', async () => {
    const s = await setup()
    const cover = (tilesWide: number): Footprint => {
      const fp: Footprint = new Map()
      for (let y = 3; y <= 11; y++) for (let x = 2; x < 2 + tilesWide; x++) placeMask(fp, solid(32, 32), x, y)
      return fp
    }
    const byObjects = classifyPixels({ ...s.base, objects: cover(8) })
    expect(byObjects.counts.object).toBeGreaterThan(0)
    expect(decideOutcome(0, byObjects.counts.comparedInMap, byObjects.counts.inMap)).toBe('not-checkable')
    const byFloating = classifyPixels({ ...s.base, floating: cover(9) })
    expect(byFloating.counts.floating).toBeGreaterThan(byFloating.counts.compared)
    expect(decideOutcome(0, byFloating.counts.comparedInMap, byFloating.counts.inMap)).toBe('not-checkable')
    // Differences still win over a small comparison.
    expect(decideOutcome(3, byFloating.counts.comparedInMap, byFloating.counts.inMap)).toBe('fail')
    // Floating takes precedence over objects, UI over both.
    const ui = new Uint8Array(W * H)
    ui[0] = 1
    const both = classifyPixels({ ...s.base, objects: cover(3), floating: cover(1), ui })
    expect(both.cls[0]).toBe(PIXEL.ui)
    // Pixel 10 lies in tile x = 2 (floating and object), pixel 40 in tile x = 3 (object only).
    expect(both.cls[10]).toBe(PIXEL.floating)
    expect(both.cls[40]).toBe(PIXEL.object)
  })

  it('evaluates clip step order and timing with the median interval', () => {
    const steps = [0, 183, 367, 550, 733, 917, 1283, 1467].map((t, i) => ({ tStartMs: t, paletteStep: i }))
    // One held step (917 → 1283 covers one step), otherwise 183 ms.
    const r = evaluateClipSteps(steps, 72, 60, 180)
    expect(r.ordered).toBe(true)
    expect(Math.abs(r.stepMsMeasured - 183.3)).toBeLessThan(1)
    expect(r.pass).toBe(true)
    const skipped = evaluateClipSteps([{ tStartMs: 0, paletteStep: 1 }, { tStartMs: 180, paletteStep: 3 }, { tStartMs: 360, paletteStep: 4 }], 72, 60, 180)
    expect(skipped.ordered).toBe(false)
    const slow = evaluateClipSteps([0, 250, 500, 750].map((t, i) => ({ tStartMs: t, paletteStep: i })), 72, 60, 180)
    expect(slow.pass).toBe(false)
  })
})

describe('capture selection (spec 003 T031)', () => {
  const rec = (id: string, sha: string, createdAt: string, origin: { x: number; y: number }, verified: boolean): { record: CaptureRecord } => ({
    record: {
      id,
      createdAt,
      kind: 'still',
      level: 0,
      map: { sha256: sha },
      mapping: { originTile: origin },
      ...(verified ? { verification: {} } : {}),
    } as unknown as CaptureRecord,
  })

  it('keeps captures of the current map file, newest first, one per view, and reports the rest as stale', () => {
    const all = [rec('old-version', 'b', '2026-09-10', { x: 1, y: 1 }, false), rec('a1', 'a', '2026-09-11', { x: 1, y: 1 }, false), rec('a2', 'a', '2026-09-12', { x: 1, y: 1 }, true), rec('a3', 'a', '2026-09-12', { x: 5, y: 1 }, true)]
    const { current, stale } = selectCaptures(all, 'a', true)
    expect(current.map((c) => c.record.id)).toEqual(['a2', 'a3'])
    expect(stale.map((c) => c.record.id)).toEqual(['old-version'])
    expect(selectCaptures(all, 'a', false).current.map((c) => c.record.id)).toEqual(['a2', 'a3', 'a1'])
  })

  it('probes misalignment only for records without verification', () => {
    expect(mayBeMisaligned(rec('x', 'a', '2026', { x: 0, y: 0 }, false).record)).toBe(true)
    expect(mayBeMisaligned(rec('y', 'a', '2026', { x: 0, y: 0 }, true).record)).toBe(false)
  })
})
