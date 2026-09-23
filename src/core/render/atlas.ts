// Terrain atlas (research.md §6): every frame of the terrain, river, road and border sprites as
// 8-bit palette indices in fixed 32×32 cells, plus one RGBA palette row per sprite. Built once per
// archive; its size does not depend on the map (constitution IV).

import { TILE_SIZE } from '../data/terrain.ts'
import { decodeFrame } from '../formats/def/def.ts'
import type { DefSprite } from '../formats/def/def.ts'
import type { PcxImage } from '../formats/pcx/pcx.ts'

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
  /** Lower-case DEF name, or the tile-set prefix for a HotA terrain. */
  name: string
  /** Palette row index; the first row when the sprite has one row per view. */
  row: number
  /** Atlas cell per view index. */
  cells: number[]
  /**
   * Palette row per view index. Null when one row covers the whole sprite (every DEF). HotA
   * terrains ship as separate PCX tiles with a palette each, so they need a row per tile
   * (spec 005 research M1).
   */
  rows: number[] | null
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

/** A numbered PCX tile set: HotA's Highlands and Wasteland terrains. */
export interface AtlasTileSet {
  /** Lower-case name the draw plan looks the sprite up by (the file-name prefix). */
  name: string
  /** Tiles in view-index order; each 32x32 indexed with its own palette. */
  tiles: readonly PcxImage[]
}

export type AtlasInput = { def: DefSprite; overlay: boolean } | { tileSet: AtlasTileSet; overlay: boolean }

function writePaletteRow(palettes: Uint8Array, row: number, palette: Uint8Array, overlay: boolean): void {
  const base = row * 256 * 4
  for (let i = 0; i < 256; i++) {
    const o = base + i * 4
    const alpha = overlay ? OVERLAY_ALPHA[i] : undefined
    if (alpha !== undefined) {
      palettes[o + 3] = alpha
      continue
    }
    const [r, g, b] = toDisplayColor(palette[i * 3] as number, palette[i * 3 + 1] as number, palette[i * 3 + 2] as number)
    palettes[o] = r
    palettes[o + 1] = g
    palettes[o + 2] = b
    palettes[o + 3] = 255
  }
}

export function buildAtlas(inputs: readonly AtlasInput[]): Atlas {
  // Count distinct frames and palette rows first to size the page and the palette texture.
  let distinct = 0
  let rowCount = 0
  for (const input of inputs) {
    if ('def' in input) {
      distinct += new Set(input.def.frameOrder.map((f) => f.header.offset)).size
      rowCount += 1
    } else {
      distinct += input.tileSet.tiles.length
      // One palette per tile: HotA gives every terrain tile its own 244 colours.
      rowCount += input.tileSet.tiles.length
    }
  }
  let size = TILE_SIZE
  while ((size / TILE_SIZE) ** 2 < distinct) size *= 2
  if (size > MAX_ATLAS_PAGE) throw new RangeError(`atlas needs ${distinct} cells, more than a ${MAX_ATLAS_PAGE}² page holds`)
  const cellsPerRow = size / TILE_SIZE
  const indices = new Uint8Array(size * size)
  const palettes = new Uint8Array(256 * rowCount * 4)
  const sprites: Record<string, AtlasSprite> = {}
  let cell = 0
  let row = -1
  const writeCell = (c: number, width: number, height: number, x: number, y: number, pixels: Uint8Array, srcWidth: number): void => {
    const cx = (c % cellsPerRow) * TILE_SIZE
    const cy = Math.floor(c / cellsPerRow) * TILE_SIZE
    for (let yy = 0; yy < height; yy++) {
      const src = yy * srcWidth
      indices.set(pixels.subarray(src, src + width), (cy + y + yy) * size + cx + x)
    }
  }
  for (const input of inputs) {
    if (!('def' in input)) {
      const { tileSet, overlay } = input
      const cells: number[] = []
      const rows: number[] = []
      tileSet.tiles.forEach((tile, i) => {
        if (tile.width !== TILE_SIZE || tile.height !== TILE_SIZE || tile.kind !== 'indexed' || tile.palette === undefined) {
          throw new RangeError(`${tileSet.name}: tile ${i} is ${tile.width}x${tile.height} ${tile.kind}, terrain tiles need ${TILE_SIZE}x${TILE_SIZE} indexed`)
        }
        const c = cell++
        writeCell(c, TILE_SIZE, TILE_SIZE, 0, 0, tile.pixels, TILE_SIZE)
        row += 1
        writePaletteRow(palettes, row, tile.palette, overlay)
        cells.push(c)
        rows.push(row)
      })
      sprites[tileSet.name.toLowerCase()] = { name: tileSet.name.toLowerCase(), row: rows[0] ?? 0, cells, rows, overlay }
      continue
    }
    const { def, overlay } = input
    row += 1
    buildDefSprite(def, overlay, row)
    continue
  }
  function buildDefSprite(def: DefSprite, overlay: boolean, row: number): void {
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
        writeCell(c, frame.width, frame.height, frame.x, frame.y, frame.pixels, frame.width)
      }
      cells.push(c)
    }
    writePaletteRow(palettes, row, def.palette, overlay)
    sprites[def.name.toLowerCase()] = { name: def.name.toLowerCase(), row, cells, rows: null, overlay }
  }
  return { layout: { size, cellsPerRow, cellCount: cell, sprites, rowCount }, indices, palettes }
}

/** GPU bytes the atlas occupies once uploaded (index page + palette texture). */
export function atlasGpuBytes(layout: AtlasLayout): number {
  return layout.size * layout.size + 256 * layout.rowCount * 4
}
