import { describe, expect, it } from 'vitest'
import { buildObjectPlan, OBJECT_VERTEX_SIZE, OBJECT_VERTICES_PER_QUAD } from '../../../src/core/render/object-plan.ts'
import { MAX_SPRITE_EXTENT, ObjectIndex } from '../../../src/core/state/object-index.ts'
import { objectScene } from './objects-helpers.ts'

describe('object plan', async () => {
  const small = await objectScene(36)
  const large = await objectScene(252)
  const range = { x0: 0, y0: 0, x1: 18, y1: 16 }

  // Quads of one object: the plan cuts sprites at map tile borders (the game orders objects per tile).
  const quadsOf = (plan: ReturnType<typeof buildObjectPlan>, index: number): number[] => {
    const out: number[] = []
    for (let q = 0; q < plan.quadCount; q++) if (plan.quadObjects[q] === index) out.push(q * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE)
    return out
  }

  it('places pieces bottom-right anchored with cropped offsets, cut at tile borders and covering the frame', () => {
    const plan = buildObjectPlan(small.index, small.atlas.layout, 0, range, 0, { drawList: true })
    expect(plan.quadCount).toBeGreaterThan(plan.entries?.length as number)
    for (const e of plan.entries ?? []) {
      const sprite = small.atlas.layout.sprites[e.def]
      const cell = sprite?.groups[e.group]?.[e.frame]
      expect(e.screenX).toBe((e.x + 1) * 32 - (sprite?.fullWidth as number))
      expect(e.screenY).toBe((e.y + 1) * 32 - (sprite?.fullHeight as number))
      const x = e.mirror ? (sprite?.fullWidth as number) - (cell?.x as number) - (cell?.width as number) : (cell?.x as number)
      let area = 0
      for (const b of quadsOf(plan, e.index)) {
        const [lx0, ly0, lx1, ly1] = [12, 13, 14, 15].map((k) => plan.vertices[b + k] as number) as [number, number, number, number]
        // Vertex 0 is the piece's top-left corner: the frame's corner plus the piece offset.
        expect(plan.vertices[b]).toBe(e.screenX + x + lx0)
        expect(plan.vertices[b + 1]).toBe(e.screenY + (cell?.y as number) + ly0)
        // A piece never crosses a tile border (plan coordinates start at the range corner).
        expect(Math.floor((plan.vertices[b] as number) / 32)).toBe(Math.floor(((plan.vertices[b] as number) + lx1 - lx0 - 1) / 32))
        expect(Math.floor((plan.vertices[b + 1] as number) / 32)).toBe(Math.floor(((plan.vertices[b + 1] as number) + ly1 - ly0 - 1) / 32))
        area += (lx1 - lx0) * (ly1 - ly0)
      }
      expect(area).toBe((cell?.width as number) * (cell?.height as number))
    }
  })

  it('advances animated frames with the tick', () => {
    const a = buildObjectPlan(small.index, small.atlas.layout, 0, range, 0, { drawList: true })
    const b = buildObjectPlan(small.index, small.atlas.layout, 0, range, 1, { drawList: true })
    expect(a.animatedInView).toBe(true)
    const anim = a.entries?.findIndex((e) => e.frameCount > 1) as number
    expect(b.entries?.[anim]?.frame).toBe(((a.entries?.[anim]?.frame as number) + 1) % (a.entries?.[anim]?.frameCount as number))
    expect(a.entries?.[anim]?.frame).toBe((a.entries?.[anim]?.phase as number) % (a.entries?.[anim]?.frameCount as number))
  })

  it('mirrors horizontally with a negative cell width', () => {
    const idx = small.objects.findIndex((o) => o.def === 'syntree.def')
    const mirrored = small.objects.map((o, i) => (i === idx ? { ...o, mirror: true } : o))
    const index = new ObjectIndex(mirrored, 36, 2)
    const plan = buildObjectPlan(index, small.atlas.layout, 0, range, 0, { drawList: true })
    const quads = quadsOf(plan, idx)
    expect(quads.length).toBeGreaterThan(0)
    for (const b of quads) {
      expect(plan.vertices[b + 6] as number).toBeLessThan(0)
      expect(plan.vertices[b + 7] as number).toBeGreaterThan(0)
    }
  })

  it('includes objects anchored outside the range whose sprites reach into it', () => {
    const inner = { x0: 5, y0: 5, x1: 10, y1: 8 }
    const plan = buildObjectPlan(small.index, small.atlas.layout, 0, inner, 0, { drawList: true })
    expect(plan.entries?.some((e) => e.x > inner.x1 || e.y > inner.y1)).toBe(true)
    expect(plan.entries?.every((e) => e.x <= inner.x1 + MAX_SPRITE_EXTENT.left && e.y <= inner.y1 + MAX_SPRITE_EXTENT.up)).toBe(true)
  })

  it('does not depend on the map size for the same view', () => {
    const a = buildObjectPlan(small.index, small.atlas.layout, 0, range, 3)
    const b = buildObjectPlan(large.index, large.atlas.layout, 0, range, 3)
    expect(b.quadCount).toBe(a.quadCount)
    expect(b.vertices.length).toBe(a.vertices.length)
  })
})
