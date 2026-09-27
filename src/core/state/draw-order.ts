// Draw order of render objects (specs/003-map-objects/research.md §4, measured T047; revised
// 2026-09-28, spec 005 research "Draw order: who stands below whom"). A property of the world's
// objects, computed once per map in `buildRenderObjects`; the renderer sorts by `drawRank`.

import type { RenderObject } from './render-objects.ts'

/** What the draw order reads of a render object. */
export type DrawOrderInput = Pick<RenderObject, 'kind' | 'flat' | 'x' | 'y' | 'z' | 'visitable' | 'order' | 'passable'>

// The body's flagpole covers the last flag column in the game (research.md "Hero flags").
const KIND_RANK: Readonly<Record<RenderObject['kind'], number>> = { object: 0, heroFlag: 1, heroBody: 2 }

/**
 * The base order, a total one: flat objects first, then anchor row, heroes after other objects of
 * the row, visitable after non-visitable objects of the row (base game only), then map file order.
 * HotA maps skip the visitable key: within a row the object later in the file is in front, whatever
 * its kind — the HotA editor moves the object last placed or moved to the end of the list (owner's
 * probe objects on test_map_hota.h3m, 2026-09-28). `drawRanks` refines the order where blocked tiles
 * say which of two objects stands in front.
 */
export function compareObjects(a: DrawOrderInput, b: DrawOrderInput, hota = false): number {
  if (a.flat !== b.flat) return a.flat ? -1 : 1
  if (a.y !== b.y) return a.y - b.y
  const heroA = a.kind === 'object' ? 0 : 1
  const heroB = b.kind === 'object' ? 0 : 1
  if (heroA !== heroB) return heroA - heroB
  if (!hota && a.visitable !== b.visitable) return a.visitable ? 1 : -1
  if (a.order !== b.order) return a.order - b.order
  return KIND_RANK[a.kind] - KIND_RANK[b.kind]
}

/** Blocked tiles of an object as absolute coordinates (x, y pairs). */
function blockedTiles(o: DrawOrderInput): number[] {
  const out: number[] = []
  const mask = o.passable
  if (mask === undefined || o.flat) return out
  for (let row = 0; row < 6; row++) {
    const bits = mask[row] as number
    for (let bit = 0; bit < 8; bit++) if ((bits & (1 << bit)) === 0) out.push(o.x + bit - 7, o.y + row - 5)
  }
  return out
}

/** A tile key; blocked tiles may lie up to 7 tiles left of and 5 above the map (anchors near its edge). */
function tileKey(z: number, x: number, y: number): number {
  return (z * 2048 + y + 16) * 2048 + x + 16
}

/** Binary min-heap of object indices by base rank. */
class RankHeap {
  private readonly items: number[] = []
  private readonly base: Int32Array
  constructor(base: Int32Array) {
    this.base = base
  }
  get size(): number {
    return this.items.length
  }
  push(i: number): void {
    const a = this.items
    a.push(i)
    let c = a.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if ((this.base[a[p] as number] as number) <= (this.base[i] as number)) break
      a[c] = a[p] as number
      c = p
    }
    a[c] = i
  }
  pop(): number {
    const a = this.items
    const top = a[0] as number
    const last = a.pop() as number
    if (a.length > 0) {
      let c = 0
      for (;;) {
        const l = 2 * c + 1
        if (l >= a.length) break
        const r = l + 1
        const m = r < a.length && (this.base[a[r] as number] as number) < (this.base[a[l] as number] as number) ? r : l
        if ((this.base[a[m] as number] as number) >= (this.base[last] as number)) break
        a[c] = a[m] as number
        c = m
      }
      a[c] = last
    }
    return top
  }
}

/**
 * Draw rank of every object (lower draws first), over the whole map so that the order of two objects
 * never depends on the view.
 *
 * Measured against the game (spec 005 research "Draw order: who stands below whom"; the rule was
 * first described by VCMI from H3 maps, re-implemented here from that description): of two
 * objects, the one whose blocked tiles lie directly below more blocked tiles of the other stands in
 * front of it, whatever their anchor rows and map order. Pairs without such a difference keep the
 * base order (`compareObjects`). On HotA maps the rule holds only between objects of different
 * rows; within one row HotA keeps file order. The pairwise rule is not
 * transitive, so it is applied as constraints on the base order: a topological sort that always
 * takes the available object of lowest base rank, and in a cycle the remaining object of lowest
 * base rank.
 */
export function drawRanks(objects: readonly DrawOrderInput[], opts: { hota: boolean }): Int32Array {
  const n = objects.length
  const sorted = Array.from({ length: n }, (_, i) => i).sort((a, b) => compareObjects(objects[a] as DrawOrderInput, objects[b] as DrawOrderInput, opts.hota) || a - b)
  const base = new Int32Array(n)
  sorted.forEach((i, r) => {
    base[i] = r
  })

  // Who blocks each tile (per level; heroes and flat objects block nothing here).
  const tiles = objects.map(blockedTiles)
  const blockers = new Map<number, number[]>()
  tiles.forEach((t, i) => {
    const z = (objects[i] as DrawOrderInput).z
    for (let k = 0; k < t.length; k += 2) {
      const key = tileKey(z, t[k] as number, t[k + 1] as number)
      const list = blockers.get(key)
      if (list === undefined) blockers.set(key, [i])
      else list.push(i)
    }
  })
  // below.get(a).get(b): blocked tiles of a with a blocked tile of b directly below them.
  const below = new Map<number, Map<number, number>>()
  tiles.forEach((t, a) => {
    const z = (objects[a] as DrawOrderInput).z
    for (let k = 0; k < t.length; k += 2) {
      const under = blockers.get(tileKey(z, t[k] as number, (t[k + 1] as number) + 1))
      if (under === undefined) continue
      for (const b of under) {
        if (b === a) continue
        let m = below.get(a)
        if (m === undefined) below.set(a, (m = new Map()))
        m.set(b, (m.get(b) ?? 0) + 1)
      }
    }
  })
  // Edge a → b (a drawn before b) where b stands below a more than a below b.
  const after: number[][] = Array.from({ length: n }, () => [])
  const indegree = new Int32Array(n)
  for (const [a, m] of below) {
    for (const [b, count] of m) {
      const back = below.get(b)?.get(a) ?? 0
      if (count <= back) continue
      if (opts.hota && (objects[a] as DrawOrderInput).y === (objects[b] as DrawOrderInput).y) continue
      ;(after[a] as number[]).push(b)
      indegree[b] = (indegree[b] as number) + 1
    }
  }

  const ranks = new Int32Array(n)
  const done = new Uint8Array(n)
  const heap = new RankHeap(base)
  for (let i = 0; i < n; i++) if (indegree[i] === 0) heap.push(i)
  let next = 0
  let cursor = 0
  while (next < n) {
    let i: number
    if (heap.size > 0) {
      i = heap.pop()
      if (done[i] === 1) continue
    } else {
      // A cycle: take the remaining object of lowest base rank.
      while (done[sorted[cursor] as number] === 1) cursor++
      i = sorted[cursor] as number
    }
    done[i] = 1
    ranks[i] = next++
    for (const b of after[i] as number[]) {
      indegree[b] = (indegree[b] as number) - 1
      if (indegree[b] === 0 && done[b] === 0) heap.push(b)
    }
  }
  return ranks
}
