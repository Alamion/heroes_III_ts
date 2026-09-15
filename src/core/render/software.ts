// CPU rasterizer of a draw plan: the reference the WebGL renderer is cross-checked against and a
// fast way to compare hypotheses with captures in Node. Same semantics as the shader: nearest
// sampling, palette lookup, alpha 0 discarded, other alpha blended over what is below.

import { TILE_SIZE } from '../data/terrain.ts'
import type { Atlas } from './atlas.ts'
import type { Camera } from './camera.ts'
import { VERTEX_SIZE, VERTICES_PER_QUAD } from './draw-plan.ts'
import type { DrawPlan } from './draw-plan.ts'

/** Renders into an RGBA buffer of camera.width × camera.height (scale 1). `palettes` = rotated palette texture data. */
export function rasterize(plan: DrawPlan, atlas: Atlas, palettes: Uint8Array, cam: Camera, background: [number, number, number] = [0, 0, 0]): Uint8Array {
  if (cam.scale !== 1) throw new RangeError('software rasterizer supports scale 1 only')
  const { width, height } = cam
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = background[0]
    out[i * 4 + 1] = background[1]
    out[i * 4 + 2] = background[2]
    out[i * 4 + 3] = 255
  }
  const { size } = atlas.layout
  const originX = plan.range.x0 * TILE_SIZE - cam.offsetX
  const originY = plan.range.y0 * TILE_SIZE - cam.offsetY
  const v = plan.vertices
  for (let q = 0; q < plan.quadCount; q++) {
    const b = q * VERTICES_PER_QUAD * VERTEX_SIZE
    // Vertex 0 is the top-left corner, vertex 5 the bottom-right (see writeQuad).
    const x0 = (v[b] as number) + originX
    const y0 = (v[b + 1] as number) + originY
    const u0 = (v[b + 2] as number) * size
    const v0 = (v[b + 3] as number) * size
    const u1 = (v[b + 5 * VERTEX_SIZE + 2] as number) * size
    const v1 = (v[b + 5 * VERTEX_SIZE + 3] as number) * size
    const row = v[b + 4] as number
    const stepU = u1 > u0 ? 1 : -1
    const stepV = v1 > v0 ? 1 : -1
    const startU = stepU > 0 ? u0 : u0 - 1
    const startV = stepV > 0 ? v0 : v0 - 1
    for (let dy = 0; dy < TILE_SIZE; dy++) {
      const sy = y0 + dy
      if (sy < 0 || sy >= height) continue
      const ty = startV + stepV * dy
      for (let dx = 0; dx < TILE_SIZE; dx++) {
        const sx = x0 + dx
        if (sx < 0 || sx >= width) continue
        const tx = startU + stepU * dx
        const idx = atlas.indices[ty * size + tx] as number
        const p = (row * 256 + idx) * 4
        const a = palettes[p + 3] as number
        if (a === 0) continue
        const o = (sy * width + sx) * 4
        if (a === 255) {
          out[o] = palettes[p] as number
          out[o + 1] = palettes[p + 1] as number
          out[o + 2] = palettes[p + 2] as number
        } else {
          const af = a / 255
          out[o] = Math.round((palettes[p] as number) * af + (out[o] as number) * (1 - af))
          out[o + 1] = Math.round((palettes[p + 1] as number) * af + (out[o + 1] as number) * (1 - af))
          out[o + 2] = Math.round((palettes[p + 2] as number) * af + (out[o + 2] as number) * (1 - af))
        }
      }
    }
  }
  return out
}

/**
 * Palette row of the topmost layer drawn at each pixel: −1 = nothing drawn, −2 = the topmost layer
 * is semi-transparent (the pixel mixes rows). `palettes` provides the alpha of each index.
 */
export function rasterizeRows(plan: DrawPlan, atlas: Atlas, palettes: Uint8Array, cam: Camera): Int16Array {
  const { width, height } = cam
  const out = new Int16Array(width * height).fill(-1)
  const { size } = atlas.layout
  const originX = plan.range.x0 * TILE_SIZE - cam.offsetX
  const originY = plan.range.y0 * TILE_SIZE - cam.offsetY
  const v = plan.vertices
  for (let q = 0; q < plan.quadCount; q++) {
    const b = q * VERTICES_PER_QUAD * VERTEX_SIZE
    const x0 = (v[b] as number) + originX
    const y0 = (v[b + 1] as number) + originY
    const u0 = (v[b + 2] as number) * size
    const v0 = (v[b + 3] as number) * size
    const u1 = (v[b + 5 * VERTEX_SIZE + 2] as number) * size
    const v1 = (v[b + 5 * VERTEX_SIZE + 3] as number) * size
    const row = v[b + 4] as number
    const stepU = u1 > u0 ? 1 : -1
    const stepV = v1 > v0 ? 1 : -1
    const startU = stepU > 0 ? u0 : u0 - 1
    const startV = stepV > 0 ? v0 : v0 - 1
    for (let dy = 0; dy < TILE_SIZE; dy++) {
      const sy = y0 + dy
      if (sy < 0 || sy >= height) continue
      for (let dx = 0; dx < TILE_SIZE; dx++) {
        const sx = x0 + dx
        if (sx < 0 || sx >= width) continue
        const idx = atlas.indices[(startV + stepV * dy) * size + startU + stepU * dx] as number
        const a = palettes[(row * 256 + idx) * 4 + 3] as number
        if (a === 0) continue
        out[sy * width + sx] = a === 255 ? row : -2
      }
    }
  }
  return out
}
