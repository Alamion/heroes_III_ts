// Tile-offset registration of a game capture against an editor capture (SC-003 cross-check).
import { tilePixel } from './geometry.ts'
import type { TileMapping, TileRange, VisibleRange } from '../model/types.ts'

export interface Capture {
  width: number
  rgb: Buffer
  /** One byte per pixel, non-zero = volatile. */
  mask: Buffer
  mapping: TileMapping
  visible: VisibleRange
}

export interface OffsetScore {
  dx: number
  dy: number
  compared: number
  differing: number
  fraction: number
}

function innerTiles(v: VisibleRange): TileRange {
  // Partial edge tiles are cut by the viewport; skip them.
  return {
    x0: v.x0 + (v.partialEdges.includes('left') ? 1 : 0),
    y0: v.y0 + (v.partialEdges.includes('top') ? 1 : 0),
    x1: v.x1 - (v.partialEdges.includes('right') ? 1 : 0),
    y1: v.y1 - (v.partialEdges.includes('bottom') ? 1 : 0),
  }
}

function inViewport(m: TileMapping, px: { x: number; y: number }): boolean {
  const vp = m.viewport
  return px.x >= vp.x && px.y >= vp.y && px.x + 32 <= vp.x + vp.w && px.y + 32 <= vp.y + vp.h
}

/**
 * Scores offsets: game tile (tx, ty) is compared with editor tile (tx + dx, ty + dy). The true
 * registration is the offset with the lowest differing fraction; correct positioning gives (0, 0).
 */
export function registerCaptures(
  game: Capture,
  editor: Capture,
  radius = 3,
  /** Per-channel tolerance: the game renders in 16-bit colour, the editor in 24-bit, so channels differ slightly. */
  tolerance = 8,
): { best: OffsetScore; scores: OffsetScore[] } {
  const near = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance
  const g = innerTiles(game.visible)
  const e = innerTiles(editor.visible)
  const scores: OffsetScore[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let compared = 0
      let differing = 0
      for (let ty = Math.max(g.y0, e.y0 - dy); ty <= Math.min(g.y1, e.y1 - dy); ty++) {
        for (let tx = Math.max(g.x0, e.x0 - dx); tx <= Math.min(g.x1, e.x1 - dx); tx++) {
          const gp = tilePixel(game.mapping, { x: tx, y: ty })
          const ep = tilePixel(editor.mapping, { x: tx + dx, y: ty + dy })
          if (!inViewport(game.mapping, gp) || !inViewport(editor.mapping, ep)) continue
          for (let y = 0; y < 32; y++) {
            for (let x = 0; x < 32; x++) {
              const gi = (gp.y + y) * game.width + gp.x + x
              const ei = (ep.y + y) * editor.width + ep.x + x
              if (game.mask[gi] !== 0 || editor.mask[ei] !== 0) continue
              compared++
              if (!near(game.rgb[gi * 3], editor.rgb[ei * 3]) || !near(game.rgb[gi * 3 + 1], editor.rgb[ei * 3 + 1]) || !near(game.rgb[gi * 3 + 2], editor.rgb[ei * 3 + 2])) differing++
            }
          }
        }
      }
      scores.push({ dx, dy, compared, differing, fraction: compared === 0 ? 1 : differing / compared })
    }
  }
  const usable = scores.filter((s) => s.compared >= 32 * 32 * 4)
  const best = (usable.length > 0 ? usable : scores).reduce((a, b) => (b.fraction < a.fraction ? b : a))
  return { best, scores }
}
