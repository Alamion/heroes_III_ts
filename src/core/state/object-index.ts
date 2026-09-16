// Spatial index of render objects by anchor tile, so object queries cost O(view), not O(map)
// (specs/003-map-objects/research.md §2).

import type { RenderObject } from './render-objects.ts'

export const BUCKET_TILES = 8

/** How far a sprite reaches from its anchor, in tiles (largest base-game sprites: 8×6 tiles). */
export const MAX_SPRITE_EXTENT = { left: 8, up: 6 } as const

export interface TileRangeLike {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export class ObjectIndex {
  readonly objects: readonly RenderObject[]
  private readonly buckets: Map<number, number[]>[]
  private readonly bucketsPerRow: number

  constructor(objects: readonly RenderObject[], size: number, levels: number) {
    this.objects = objects
    // Anchors may lie up to MAX_SPRITE_EXTENT past the map edge (sprites reaching into the map).
    this.bucketsPerRow = Math.ceil((size + MAX_SPRITE_EXTENT.left + 1) / BUCKET_TILES) + 1
    this.buckets = Array.from({ length: levels }, () => new Map())
    objects.forEach((o, i) => {
      const level = this.buckets[o.z]
      if (level === undefined) return
      const key = this.key(o.x, o.y)
      const list = level.get(key)
      if (list === undefined) level.set(key, [i])
      else list.push(i)
    })
  }

  private key(x: number, y: number): number {
    return Math.floor(Math.max(0, y) / BUCKET_TILES) * this.bucketsPerRow + Math.floor(Math.max(0, x) / BUCKET_TILES)
  }

  /**
   * Indices (into `objects`, ascending) of objects on `level` whose sprite can intersect `range`:
   * anchors in [x0, x1 + left] × [y0, y1 + up]. Visits only the buckets overlapping that area.
   */
  query(level: number, range: TileRangeLike): number[] {
    const buckets = this.buckets[level]
    if (buckets === undefined) return []
    const ax0 = range.x0
    const ay0 = range.y0
    const ax1 = range.x1 + MAX_SPRITE_EXTENT.left
    const ay1 = range.y1 + MAX_SPRITE_EXTENT.up
    const out: number[] = []
    const bx0 = Math.floor(Math.max(0, ax0) / BUCKET_TILES)
    const by0 = Math.floor(Math.max(0, ay0) / BUCKET_TILES)
    const bx1 = Math.floor(Math.max(0, ax1) / BUCKET_TILES)
    const by1 = Math.floor(Math.max(0, ay1) / BUCKET_TILES)
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= Math.min(bx1, this.bucketsPerRow - 1); bx++) {
        const list = buckets.get(by * this.bucketsPerRow + bx)
        if (list === undefined) continue
        for (const i of list) {
          const o = this.objects[i] as RenderObject
          if (o.x >= ax0 && o.x <= ax1 && o.y >= ay0 && o.y <= ay1) out.push(i)
        }
      }
    }
    return out.sort((a, b) => a - b)
  }
}
