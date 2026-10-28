import { describe, expect, it } from 'vitest'
import { BUSY_COVERAGE, CANDIDATES_PER_LEVEL, placeView } from '../../../src/core/render/view-placement.ts'
import type { Candidate, PlacementInput, ViewPlacement } from '../../../src/core/render/view-placement.ts'
import { coverageGrid } from '../../../src/core/state/coverage.ts'
import { coverageWorld, fillRect } from '../../fixtures/synthetic/coverage-world.ts'

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

describe('busy random places (spec 009)', () => {
  const view = { width: 1920, height: 1080, scale: 1, overscan: 8 * 32 }
  const input = (size: number, levels: number, objects: Parameters<typeof coverageWorld>[0]['objects'], seed: number, level: PlacementInput['level'] = 0): PlacementInput => ({
    mapSize: size,
    levels,
    level,
    placement: { mode: 'random', seed },
    ...view,
    coverage: coverageGrid(coverageWorld({ size, levels, objects })),
  })
  const plain = ({ coverage: _, ...i }: PlacementInput): PlacementInput => i
  const chosen = (r: ReturnType<typeof placeView>): Candidate => r.choice?.candidates[r.choice.chosen] as Candidate
  const SEEDS = Array.from({ length: 50 }, (_, i) => (i * 0x9e3779b1 + 17) >>> 0)

  it('keeps the uniform place as candidate 0 and never ends below it', () => {
    for (const seed of SEEDS) {
      const i = input(144, 1, fillRect(0, 60, 60, 89, 79), seed)
      const r = placeView(i)
      const today = placeView(plain(i))
      const first = r.choice?.candidates[0] as Candidate
      expect({ level: first.level, fx: first.fx, fy: first.fy }).toEqual({ level: today.camera.level, fx: today.fx, fy: today.fy })
      expect(chosen(r).coverage).toBeGreaterThanOrEqual(first.coverage)
      expect(r.camera.level).toBe(chosen(r).level)
      expect([r.fx, r.fy]).toEqual([chosen(r).fx, chosen(r).fy])
    }
  })

  it('lands on the island of an empty sea whenever a candidate reaches it', () => {
    let reached = 0
    for (const seed of SEEDS) {
      const r = placeView(input(144, 1, fillRect(0, 60, 60, 89, 79), seed))
      const any = r.choice?.candidates.some((c) => c.coverage >= BUSY_COVERAGE) ?? false
      expect(r.choice?.reached).toBe(any)
      if (any) {
        reached++
        expect(chosen(r).coverage).toBeGreaterThanOrEqual(BUSY_COVERAGE)
        // Stops at the first busy candidate.
        expect(r.choice?.chosen).toBe((r.choice?.candidates.length as number) - 1)
      }
    }
    expect(reached).toBeGreaterThan(SEEDS.length / 2)
  })

  it('on an empty map keeps the first candidate (ties go to the earlier one) and reports not reached', () => {
    const r = placeView(input(144, 1, [], 5))
    expect(r.choice?.reached).toBe(false)
    expect(r.choice?.candidates).toHaveLength(CANDIDATES_PER_LEVEL)
    expect(r.choice?.chosen).toBe(0)
  })

  it('accepts candidate 0 at once on a busy map', () => {
    const r = placeView(input(72, 1, fillRect(0, 0, 0, 71, 71), 9))
    expect(r.choice?.candidates).toHaveLength(1)
    expect(r.choice?.reached).toBe(true)
  })

  it('is deterministic and leaves the other modes untouched', () => {
    const i = input(144, 2, fillRect(0, 10, 10, 40, 40), 77, { random: 3 })
    expect(placeView(i)).toEqual(placeView(i))
    for (const placement of [{ mode: 'centre' } as const, { mode: 'coords', fx: 0.3, fy: 0.8 } as const]) {
      expect(placeView({ ...i, placement })).toEqual(placeView({ ...plain(i), placement }))
    }
    expect('choice' in placeView(plain(i))).toBe(false)
  })

  it('on a map smaller than the view gives one camera per level', () => {
    // 36×36 tiles = 1152 px each way, inside a 1920×1200 view (no border band).
    const small = (i: PlacementInput): PlacementInput => ({ ...i, height: 1200, overscan: 0 })
    const r = placeView(small(input(36, 1, fillRect(0, 0, 0, 3, 3), 4)))
    const cameras = new Set((r.choice?.candidates ?? []).map((c) => JSON.stringify(placeView({ ...plain(small(input(36, 1, [], 0))), placement: { mode: 'coords', fx: c.fx, fy: c.fy } }).camera)))
    expect(cameras.size).toBe(1)
  })

  it('with a random level tries the other level after the drawn one fails', () => {
    for (const [empty, busy] of [[1, 0], [0, 1]] as const) {
      let switched = 0
      for (const seed of SEEDS) {
        const r = placeView(input(144, 2, fillRect(busy, 0, 0, 143, 143, 2), seed, { random: seed ^ 0x85ebca6b }))
        const drawn = r.choice?.candidates[0]?.level
        if (drawn === empty) {
          switched++
          expect(r.camera.level).toBe(busy)
          expect(r.choice?.candidates.slice(0, CANDIDATES_PER_LEVEL).every((c) => c.level === empty)).toBe(true)
          expect(r.choice?.candidates).toHaveLength(CANDIDATES_PER_LEVEL + 1)
        } else expect(r.choice?.candidates).toHaveLength(1)
      }
      expect(switched).toBeGreaterThan(0)
    }
  })

  it('keeps a fixed level and the only level of a one-level map', () => {
    const r = placeView(input(144, 2, fillRect(0, 0, 0, 143, 143), 3, 1))
    expect(r.camera.level).toBe(1)
    expect(r.choice?.candidates.every((c) => c.level === 1)).toBe(true)
    expect(r.choice?.candidates).toHaveLength(CANDIDATES_PER_LEVEL)
    const one = placeView(input(144, 1, [], 3, { random: 8 }))
    expect(one.choice?.candidates.every((c) => c.level === 0)).toBe(true)
    expect(one.choice?.candidates).toHaveLength(CANDIDATES_PER_LEVEL)
  })
})
