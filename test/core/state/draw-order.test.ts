import { describe, expect, it } from 'vitest'
import { heroLayer, layerAt, layerTable, place, tileList } from '../../../src/core/state/draw-order.ts'
import type { RenderObject } from '../../../src/core/state/render-objects.ts'

const obj = (o: Partial<RenderObject>): RenderObject => ({ id: 0, kind: 'object', classId: 118, x: 0, y: 0, z: 0, def: 'a.def', group: 0, mirror: false, owner: null, flat: false, visitable: false, order: 0, random: null, floating: false, phase: 0, ...o })

// Passability mask with the given blocked tiles, as (dx, dy) from the anchor (dx, dy ≤ 0).
const blocking = (...tiles: [number, number][]): Uint8Array => {
  const mask = new Uint8Array(6).fill(0xff)
  for (const [dx, dy] of tiles) mask[5 + dy] = (mask[5 + dy] as number) & ~(1 << (7 + dx))
  return mask
}

// Layers of a box as rows from the top, columns from the left (as on screen).
const rows = (o: RenderObject, w: number, h: number): number[][] => {
  const t = layerTable(o, w, h)
  return Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => t[(w - 1 - c) * 6 + (h - 1 - r)] as number))
}

describe('layers of a template box (research.md "Draw order in the executable")', () => {
  it('counts rows up from the anchor row', () => {
    const o = obj({ passable: blocking([0, 0], [-1, 0], [0, -1], [-1, -1]) })
    expect(rows(o, 2, 3)).toEqual([[3, 3], [2, 2], [1, 1]])
  })

  it('restarts at a blocked tile standing on a passable one', () => {
    // A tree whose bottom row only overhangs: the blocked tile above it is layer 1 again.
    const o = obj({ passable: blocking([0, -1]) })
    expect(rows(o, 1, 3)).toEqual([[2], [1], [1]])
  })

  it('gives a passable tile the layer of the blocked tile on its right', () => {
    // Without the rule the top-left tile would count on to 3.
    const o = obj({ passable: blocking([0, -2]) })
    expect(rows(o, 2, 3)).toEqual([[1, 1], [2, 2], [1, 1]])
  })

  it('puts flat objects in layer 0', () => {
    expect(rows(obj({ flat: true, passable: blocking([0, 0]) }), 2, 2)).toEqual([[0, 0], [0, 0]])
  })
})

describe('tile lists', () => {
  it('draws lower layers first, whatever the map order', () => {
    // An object standing on this tile's row, and a tall one whose base is two rows further south.
    const here = place(obj({ x: 5, y: 5, order: 1, passable: blocking([0, 0]) }), 1, 1)
    const south = place(obj({ x: 5, y: 7, order: 0, passable: blocking([0, 0], [0, -1], [0, -2]) }), 1, 3)
    expect(layerAt(south, 5, 5)).toBe(3)
    expect(tileList([south, here], 5, 5).map((p) => p.o.order)).toEqual([1, 0])
  })

  it('keeps map order in a shared layer', () => {
    const a = place(obj({ x: 5, y: 5, order: 0, passable: blocking([0, 0]) }), 1, 1)
    const b = place(obj({ x: 6, y: 5, order: 1, passable: blocking([0, 0], [-1, 0]) }), 2, 1)
    expect(tileList([b, a], 5, 5).map((p) => p.o.order)).toEqual([0, 1])
  })

  it('puts a later object behind when it is behind somewhere in the common box', () => {
    // Both are layer 1 on (5, 5); one row up, the later object is layer 1 and the earlier layer 2.
    const early = place(obj({ x: 5, y: 5, order: 0, passable: blocking([0, 0], [0, -1]) }), 1, 2)
    const late = place(obj({ x: 5, y: 5, order: 1, passable: blocking([0, -1]) }), 1, 2)
    expect(layerAt(early, 5, 4)).toBe(2)
    expect(layerAt(late, 5, 4)).toBe(1)
    expect(tileList([early, late], 5, 5).map((p) => p.o.order)).toEqual([1, 0])
  })

  it('draws a hero after the objects of its row', () => {
    expect(heroLayer(obj({ kind: 'heroBody', x: 10, y: 12 }), 12)).toBe(1)
    expect(heroLayer(obj({ kind: 'heroBody', x: 10, y: 12 }), 11)).toBe(2)
  })
})
