// Object draw plan (specs/003-map-objects/data-model.md "Object draw plan"): quads of the objects
// whose sprites reach into a tile range, in draw order, for one animation tick. Pure and DOM-free;
// its cost depends on the objects near the range (spatial index), not on the map.

import { NEUTRAL_SLOT } from '../data/players.ts'
import { TILE_SIZE } from '../data/terrain.ts'
import { className } from '../data/object-classes.ts'
import type { ObjectIndex } from '../state/object-index.ts'
import type { RenderObject } from '../state/render-objects.ts'
import { SHADOW_TINT_WEIGHT } from '../data/animation.ts'
import { frameOf } from './animation.ts'
import type { TileRange } from './camera.ts'
import type { FrameCell, ObjectAtlasLayout, ObjectSprite } from './object-atlas.ts'
import { comparePieces, orderInTile } from '../state/draw-order.ts'
import type { PieceOrder } from '../state/draw-order.ts'
import { QUAD_CORNERS } from './draw-plan.ts'

/**
 * Floats per vertex: the terrain layout (draw-plan.ts VERTEX_SIZE), then page, owner slot (0–7,
 * 8 = neutral), shadow tint weight (animation.ts SHADOW_TINT_WEIGHT), and the piece of the cell the
 * quad covers (min x, min y, max x, max y in cell pixels): sprites are cut at map tile borders,
 * because the game orders objects per tile (draw-order.ts `comparePieces`).
 */
export const OBJECT_VERTEX_SIZE = 16
export const OBJECT_VERTICES_PER_QUAD = 6

export interface DrawListEntry {
  id: number
  kind: RenderObject['kind']
  className: string
  def: string
  group: number
  frame: number
  frameCount: number
  mirror: boolean
  x: number
  y: number
  /** Top-left pixel of the full frame relative to the range's top-left tile. */
  screenX: number
  screenY: number
  width: number
  height: number
  owner: number | null
  flat: boolean
  visitable: boolean
  random: boolean
  floating: boolean
  /** Index into the render-object list. */
  index: number
  phase: number
}

export interface ObjectPlan {
  range: TileRange
  level: number
  tick: number
  vertices: Float32Array
  quadCount: number
  /** True when an object in the plan has more than one frame in its group. */
  animatedInView: boolean
  /** Render-object index per quad (draw order; one object has a quad per map tile it covers), for per-pixel ownership in checks. */
  quadObjects: Int32Array
  /** Sprites not found in the atlas (reported, not drawn). */
  missing: string[]
  entries: DrawListEntry[] | undefined
}

/**
 * Pieces of the view in draw order, packed as (render-object index, tile x, tile y) triples with tiles
 * relative to the range. Cut from each sprite's full frame, so the order does not depend on the
 * animation frame; cached per index, level and range, because the plan is rebuilt every tick.
 */
const orderCache = new WeakMap<ObjectIndex, Map<string, Int32Array>>()
const ORDER_CACHE_SIZE = 4

function pieceOrder(index: ObjectIndex, layout: ObjectAtlasLayout, level: number, range: TileRange): Int32Array {
  const key = `${level}:${range.x0},${range.y0},${range.x1},${range.y1}`
  let byRange = orderCache.get(index)
  const hit = byRange?.get(key)
  if (hit !== undefined) return hit
  const pieces: { index: number; o: RenderObject; tx: number; ty: number; order: PieceOrder }[] = []
  for (const i of index.query(level, range)) {
    const o = index.objects[i] as RenderObject
    const sprite = layout.sprites[o.def]
    if (sprite === undefined) continue
    // Tiles of the full frame, relative to the range corner (the anchor tile is the bottom-right one).
    const right = o.x - range.x0
    const bottom = o.y - range.y0
    for (let ty = bottom - Math.ceil(sprite.fullHeight / TILE_SIZE) + 1; ty <= bottom; ty++) {
      for (let tx = right - Math.ceil(sprite.fullWidth / TILE_SIZE) + 1; tx <= right; tx++) {
        const wx = range.x0 + tx
        pieces.push({ index: i, o, tx, ty, order: orderInTile(o, wx, range.y0 + ty) })
      }
    }
  }
  // Pieces of different tiles never overlap, so one sort by the per-tile order is the draw order.
  pieces.sort((a, b) => comparePieces(a.o, a.order, b.o, b.order) || a.index - b.index || a.ty - b.ty || a.tx - b.tx)
  const out = new Int32Array(pieces.length * 3)
  pieces.forEach((p, k) => out.set([p.index, p.tx, p.ty], k * 3))
  if (byRange === undefined) {
    byRange = new Map()
    orderCache.set(index, byRange)
  }
  if (byRange.size >= ORDER_CACHE_SIZE) byRange.delete(byRange.keys().next().value as string)
  byRange.set(key, out)
  return out
}

/**
 * `frames` overrides the frame of individual render objects (by index into the render-object list),
 * for the fidelity state search.
 */
