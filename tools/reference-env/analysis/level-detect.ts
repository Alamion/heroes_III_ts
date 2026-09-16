// Which map level the game shows, from the minimap and the parsed map's terrain
// (specs/003-map-objects/research.md §11). Independent of the interface colour, which follows the
// human player's colour.
import type { Rgb } from '../data/game-layout.ts'
import type { Rect } from '../model/types.ts'
import type { Frame } from './minimap.ts'

export interface LevelDetection {
  /** Detected level, or null when no level wins by the required margin. */
  level: number | null
  /** Agreement 0–1 per level. */
  agreement: number[]
  /** Best agreement minus the runner-up (1 for single-level maps). */
  margin: number
}

export const LEVEL_MARGIN = 0.1

/**
 * `terrain[z][y * size + x]` is the terrain id of each tile. The game draws each terrain in two
 * shades (passable and blocked) plus object colours, so on the level that is shown (a) tiles of one
 * minimap colour share a terrain (purity) and (b) each terrain's tiles use at most two main colours
 * (coverage). Agreement = purity × coverage; measured 0.92 vs 0.20 (Arrogance surface) and 0.99 vs
 * 0.30 (Shadow Valleys underground). Tiles drawn in an `ignore` colour (view rectangle) are skipped.
 */
export function detectLevel(frame: Frame, minimap: Rect, size: number, terrain: readonly Uint8Array[], ignore: readonly Rgb[] = []): LevelDetection {
  const scale = minimap.w / size
  const colour = new Int32Array(size * size)
  const distinct = new Set<number>()
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const x = minimap.x + Math.min(minimap.w - 1, Math.floor((tx + 0.5) * scale))
      const y = minimap.y + Math.min(minimap.h - 1, Math.floor((ty + 0.5) * scale))
      const i = (y * frame.width + x) * 3
      const r = frame.rgb[i] as number
      const g = frame.rgb[i + 1] as number
      const b = frame.rgb[i + 2] as number
      const c = ignore.some((k) => k[0] === r && k[1] === g && k[2] === b) ? -1 : (r << 16) | (g << 8) | b
      colour[ty * size + tx] = c
      if (c >= 0) distinct.add(c)
    }
  }
  // A shrouded or blank minimap carries no information.
  if (distinct.size < 2) return { level: null, agreement: terrain.map(() => 0), margin: 0 }
  const agreement = terrain.map((t) => {
    const byColour = new Map<number, Map<number, number>>()
    const byTerrain = new Map<number, Map<number, number>>()
    let tiles = 0
    const bump = (m: Map<number, Map<number, number>>, k: number, v: number) => {
      let inner = m.get(k)
      if (inner === undefined) {
        inner = new Map()
        m.set(k, inner)
      }
      inner.set(v, (inner.get(v) ?? 0) + 1)
    }
    for (let i = 0; i < size * size; i++) {
      const c = colour[i] as number
      if (c < 0) continue
      tiles++
      bump(byColour, c, t[i] as number)
      bump(byTerrain, t[i] as number, c)
    }
    if (tiles === 0) return 0
    let purity = 0
    for (const m of byColour.values()) purity += Math.max(...m.values())
    let coverage = 0
    for (const m of byTerrain.values()) {
      const counts = [...m.values()].sort((a, b) => b - a)
      coverage += (counts[0] ?? 0) + (counts[1] ?? 0)
    }
    return (purity / tiles) * (coverage / tiles)
  })
  if (agreement.length === 1) return { level: 0, agreement, margin: 1 }
  const order = agreement.map((a, z) => ({ a, z })).sort((p, q) => q.a - p.a)
  const best = order[0] as { a: number; z: number }
  const margin = best.a - (order[1]?.a ?? 0)
  return { level: margin >= LEVEL_MARGIN ? best.z : null, agreement, margin }
}
