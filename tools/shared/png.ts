// Minimal PNG codec on node:zlib (tools only): 8-bit gray, RGB, RGBA; all five filter types on
// decode, filter 0 on encode. Lossless, no ancillary chunks.

import { deflateSync, inflateSync } from 'node:zlib'

export type PngChannels = 1 | 3 | 4

export interface PngImage {
  width: number
  height: number
  channels: PngChannels
  data: Uint8Array
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, payload.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)))
  return out
}

const COLOR_TYPE: Record<PngChannels, number> = { 1: 0, 3: 2, 4: 6 }

export function encodePng(img: PngImage): Uint8Array {
  const { width, height, channels, data } = img
  if (data.length !== width * height * channels) {
    throw new Error(`png: data length ${data.length} != ${width}x${height}x${channels}`)
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = COLOR_TYPE[channels]
  const stride = width * channels
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const idat = deflateSync(raw, { level: 6 })
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

export function decodePng(bytes: Uint8Array): PngImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('png: bad signature')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 8
  let width = 0
  let height = 0
  let channels: PngChannels = 4
  const idat: Uint8Array[] = []
  while (off < bytes.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8))
    const payload = bytes.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(off + 8)
      height = view.getUint32(off + 12)
      const depth = payload[8]
      const colorType = payload[9]
      if (depth !== 8 || payload[12] !== 0) throw new Error('png: only 8-bit non-interlaced images are supported')
      if (colorType === 0) channels = 1
      else if (colorType === 2) channels = 3
      else if (colorType === 6) channels = 4
      else throw new Error(`png: unsupported color type ${colorType}`)
    } else if (type === 'IDAT') {
      idat.push(payload)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0))
  let j = 0
  for (const p of idat) {
    joined.set(p, j)
    j += p.length
  }
  const raw = inflateSync(joined)
  const stride = width * channels
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x] as number
      const a = x >= channels ? (out[dst + x - channels] as number) : 0
      const b = y > 0 ? (out[dst - stride + x] as number) : 0
      const c = x >= channels && y > 0 ? (out[dst - stride + x - channels] as number) : 0
      let v: number
      switch (filter) {
        case 0: v = cur; break
        case 1: v = cur + a; break
        case 2: v = cur + b; break
        case 3: v = cur + ((a + b) >> 1); break
        case 4: v = cur + paeth(a, b, c); break
        default: throw new Error(`png: bad filter ${filter}`)
      }
      out[dst + x] = v & 0xff
    }
  }
  return { width, height, channels, data: out }
}

/** Converts any decoded image to RGBA. */
export function toRgba(img: PngImage): Uint8Array {
  if (img.channels === 4) return img.data
  const n = img.width * img.height
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    if (img.channels === 1) {
      const g = img.data[i] as number
      out[i * 4] = g
      out[i * 4 + 1] = g
      out[i * 4 + 2] = g
    } else {
      out[i * 4] = img.data[i * 3] as number
      out[i * 4 + 1] = img.data[i * 3 + 1] as number
      out[i * 4 + 2] = img.data[i * 3 + 2] as number
    }
    out[i * 4 + 3] = 255
  }
  return out
}
