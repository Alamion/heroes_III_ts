// Pixel footprints of map objects (research.md §9): the union of non-transparent pixels over all
// frames of a sprite, placed with its bottom-right corner on the bottom-right corner of the
// object's tile.

import { TILE_SIZE } from '../data/terrain.ts'
import { decodeFrame } from '../formats/def/def.ts'
import type { DefSprite } from '../formats/def/def.ts'
import { maskOffsets } from '../formats/h3m/types.ts'

/** Coverage of a sprite over all its frames, width × height, 1 = some frame draws there. */
export interface SpriteMask {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly mask: Uint8Array
}

export function spriteMaskFromDef(def: DefSprite): SpriteMask {
  const width = def.fullWidth
  const height = def.fullHeight
  const mask = new Uint8Array(width * height)
  const seen = new Set<number>()
  for (const ref of def.frameOrder) {
    if (seen.has(ref.header.offset)) continue
    seen.add(ref.header.offset)
    const f = decodeFrame(def, ref)
    for (let row = 0; row < f.height; row++) {
      const y = f.y + row
      if (y >= height) break
      for (let col = 0; col < f.width; col++) {
        if (f.pixels[row * f.width + col] === 0) continue
        const x = f.x + col
        if (x < width) mask[y * width + x] = 1
      }
    }
  }
  return { name: def.name, width, height, mask }
}

/** Union of masks aligned at their bottom-right corners. */
export function unionMasks(name: string, masks: readonly SpriteMask[]): SpriteMask {
  const width = Math.max(0, ...masks.map((m) => m.width))
  const height = Math.max(0, ...masks.map((m) => m.height))
  const mask = new Uint8Array(width * height)
  for (const m of masks) {
    const ox = width - m.width
    const oy = height - m.height
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) if (m.mask[y * m.width + x]) mask[(y + oy) * width + x + ox] = 1
  }
  return { name, width, height, mask }
}

/** A template-shaped fallback when a sprite is missing: every tile of the 8×6 area that the template blocks or uses. */
export function templateAreaMask(name: string, passable: Uint8Array, active: Uint8Array): SpriteMask {
  const width = 8 * TILE_SIZE
  const height = 6 * TILE_SIZE
  const mask = new Uint8Array(width * height)
  const blocked = new Set<string>()
  for (const { dx, dy } of maskOffsets(active)) blocked.add(`${dx},${dy}`)
  const passableSet = new Set(maskOffsets(passable).map(({ dx, dy }) => `${dx},${dy}`))
  for (let dy = -5; dy <= 0; dy++)
    for (let dx = -7; dx <= 0; dx++) if (!passableSet.has(`${dx},${dy}`)) blocked.add(`${dx},${dy}`)
  for (const key of blocked) {
    const [dx, dy] = key.split(',').map(Number) as [number, number]
    const tx = (dx + 7) * TILE_SIZE
    const ty = (dy + 5) * TILE_SIZE
    for (let y = 0; y < TILE_SIZE; y++) mask.fill(1, (ty + y) * width + tx, (ty + y) * width + tx + TILE_SIZE)
  }
  return { name, width, height, mask }
}

/** Per-tile 32×32 coverage bitsets (one u32 per pixel row). */
export interface TileCoverage {
  readonly x: number
  readonly y: number
  readonly rows: Uint32Array
}

export type Footprint = Map<string, TileCoverage>

export function tileKey(x: number, y: number): string {
  return `${x},${y}`
}

/** Adds a sprite anchored at object tile (x, y) to a footprint. */
export function placeMask(target: Footprint, sprite: SpriteMask, x: number, y: number): void {
  const originX = (x + 1) * TILE_SIZE - sprite.width
  const originY = (y + 1) * TILE_SIZE - sprite.height
  for (let py = 0; py < sprite.height; py++) {
    const wy = originY + py
    const ty = Math.floor(wy / TILE_SIZE)
    const ry = wy - ty * TILE_SIZE
    for (let px = 0; px < sprite.width; px++) {
      if (!sprite.mask[py * sprite.width + px]) continue
      const wx = originX + px
      const tx = Math.floor(wx / TILE_SIZE)
      const rx = wx - tx * TILE_SIZE
      const key = tileKey(tx, ty)
      let cov = target.get(key)
      if (cov === undefined) {
        cov = { x: tx, y: ty, rows: new Uint32Array(TILE_SIZE) }
        target.set(key, cov)
      }
      cov.rows[ry] = ((cov.rows[ry] as number) | (1 << rx)) >>> 0
    }
  }
}

export function coveredPixels(cov: TileCoverage): number {
  let n = 0
  for (const r of cov.rows) {
    let v = r
    while (v) {
      v &= v - 1
      n++
    }
  }
  return n
}

export function isCovered(cov: TileCoverage | undefined, px: number, py: number): boolean {
  if (cov === undefined) return false
  return (((cov.rows[py] as number) >>> px) & 1) === 1
}
