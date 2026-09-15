// Terrain atlas (research.md §6): every frame of the terrain, river, road and border sprites as
// 8-bit palette indices in fixed 32×32 cells, plus one RGBA palette row per sprite. Built once per
// archive; its size does not depend on the map (constitution IV).

import { TILE_SIZE } from '../data/terrain.ts'
import { decodeFrame } from '../formats/def/def.ts'
import type { DefSprite } from '../formats/def/def.ts'

/** Alpha of special indices for layers drawn over terrain (rivers, roads, border). */
const OVERLAY_ALPHA: Readonly<Record<number, number>> = { 0: 0, 1: 64, 2: 64, 3: 128, 4: 128, 6: 128, 7: 64 }

export const MAX_ATLAS_PAGE = 2048

/**
 * The original game draws in 16-bit colour (RGB565): each palette channel is truncated to 5/6/5
 * bits and expanded back on display (measured from reference captures, research.md §5).
 */
export function toDisplayColor(r: number, g: number, b: number): [number, number, number] {
  const r5 = r >> 3
  const g6 = g >> 2
  const b5 = b >> 3
  return [Math.round((r5 * 255) / 31), Math.round((g6 * 255) / 63), Math.round((b5 * 255) / 31)]
}

export interface AtlasSprite {
  /** Lower-case DEF name. */
  name: string
  /** Palette row index. */
  row: number
  /** Atlas cell per view index. */
  cells: number[]
  /** Terrain sprites are opaque; overlay sprites use special-index transparency. */
  overlay: boolean
}

export interface AtlasLayout {
  /** Page width and height in pixels (square, power of two). */
  size: number
  cellsPerRow: number
  cellCount: number
  sprites: Record<string, AtlasSprite>
  rowCount: number
}

export interface Atlas {
  layout: AtlasLayout
  /** size × size palette indices. */
  indices: Uint8Array
  /** 256 × rowCount × 4 RGBA base palettes (unrotated). */
  palettes: Uint8Array
}

export interface AtlasInput {
  def: DefSprite
  overlay: boolean
}

export function buildAtlas(inputs: readonly AtlasInput[]): Atlas {
  // Count distinct frames first to size the page.
  let distinct = 0
  for (const { def } of inputs) distinct += new Set(def.frameOrder.map((f) => f.header.offset)).size
  let size = TILE_SIZE
  while ((size / TILE_SIZE) ** 2 < distinct) size *= 2
  if (size > MAX_ATLAS_PAGE) throw new RangeError(`atlas needs ${distinct} cells, more than a ${MAX_ATLAS_PAGE}² page holds`)
  const cellsPerRow = size / TILE_SIZE
  const indices = new Uint8Array(size * size)
  const palettes = new Uint8Array(256 * inputs.length * 4)
  const sprites: Record<string, AtlasSprite> = {}
  let cell = 0
  inputs.forEach(({ def, overlay }, row) => {
    const byOffset = new Map<number, number>()
    const cells: number[] = []
    for (const ref of def.frameOrder) {
      let c = byOffset.get(ref.header.offset)
      if (c === undefined) {
        c = cell++
        byOffset.set(ref.header.offset, c)
        const frame = decodeFrame(def, ref)
        if (frame.fullWidth !== TILE_SIZE || frame.fullHeight !== TILE_SIZE) {
          throw new RangeError(`${def.name}: frame ${ref.name} is ${frame.fullWidth}x${frame.fullHeight}, terrain layers need ${TILE_SIZE}x${TILE_SIZE}`)
        }
        const cx = (c % cellsPerRow) * TILE_SIZE
        const cy = Math.floor(c / cellsPerRow) * TILE_SIZE
        for (let y = 0; y < frame.height; y++) {
          const src = y * frame.width
          indices.set(frame.pixels.subarray(src, src + frame.width), (cy + frame.y + y) * size + cx + frame.x)
        }
      }
      cells.push(c)
    }
    const base = row * 256 * 4
    for (let i = 0; i < 256; i++) {
      const o = base + i * 4
      const alpha = overlay ? OVERLAY_ALPHA[i] : undefined
      if (alpha !== undefined) {
        palettes[o + 3] = alpha
        continue
      }
      const [r, g, b] = toDisplayColor(def.palette[i * 3] as number, def.palette[i * 3 + 1] as number, def.palette[i * 3 + 2] as number)
      palettes[o] = r
      palettes[o + 1] = g
      palettes[o + 2] = b
      palettes[o + 3] = 255
    }
    sprites[def.name.toLowerCase()] = { name: def.name.toLowerCase(), row, cells, overlay }
  })
  return { layout: { size, cellsPerRow, cellCount: cell, sprites, rowCount: inputs.length }, indices, palettes }
}

/** GPU bytes the atlas occupies once uploaded (index page + palette texture). */
export function atlasGpuBytes(layout: AtlasLayout): number {
  return layout.size * layout.size + 256 * layout.rowCount * 4
}
