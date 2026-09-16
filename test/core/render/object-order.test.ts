import { describe, expect, it } from 'vitest'
import { compareObjects } from '../../../src/core/render/object-order.ts'
import type { RenderObject } from '../../../src/core/state/render-objects.ts'
import { createRng } from '../../../src/core/util/rng.ts'

const obj = (o: Partial<RenderObject>): RenderObject => ({ id: 0, kind: 'object', classId: 118, x: 0, y: 0, z: 0, def: 'a.def', group: 0, mirror: false, owner: null, flat: false, visitable: false, order: 0, random: null, floating: false, phase: 0, ...o })

describe('object draw order', () => {
  it('applies the keys in order: flat, visitable, y, heroes, map order', () => {
    expect(compareObjects(obj({ flat: true, y: 9 }), obj({ y: 1 }))).toBeLessThan(0)
    expect(compareObjects(obj({ visitable: true, y: 1 }), obj({ y: 9 }))).toBeGreaterThan(0)
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
})
