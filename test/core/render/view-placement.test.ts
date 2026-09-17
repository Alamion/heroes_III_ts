import { describe, expect, it } from 'vitest'
import { placeView } from '../../../src/core/render/view-placement.ts'
import type { PlacementInput, ViewPlacement } from '../../../src/core/render/view-placement.ts'

const base = (mapSize: number, placement: ViewPlacement, extra: Partial<PlacementInput> = {}): PlacementInput => ({
  mapSize,
  levels: 2,
  level: 0,
  placement,
  width: 640,
  height: 480,
  scale: 1,
  ...extra,
})

describe('view placement', () => {
  it('maps slider fractions to the reachable range', () => {
    for (const size of [36, 252]) {
      const map = size * 32
      const left = placeView(base(size, { mode: 'coords', fx: 0, fy: 0 })).camera
      const mid = placeView(base(size, { mode: 'coords', fx: 0.5, fy: 0.5 })).camera
      const right = placeView(base(size, { mode: 'coords', fx: 1, fy: 1 })).camera
      expect([left.offsetX, left.offsetY]).toEqual([0, 0])
      expect(right.offsetX).toBe(map - 640)
      expect(right.offsetY).toBe(map - 480)
      expect(mid.offsetX).toBe(Math.round((map - 640) / 2))
    }
  })

  it('reaches the overscan band past each edge; centre is unchanged', () => {
    const map = 144 * 32
    const band = { overscan: 8 * 32 }
    const left = placeView(base(144, { mode: 'coords', fx: 0, fy: 0 }, band)).camera
    const right = placeView(base(144, { mode: 'coords', fx: 1, fy: 1 }, band)).camera
    expect([left.offsetX, left.offsetY]).toEqual([-256, -256])
    expect([right.offsetX, right.offsetY]).toEqual([map - 640 + 256, map - 480 + 256])
    expect(placeView(base(144, { mode: 'centre' }, band)).camera).toEqual(placeView(base(144, { mode: 'centre' })).camera)
    // The same 8 tiles at ×3, independent of the view size.
    const x3 = placeView(base(36, { mode: 'coords', fx: 1, fy: 0 }, { ...band, width: 1920, height: 1080, scale: 3 })).camera
    expect([x3.offsetX, x3.offsetY]).toEqual([36 * 32 - 640 + 256, -256])
  })

  it('centre equals coords 50/50 and clamps out-of-range fractions', () => {
    const c = placeView(base(144, { mode: 'centre' })).camera
    expect(placeView(base(144, { mode: 'coords', fx: 0.5, fy: 0.5 })).camera).toEqual(c)
    expect(placeView(base(144, { mode: 'coords', fx: 7, fy: -3 })).camera).toMatchObject({ offsetX: 144 * 32 - 640, offsetY: 0 })
  })

  it('falls back to the surface when the level does not exist', () => {
    expect(placeView(base(36, { mode: 'centre' }, { levels: 1, level: 1 })).camera.level).toBe(0)
    expect(placeView(base(36, { mode: 'centre' }, { levels: 2, level: 1 })).camera.level).toBe(1)
  })

  it('centres a map smaller than the view', () => {
    const cam = placeView(base(10, { mode: 'coords', fx: 0, fy: 1 })).camera
    expect(cam.offsetX).toBe(Math.round((320 - 640) / 2))
    expect(cam.offsetY).toBe(Math.round((320 - 480) / 2))
  })

  it('uses the scale for the view size in world pixels', () => {
    const cam = placeView(base(36, { mode: 'coords', fx: 1, fy: 1 }, { scale: 2 })).camera
    expect(cam.offsetX).toBe(36 * 32 - 320)
  })

  it('a random level choice draws the level on two-level maps only', () => {
    const levels = new Set<number>()
    for (let seed = 1; seed <= 40; seed++) levels.add(placeView(base(144, { mode: 'centre' }, { level: { random: seed } })).camera.level)
    expect([...levels].sort()).toEqual([0, 1])
    expect(placeView(base(144, { mode: 'random', seed: 3 }, { levels: 1, level: { random: 5 } })).camera.level).toBe(0)
    expect(placeView(base(144, { mode: 'random', seed: 3 }, { level: 1 })).camera.level).toBe(1)
  })

  it('random placement is deterministic per seed', () => {
    const a = placeView(base(144, { mode: 'random', seed: 42 }))
    const b = placeView(base(144, { mode: 'random', seed: 42 }))
    const c = placeView(base(144, { mode: 'random', seed: 43 }))
    expect(a).toEqual(b)
    expect(a.camera).not.toEqual(c.camera)
    expect(a.fx).toBeGreaterThanOrEqual(0)
    expect(a.fx).toBeLessThan(1)
  })
})
