import { describe, expect, it } from 'vitest'
import { parseDef } from '../../../src/core/formats/def/def.ts'
import { buildAtlas } from '../../../src/core/render/atlas.ts'
import { cameraForMapping, visibleRange } from '../../../src/core/render/camera.ts'
import { buildDrawPlan } from '../../../src/core/render/draw-plan.ts'
import { buildObjectPlan } from '../../../src/core/render/object-plan.ts'
import { palettesAt } from '../../../src/core/render/palette.ts'
import { drawObjects, rasterize, rasterizeScene, shadowColor } from '../../../src/core/render/software.ts'
import { FLAG_INDEX, SHADOW_KINDS } from '../../../src/core/data/animation.ts'
import { NEUTRAL_SLOT } from '../../../src/core/data/players.ts'
import { terrainLayerDefs, TERRAINS } from '../../../src/core/data/terrain.ts'
import { objectScene } from './objects-helpers.ts'
import { ObjectIndex } from '../../../src/core/state/object-index.ts'

describe('software rasterizer with objects', async () => {
  const s = await objectScene(36)
  const inputs = []
  for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await s.sprites.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
  const terrainAtlas = buildAtlas(inputs)
  const cam = cameraForMapping(0, { x: -1, y: -1 }, { x: 0, y: 0 }, 640, 576)
  const range = visibleRange(cam, 1)
  const plan = buildDrawPlan(s.state, terrainAtlas.layout, 0, range)
  const objectPlan = buildObjectPlan(s.index, s.atlas.layout, 0, range, 2, { drawList: true })
  const palettes = palettesAt(terrainAtlas.layout, terrainAtlas.palettes, 0)
  const scene = { plan: objectPlan, atlas: s.atlas, flagColors: s.colors }

  it('reports the shadow layers it applied, so a check can tell shadow from body', () => {
    const layers = { dark: new Uint8Array(cam.width * cam.height), light: new Uint8Array(cam.width * cam.height) }
    const img = rasterizeScene(plan, terrainAtlas, palettes, cam, scene, undefined, layers)
    const plain = rasterize(plan, terrainAtlas, palettes, cam)
    let shadowed = 0
    let onTerrain = 0
    for (let i = 0; i < cam.width * cam.height; i++) {
      const d = layers.dark[i] as number
      const l = layers.light[i] as number
      if (d === 0 && l === 0) continue
      shadowed++
      // A shadow falls on the terrain or on a body drawn before it. Where it fell on the terrain,
      // the drawn pixel is exactly that terrain shaded by the reported layers — which is what lets
      // a check compare the game's shadow with ours (spec 005 research, the HotA shadow question).
      const [r, g, b] = shadowColor(plain[i * 4] as number, plain[i * 4 + 1] as number, plain[i * 4 + 2] as number, d, l)
      if (img[i * 4] === r && img[i * 4 + 1] === g && img[i * 4 + 2] === b) onTerrain++
    }
    expect(shadowed).toBeGreaterThan(0)
    expect(onTerrain).toBeGreaterThan(0)
    // No layers reported where nothing shaded the pixel: those pixels are the plain scene.
    expect(layers.dark.some((v, i) => v === 0 && (layers.light[i] as number) === 0)).toBe(true)
  })

  it('draws owner colours on flag pixels and records the topmost object per pixel', () => {
    const owners = new Int32Array(cam.width * cam.height)
    const img = rasterizeScene(plan, terrainAtlas, palettes, cam, scene, owners)
    const mine = objectPlan.entries?.find((e) => e.def === 'synmine.def' && e.owner !== null) as NonNullable<typeof objectPlan.entries>[number]
    const sprite = s.atlas.layout.sprites['synmine.def']
    const cell = sprite?.groups[0]?.[mine.frame] as NonNullable<NonNullable<typeof sprite>['groups'][number][number]>
    const page = s.atlas.pages[cell.page] as Uint8Array
    let checked = 0
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (page[(cell.v + y) * s.atlas.layout.pageSize + cell.u + x] !== FLAG_INDEX) continue
        const sx = mine.screenX + cell.x + x + range.x0 * 32 - cam.offsetX
        const sy = mine.screenY + cell.y + y + range.y0 * 32 - cam.offsetY
        if (sx < 0 || sy < 0 || sx >= cam.width || sy >= cam.height || owners[sy * cam.width + sx] !== mine.index) continue
        const o = (sy * cam.width + sx) * 4
        const c = (mine.owner ?? NEUTRAL_SLOT) * 3
        expect([img[o], img[o + 1], img[o + 2]]).toEqual([s.colors[c], s.colors[c + 1], s.colors[c + 2]])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('darkens what is below shadow pixels in 16-bit colour', () => {
    const tree = objectPlan.entries?.find((e) => e.def === 'syntree.def') as NonNullable<typeof objectPlan.entries>[number]
    // Everything except the tree, then the full scene: the tree's shadow darkens what was below it.
    const withoutTree = new ObjectIndex(s.objects.filter((_, i) => i !== tree.index).map((o) => o), 36, 2)
    const below = rasterize(plan, terrainAtlas, palettes, cam, [0, 0, 0], { from: 0, to: plan.quadCount - plan.layerQuads.border })
    drawObjects(below, { ...scene, plan: buildObjectPlan(withoutTree, s.atlas.layout, 0, range, 2) }, cam)
    const withObjects = rasterize(plan, terrainAtlas, palettes, cam, [0, 0, 0], { from: 0, to: plan.quadCount - plan.layerQuads.border })
    const owners = new Int32Array(cam.width * cam.height)
    drawObjects(withObjects, scene, cam, owners)
    const terrainOnly = below
    const cell = s.atlas.layout.sprites['syntree.def']?.groups[0]?.[0] as { page: number; u: number; v: number; width: number; height: number; x: number; y: number }
    const page = s.atlas.pages[cell.page] as Uint8Array
    let checked = 0
    for (let y = 0; y < cell.height && checked < 20; y++) {
      for (let x = 0; x < cell.width; x++) {
        const idx = page[(cell.v + y) * 2048 + cell.u + x] as number
        const kind = SHADOW_KINDS.get(idx)
        if (kind === undefined) continue
        const sx = tree.screenX + cell.x + x + range.x0 * 32 - cam.offsetX
        const sy = tree.screenY + cell.y + y + range.y0 * 32 - cam.offsetY
        if (sx < 0 || sy < 0 || sx >= cam.width || sy >= cam.height || owners[sy * cam.width + sx] !== tree.index) continue
        const o = (sy * cam.width + sx) * 4
        const expected = shadowColor(terrainOnly[o] as number, terrainOnly[o + 1] as number, terrainOnly[o + 2] as number, kind === 'dark' ? 1 : 0, kind === 'light' ? 1 : 0)
        expect([withObjects[o], withObjects[o + 1], withObjects[o + 2]]).toEqual(expected)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('draws the map border over objects', () => {
    const owners = new Int32Array(cam.width * cam.height)
    const img = rasterizeScene(plan, terrainAtlas, palettes, cam, scene, owners)
    const noObjects = rasterizeScene(plan, terrainAtlas, palettes, cam, undefined)
    // Top-left pixel is border (tile −1, −1): identical with and without objects.
    expect(Array.from(img.subarray(0, 4))).toEqual(Array.from(noObjects.subarray(0, 4)))
  })
})
