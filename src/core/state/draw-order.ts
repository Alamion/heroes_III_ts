// Draw order of the original game (Heroes3.exe SoD 3.2, specs/003-map-objects/research.md "Draw order
// in the executable"): every map tile keeps a list of (object, sprite tile, layer) entries, built
// when the objects are placed in map order; a tile draws its entries by layer, then in list order.

import { OBJECT_CLASS } from '../data/object-classes.ts'
import type { RenderObject } from './render-objects.ts'

/** What the tile lists read of a render object. */
export type TileListInput = Pick<RenderObject, 'kind' | 'classId' | 'flat' | 'x' | 'y' | 'order' | 'passable' | 'groundCover'>

/** Template boxes are at most 8 × 6 tiles (the masks' size). */
export const BOX_WIDTH = 8
export const BOX_HEIGHT = 6

/** A placed object: its footprint box in tiles (bottom-right anchored) and the layer of each box tile. */
export interface Placed {
  readonly o: TileListInput
  readonly width: number
  readonly height: number
  /** Layer per box tile, index dx * BOX_HEIGHT + dy (dx columns left of the anchor, dy rows above it). */
  readonly layers: Uint8Array
}

/** Heroes and boats are not in the tile lists; the game draws them between the layers. */
export function inTileLists(o: TileListInput): boolean {
  return o.kind === 'object' && o.classId !== OBJECT_CLASS.BOAT
}

function passableAt(mask: Uint8Array | undefined, dx: number, dy: number): boolean {
  if (mask === undefined) return true
  return (((mask[BOX_HEIGHT - 1 - dy] as number) >> (BOX_WIDTH - 1 - dx)) & 1) !== 0
}

/**
 * Layers of an object's box tiles. A flat object is layer 0 everywhere. Otherwise each column counts
 * up from 1 at the anchor row; a blocked tile standing on a passable one starts the count again at 1,
 * and a passable tile beside a blocked tile on its right takes that tile's layer.
 */
export function layerTable(o: TileListInput, width: number, height: number): Uint8Array {
  const layers = new Uint8Array(BOX_WIDTH * BOX_HEIGHT)
  if (o.flat) return layers
  const mask = o.passable
  for (let dx = 0; dx < width; dx++) {
    let c = 1
    for (let dy = 0; dy < height; dy++) {
      const passable = passableAt(mask, dx, dy)
      if (dy > 0 && !passable && passableAt(mask, dx, dy - 1)) c = 1
      if (dx > 0 && passable && !passableAt(mask, dx - 1, dy)) c = layers[(dx - 1) * BOX_HEIGHT + dy] as number
      layers[dx * BOX_HEIGHT + dy] = c
      c++
    }
  }
  return layers
}

export function place(o: TileListInput, width: number, height: number): Placed {
  const w = Math.min(width, BOX_WIDTH)
  const h = Math.min(height, BOX_HEIGHT)
  return { o, width: w, height: h, layers: layerTable(o, w, h) }
}

/** Layer of a placed object at map tile (wx, wy), or −1 outside its box. */
export function layerAt(p: Placed, wx: number, wy: number): number {
  const dx = p.o.x - wx
  const dy = p.o.y - wy
  if (dx < 0 || dy < 0 || dx >= p.width || dy >= p.height) return -1
  return p.layers[dx * BOX_HEIGHT + dy] as number
}

/** Whether `b` goes behind `a` in a shared layer: somewhere in their common box `b` is in a lower layer. */
function behindSomewhere(b: Placed, a: Placed): boolean {
  const left = Math.max(0, b.o.x - b.width + 1, a.o.x - a.width + 1)
  const top = Math.max(0, b.o.y - b.height + 1, a.o.y - a.height + 1)
  const right = Math.min(b.o.x, a.o.x)
  const bottom = Math.min(b.o.y, a.o.y)
  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      if (layerAt(b, x, y) < layerAt(a, x, y)) return true
    }
  }
  return false
}

/**
 * The list of map tile (wx, wy): the placed objects whose box covers it, inserted in map order. An
 * entry goes behind every entry of a higher layer; in its own layer it goes behind an entry when
 * somewhere in their common box it is in a lower layer, else in front. On HotA maps ground covers
 * go behind the other entries of their layer.
 */
export function tileList(covering: readonly Placed[], wx: number, wy: number): Placed[] {
  const list: Placed[] = []
  const sorted = [...covering].sort((a, b) => a.o.order - b.o.order)
  for (const p of sorted) {
    const layer = layerAt(p, wx, wy)
    let i = list.length
    while (i > 0) {
      const prev = list[i - 1] as Placed
      const prevLayer = layerAt(prev, wx, wy)
      if (layer > prevLayer) break
      if (layer === prevLayer) {
        // HotA (003 research "Draw order in HotA"): a ground cover goes behind any other entry of
        // its layer, and any other entry in front of a ground cover.
        const cover = p.o.groundCover === true
        const prevCover = prev.o.groundCover === true
        if (!cover && prevCover) break
        if (cover === prevCover && !behindSomewhere(p, prev)) break
      }
      i--
    }
    list.splice(i, 0, p)
  }
  return list
}

/**
 * Draw rank of hero and boat pieces in a tile: the game draws a hero's bottom row after the layer-1
 * entries and its top row after the layer-2 entries, the flag before the body.
 */
export function heroLayer(o: TileListInput, wy: number): number {
  return o.y - wy + 1
}
