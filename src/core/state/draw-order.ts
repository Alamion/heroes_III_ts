// Draw order of render objects (specs/003-map-objects/research.md §4; revised 2026-09-28 and
// 2026-09-30, spec 005 research "Draw order: tiles and columns"). The game draws the adventure map
// tile by tile, so the order is decided per map tile: object-plan.ts cuts every sprite at tile borders
// and sorts the pieces with `comparePieces`.

import type { RenderObject } from './render-objects.ts'

/** What the draw order reads of a render object. */
export type DrawOrderInput = Pick<RenderObject, 'kind' | 'flat' | 'x' | 'y' | 'z' | 'visitable' | 'order' | 'passable'>

// The body's flagpole covers the last flag column in the game (research.md "Hero flags").
const KIND_RANK: Readonly<Record<RenderObject['kind'], number>> = { object: 0, heroFlag: 1, heroBody: 2 }

/**
 * Depth of an object in map column `wx` (spec 005 research "Draw order: tiles and columns"): the row
 * of its lowest blocked tile in that column; a column where the sprite only overhangs counts as the
 * object's own row (a windmill's blades stay over a monster standing beside the mill). Heroes use
 * their row.
 */
export function columnDepth(o: DrawOrderInput, wx: number): number {
  if (o.kind !== 'object') return o.y
  const mask = o.passable
  if (mask === undefined) return o.y
  const bit = wx - o.x + 7
  if (bit < 0 || bit > 7) return o.y
  for (let row = 5; row >= 0; row--) if (((mask[row] as number) & (1 << bit)) === 0) return o.y + row - 5
  return o.y
}

/** Whether an object blocks map tile (wx, wy); heroes block nothing here. */
export function blocksTile(o: DrawOrderInput, wx: number, wy: number): boolean {
  if (o.kind !== 'object' || o.passable === undefined) return false
  const bit = wx - o.x + 7
  const row = wy - o.y + 5
  if (bit < 0 || bit > 7 || row < 0 || row > 5) return false
  return ((o.passable[row] as number) & (1 << bit)) === 0
}

/** What orders a sprite piece within its map tile (`comparePieces`). */
export interface PieceOrder {
  /** `columnDepth` of the object in the tile's column. */
  depth: number
  /** The object blocks this tile (else the sprite only overhangs it). */
  blocked: boolean
}

/** The order keys of object `o` in map tile (wx, wy). */
export function orderInTile(o: DrawOrderInput, wx: number, wy: number): PieceOrder {
  return { depth: columnDepth(o, wx), blocked: blocksTile(o, wx, wy) }
}

/**
 * Order of two sprite pieces in one map tile. The game draws the adventure map tile by tile, so two
 * objects may overlap in one order in one tile and in the other order in the next (19 % of the
 * object pairs overlapping in several tiles, in stills of 19 SoD and HotA maps). Within a tile: flat
 * objects first, then the anchor row, then column depth (`columnDepth`), then a piece that only
 * overhangs the tile in front of one that blocks it; where both only overhang it, a visitable object
 * in front (windmill blades over the trees and the monster beside the mill); heroes after other
 * objects, map file order. One rule for SoD and HotA, chosen over the whole corpus
 * (`yarn verify corpus`; spec 005 research "Draw order: tiles and columns"). Shadows are not ordered
 * here: every shadow is drawn before every body.
 */
export function comparePieces(a: DrawOrderInput, pa: PieceOrder, b: DrawOrderInput, pb: PieceOrder): number {
  if (a.flat !== b.flat) return a.flat ? -1 : 1
  if (a.y !== b.y) return a.y - b.y
  if (pa.depth !== pb.depth) return pa.depth - pb.depth
  if (pa.blocked !== pb.blocked) return pa.blocked ? -1 : 1
  if (!pa.blocked && a.visitable !== b.visitable) return a.visitable ? 1 : -1
  const heroA = a.kind === 'object' ? 0 : 1
  const heroB = b.kind === 'object' ? 0 : 1
  if (heroA !== heroB) return heroA - heroB
  if (a.order !== b.order) return a.order - b.order
  return KIND_RANK[a.kind] - KIND_RANK[b.kind]
}
