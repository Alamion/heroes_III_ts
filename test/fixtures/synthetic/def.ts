// Synthetic DEF writer (procedural palettes and patterns; no game content). Encodes frames with
// any of the four compression types the reader supports.

import { ByteWriter } from './writer.ts'

export interface SyntheticFrame {
  name: string
  width: number
  height: number
  x?: number
  y?: number
  /** width × height palette indices. */
  pixels: Uint8Array
  compression: 0 | 1 | 2 | 3
  /** Writes the 16-byte old-format header (compression 1 only, full-size frame). */
  oldFormat?: boolean
}

export interface SyntheticGroup {
  type: number
  frames: SyntheticFrame[]
  /** Indices into `frames` that should reuse an earlier frame's data offset. */
  aliases?: Record<number, number>
}

export function proceduralPalette(seed = 1): Uint8Array {
  const p = new Uint8Array(768)
  for (let i = 0; i < 256; i++) {
    p[i * 3] = (i * 7 + seed * 13) & 0xff
    p[i * 3 + 1] = (i * 11 + seed * 5) & 0xff
    p[i * 3 + 2] = (i * 3 + seed * 29) & 0xff
  }
  return p
}

export function patternPixels(width: number, height: number, seed = 0, maxIndex = 255): Uint8Array {
  const px = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Mix of long runs and noise so every RLE path is exercised.
      const run = ((x >> 3) + (y >> 2) + seed) % 4 === 0
      px[y * width + x] = run ? ((y + seed) % 7) : ((x * 31 + y * 17 + seed * 7) % (maxIndex + 1))
    }
  }
  return px
}

function encodeRle1(f: SyntheticFrame): Uint8Array {
  const rows: Uint8Array[] = []
  for (let y = 0; y < f.height; y++) {
    const row = f.pixels.subarray(y * f.width, (y + 1) * f.width)
    const out: number[] = []
    let x = 0
    while (x < f.width) {
      const v = row[x] as number
      let len = 1
      while (x + len < f.width && row[x + len] === v && len < 256) len++
      if (len >= 3 && v !== 0xff) {
        out.push(v, len - 1)
        x += len
      } else {
        let raw = 0
        while (x + raw < f.width && raw < 256) {
          const w = row[x + raw] as number
          let l = 1
          while (x + raw + l < f.width && row[x + raw + l] === w && l < 3) l++
          if (l >= 3 && w !== 0xff) break
          raw++
        }
        if (raw === 0) raw = 1
        out.push(0xff, raw - 1, ...row.subarray(x, x + raw))
        x += raw
      }
    }
    rows.push(Uint8Array.from(out))
  }
  const w = new ByteWriter()
  let off = f.height * 4
  for (const r of rows) {
    w.u32(off)
    off += r.length
  }
  for (const r of rows) w.bytes(r)
  return w.toBytes()
}

function encodePackedRow(row: Uint8Array): number[] {
  const out: number[] = []
  let x = 0
  while (x < row.length) {
    const v = row[x] as number
    if (v <= 6) {
      let len = 1
      while (x + len < row.length && row[x + len] === v && len < 32) len++
      out.push((v << 5) | (len - 1))
      x += len
    } else {
      let len = 0
      while (x + len < row.length && (row[x + len] as number) > 6 && len < 32) len++
      out.push((7 << 5) | (len - 1), ...row.subarray(x, x + len))
      x += len
    }
  }
  return out
}

function encodeRle2(f: SyntheticFrame): Uint8Array {
  const w = new ByteWriter()
  const tableSize = f.height * 2
  const rows: number[] = []
  for (let y = 0; y < f.height; y++) rows.push(...encodePackedRow(f.pixels.subarray(y * f.width, (y + 1) * f.width)))
  // Only the first offset is used by the format; the rest point at the same start.
  for (let y = 0; y < f.height; y++) w.u16(tableSize)
  w.bytes(rows)
  return w.toBytes()
}

function encodeRle3(f: SyntheticFrame): Uint8Array {
  const blocks = Math.floor(f.width / 32)
  const tableSize = f.height * blocks * 2
  const rowData: number[][] = []
  for (let y = 0; y < f.height; y++) rowData.push(encodePackedRow(f.pixels.subarray(y * f.width, (y + 1) * f.width)))
  const w = new ByteWriter()
  let off = tableSize
  for (let y = 0; y < f.height; y++) {
    // Per-block offsets; the reader uses the first of each row.
    for (let b = 0; b < blocks; b++) w.u16(off)
    off += (rowData[y] as number[]).length
  }
  for (const r of rowData) w.bytes(r)
  return w.toBytes()
}

function encodeFrame(f: SyntheticFrame): Uint8Array {
  if (f.compression === 3 && f.width % 32 !== 0) throw new Error('compression 3 frames must be a multiple of 32 wide')
  switch (f.compression) {
    case 0:
      return f.pixels.slice()
    case 1:
      return encodeRle1(f)
    case 2:
      return encodeRle2(f)
    case 3:
      return encodeRle3(f)
  }
}

export function writeDef(opts: { type?: number; fullWidth: number; fullHeight: number; palette?: Uint8Array; groups: SyntheticGroup[] }): Uint8Array {
  const w = new ByteWriter().u32(opts.type ?? 0x42).u32(opts.fullWidth).u32(opts.fullHeight).u32(opts.groups.length)
  w.bytes(opts.palette ?? proceduralPalette())
  // Compute header layout to know frame offsets.
  let headerSize = w.length
  for (const g of opts.groups) headerSize += 16 + g.frames.length * 17
  const encoded = opts.groups.map((g) => g.frames.map((f) => encodeFrame(f)))
  const offsets: number[][] = []
  let off = headerSize
  opts.groups.forEach((g, gi) => {
    const row: number[] = []
    g.frames.forEach((f, fi) => {
      const alias = g.aliases?.[fi]
      if (alias !== undefined) {
        row.push(row[alias] as number)
        return
      }
      row.push(off)
      off += (f.oldFormat === true ? 16 : 32) + (encoded[gi]?.[fi] as Uint8Array).length
    })
    offsets.push(row)
  })
  opts.groups.forEach((g, gi) => {
    w.u32(g.type).u32(g.frames.length).zeros(8)
    for (const f of g.frames) w.fixedString(f.name, 13)
    for (const o of offsets[gi] as number[]) w.u32(o)
  })
  opts.groups.forEach((g, gi) => {
    g.frames.forEach((f, fi) => {
      if (g.aliases?.[fi] !== undefined) return
      const data = encoded[gi]?.[fi] as Uint8Array
      if (f.oldFormat === true) {
        // Old format: size, compression, full width, full height; width/height fields larger than
        // full size signal the quirk, so write them as the first 16 bytes of pixel data instead.
        w.u32(data.length).u32(1).u32(opts.fullWidth).u32(opts.fullHeight)
      } else {
        w.u32(data.length).u32(f.compression).u32(opts.fullWidth).u32(opts.fullHeight).u32(f.width).u32(f.height).i32(f.x ?? 0).i32(f.y ?? 0)
      }
      w.bytes(data)
    })
  })
  return w.toBytes()
}
