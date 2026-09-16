import { describe, expect, it } from 'vitest'
import { frameOf, nextChangeMs, objectTick } from '../../../src/core/render/animation.ts'
import { OBJECT_FRAME_MS } from '../../../src/core/data/animation.ts'

describe('animation state', () => {
  it('derives ticks and frames with per-object phases', () => {
    expect(OBJECT_FRAME_MS).toBe(180)
    expect(objectTick(179)).toBe(0)
    expect(objectTick(180)).toBe(1)
    expect(frameOf(8, 13)).toBe(5)
    expect(frameOf(1, 99)).toBe(0)
    expect(frameOf(12, -1)).toBe(11)
  })

  it('reports the next visible change only for animated content in view', () => {
    expect(nextChangeMs(200, { animatedRows: false, animatedObjects: false })).toBeNull()
    expect(nextChangeMs(200, { animatedRows: true, animatedObjects: false })).toBe(360)
    expect(nextChangeMs(200, { animatedRows: false, animatedObjects: true })).toBe(360)
    expect(nextChangeMs(360, { animatedRows: true, animatedObjects: true })).toBe(540)
  })
})
