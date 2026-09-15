// Pure palette rotation math shared by the renderer, CLIs and checks (research.md §5).

import type { PaletteRotation } from '../data/palette-rotation.ts'

/**
 * Returns a copy of an RGB (768-byte) or RGBA (1024-byte) palette with every rotation advanced by
 * `step` steps: after one step, new[start + i] = old[start + (i − 1) mod length], i.e. the last colour
 * of the range moves to its start (direction measured from reference clips, research.md §5).
 */
export function rotatePalette(palette: Uint8Array, rotations: readonly PaletteRotation[], step: number, channels: 3 | 4 = 3): Uint8Array {
  const out = palette.slice()
  for (const r of rotations) {
    const shift = (((-step) % r.length) + r.length) % r.length
    if (shift === 0) continue
    for (let i = 0; i < r.length; i++) {
      const src = (r.start + ((i + shift) % r.length)) * channels
      const dst = (r.start + i) * channels
      for (let ch = 0; ch < channels; ch++) out[dst + ch] = palette[src + ch] as number
    }
  }
  return out
}
