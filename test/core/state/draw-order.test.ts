import { describe, expect, it } from 'vitest'
import { columnDepth, comparePieces, orderInTile } from '../../../src/core/state/draw-order.ts'
import type { PieceOrder } from '../../../src/core/state/draw-order.ts'
import type { RenderObject } from '../../../src/core/state/render-objects.ts'
import { createRng } from '../../../src/core/util/rng.ts'

const obj = (o: Partial<RenderObject>): RenderObject => ({ id: 0, kind: 'object', classId: 118, x: 0, y: 0, z: 0, def: 'a.def', group: 0, mirror: false, owner: null, flat: false, visitable: false, order: 0, random: null, floating: false, phase: 0, ...o })
const at = (o: RenderObject, wx: number, wy: number): PieceOrder => orderInTile(o, wx, wy)

describe('object draw order (per map tile)', () => {
  // Passability mask with the given blocked tiles, as (dx, dy) from the anchor (dx, dy ≤ 0).
  const blocking = (...tiles: [number, number][]): Uint8Array => {
    const mask = new Uint8Array(6).fill(0xff)
    for (const [dx, dy] of tiles) mask[5 + dy] = (mask[5 + dy] as number) & ~(1 << (7 + dx))
    return mask
  }

  it('draws a hero over the town gate it stands in', () => {
    // The town blocks its gate row except the entrance; the hero, anchored one tile right of the
    // entrance on the same row, blocks nothing and is drawn after objects of its row.
    const town = obj({ classId: 98, x: 11, y: 12, visitable: true, order: 1, passable: blocking([-4, 0], [-3, 0], [-1, 0], [0, 0]) })
    const hero = obj({ kind: 'heroBody', classId: 34, x: 10, y: 12, visitable: true, order: 0 })
    for (const wx of [8, 9, 10]) expect(comparePieces(town, at(town, wx, 12), hero, at(hero, wx, 12))).toBeLessThan(0)
    const flag = obj({ ...hero, kind: 'heroFlag' })
    expect(comparePieces(flag, at(flag, 9, 12), hero, at(hero, 9, 12))).toBeLessThan(0)
  })

  it('is a total order within a tile on random samples', () => {
    const rng = createRng(3)
    const kinds = ['object', 'heroBody', 'heroFlag'] as const
    const list = Array.from({ length: 60 }, (_, i) => {
      const o = obj({ kind: kinds[rng.int(3)], x: 4 + rng.int(3), y: 4 + rng.int(3), flat: rng.int(4) === 0, order: rng.int(30), id: i, passable: blocking([-rng.int(3), -rng.int(2)], [-rng.int(3), 0]) })
      return { o, p: at(o, 4, 4) }
    })
    const cmp = (a: (typeof list)[number], b: (typeof list)[number]): number => comparePieces(a.o, a.p, b.o, b.p)
    for (const a of list) {
      expect(cmp(a, a)).toBe(0)
      for (const b of list) {
        expect(Math.sign(cmp(a, b)) + Math.sign(cmp(b, a))).toBe(0)
        for (const c of list.slice(0, 15)) if (cmp(a, b) < 0 && cmp(b, c) < 0) expect(cmp(a, c)).toBeLessThan(0)
      }
    }
  })

  it('gives each map column its own depth: the lowest blocked tile there', () => {
    // Blocked: (8,9) and (8,10) in column 8, (9,10) in column 9; column 7 is overhang only (counts as the object's row).
    const o = obj({ x: 10, y: 10, passable: blocking([-2, -1], [-2, 0], [-1, 0]) })
    expect(columnDepth(o, 8)).toBe(10)
    expect(columnDepth(o, 9)).toBe(10)
    expect(columnDepth(o, 10)).toBe(10)
    expect(columnDepth(o, 7)).toBe(10)
    expect(columnDepth(obj({ kind: 'heroBody', x: 4, y: 6 }), 3)).toBe(6)
  })

  it('orders two objects of one row differently in two tiles', () => {
    // Same row. a blocks (8,9), (8,10) and (9,10); b blocks (9,10) and (10,10), its sprite overhangs (8,9).
    const a = obj({ x: 9, y: 10, order: 2, passable: blocking([-1, -1], [-1, 0], [0, 0]) })
    const b = obj({ x: 10, y: 10, order: 1, passable: blocking([-1, 0], [0, 0]) })
    // Tile (8,9), above their row: b only overhangs it, so b is in front of a, which blocks it.
    expect(comparePieces(a, at(a, 8, 9), b, at(b, 8, 9))).toBeLessThan(0)
    // Tile (9,10): both block it at the same depth: file order, a (later) in front.
    expect(comparePieces(a, at(a, 9, 10), b, at(b, 9, 10))).toBeGreaterThan(0)
    // Where both only overhang a tile, a visitable object is in front of one that is not.
    const tree = obj({ x: 9, y: 10, order: 5, visitable: false, passable: blocking([0, 0]) })
    const mill = obj({ x: 10, y: 10, order: 4, visitable: true, passable: blocking([0, 0]) })
    expect(comparePieces(tree, at(tree, 8, 8), mill, at(mill, 8, 8))).toBeLessThan(0)
    // A lower row is drawn later whatever the tile; flat objects first.
    const low = obj({ x: 9, y: 11, order: 0, passable: blocking([0, 0]) })
    expect(comparePieces(a, at(a, 9, 9), low, at(low, 9, 9))).toBeLessThan(0)
    expect(comparePieces(obj({ flat: true, y: 99 }), { depth: 99, blocked: true }, b, at(b, 8, 10))).toBeLessThan(0)
  })
})
