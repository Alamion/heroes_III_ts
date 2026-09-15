// Camera and visible range (data-model.md Render). World pixels: tile (x, y) spans
// [x·32, (x+1)·32). The camera holds the world pixel shown at the top-left device pixel.

import { TILE_SIZE } from '../data/terrain.ts'

export interface Camera {
  level: number
  /** World pixel at the viewport's top-left corner (integers keep pixel art crisp). */
  offsetX: number
  offsetY: number
  /** Viewport in device pixels. */
  width: number
  height: number
  /** Device pixels per world pixel (1 = native 32 px tiles). */
  scale: number
}

export interface TileRange {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Tiles intersecting the viewport, plus `margin` tiles on each side (may extend outside the map). */
export function visibleRange(cam: Camera, margin = 1): TileRange {
  const tile = TILE_SIZE * cam.scale
  const left = cam.offsetX * cam.scale
  const top = cam.offsetY * cam.scale
  return {
    x0: Math.floor(left / tile) - margin,
    y0: Math.floor(top / tile) - margin,
    x1: Math.floor((left + cam.width - 1) / tile) + margin,
    y1: Math.floor((top + cam.height - 1) / tile) + margin,
  }
}

export function rangeEquals(a: TileRange | undefined, b: TileRange): boolean {
  return a !== undefined && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1
}

/** Whether a range lies inside another (the plan can be reused while the camera stays inside). */
export function rangeContains(outer: TileRange, inner: TileRange): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1
}

/** Camera that centres world pixel (cx, cy). */
export function centeredCamera(level: number, cx: number, cy: number, width: number, height: number, scale = 1): Camera {
  return { level, offsetX: Math.round(cx - width / scale / 2), offsetY: Math.round(cy - height / scale / 2), width, height, scale }
}

/** Camera that places tile `originTile` at device pixel `originPixel` (capture mappings). */
export function cameraForMapping(level: number, originTile: { x: number; y: number }, originPixel: { x: number; y: number }, width: number, height: number): Camera {
  return { level, offsetX: originTile.x * TILE_SIZE - originPixel.x, offsetY: originTile.y * TILE_SIZE - originPixel.y, width, height, scale: 1 }
}

/** Keeps the camera within the map plus a border band of `borderTiles` tiles. */
export function clampCamera(cam: Camera, mapSize: number, borderTiles: number): Camera {
  const viewW = cam.width / cam.scale
  const viewH = cam.height / cam.scale
  const min = -borderTiles * TILE_SIZE
  const maxX = (mapSize + borderTiles) * TILE_SIZE - viewW
  const maxY = (mapSize + borderTiles) * TILE_SIZE - viewH
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? Math.round((lo + hi) / 2) : Math.min(Math.max(v, lo), hi))
  return { ...cam, offsetX: clamp(cam.offsetX, min, maxX), offsetY: clamp(cam.offsetY, min, maxY) }
}
