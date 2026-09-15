// PCX image as stored in LOD archives (research.md §4): u32 size, width, height, then either
// width×height palette indices followed by a 768-byte palette, or width×height×3 BGR bytes.

import { ByteReader } from '../../util/byte-reader.ts'

export interface PcxImage {
  name: string
  width: number
  height: number
  kind: 'indexed' | 'bgr24'
  pixels: Uint8Array
  palette?: Uint8Array
}

export function parsePcx(bytes: Uint8Array, name: string): PcxImage {
  const r = new ByteReader(bytes, { file: name, format: 'pcx' })
  const { size, width, height } = r.scope('header', () => ({ size: r.u32(), width: r.u32(), height: r.u32() }))
  if (width > 8192 || height > 8192) r.invalid(`image size ${width}x${height} too large`, 4)
  if (size === width * height) {
    const pixels = r.scope('pixels', () => r.bytesCopy(size))
    const palette = r.scope('palette', () => r.bytesCopy(768))
    r.scope('end', () => r.expectEnd())
    return { name, width, height, kind: 'indexed', pixels, palette }
  }
  if (size === width * height * 3) {
    const pixels = r.scope('pixels', () => r.bytesCopy(size))
    r.scope('end', () => r.expectEnd())
    return { name, width, height, kind: 'bgr24', pixels }
  }
  return r.invalid(`size field ${size} matches neither ${width}x${height} indexed nor 24-bit`, 0)
}

export function pcxToRgba(img: PcxImage): Uint8Array {
  const n = img.width * img.height
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    if (img.kind === 'indexed') {
      const idx = (img.pixels[i] as number) * 3
      const pal = img.palette as Uint8Array
      out[i * 4] = pal[idx] as number
      out[i * 4 + 1] = pal[idx + 1] as number
      out[i * 4 + 2] = pal[idx + 2] as number
    } else {
      out[i * 4] = img.pixels[i * 3 + 2] as number
      out[i * 4 + 1] = img.pixels[i * 3 + 1] as number
      out[i * 4 + 2] = img.pixels[i * 3] as number
    }
    out[i * 4 + 3] = 255
  }
  return out
}
