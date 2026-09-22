// CPU rasterizer of a draw plan: the reference the WebGL renderer is cross-checked against and a
// fast way to compare hypotheses with captures in Node. Same semantics as the shader: nearest
// sampling, palette lookup, alpha 0 discarded, other alpha blended over what is below.

import { TILE_SIZE } from '../data/terrain.ts'
import type { Atlas } from './atlas.ts'
import type { Camera } from './camera.ts'
import { VERTEX_SIZE, VERTICES_PER_QUAD } from './draw-plan.ts'
import type { DrawPlan } from './draw-plan.ts'
import { FLAG_INDEX, SHADOW_MARKER_ALPHA, shadowChannel } from '../data/animation.ts'
import type { ObjectAtlas } from './object-atlas.ts'
import { OBJECT_VERTEX_SIZE, OBJECT_VERTICES_PER_QUAD } from './object-plan.ts'
import type { ObjectPlan } from './object-plan.ts'

/** Texel walk of a quad's cell from its first vertex (layout: draw-plan.ts VERTEX_SIZE); negative sizes mirror. */
function cellWalk(v: Float32Array, b: number): { startU: number; stepU: number; startV: number; stepV: number } {
  const cx = v[b + 4] as number
  const cy = v[b + 5] as number
  const w = v[b + 6] as number
  const h = v[b + 7] as number
  return { startU: w > 0 ? cx : cx - w - 1, stepU: w > 0 ? 1 : -1, startV: h > 0 ? cy : cy - h - 1, stepV: h > 0 ? 1 : -1 }
}

