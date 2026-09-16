import { describe, expect, it } from 'vitest'
import { detectLevel, LEVEL_MARGIN } from '../../tools/reference-env/analysis/level-detect.ts'
import type { Rgb } from '../../tools/reference-env/data/game-layout.ts'

const MINIMAP = { x: 630, y: 26, w: 144, h: 144 }
const SIZE = 36
const RECT_COLOR: Rgb = [255, 73, 123]

/** Surface: terrain bands; underground: mostly rock with a few tunnels. */
const surface = Uint8Array.from({ length: SIZE * SIZE }, (_, i) => Math.floor(((i % SIZE) + Math.floor(i / SIZE) * 2) / 5) % 9)
const underground = Uint8Array.from({ length: SIZE * SIZE }, (_, i) => ((i % SIZE) % 7 === 0 ? 6 : 9))

/** Minimap as the game would draw it: one colour per terrain, tinted by an interface palette. */
function minimapOf(terrain: Uint8Array, tint: number, withRect: boolean): { width: number; rgb: Buffer } {
  const width = 800
  const rgb = Buffer.alloc(width * 600 * 3)
  const scale = MINIMAP.w / SIZE
  for (let y = 0; y < MINIMAP.h; y++) {
    for (let x = 0; x < MINIMAP.w; x++) {
      const t = terrain[Math.floor(y / scale) * SIZE + Math.floor(x / scale)] as number
      const i = ((MINIMAP.y + y) * width + MINIMAP.x + x) * 3
      rgb[i] = (t * 37 + tint) & 0xff
      rgb[i + 1] = (t * 71) & 0xff
      rgb[i + 2] = (t * 13 + 40) & 0xff
      if (withRect && (y === 20 || y === 87) && x >= 10 && x < 86 && x % 3 !== 0) rgb.set(RECT_COLOR, i)
    }
  }
  return { width, rgb }
}

describe('detectLevel', () => {
  it('recognises the shown level regardless of interface colour', () => {
    for (const tint of [0, 90, 170]) {
      expect(detectLevel(minimapOf(surface, tint, true), MINIMAP, SIZE, [surface, underground], [RECT_COLOR]).level).toBe(0)
      expect(detectLevel(minimapOf(underground, tint, true), MINIMAP, SIZE, [surface, underground], [RECT_COLOR]).level).toBe(1)
    }
  })

  it('is unknown when both levels explain the minimap equally', () => {
    const d = detectLevel(minimapOf(surface, 0, false), MINIMAP, SIZE, [surface, surface])
    expect(d.level).toBeNull()
    expect(d.margin).toBeLessThan(LEVEL_MARGIN)
  })

  it('is unknown on a fully shrouded minimap', () => {
    const black = { width: 800, rgb: Buffer.alloc(800 * 600 * 3) }
    expect(detectLevel(black, MINIMAP, SIZE, [surface, underground]).level).toBeNull()
  })

  it('tolerates two shades per terrain and object colours', () => {
    const f = minimapOf(surface, 0, false)
    const scale = MINIMAP.w / SIZE
    for (let t = 0; t < SIZE * SIZE; t += 3) {
      const tx = t % SIZE
      const ty = Math.floor(t / SIZE)
      const i = ((MINIMAP.y + Math.floor((ty + 0.5) * scale)) * 800 + MINIMAP.x + Math.floor((tx + 0.5) * scale)) * 3
      f.rgb[i] = ((f.rgb[i] as number) + 20) & 0xff // blocked-tile shade
    }
    expect(detectLevel(f, MINIMAP, SIZE, [surface, underground]).level).toBe(0)
  })

  it('accepts single-level maps', () => {
    expect(detectLevel(minimapOf(surface, 0, false), MINIMAP, SIZE, [surface]).level).toBe(0)
  })
})
