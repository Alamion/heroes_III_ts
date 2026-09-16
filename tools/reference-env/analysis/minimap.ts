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
 * Which edges of the bounding box are real dashed lines. A clipped edge only has the few pixels of
 * the perpendicular dashes, which may even start in a dash gap, so the bounding box alone cannot
 * tell a clipped edge from a drawn one.
 */
export function drawnEdges(frame: Frame, rect: Rect, color: Rgb): { left: boolean; top: boolean; right: boolean; bottom: boolean } {
  const countRow = (y: number) => {
    let n = 0
    for (let x = rect.x; x < rect.x + rect.w; x++) if (pixelIs(frame, x, y, color)) n++
    return n
  }
  const countCol = (x: number) => {
    let n = 0
    for (let y = rect.y; y < rect.y + rect.h; y++) if (pixelIs(frame, x, y, color)) n++
    return n
  }
  const line = (n: number, len: number) => n >= Math.max(4, Math.floor(len * 0.3))
  return {
    top: line(countRow(rect.y), rect.w),
    bottom: line(countRow(rect.y + rect.h - 1), rect.w),
    left: line(countCol(rect.x), rect.h),
    right: line(countCol(rect.x + rect.w - 1), rect.h),
  }
}

/**
 * Converts the minimap rectangle to the view's top-left tile. A clipped edge is reconstructed from
 * the opposite, drawn edge and the known view size.
 */
export function rectToViewOrigin(
  rect: Rect,
  minimap: Rect,
  mapSize: number,
  viewTiles: { w: number; h: number },
  edges: { left: boolean; top: boolean; right: boolean; bottom: boolean },
): ViewTiles {
  const scale = minimap.w / mapSize
  const clipped = { left: !edges.left, top: !edges.top, right: !edges.right, bottom: !edges.bottom }
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

/** How far (px) a clipped edge's bounding box may start from the minimap border (dash gaps). */
export const CLIPPED_EDGE_TOLERANCE = 4
/** Allowed difference (px) between the drawn rectangle and the expected view size. */
export const RECT_SIZE_TOLERANCE = 2

/**
 * Checks a view rectangle read from the minimap before it is trusted (specs/003-map-objects/
 * research.md §10): drawn opposite edges must span the view size, clipped edges must lie on the
 * minimap border. Returns a description of the problem, or null when the rectangle is plausible.
 */
export function viewRectProblem(
  rect: Rect,
  minimap: Rect,
  mapSize: number,
  viewTiles: { w: number; h: number },
  edges: { left: boolean; top: boolean; right: boolean; bottom: boolean },
): string | null {
  const scale = minimap.w / mapSize
  const axis = (name: string, start: number, len: number, mmStart: number, mmLen: number, drawnStart: boolean, drawnEnd: boolean, viewLen: number): string | null => {
    const expected = viewLen * scale
    if (drawnStart && drawnEnd && Math.abs(len - expected) > RECT_SIZE_TOLERANCE) return `${name}: drawn edges span ${len} px, expected ${expected.toFixed(1)}`
    if (!drawnStart && start - mmStart > CLIPPED_EDGE_TOLERANCE) return `${name}: start edge not drawn but ${start - mmStart} px inside the minimap`
    if (!drawnEnd && mmStart + mmLen - (start + len) > CLIPPED_EDGE_TOLERANCE) return `${name}: end edge not drawn but ${mmStart + mmLen - (start + len)} px inside the minimap`
    if (drawnStart !== drawnEnd && len > expected + RECT_SIZE_TOLERANCE) return `${name}: one edge clipped but the rectangle is ${len} px, longer than the view`
    return null
  }
  return (
    axis('horizontal', rect.x, rect.w, minimap.x, minimap.w, edges.left, edges.right, viewTiles.w) ??
    axis('vertical', rect.y, rect.h, minimap.y, minimap.h, edges.top, edges.bottom, viewTiles.h)
  )
}
