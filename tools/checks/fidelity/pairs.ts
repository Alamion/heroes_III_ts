// Draw-order diagnosis for a still (`yarn verify fidelity --pairs`): for every two objects whose
// bodies overlap, which one does the capture show on top? Each object is rendered alone over the
// terrain; at a pixel covered by both, the capture colour reproduced by exactly one of them decides
// the pair. The votes, with what we draw, point at draw-order mistakes and are the data a draw-order
// rule is fitted to (spec 005 research "Draw order: who stands below whom").

import { TILE_SIZE } from '../../../src/core/data/terrain.ts'
import type { Camera } from '../../../src/core/render/camera.ts'
import type { DrawPlan } from '../../../src/core/render/draw-plan.ts'
import { OBJECT_VERTEX_SIZE, OBJECT_VERTICES_PER_QUAD } from '../../../src/core/render/object-plan.ts'
import type { ObjectPlan } from '../../../src/core/render/object-plan.ts'
import { rasterizeScene, shadowLayers } from '../../../src/core/render/software.ts'
import type { Atlas } from '../../../src/core/render/atlas.ts'
import type { RenderObject } from '../../../src/core/state/render-objects.ts'
import { PIXEL, samePixel } from './compare.ts'
import type { CaptureSampler } from './compare.ts'
import type { ObjectContext } from './masks.ts'

export interface PairObject {
  index: number
  def: string
  x: number
  y: number
  order: number
  visitable: boolean
  flat: boolean
  kind: RenderObject['kind']
  /** Template passability mask (clear bit = blocked), absent for heroes. */
  passable?: number[]
}

export interface OrderPair {
  a: PairObject
  b: PairObject
  /** Pixels where the capture shows a on top of b, and b on top of a. */
  aOver: number
  bOver: number
  /** Per tile of the deciding pixels ("x,y"): pixels showing a on top, and b on top. */
  tiles: Record<string, [number, number]>
}

export function orderPairs(opts: {
  plan: DrawPlan
  atlas: Atlas
  palettes: Uint8Array
  cam: Camera
  objects: ObjectContext
  objectPlan: ObjectPlan
  cls: Uint8Array
  cap: CaptureSampler
}): OrderPair[] {
  const { plan, atlas, palettes, cam, objects, objectPlan, cls, cap } = opts
  const width = cam.width
  const n = cam.width * cam.height
  const scene = (p: ObjectPlan | undefined, owners?: Int32Array, layers?: ReturnType<typeof shadowLayers>): Uint8Array => rasterizeScene(plan, atlas, palettes, cam, p === undefined ? undefined : { plan: p, atlas: objects.atlas, flagColors: objects.flagColors }, owners, layers)
  const terrain = scene(undefined)
  // Per compared pixel: objects whose body covers it, and those whose colour the capture shows. Shadows
  // do not take part: the game draws every shadow before every body.
  const covering = new Map<number, number[]>()
  const matching = new Map<number, number[]>()
  const quad = OBJECT_VERTEX_SIZE * OBJECT_VERTICES_PER_QUAD
  // An object is drawn with one quad per map tile it covers.
  const quadsOf = new Map<number, number[]>()
  for (let q = 0; q < objectPlan.quadCount; q++) {
    const obj = objectPlan.quadObjects[q] as number
    const list = quadsOf.get(obj)
    if (list === undefined) quadsOf.set(obj, [q])
    else list.push(q)
  }
  for (const [obj, qs] of quadsOf) {
    const vertices = new Float32Array(qs.length * quad)
    qs.forEach((q, k) => vertices.set(objectPlan.vertices.subarray(q * quad, (q + 1) * quad), k * quad))
    const alone: ObjectPlan = { ...objectPlan, vertices, quadCount: qs.length, quadObjects: new Int32Array(qs.length).fill(obj) }
    const own = new Int32Array(n)
    const layers = shadowLayers(n)
    const img = scene(alone, own, layers)
    for (let i = 0; i < n; i++) {
      if (own[i] !== obj || cls[i] !== PIXEL.compared) continue
      if (layers.dark[i] !== 0 || layers.medium[i] !== 0 || layers.light[i] !== 0 || layers.faint[i] !== 0) continue
      const r = i * 4
      if (img[r] === terrain[r] && img[r + 1] === terrain[r + 1] && img[r + 2] === terrain[r + 2]) continue
      const c = covering.get(i)
      if (c === undefined) covering.set(i, [obj])
      else c.push(obj)
      if (samePixel(cap, img, width, i)) {
        const m = matching.get(i)
        if (m === undefined) matching.set(i, [obj])
        else m.push(obj)
      }
    }
  }
  const pairs = new Map<string, { a: number; b: number; aOver: number; bOver: number; tiles: Map<string, [number, number]> }>()
  for (const [i, cover] of covering) {
    if (cover.length < 2) continue
    const match = matching.get(i)
    if (match === undefined || match.length !== 1) continue
    const winner = match[0] as number
    const px = i % width
    const tile = `${Math.floor((px + cam.offsetX) / TILE_SIZE)},${Math.floor(((i - px) / width + cam.offsetY) / TILE_SIZE)}`
    for (const other of cover) {
      if (other === winner) continue
      const a = Math.min(winner, other)
      const b = Math.max(winner, other)
      const key = `${a}|${b}`
      const e = pairs.get(key) ?? { a, b, aOver: 0, bOver: 0, tiles: new Map<string, [number, number]>() }
      const votes = e.tiles.get(tile) ?? [0, 0]
      if (winner === a) {
        e.aOver++
        votes[0]++
      } else {
        e.bOver++
        votes[1]++
      }
      e.tiles.set(tile, votes)
      pairs.set(key, e)
    }
  }
  const describe = (index: number): PairObject => {
    const o = objects.objects[index] as RenderObject
    return { index, def: o.def, x: o.x, y: o.y, order: o.order, visitable: o.visitable, flat: o.flat, kind: o.kind, ...(o.passable !== undefined ? { passable: [...o.passable] } : {}) }
  }
  return [...pairs.values()]
    .sort((p, q) => q.aOver + q.bOver - (p.aOver + p.bOver))
    .map((e) => {
      const a = describe(e.a)
      const b = describe(e.b)
      return { a, b, aOver: e.aOver, bOver: e.bOver, tiles: Object.fromEntries([...e.tiles].sort((x, y) => x[0].localeCompare(y[0]))) }
    })
}
