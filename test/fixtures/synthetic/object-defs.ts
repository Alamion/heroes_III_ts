// Synthetic adventure-object sprites (procedural pixels, no game content). Frames use the special
// palette indices the object renderer handles: 0 transparent, 1–4 and 6–7 shadow, 5 flag colour.

import { proceduralPalette, writeDef } from './def.ts'
import type { SyntheticFrame, SyntheticGroup } from './def.ts'

export interface ObjectDefOptions {
  width: number
  height: number
  /** Frames per group. */
  frames: number
  /** Number of groups (hero sprites have 10). */
  groups?: number
  seed: number
  /** Paint a flag area with palette index 5. */
  flag?: boolean
  /** Paint a shadow band with indices 1–4 and 6–7. */
  shadow?: boolean
}

/** One frame: a body inset from the full frame (so frames are stored cropped), animated by `i`. */
function objectFrame(o: ObjectDefOptions, group: number, i: number): SyntheticFrame {
  const x0 = Math.min(4, Math.floor(o.width / 8))
  const y0 = Math.min(6, Math.floor(o.height / 8))
  const width = o.width - x0
  const height = o.height - y0
  const px = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v: number
      const edge = x < 3 || y < 3
      if (edge) v = 0
      else if (o.shadow === true && y >= height - 6 && x < width / 2) v = [1, 2, 3, 4, 6, 7][(x + y) % 6] as number
      else if (o.flag === true && y < height / 3 && x >= width - 10) v = 5
      else v = 20 + ((x * 5 + y * 9 + (i + group) * 13 + o.seed * 17) % 180)
      px[y * width + x] = v
    }
  }
  return { name: `o${o.seed}_${group}_${i}.pcx`, compression: 1, width, height, x: x0, y: y0, pixels: px }
}

export function writeObjectDef(o: ObjectDefOptions): Uint8Array {
  const groups: SyntheticGroup[] = Array.from({ length: o.groups ?? 1 }, (_, g) => ({
    type: g,
    frames: Array.from({ length: o.frames }, (_, i) => objectFrame(o, g, i)),
  }))
  return writeDef({ type: 0x43, fullWidth: o.width, fullHeight: o.height, palette: proceduralPalette(o.seed + 40), groups })
}

/** Hero body layout: groups 0–4 idle (1 frame), 5–9 moving (8 frames). */
export function writeHeroBodyDef(seed: number): Uint8Array {
  const groups: SyntheticGroup[] = Array.from({ length: 10 }, (_, g) => {
    const o: ObjectDefOptions = { width: 96, height: 64, frames: g < 5 ? 1 : 8, seed, shadow: true }
    return { type: g, frames: Array.from({ length: o.frames }, (_, i) => objectFrame(o, g, i)) }
  })
  return writeDef({ type: 0x44, fullWidth: 96, fullHeight: 64, palette: proceduralPalette(seed + 40), groups })
}

/** Writes an `Objects.txt` line for a template (masks as in the game file, see objects-txt.ts). */
export function objectsTxtLine(t: { defName: string; classId: number; subclassId: number; overlay?: boolean; visitable?: boolean; width?: number; height?: number }): string {
  // Characters run right to left within a row and rows run bottom to top (character 0 = anchor).
  const w = t.width ?? 1
  const h = t.height ?? 1
  const passable = Array.from({ length: 48 }, (_, i) => (Math.floor(i / 8) < h && i % 8 < w ? '0' : '1')).join('')
  const active = Array.from({ length: 48 }, (_, i) => (t.visitable === true && i === 0 ? '1' : '0')).join('')
  return `${t.defName} ${passable} ${active} 111111111 111111111 ${t.classId} ${t.subclassId} 1 ${t.overlay === true ? 1 : 0}`
}

/** RIFF PAL file (`game.pal`/`PLAYERS.PAL` layout: 256 colours). */
export function writeRiffPal(colors: Uint8Array): Uint8Array {
  if (colors.length !== 768) throw new Error('palette must have 256 RGB entries')
  const out = new Uint8Array(24 + 256 * 4)
  const dv = new DataView(out.buffer)
  out.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  dv.setUint32(4, out.length - 8, true)
  out.set([0x50, 0x41, 0x4c, 0x20], 8) // "PAL "
  out.set([0x64, 0x61, 0x74, 0x61], 12) // data
  dv.setUint32(16, 4 + 256 * 4, true)
  dv.setUint16(20, 0x0300, true)
  dv.setUint16(22, 256, true)
  for (let i = 0; i < 256; i++) out.set(colors.subarray(i * 3, i * 3 + 3), 24 + i * 4)
  return out
}

/** Procedural player palette: player p's 32 shades are a ramp of a distinct hue. */
export function syntheticPlayersPalette(): Uint8Array {
  const c = new Uint8Array(768)
  for (let p = 0; p < 8; p++) {
    for (let s = 0; s < 32; s++) {
      const i = (p * 32 + s) * 3
      const k = 40 + s * 6
      c[i] = p & 1 ? k : 30
      c[i + 1] = p & 2 ? k : 30 + p * 10
      c[i + 2] = p & 4 ? k : 60
    }
  }
  return c
}
