// Draw plan (research.md §6): for a tile range, the quads of the terrain, river, road and border
// layers. Pure and DOM-free so it is testable in Node; its size depends on the range only.

import { BORDER_DEF, riverDef, roadDef, ROAD_OFFSET_Y, terrainDef, TILE_FLAGS, TILE_SIZE } from '../data/terrain.ts'
import { rotationsFor } from '../data/palette-rotation.ts'
import type { AtlasLayout, AtlasSprite } from './atlas.ts'
import type { TileRange } from './camera.ts'

/**
 * Floats per vertex: x, y (corner, world pixels), local x, y (0 or the cell size), cell x, y (top-left
 * texel in the atlas), cell width, height (negative = mirrored along that axis), palette row. The
 * shaders map world pixels to texels from these (shaders.ts); the software rasterizer reads the same.
 */
export const VERTEX_SIZE = 9
export const VERTICES_PER_QUAD = 6

/** Corners of the two triangles of a quad as x, y pairs (0 = left/top, 1 = right/bottom); vertex 0 is top-left, 5 bottom-right. */
export const QUAD_CORNERS: readonly number[] = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]

export interface TerrainSource {
  size: number
  levels: number
  /** levels × size² × 7-byte records. */
  terrain: Uint8Array
}

export interface DrawPlan {
  range: TileRange
  level: number
  /** Vertices in world pixels relative to the range origin (x0·32, y0·32). */
  vertices: Float32Array
  quadCount: number
  /** Quads per layer, in draw order. */
  layerQuads: { terrain: number; river: number; road: number; border: number }
  /** Palette rows of animated sprites visible in the range. */
  animatedRows: number[]
  /** Per tile in the range (row-major), 1 if a drawn frame uses a rotating palette. */
  animatedTileMask: Uint8Array
  /** Missing frames (view index outside the sprite), reported instead of silently dropped. */
  warnings: string[]
}

/**
 * Border frame (edg.def) for a tile outside the map. Measured from reference captures
 * (research.md §4): frames tile the world in a 4×4 pattern — fill 4·(y mod 4) + (x mod 4), top edge
 * row 20 + (x mod 4), bottom edge row 28 + (x mod 4); right and left edge columns 24 + (y mod 4) and
 * 32 + (y mod 4); corners 16 (top-left), 17 (top-right), 18 (bottom-right), 19 (bottom-left).
 */
export function borderFrame(x: number, y: number, size: number): number {
  const mx = ((x % 4) + 4) % 4
  const my = ((y % 4) + 4) % 4
  const left = x === -1
  const right = x === size
  const top = y === -1
  const bottom = y === size
  const alongX = x >= 0 && x < size
  const alongY = y >= 0 && y < size
  if (left && top) return 16
  if (right && top) return 17
  if (right && bottom) return 18
  if (left && bottom) return 19
  if (top && alongX) return 20 + mx
  if (bottom && alongX) return 28 + mx
  if (right && alongY) return 24 + my
  if (left && alongY) return 32 + my
  return my * 4 + mx
}

function writeQuad(out: Float32Array, q: number, px: number, py: number, cell: number, layout: AtlasLayout, row: number, flipX: boolean, flipY: boolean): void {
  const cellX = (cell % layout.cellsPerRow) * TILE_SIZE
  const cellY = Math.floor(cell / layout.cellsPerRow) * TILE_SIZE
  const w = flipX ? -TILE_SIZE : TILE_SIZE
  const h = flipY ? -TILE_SIZE : TILE_SIZE
  let o = q * VERTICES_PER_QUAD * VERTEX_SIZE
  for (let k = 0; k < 12; k += 2) {
    const lx = QUAD_CORNERS[k] as number
    const ly = QUAD_CORNERS[k + 1] as number
    out[o++] = px + lx * TILE_SIZE
    out[o++] = py + ly * TILE_SIZE
    out[o++] = lx * TILE_SIZE
    out[o++] = ly * TILE_SIZE
    out[o++] = cellX
    out[o++] = cellY
    out[o++] = w
    out[o++] = h
    out[o++] = row
  }
}

