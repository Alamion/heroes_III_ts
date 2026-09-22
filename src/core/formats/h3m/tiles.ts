import { HOTA_TERRAIN_COUNT, MAX_RIVER_ID, MAX_ROAD_ID, TERRAIN_COUNT } from '../../data/terrain.ts'
import type { H3mContext } from './context.ts'
import { TILE_RECORD_SIZE } from './types.ts'

/** Reads levels × size² tile records and validates layer ids. */
export function readTiles(c: H3mContext, size: number, levels: number): Uint8Array {
  return c.r.scope('tiles', () => {
    const start = c.r.offset
    // HotA adds Highlands (10) and Wasteland (11); a base-game map must not carry them, and
    // rivers and roads are unchanged in HotA (research M4, M7).
    const terrainCount = c.f.hota ? HOTA_TERRAIN_COUNT : TERRAIN_COUNT
    const count = size * size * levels
    const tiles = c.r.bytesCopy(count * TILE_RECORD_SIZE)
    for (let i = 0; i < count; i++) {
      const o = i * TILE_RECORD_SIZE
      const terrain = tiles[o] as number
      const river = tiles[o + 2] as number
      const road = tiles[o + 4] as number
      if (terrain >= terrainCount || river > MAX_RIVER_ID || road > MAX_ROAD_ID) {
        const z = Math.floor(i / (size * size))
        const y = Math.floor((i % (size * size)) / size)
        const x = i % size
        c.r.invalid(`tile (${x},${y},${z}): terrain ${terrain}, river ${river}, road ${road} out of range`, start + o)
      }
    }
    return tiles
  })
}
