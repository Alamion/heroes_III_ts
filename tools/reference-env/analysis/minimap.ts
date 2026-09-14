// Pure analysis of the minimap region of a screen grab.
import type { Rgb } from '../data/game-layout.ts'
import type { Rect } from '../model/types.ts'

export interface Frame {
  width: number
  height?: number
  rgb: Buffer
}

function pixelIs(frame: Frame, x: number, y: number, c: Rgb): boolean {
  const i = (y * frame.width + x) * 3
  return frame.rgb[i] === c[0] && frame.rgb[i + 1] === c[1] && frame.rgb[i + 2] === c[2]
}

/** Bounding box (screen pixels) of the view rectangle's pixels inside the minimap, or undefined. */
export function findViewRect(frame: Frame, minimap: Rect, color: Rgb): Rect | undefined {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = minimap.y; y < minimap.y + minimap.h; y++) {
    for (let x = minimap.x; x < minimap.x + minimap.w; x++) {
      if (!pixelIs(frame, x, y, color)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (minX === Infinity) return undefined
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Fraction of minimap pixels with the shroud color. */
export function shroudFraction(frame: Frame, minimap: Rect, shroud: Rgb): number {
  let n = 0
  for (let y = minimap.y; y < minimap.y + minimap.h; y++) {
    for (let x = minimap.x; x < minimap.x + minimap.w; x++) if (pixelIs(frame, x, y, shroud)) n++
  }
  return n / (minimap.w * minimap.h)
}

export interface ViewTiles {
  /** Top-left tile of the view (may be negative: the game can show space beyond the map edge). */
  originX: number
  originY: number
  /** Edges of the drawn rectangle that were clipped by the minimap (view extends past the map). */
  clipped: { left: boolean; top: boolean; right: boolean; bottom: boolean }
}

/**
 * Converts the minimap rectangle to the view's top-left tile. The rectangle is clipped to the
 * minimap, so a clipped edge is reconstructed from the opposite edge and the known view size.
 */
export function rectToViewOrigin(rect: Rect, minimap: Rect, mapSize: number, viewTiles: { w: number; h: number }): ViewTiles {
  const scale = minimap.w / mapSize
  const clipped = {
    left: rect.x <= minimap.x,
    top: rect.y <= minimap.y,
    right: rect.x + rect.w >= minimap.x + minimap.w,
    bottom: rect.y + rect.h >= minimap.y + minimap.h,
  }
  const axis = (start: number, len: number, mmStart: number, clipStart: boolean, clipEnd: boolean, viewLen: number): number => {
    if (!clipStart) return Math.round((start - mmStart) / scale)
    if (!clipEnd) return Math.round((start + len - mmStart) / scale) - viewLen
    // Both edges clipped: the view is larger than the map on this axis; centre it.
    return Math.round((mapSize - viewLen) / 2)
  }
  return {
    originX: axis(rect.x, rect.w, minimap.x, clipped.left, clipped.right, viewTiles.w),
    originY: axis(rect.y, rect.h, minimap.y, clipped.top, clipped.bottom, viewTiles.h),
    clipped,
  }
}
