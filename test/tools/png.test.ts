import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { decodePng, encodePng, toRgba } from '../../tools/shared/png.ts'

describe('png codec', () => {
  it('round-trips gray, RGB and RGBA', () => {
    for (const channels of [1, 3, 4] as const) {
      const width = 7
      const height = 5
      const data = new Uint8Array(width * height * channels).map((_, i) => (i * 37) & 0xff)
      const img = decodePng(encodePng({ width, height, channels, data }))
      expect(img).toEqual({ width, height, channels, data })
    }
  })

  it('decodes all filter types', () => {
    // Hand-built 3x5 RGB image, one filter type per row, compared against a filter-0 reference.
    const width = 3
    const channels = 3
    const rows = [0, 1, 2, 3, 4]
    const pixels = new Uint8Array(width * channels * rows.length).map((_, i) => (i * 53 + 11) & 0xff)
    const stride = width * channels
    const raw = new Uint8Array((stride + 1) * rows.length)
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    for (const y of rows) {
      raw[y * (stride + 1)] = y
      for (let x = 0; x < stride; x++) {
        const cur = pixels[y * stride + x] as number
        const a = x >= channels ? (pixels[y * stride + x - channels] as number) : 0
        const b = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0
        const c = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] as number) : 0
        const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][y] as number
        raw[y * (stride + 1) + 1 + x] = (cur - pred) & 0xff
      }
    }
    const reference = encodePng({ width, height: rows.length, channels, data: pixels })
    // Swap the IDAT payload of the reference for the filtered one (same IHDR).
    const idat = deflateSync(raw)
    const decodedRef = decodePng(reference)
    const custom = buildPng(width, rows.length, 2, new Uint8Array(idat))
    expect(decodePng(custom).data).toEqual(decodedRef.data)
  })

  it('converts to RGBA', () => {
    const rgba = toRgba({ width: 1, height: 1, channels: 1, data: Uint8Array.of(9) })
    expect(Array.from(rgba)).toEqual([9, 9, 9, 255])
  })
})

function buildPng(width: number, height: number, colorType: number, idat: Uint8Array): Uint8Array {
  const base = encodePng({ width, height, channels: colorType === 2 ? 3 : 4, data: new Uint8Array(width * height * (colorType === 2 ? 3 : 4)) })
  // signature(8) + IHDR chunk(25) kept; rebuild IDAT + IEND.
  const head = base.subarray(0, 33)
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, payload: Uint8Array) => {
    const out = new Uint8Array(12 + payload.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, payload.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(payload, 8)
    v.setUint32(8 + payload.length, crc(out.subarray(4, 8 + payload.length)))
    return out
  }
  const parts = [head, chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
