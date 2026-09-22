// Object draw plan (specs/003-map-objects/data-model.md "Object draw plan"): quads of the objects
// whose sprites reach into a tile range, in draw order, for one animation tick. Pure and DOM-free;
// its cost depends on the objects near the range (spatial index), not on the map.

import { NEUTRAL_SLOT } from '../data/players.ts'
import { TILE_SIZE } from '../data/terrain.ts'
import { className } from '../data/object-classes.ts'
import type { ObjectIndex } from '../state/object-index.ts'
import type { RenderObject } from '../state/render-objects.ts'
import { frameOf } from './animation.ts'
import type { TileRange } from './camera.ts'
import type { ObjectAtlasLayout } from './object-atlas.ts'
import { QUAD_CORNERS } from './draw-plan.ts'
import { compareObjects } from './object-order.ts'

/** Floats per vertex: the terrain layout (draw-plan.ts VERTEX_SIZE), then page and owner slot (0–7, 8 = neutral). */
export const OBJECT_VERTEX_SIZE = 11
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
  /** Render-object index per quad (draw order), for per-pixel ownership in checks. */
  quadObjects: Int32Array
  /** Sprites not found in the atlas (reported, not drawn). */
  missing: string[]
  entries: DrawListEntry[] | undefined
}

/** Objects of `level` that can reach into `range`, in draw order. */
export function orderedObjects(index: ObjectIndex, level: number, range: TileRange, compare: (a: RenderObject, b: RenderObject) => number = compareObjects): number[] {
  return index.query(level, range).sort((a, b) => compare(index.objects[a] as RenderObject, index.objects[b] as RenderObject))
}

/**
 * `frames` overrides the frame of individual render objects (by index into the render-object list),
 * for the fidelity state search.
 */
export function buildObjectPlan(index: ObjectIndex, layout: ObjectAtlasLayout, level: number, range: TileRange, tick: number, opts: { drawList?: boolean; frames?: ReadonlyMap<number, number>; compare?: (a: RenderObject, b: RenderObject) => number } = {}): ObjectPlan {
  const ids = orderedObjects(index, level, range, opts.compare)
  const vertices = new Float32Array(ids.length * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE)
  const quadObjects = new Int32Array(ids.length)
  const entries: DrawListEntry[] | undefined = opts.drawList === true ? [] : undefined
  const missing = new Set<string>()
  const originX = range.x0 * TILE_SIZE
  const originY = range.y0 * TILE_SIZE
  let q = 0
  let animated = false
  for (const i of ids) {
    const o = index.objects[i] as RenderObject
    const sprite = layout.sprites[o.def]
    const group = sprite?.groups[o.group] ?? sprite?.groups[0]
    if (sprite === undefined || group === undefined || group.length === 0) {
      missing.add(o.def)
      continue
    }
    if (group.length > 1) animated = true
    const override = opts.frames?.get(i)
    const frame = override !== undefined ? frameOf(group.length, override) : frameOf(group.length, tick + o.phase)
    const cell = group[frame] as NonNullable<typeof group[number]>
    const fullLeft = (o.x + 1) * TILE_SIZE - sprite.fullWidth - originX
    const fullTop = (o.y + 1) * TILE_SIZE - sprite.fullHeight - originY
    const cellX = o.mirror ? sprite.fullWidth - cell.x - cell.width : cell.x
    const x0 = fullLeft + cellX
    const y0 = fullTop + cell.y
    const x1 = x0 + cell.width
    const y1 = y0 + cell.height
    const owner = o.owner ?? NEUTRAL_SLOT
    let p = q * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE
    for (let k = 0; k < 12; k += 2) {
      const lx = QUAD_CORNERS[k] as number
      const ly = QUAD_CORNERS[k + 1] as number
      vertices[p++] = lx === 0 ? x0 : x1
      vertices[p++] = ly === 0 ? y0 : y1
      vertices[p++] = lx * cell.width
      vertices[p++] = ly * cell.height
      vertices[p++] = cell.u
      vertices[p++] = cell.v
      vertices[p++] = o.mirror ? -cell.width : cell.width
      vertices[p++] = cell.height
      vertices[p++] = sprite.row
      vertices[p++] = cell.page
      vertices[p++] = owner
    }
    quadObjects[q] = i
    q++
    entries?.push({
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
  return { range, level, tick, vertices, quadCount: q, animatedInView: animated, quadObjects: quadObjects.subarray(0, q), missing: [...missing].sort(), entries }
}
