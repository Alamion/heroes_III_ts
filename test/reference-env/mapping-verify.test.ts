import { describe, expect, it } from 'vitest'
import { verifyMapping } from '../../tools/reference-env/analysis/mapping-verify.ts'
import type { MappingRender } from '../../tools/reference-env/analysis/mapping-verify.ts'

const W = 592
const H = 544
const TILE = 32

/** A deterministic "world" of unique tile textures; animated/object areas are marked not comparable. */
function world(offsetX: number, offsetY: number): MappingRender {
  const rgba = new Uint8Array(W * H * 4)
  const comparable = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x + offsetX
      const wy = y + offsetY
      const tx = Math.floor(wx / TILE)
      const ty = Math.floor(wy / TILE)
      const h = Math.imul((tx * 73856093) ^ (ty * 19349663) ^ ((wx & 31) * 31 + (wy & 31) * 7), 2654435761) >>> 0
      rgba.set([h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, 255], (y * W + x) * 4)
      comparable[y * W + x] = (tx + ty) % 5 === 0 ? 0 : 1
    }
  }
  return { rgba, comparable }
}

function captureAt(offsetX: number, offsetY: number): Uint8Array {
  const { rgba } = world(offsetX, offsetY)
  const rgb = new Uint8Array(W * H * 3)
  for (let i = 0; i < W * H; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3)
  // A cheat reply / cursor-like disturbance on a small area.
  for (let i = 0; i < 2000; i++) rgb[i * 3] = 1
  return rgb
}

describe('verifyMapping', () => {
  it('accepts a capture taken at the recorded mapping', () => {
    const r = verifyMapping({ width: W, height: H, capture: captureAt(320, 96), channels: 3, offset: { x: 320, y: 96 }, tileSize: TILE, render: world })
    expect(r.ok).toBe(true)
    expect(r.bestShift).toEqual({ dx: 0, dy: 0 })
  })

  it('rejects a capture whose real view is one tile off, in every direction', () => {
    for (const dy of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue
        const r = verifyMapping({ width: W, height: H, capture: captureAt(320 + dx * TILE, 96 + dy * TILE), channels: 3, offset: { x: 320, y: 96 }, tileSize: TILE, render: world })
        expect(r.ok).toBe(false)
        expect(r.bestShift).toEqual({ dx, dy })
        expect(r.differingRecorded).toBeGreaterThan(r.bestDiffering * 5)
      }
    }
  })
})