/** Renders into an RGBA buffer of camera.width × camera.height (scale 1). `palettes` = rotated palette texture data. */
export function rasterize(plan: DrawPlan, atlas: Atlas, palettes: Uint8Array, cam: Camera, background: [number, number, number] = [0, 0, 0], quads: { from: number; to: number } = { from: 0, to: plan.quadCount }, target?: Uint8Array): Uint8Array {
  if (cam.scale !== 1) throw new RangeError('software rasterizer supports scale 1 only')
  const { width, height } = cam
  const out = target ?? new Uint8Array(width * height * 4)
  if (target === undefined) {
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = background[0]
      out[i * 4 + 1] = background[1]
      out[i * 4 + 2] = background[2]
      out[i * 4 + 3] = 255
    }
  }
  const { size } = atlas.layout
  const originX = plan.range.x0 * TILE_SIZE - cam.offsetX
  const originY = plan.range.y0 * TILE_SIZE - cam.offsetY
  const v = plan.vertices
  for (let q = quads.from; q < quads.to; q++) {
    const b = q * VERTICES_PER_QUAD * VERTEX_SIZE
    // Vertex 0 is the top-left corner (see writeQuad).
    const x0 = (v[b] as number) + originX
    const y0 = (v[b + 1] as number) + originY
    const { startU, stepU, startV, stepV } = cellWalk(v, b)
    const row = v[b + 8] as number
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
    const { startU, stepU, startV, stepV } = cellWalk(v, b)
    const row = v[b + 8] as number
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

export interface SceneObjects {
  plan: ObjectPlan
  atlas: ObjectAtlas
  /** 9 × RGB flag colours (players 0–7, neutral). */
  flagColors: Uint8Array
}

/**
 * Terrain, rivers and roads, then objects, then the map border — the renderer's layer order
 * (research.md §2). `owners`, when given, receives the render-object index of the topmost object
 * body drawn at each pixel, or of a shadow over no object (−1 = none).
 */
export function rasterizeScene(plan: DrawPlan, atlas: Atlas, palettes: Uint8Array, cam: Camera, objects: SceneObjects | undefined, owners?: Int32Array): Uint8Array {
  const borderFrom = plan.quadCount - plan.layerQuads.border
  const out = rasterize(plan, atlas, palettes, cam, [0, 0, 0], { from: 0, to: borderFrom })
  if (objects !== undefined) drawObjects(out, objects, cam, owners)
  else owners?.fill(-1)
  rasterize(plan, atlas, palettes, cam, [0, 0, 0], { from: borderFrom, to: plan.quadCount }, out)
  return out
}

/** 8-bit display channel ↔ 5/6-bit value of the game's 16-bit colour. */
function toBits(v: number, max: number): number {
  return Math.round((v * max) / 255)
}
function fromBits(c: number, max: number): number {
  return Math.round((c * 255) / max)
}

/** Applies `dark` then `light` shadow steps to an RGB display colour in 565 space. */
export function shadowColor(r: number, g: number, b: number, dark: number, light: number): [number, number, number] {
  let r5 = toBits(r, 31)
  let g6 = toBits(g, 63)
  let b5 = toBits(b, 31)
  for (let i = 0; i < dark; i++) {
    r5 = shadowChannel(r5, 'dark')
    g6 = shadowChannel(g6, 'dark')
    b5 = shadowChannel(b5, 'dark')
  }
  for (let i = 0; i < light; i++) {
    r5 = shadowChannel(r5, 'light')
    g6 = shadowChannel(g6, 'light')
    b5 = shadowChannel(b5, 'light')
  }
  return [fromBits(r5, 31), fromBits(g6, 63), fromBits(b5, 31)]
}

/**
 * Draws an object plan over `out` (RGBA, camera-sized): palette lookup and flag colour for body
 * pixels; shadow pixels are counted per kind since the last body pixel and applied at the end in
 * 16-bit colour (research.md T046). The WebGL renderer uses the same model, so both stay bit-equal.
 */
export function drawObjects(out: Uint8Array, objects: SceneObjects, cam: Camera, owners?: Int32Array): void {
  const { plan, atlas, flagColors } = objects
  const { width, height } = cam
  owners?.fill(-1)
  const dark = new Uint8Array(width * height)
  const light = new Uint8Array(width * height)
  const size = atlas.layout.pageSize
  const originX = plan.range.x0 * TILE_SIZE - cam.offsetX
  const originY = plan.range.y0 * TILE_SIZE - cam.offsetY
  const v = plan.vertices
  for (let q = 0; q < plan.quadCount; q++) {
    const b = q * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE
    const x0 = (v[b] as number) + originX
    const y0 = (v[b + 1] as number) + originY
    const w = Math.abs(v[b + 6] as number)
    const h = Math.abs(v[b + 7] as number)
    const { startU, stepU, startV, stepV } = cellWalk(v, b)
    const row = v[b + 8] as number
    const page = atlas.pages[v[b + 9] as number] as Uint8Array
    const owner = v[b + 10] as number
    const object = plan.quadObjects[q] as number
    for (let dy = 0; dy < h; dy++) {
      const sy = y0 + dy
      if (sy < 0 || sy >= height) continue
      const ty = startV + stepV * dy
      for (let dx = 0; dx < w; dx++) {
        const sx = x0 + dx
        if (sx < 0 || sx >= width) continue
        const idx = page[ty * size + startU + stepU * dx] as number
        const p = (row * 256 + idx) * 4
        const a = atlas.palettes[p + 3] as number
        if (a === 0) continue
        const i = sy * width + sx
        // A shadow keeps the owner of the object it darkens, so that object's frame stays searchable.
        if (owners !== undefined && (a === 255 || owners[i] === -1)) owners[i] = object
        if (a !== 255) {
          if (a === SHADOW_MARKER_ALPHA.dark) dark[i] = (dark[i] as number) + 1
          else light[i] = (light[i] as number) + 1
          continue
        }
        dark[i] = 0
        light[i] = 0
        const o = i * 4
        if (idx === FLAG_INDEX) {
          out[o] = flagColors[owner * 3] as number
          out[o + 1] = flagColors[owner * 3 + 1] as number
          out[o + 2] = flagColors[owner * 3 + 2] as number
        } else {
          out[o] = atlas.palettes[p] as number
          out[o + 1] = atlas.palettes[p + 1] as number
          out[o + 2] = atlas.palettes[p + 2] as number
        }
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (dark[i] === 0 && light[i] === 0) continue
    const o = i * 4
    const [r, g, bl] = shadowColor(out[o] as number, out[o + 1] as number, out[o + 2] as number, dark[i] as number, light[i] as number)
    out[o] = r
    out[o + 1] = g
    out[o + 2] = bl
  }
}
