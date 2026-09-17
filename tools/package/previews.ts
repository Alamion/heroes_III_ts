// Package preview images (spec 004 FR-020, constitution I): original procedural art — the project
// icon over a dimmed, stylised tile map in earthy colours — generated deterministically. No game
// imagery, logos or captures.

import { createRng } from '../../src/core/util/rng.ts'
import { ICON_SIZE, iconPixels } from './icon.ts'
import { encodePng } from '../shared/png.ts'

const PALETTE: readonly [number, number, number][] = [
  [58, 94, 44], // grass
  [74, 112, 52],
  [120, 104, 62], // dirt
  [92, 84, 70], // rough
  [196, 176, 120], // sand
  [48, 62, 40], // swamp
]

export function previewPng(size: number): Uint8Array {
  const tiles = 16
  const cell = Math.floor(size / tiles)
  const rng = createRng(0x4833)
  const grid = Array.from({ length: tiles * tiles }, () => rng.int(PALETTE.length))
  const data = new Uint8Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = Math.min(tiles - 1, Math.floor(x / cell))
      const ty = Math.min(tiles - 1, Math.floor(y / cell))
      let [r, g, b] = PALETTE[grid[ty * tiles + tx] as number] as [number, number, number]
      // Per-tile texture and a soft vignette.
      const n = ((x * 37 + y * 17 + tx * 101 + ty * 53) % 23) - 11
      r += n
      g += n
      b += n
      // A river: a sine band across the map.
      const riverY = size * (0.5 + 0.18 * Math.sin((x / size) * Math.PI * 2.2))
      const d = Math.abs(y - riverY)
      if (d < size * 0.035) {
        const t = d / (size * 0.035)
        r = Math.round(r * t + 40 * (1 - t))
        g = Math.round(g * t + 96 * (1 - t))
        b = Math.round(b * t + 160 * (1 - t))
      }
      const cx = x / size - 0.5
      const cy = y / size - 0.5
      const v = 0.55 * (1 - 0.7 * (cx * cx + cy * cy))
      const i = (y * size + x) * 3
      data[i] = Math.max(0, Math.min(255, Math.round(r * v)))
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g * v)))
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b * v)))
    }
  }
  // The icon, centred at an integer scale.
  const icon = iconPixels()
  const scale = Math.max(1, Math.floor((size * 0.8) / ICON_SIZE))
  const offset = Math.floor((size - scale * ICON_SIZE) / 2)
  for (let y = 0; y < scale * ICON_SIZE; y++) {
    for (let x = 0; x < scale * ICON_SIZE; x++) {
      const c = icon[Math.floor(y / scale) * ICON_SIZE + Math.floor(x / scale)]
      if (c) data.set(c, ((offset + y) * size + offset + x) * 3)
    }
  }
  return encodePng({ width: size, height: size, channels: 3, data })
}
