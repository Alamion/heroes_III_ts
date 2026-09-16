// Terrain-only renders for mapping verification: the project's software rasterizer at a camera
// offset, comparable = in-map terrain that is not palette-animated and not under any object or
// floating footprint (objects may animate or be random).
import { TILE_SIZE } from '../../../src/core/data/terrain.ts'
import { cameraForMapping, visibleRange } from '../../../src/core/render/camera.ts'
import { buildDrawPlan } from '../../../src/core/render/draw-plan.ts'
import { palettesAt } from '../../../src/core/render/palette.ts'
import { rasterize } from '../../../src/core/render/software.ts'
import { isCovered, tileKey } from '../../../src/core/state/footprint.ts'
import type { MapContext } from '../../checks/fidelity/masks.ts'
import type { Rect, TileMapping } from '../model/types.ts'
import type { MappingCheckInput, MappingRender } from './mapping-verify.ts'

/** Camera offset (world pixel at the viewport's top-left) implied by a recorded mapping. */
export function mappingOffset(mapping: TileMapping): { x: number; y: number } {
  const vp = mapping.viewport
  const cam = cameraForMapping(0, mapping.originTile, { x: mapping.originPixel.x - vp.x, y: mapping.originPixel.y - vp.y }, vp.w, vp.h)
  return { x: cam.offsetX, y: cam.offsetY }
}

export function terrainRenderer(ctx: MapContext, level: number, vp: Rect): (offsetX: number, offsetY: number) => MappingRender {
  const palettes = palettesAt(ctx.atlas.layout, ctx.atlas.palettes, 0)
  const objects = ctx.objects[level] ?? new Map()
  const floating = ctx.floating.levels[level]?.footprint ?? new Map()
  return (offsetX, offsetY) => {
    const cam = { level, offsetX, offsetY, width: vp.w, height: vp.h, scale: 1 }
    const plan = buildDrawPlan(ctx.state, ctx.atlas.layout, level, visibleRange(cam, 1))
    const rgba = rasterize(plan, ctx.atlas, palettes, cam)
    const pw = plan.range.x1 - plan.range.x0 + 1
    const comparable = new Uint8Array(vp.w * vp.h)
    for (let y = 0; y < vp.h; y++) {
      const wy = offsetY + y
      const ty = Math.floor(wy / TILE_SIZE)
      for (let x = 0; x < vp.w; x++) {
        const wx = offsetX + x
        const tx = Math.floor(wx / TILE_SIZE)
        if (tx < 0 || ty < 0 || tx >= ctx.state.size || ty >= ctx.state.size) continue
        if (plan.animatedTileMask[(ty - plan.range.y0) * pw + (tx - plan.range.x0)] === 1) continue
        const rx = wx - tx * TILE_SIZE
        const ry = wy - ty * TILE_SIZE
        if (isCovered(objects.get(tileKey(tx, ty)), rx, ry) || isCovered(floating.get(tileKey(tx, ty)), rx, ry)) continue
        comparable[y * vp.w + x] = 1
      }
    }
    return { rgba, comparable }
  }
}

/** Builds the verification input for a screen grab (RGB, full screen) and its recorded mapping. */
export function mappingCheckInput(ctx: MapContext, level: number, mapping: TileMapping, screen: { width: number; rgb: Uint8Array }): MappingCheckInput {
  const vp = mapping.viewport
  const capture = new Uint8Array(vp.w * vp.h * 3)
  for (let y = 0; y < vp.h; y++) {
    const from = ((vp.y + y) * screen.width + vp.x) * 3
    capture.set(screen.rgb.subarray(from, from + vp.w * 3), y * vp.w * 3)
  }
  return { width: vp.w, height: vp.h, capture, channels: 3, offset: mappingOffset(mapping), tileSize: TILE_SIZE, render: terrainRenderer(ctx, level, vp) }
}
