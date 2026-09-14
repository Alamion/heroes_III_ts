import type { Edge, Point, Rect, TileMapping, TileRange, VisibleRange } from '../model/types.ts'

export const TILE = 32

/** Minimap pixel at the centre of tile (x, y). */
export function tileToMinimapPoint(tile: Point, mapSize: number, minimap: Rect): Point {
  return {
    x: minimap.x + Math.floor(((tile.x + 0.5) * minimap.w) / mapSize),
    y: minimap.y + Math.floor(((tile.y + 0.5) * minimap.h) / mapSize),
  }
}

/**
 * Visible tiles and the tile→pixel mapping for a view whose first tile (origin) is drawn at
 * `firstTilePixel`. Tiles cut by the viewport edge are included and reported in partialEdges.
 */
export function viewMapping(
  origin: Point,
  firstTilePixel: Point,
  viewport: Rect,
  mapSize: number,
): { visible: VisibleRange; mapping: TileMapping } {
  const tileAtPixel = (px: number, originTile: number, originPx: number) => originTile + Math.floor((px - originPx) / TILE)
  let x0 = tileAtPixel(viewport.x, origin.x, firstTilePixel.x)
  let y0 = tileAtPixel(viewport.y, origin.y, firstTilePixel.y)
  let x1 = tileAtPixel(viewport.x + viewport.w - 1, origin.x, firstTilePixel.x)
  let y1 = tileAtPixel(viewport.y + viewport.h - 1, origin.y, firstTilePixel.y)
  const partialEdges: Edge[] = []
  const pixelOf = (t: number, o: number, p: number) => p + (t - o) * TILE
  if (pixelOf(x0, origin.x, firstTilePixel.x) < viewport.x) partialEdges.push('left')
  if (pixelOf(y0, origin.y, firstTilePixel.y) < viewport.y) partialEdges.push('top')
  if (pixelOf(x1, origin.x, firstTilePixel.x) + TILE > viewport.x + viewport.w) partialEdges.push('right')
  if (pixelOf(y1, origin.y, firstTilePixel.y) + TILE > viewport.y + viewport.h) partialEdges.push('bottom')
  x0 = Math.max(0, x0)
  y0 = Math.max(0, y0)
  x1 = Math.min(mapSize - 1, x1)
  y1 = Math.min(mapSize - 1, y1)
  return {
    visible: { x0, y0, x1, y1, partialEdges },
    mapping: { tileSize: TILE, originTile: { ...origin }, originPixel: { ...firstTilePixel }, viewport: { ...viewport } },
  }
}

export function tilePixel(mapping: TileMapping, tile: Point): Point {
  return {
    x: mapping.originPixel.x + (tile.x - mapping.originTile.x) * mapping.tileSize,
    y: mapping.originPixel.y + (tile.y - mapping.originTile.y) * mapping.tileSize,
  }
}

/** Pixel rectangle of a tile region, clipped to the viewport. */
export function cropForRegion(mapping: TileMapping, region: TileRange): Rect {
  const tl = tilePixel(mapping, { x: region.x0, y: region.y0 })
  const br = tilePixel(mapping, { x: region.x1 + 1, y: region.y1 + 1 })
  const vp = mapping.viewport
  const x = Math.max(tl.x, vp.x)
  const y = Math.max(tl.y, vp.y)
  const r = Math.min(br.x, vp.x + vp.w)
  const b = Math.min(br.y, vp.y + vp.h)
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, b - y) }
}

export function rangeContains(outer: TileRange, inner: TileRange): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1
}
