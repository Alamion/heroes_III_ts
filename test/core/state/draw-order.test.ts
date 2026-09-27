import { describe, expect, it } from 'vitest'
import { compareObjects, drawRanks } from '../../../src/core/state/draw-order.ts'
import type { RenderObject } from '../../../src/core/state/render-objects.ts'
import { createRng } from '../../../src/core/util/rng.ts'

const obj = (o: Partial<RenderObject>): RenderObject => ({ id: 0, kind: 'object', classId: 118, x: 0, y: 0, z: 0, def: 'a.def', group: 0, mirror: false, owner: null, flat: false, visitable: false, order: 0, random: null, floating: false, phase: 0, drawRank: 0, ...o })

const BASE = { hota: false }

describe('object draw order', () => {
  it('applies the base keys in order: flat, y, heroes, visitable, map order', () => {
    expect(compareObjects(obj({ flat: true, y: 9 }), obj({ y: 1 }))).toBeLessThan(0)
    // A visitable object is drawn after the non-visitable ones of its row only (Gold Rush: a forest
    // in the row below covers a black market; spec 005 research "Draw order").
    expect(compareObjects(obj({ visitable: true, y: 1 }), obj({ y: 9 }))).toBeLessThan(0)
    expect(compareObjects(obj({ visitable: true, y: 5, order: 1 }), obj({ y: 5, order: 2 }))).toBeGreaterThan(0)
    expect(compareObjects(obj({ y: 2 }), obj({ y: 3, x: 0 }))).toBeLessThan(0)
    expect(compareObjects(obj({ kind: 'heroBody', y: 5, x: 0, order: 1, visitable: true }), obj({ y: 5, x: 9, visitable: true, order: 9 }))).toBeGreaterThan(0)
    expect(compareObjects(obj({ y: 5, x: 9, order: 1 }), obj({ y: 5, x: 2, order: 2 }))).toBeLessThan(0)
    expect(compareObjects(obj({ order: 1 }), obj({ order: 2 }))).toBeLessThan(0)
    expect(compareObjects(obj({ kind: 'heroBody', order: 4 }), obj({ kind: 'heroFlag', order: 4 }))).toBeGreaterThan(0)
  })

  it('draws a hero over the town it stands in', () => {
    const town = obj({ classId: 98, x: 11, y: 12, visitable: true, order: 1 })
    const hero = obj({ kind: 'heroBody', classId: 34, x: 11, y: 12, visitable: true, order: 0 })
    expect(compareObjects(town, hero)).toBeLessThan(0)
  })

  it('is a total order on random samples', () => {
    const rng = createRng(3)
    const kinds = ['object', 'heroBody', 'heroFlag'] as const
    const list = Array.from({ length: 60 }, (_, i) => obj({ kind: kinds[rng.int(3)], x: rng.int(4), y: rng.int(4), flat: rng.int(2) === 0, visitable: rng.int(2) === 0, order: rng.int(30), id: i }))
    for (const a of list) {
      expect(compareObjects(a, a)).toBe(0)
      for (const b of list) {
        expect(Math.sign(compareObjects(a, b)) + Math.sign(compareObjects(b, a))).toBe(0)
        for (const c of list.slice(0, 15)) if (compareObjects(a, b) < 0 && compareObjects(b, c) < 0) expect(compareObjects(a, c)).toBeLessThan(0)
      }
    }
  })

  // Passability mask with the given blocked tiles, as (dx, dy) from the anchor (dx, dy ≤ 0).
  const blocking = (...tiles: [number, number][]): Uint8Array => {
    const mask = new Uint8Array(6).fill(0xff)
    for (const [dx, dy] of tiles) mask[5 + dy] = (mask[5 + dy] as number) & ~(1 << (7 + dx))
    return mask
  }

  it('draws an object in front of the one it stands below, whatever the rows and file order', () => {
    // q (row 10) blocks (10,10), directly below p's blocked tile (10,9); p is anchored a row lower
    // (11) and earlier in the file, so the base order draws q first. The game shows q in front
    // (spec 005 research "Draw order: who stands below whom").
    const p = obj({ x: 12, y: 11, order: 1, passable: blocking([-2, -2]) })
    const q = obj({ x: 10, y: 10, order: 2, passable: blocking([0, 0]) })
    expect(Array.from(drawRanks([{ ...p, passable: undefined }, { ...q, passable: undefined }], BASE))).toEqual([1, 0])
    expect(Array.from(drawRanks([p, q], BASE))).toEqual([0, 1])
    // Tiles blocked by both, or side by side, say nothing: the base order stays.
    const beside = obj({ x: 11, y: 10, order: 3, passable: blocking([0, 0]) })
    expect(Array.from(drawRanks([q, beside], BASE))).toEqual([0, 1])
  })

  it('on HotA maps, lets file order decide within a row, visitable or not', () => {
    // The owner's probe pairs: a crypt and a tree in one row, the one later in the file in front.
    const crypt = obj({ x: 3, y: 120, order: 1, visitable: true })
    const tree = obj({ x: 1, y: 120, order: 2 })
    expect(Array.from(drawRanks([crypt, tree], BASE))).toEqual([1, 0])
    expect(Array.from(drawRanks([crypt, tree], { hota: true }))).toEqual([0, 1])
  })

  it('on HotA maps, applies the rule only between objects of different rows', () => {
    // Same row: s stands below t (its tile (10,10) under t's (10,9)) but is earlier in the file.
    const s = obj({ x: 10, y: 10, order: 1, passable: blocking([0, 0]) })
    const t = obj({ x: 11, y: 10, order: 2, passable: blocking([-1, -1]) })
    expect(Array.from(drawRanks([s, t], BASE))).toEqual([1, 0])
    expect(Array.from(drawRanks([s, t], { hota: true }))).toEqual([0, 1])
  })

  it('makes a total order, independent of input order, when the pairwise rule has a cycle', () => {
    // All anchored at (2,1). p stands below q ((0,1) under (0,0)), q below r ((1,0) under (1,-1)),
    // r below p ((2,1) under (2,0)): no order satisfies all three; the lowest base rank goes first.
    const p = obj({ id: 1, x: 2, y: 1, order: 1, passable: blocking([-2, 0], [0, -1]) })
    const q = obj({ id: 2, x: 2, y: 1, order: 2, passable: blocking([-2, -1], [-1, -1]) })
    const r = obj({ id: 3, x: 2, y: 1, order: 3, passable: blocking([-1, -2], [0, 0]) })
    const ranks = Array.from(drawRanks([p, q, r], BASE))
    expect(new Set(ranks).size).toBe(3)
    const reversed = drawRanks([r, q, p], BASE)
    expect([reversed[2], reversed[1], reversed[0]]).toEqual(ranks)
    // p (lowest base rank) breaks the cycle; r stands below p, so it follows; q stands below r and
    // comes last.
    expect(ranks).toEqual([0, 2, 1])
  })
})