/** Upper bound of quads for a range (lets callers size buffers by viewport only). */
export function maxQuads(range: TileRange): number {
  return (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) * 3
}

export function buildDrawPlan(src: TerrainSource, layout: AtlasLayout, level: number, range: TileRange, drawBorder = true): DrawPlan {
  const w = range.x1 - range.x0 + 1
  const h = range.y1 - range.y0 + 1
  const vertices = new Float32Array(maxQuads(range) * VERTICES_PER_QUAD * VERTEX_SIZE)
  const animatedTileMask = new Uint8Array(w * h)
  const animated = new Set<number>()
  const warnings: string[] = []
  const layers = { terrain: 0, river: 0, road: 0, border: 0 }
  let q = 0
  const size = src.size
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size

  const spriteFor = (name: string | undefined): AtlasSprite | undefined => (name === undefined ? undefined : layout.sprites[name])
  const cellFor = (sprite: AtlasSprite, view: number, x: number, y: number): number | undefined => {
    const c = sprite.cells[view]
    if (c === undefined) warnings.push(`${sprite.name}: view index ${view} missing at (${x},${y},${level})`)
    return c
  }
  const markAnimated = (sprite: AtlasSprite, x: number, y: number) => {
    if (rotationsFor(sprite.name).length === 0) return
    animated.add(sprite.row)
    animatedTileMask[(y - range.y0) * w + (x - range.x0)] = 1
  }

  // Layers are emitted in draw order: all terrain, then rivers, roads, border.
  for (const layer of ['terrain', 'river', 'road'] as const) {
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        if (!inMap(x, y)) continue
        const o = (level * size * size + y * size + x) * 7
        const t = src.terrain
        const flags = t[o + 6] as number
        const px = (x - range.x0) * TILE_SIZE
        const py = (y - range.y0) * TILE_SIZE
        if (layer === 'terrain') {
          const sprite = spriteFor(terrainDef(t[o] as number))
          if (sprite === undefined) continue
          const cell = cellFor(sprite, t[o + 1] as number, x, y)
          if (cell === undefined) continue
          writeQuad(vertices, q++, px, py, cell, layout, sprite.row, (flags & TILE_FLAGS.terrainFlipX) !== 0, (flags & TILE_FLAGS.terrainFlipY) !== 0)
          layers.terrain++
          markAnimated(sprite, x, y)
        } else if (layer === 'river') {
          const id = t[o + 2] as number
          if (id === 0) continue
          const sprite = spriteFor(riverDef(id))
          if (sprite === undefined) continue
          const cell = cellFor(sprite, t[o + 3] as number, x, y)
          if (cell === undefined) continue
          writeQuad(vertices, q++, px, py, cell, layout, sprite.row, (flags & TILE_FLAGS.riverFlipX) !== 0, (flags & TILE_FLAGS.riverFlipY) !== 0)
          layers.river++
          markAnimated(sprite, x, y)
        } else {
          const id = t[o + 4] as number
          if (id === 0) continue
          const sprite = spriteFor(roadDef(id))
          if (sprite === undefined) continue
          const cell = cellFor(sprite, t[o + 5] as number, x, y)
          if (cell === undefined) continue
          writeQuad(vertices, q++, px, py + ROAD_OFFSET_Y, cell, layout, sprite.row, (flags & TILE_FLAGS.roadFlipX) !== 0, (flags & TILE_FLAGS.roadFlipY) !== 0)
          layers.road++
        }
      }
    }
  }
  const border = layout.sprites[BORDER_DEF]
  if (drawBorder && border !== undefined) {
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        if (inMap(x, y)) continue
        const cell = border.cells[borderFrame(x, y, size)]
        if (cell === undefined) continue
        writeQuad(vertices, q++, (x - range.x0) * TILE_SIZE, (y - range.y0) * TILE_SIZE, cell, layout, border.row, false, false)
        layers.border++
      }
    }
  }
  return {
    range,
    level,
    vertices: vertices.subarray(0, q * VERTICES_PER_QUAD * VERTEX_SIZE),
    quadCount: q,
    layerQuads: layers,
    animatedRows: [...animated].sort((a, b) => a - b),
    animatedTileMask,
    warnings,
  }
}
