import { describe, expect, it } from 'vitest'
import { viewMapping } from '../../tools/reference-env/analysis/geometry.ts'
import { registerCaptures, type Capture } from '../../tools/reference-env/analysis/register.ts'
import { mulberry32, parseTiles } from '../../tools/reference-env/commands/selfcheck.ts'
import type { Point, Rect } from '../../tools/reference-env/model/types.ts'

const MAP = 24

/** Unique pseudo-random 32×32 texture per tile, so every tile offset is distinguishable. */
function tileColor(tx: number, ty: number, x: number, y: number): [number, number, number] {
  const h = Math.imul(tx * 73856093 ^ ty * 19349663 ^ (x * 31 + y * 7), 2654435761) >>> 0
  return [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff]
}

function render(width: number, height: number, origin: Point, originPixel: Point, viewport: Rect, colorShift = 0): Capture {
  const rgb = Buffer.alloc(width * height * 3)
  const { visible, mapping } = viewMapping(origin, originPixel, viewport, MAP)
  for (let py = viewport.y; py < viewport.y + viewport.h; py++) {
    for (let px = viewport.x; px < viewport.x + viewport.w; px++) {
      const tx = origin.x + Math.floor((px - originPixel.x) / 32)
      const ty = origin.y + Math.floor((py - originPixel.y) / 32)
      if (tx < 0 || ty < 0 || tx >= MAP || ty >= MAP) continue
      const c = tileColor(tx, ty, (px - originPixel.x) % 32, (py - originPixel.y) % 32)
      const i = (py * width + px) * 3
      rgb[i] = Math.min(255, c[0] + colorShift)
      rgb[i + 1] = c[1]
      rgb[i + 2] = c[2]
    }
  }
  return { width, rgb, mask: Buffer.alloc(width * height), mapping, visible }
}

describe('registerCaptures', () => {
  const gameVp = { x: 8, y: 8, w: 592, h: 544 }
  const editorVp = { x: 19, y: 124, w: 698, h: 603 }

  it('finds offset (0, 0) for correctly positioned captures despite small colour differences', () => {
    const game = render(800, 600, { x: 1, y: 4 }, { x: 0, y: 8 }, gameVp, 4)
    const editor = render(1280, 1024, { x: 0, y: 3 }, { x: 19, y: 124 }, editorVp)
    const { best } = registerCaptures(game, editor)
    expect([best.dx, best.dy]).toEqual([0, 0])
    expect(best.fraction).toBe(0)
  })

  it('detects a wrong game position as a non-zero offset', () => {
    // The game record claims origin (1, 4) but the pixels actually show origin (2, 5).
    const shown = render(800, 600, { x: 2, y: 5 }, { x: 0, y: 8 }, gameVp)
    const claimed = viewMapping({ x: 1, y: 4 }, { x: 0, y: 8 }, gameVp, MAP)
    const game = { ...shown, mapping: claimed.mapping, visible: claimed.visible }
    const editor = render(1280, 1024, { x: 0, y: 3 }, { x: 19, y: 124 }, editorVp)
    const { best } = registerCaptures(game, editor)
    expect([best.dx, best.dy]).toEqual([1, 1])
  })
})

describe('parseTiles', () => {
  it('parses floating tile lists', () => {
    expect([...parseTiles(['20,25;21,25', ' 3,4 '])]).toEqual(['20,25', '21,25', '3,4'])
    expect(() => parseTiles(['20'])).toThrow()
  })
})

describe('mulberry32', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const xs = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(xs)
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true)
  })
})
