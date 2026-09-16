import { describe, expect, it } from 'vitest'
import { buildObjectPlan, OBJECT_VERTEX_SIZE, OBJECT_VERTICES_PER_QUAD } from '../../../src/core/render/object-plan.ts'
import { MAX_SPRITE_EXTENT, ObjectIndex } from '../../../src/core/state/object-index.ts'
import { objectScene } from './objects-helpers.ts'

describe('object plan', async () => {
  const small = await objectScene(36)
  const large = await objectScene(252)
  const range = { x0: 0, y0: 0, x1: 18, y1: 16 }

  it('places quads bottom-right anchored with cropped offsets', () => {
    const plan = buildObjectPlan(small.index, small.atlas.layout, 0, range, 0, { drawList: true })
    expect(plan.quadCount).toBeGreaterThan(0)
    plan.entries?.forEach((e, q) => {
      const sprite = small.atlas.layout.sprites[e.def]
      const cell = sprite?.groups[e.group]?.[e.frame]
      const b = q * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE
      expect(e.screenX).toBe((e.x + 1) * 32 - (sprite?.fullWidth as number))
      expect(e.screenY).toBe((e.y + 1) * 32 - (sprite?.fullHeight as number))
      const x = e.mirror ? (sprite?.fullWidth as number) - (cell?.x as number) - (cell?.width as number) : (cell?.x as number)
      expect(plan.vertices[b]).toBe(e.screenX + x)
      expect(plan.vertices[b + 1]).toBe(e.screenY + (cell?.y as number))
    })
  })

  it('advances animated frames with the tick', () => {
    const a = buildObjectPlan(small.index, small.atlas.layout, 0, range, 0, { drawList: true })
    const b = buildObjectPlan(small.index, small.atlas.layout, 0, range, 1, { drawList: true })
    expect(a.animatedInView).toBe(true)
    const anim = a.entries?.findIndex((e) => e.frameCount > 1) as number
    expect(b.entries?.[anim]?.frame).toBe(((a.entries?.[anim]?.frame as number) + 1) % (a.entries?.[anim]?.frameCount as number))
    expect(a.entries?.[anim]?.frame).toBe((a.entries?.[anim]?.phase as number) % (a.entries?.[anim]?.frameCount as number))
  })

  it('mirrors horizontally by swapping u', () => {
    const idx = small.objects.findIndex((o) => o.def === 'syntree.def')
    const mirrored = small.objects.map((o, i) => (i === idx ? { ...o, mirror: true } : o))
    const index = new ObjectIndex(mirrored, 36, 2)
    const plan = buildObjectPlan(index, small.atlas.layout, 0, range, 0, { drawList: true })
    const q = plan.entries?.findIndex((e) => e.index === idx) as number
    const b = q * 6 * OBJECT_VERTEX_SIZE
    expect(plan.vertices[b + 2] as number).toBeGreaterThan(plan.vertices[b + OBJECT_VERTEX_SIZE + 2] as number)
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