export function buildObjectPlan(index: ObjectIndex, layout: ObjectAtlasLayout, level: number, range: TileRange, tick: number, opts: { drawList?: boolean; frames?: ReadonlyMap<number, number> } = {}): ObjectPlan {
  const order = pieceOrder(index, layout, level, range)
  const missing = new Set<string>()
  for (const i of index.query(level, range)) {
    const o = index.objects[i] as RenderObject
    const sprite = layout.sprites[o.def]
    const group = sprite?.groups[o.group] ?? sprite?.groups[0]
    if (sprite === undefined || group === undefined || group.length === 0) missing.add(o.def)
  }
  const vertices = new Float32Array(order.length / 3 * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE)
  const quadObjects = new Int32Array(order.length / 3)
  const entries: DrawListEntry[] | undefined = opts.drawList === true ? [] : undefined
  const listed = new Set<number>()
  let q = 0
  let p = 0
  let animated = false
  // The current frame of each object, chosen once per plan.
  let lastIndex = -1
  let frame = 0
  let cell: FrameCell | undefined
  let sprite: ObjectSprite | undefined
  let x0 = 0
  let y0 = 0
  let x1 = 0
  let y1 = 0
  for (let k = 0; k < order.length; k += 3) {
    const i = order[k] as number
    const o = index.objects[i] as RenderObject
    if (i !== lastIndex) {
      lastIndex = i
      sprite = layout.sprites[o.def]
      const group = sprite?.groups[o.group] ?? sprite?.groups[0]
      cell = undefined
      if (sprite === undefined || group === undefined || group.length === 0) continue
      if (group.length > 1) animated = true
      const override = opts.frames?.get(i)
      frame = override !== undefined ? frameOf(group.length, override) : frameOf(group.length, tick + o.phase)
      cell = group[frame] as FrameCell
      const fullLeft = (o.x - range.x0 + 1) * TILE_SIZE - sprite.fullWidth
      const fullTop = (o.y - range.y0 + 1) * TILE_SIZE - sprite.fullHeight
      x0 = fullLeft + (o.mirror ? sprite.fullWidth - cell.x - cell.width : cell.x)
      y0 = fullTop + cell.y
      x1 = x0 + cell.width
      y1 = y0 + cell.height
      if (entries !== undefined && !listed.has(i)) {
        listed.add(i)
        entries.push({
          id: o.id,
          kind: o.kind,
          className: className(o.classId),
          def: o.def,
          group: o.group,
          frame,
          frameCount: group.length,
          mirror: o.mirror,
          x: o.x,
          y: o.y,
          screenX: fullLeft,
          screenY: fullTop,
          width: sprite.fullWidth,
          height: sprite.fullHeight,
          owner: o.owner,
          flat: o.flat,
          visitable: o.visitable,
          random: o.random !== null,
          floating: o.floating,
          index: i,
          phase: o.phase,
        })
      }
    }
    if (cell === undefined || sprite === undefined) continue
    // The current frame clipped to this piece's tile; frames are cropped, so a tile may be empty.
    const tx = order[k + 1] as number
    const ty = order[k + 2] as number
    const px0 = Math.max(x0, tx * TILE_SIZE)
    const py0 = Math.max(y0, ty * TILE_SIZE)
    const px1 = Math.min(x1, (tx + 1) * TILE_SIZE)
    const py1 = Math.min(y1, (ty + 1) * TILE_SIZE)
    if (px0 >= px1 || py0 >= py1) continue
    const owner = o.owner ?? NEUTRAL_SLOT
    const tint = SHADOW_TINT_WEIGHT[o.shadowTint ?? 0]
    // Piece corners in cell pixels.
    const lx0 = px0 - x0
    const ly0 = py0 - y0
    const lx1 = px1 - x0
    const ly1 = py1 - y0
    for (let c = 0; c < 12; c += 2) {
      const cx = QUAD_CORNERS[c] as number
      const cy = QUAD_CORNERS[c + 1] as number
      vertices[p++] = cx === 0 ? px0 : px1
      vertices[p++] = cy === 0 ? py0 : py1
      vertices[p++] = cx === 0 ? lx0 : lx1
      vertices[p++] = cy === 0 ? ly0 : ly1
      vertices[p++] = cell.u
      vertices[p++] = cell.v
      vertices[p++] = o.mirror ? -cell.width : cell.width
      vertices[p++] = cell.height
      vertices[p++] = sprite.row
      vertices[p++] = cell.page
      vertices[p++] = owner
      vertices[p++] = tint
      vertices[p++] = lx0
      vertices[p++] = ly0
      vertices[p++] = lx1
      vertices[p++] = ly1
    }
    quadObjects[q++] = i
  }
  return { range, level, tick, vertices: vertices.subarray(0, p), quadCount: q, animatedInView: animated, quadObjects: quadObjects.subarray(0, q), missing: [...missing].sort(), entries }
}
