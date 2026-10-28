import { describe, expect, it } from 'vitest'
import { coverageGrid, coveredTiles, viewCoverage } from '../../../src/core/state/coverage.ts'
import { coverageWorld, fillRect, withHidden } from '../../fixtures/synthetic/coverage-world.ts'

const T = 32

describe('coverage grid (spec 009 research R2)', () => {
  it('counts exact rectangles and clamps them to the map', () => {
    const g = coverageGrid(coverageWorld({ size: 36, levels: 1, objects: fillRect(0, 10, 5, 19, 14) }))
    expect(coveredTiles(g, 0, 0, 0, 35, 35)).toBe(100)
    expect(coveredTiles(g, 0, 10, 5, 14, 9)).toBe(25)
    expect(coveredTiles(g, 0, 15, 10, 100, 100)).toBe(25)
    expect(coveredTiles(g, 0, -50, -50, 12, 6)).toBe(6)
    expect(coveredTiles(g, 0, 40, 40, 60, 60)).toBe(0)
    expect(coveredTiles(g, 0, 0, 0, 9, 35)).toBe(0)
  })

  it('marks blocked and visitable template tiles only, at the right offsets', () => {
    // Row 5 (object row): bits 7 and 6 blocked (x, x − 1); row 4: bit 7 passable but visitable;
    // every other tile passable, so it does not count.
    const passable = Uint8Array.of(255, 255, 255, 255, 255, 0b0011_1111)
    const active = Uint8Array.of(0, 0, 0, 0, 0b1000_0000, 0)
    const g = coverageGrid(coverageWorld({ size: 20, levels: 1, objects: [{ x: 10, y: 10, z: 0, passable, active }] }))
    expect(coveredTiles(g, 0, 0, 0, 19, 19)).toBe(3)
    expect(coveredTiles(g, 0, 10, 10, 10, 10)).toBe(1)
    expect(coveredTiles(g, 0, 9, 10, 9, 10)).toBe(1)
    expect(coveredTiles(g, 0, 10, 9, 10, 9)).toBe(1)
    expect(coveredTiles(g, 0, 8, 10, 8, 10)).toBe(0)
  })

  it('drops template tiles off the map', () => {
    const passable = Uint8Array.of(0, 0, 0, 0, 0, 0)
    const g = coverageGrid(coverageWorld({ size: 10, levels: 1, objects: [{ x: 2, y: 1, z: 0, passable }] }))
    // Columns −5…2 and rows −4…1 of which columns 0…2, rows 0…1 are on the map.
    expect(coveredTiles(g, 0, 0, 0, 9, 9)).toBe(6)
  })

  it('ignores hidden classes and keeps the levels apart', () => {
    const objects = [...withHidden(0, [{ x: 3, y: 3 }]), ...fillRect(1, 0, 0, 4, 4)]
    const g = coverageGrid(coverageWorld({ size: 10, levels: 2, objects }))
    expect(coveredTiles(g, 0, 0, 0, 9, 9)).toBe(0)
    expect(coveredTiles(g, 1, 0, 0, 9, 9)).toBe(25)
    expect(coveredTiles(g, 2, 0, 0, 9, 9)).toBe(0)
  })

  it('counts a view half past the map edge as half uncovered', () => {
    const g = coverageGrid(coverageWorld({ size: 100, levels: 1, objects: fillRect(0, 0, 0, 99, 99) }))
    const inside = viewCoverage(g, { level: 0, offsetX: 0, offsetY: 0, width: 20 * T, height: 10 * T, scale: 1 })
    expect(inside).toBe(1)
    const past = viewCoverage(g, { level: 0, offsetX: -10 * T, offsetY: 0, width: 20 * T, height: 10 * T, scale: 1 })
    expect(past).toBe(0.5)
    // Scale 2 halves the view in world pixels: 10×5 tiles, of which 5×5 lie past the edge.
    expect(viewCoverage(g, { level: 0, offsetX: -5 * T, offsetY: 0, width: 20 * T, height: 10 * T, scale: 2 })).toBe(0.5)
  })

  it('on a map smaller than the view counts only the map along that axis', () => {
    const g = coverageGrid(coverageWorld({ size: 36, levels: 1, objects: fillRect(0, 0, 0, 35, 35) }))
    // 1920×1080 at ×1: 60×34 tiles, the map centred horizontally (36 < 60), taller than the view.
    const view = { level: 0, offsetX: Math.round((36 * T - 1920) / 2), offsetY: 0, width: 1920, height: 1080, scale: 1 }
    expect(viewCoverage(g, view)).toBe(1)
    const half = coverageGrid(coverageWorld({ size: 36, levels: 1, objects: fillRect(0, 0, 0, 17, 35) }))
    expect(viewCoverage(half, view)).toBe(0.5)
  })
})
