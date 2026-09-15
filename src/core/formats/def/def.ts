// DEF sprite reader (research.md §4). Headers are parsed eagerly; frame pixels are decoded on
// demand into palette indices (Uint8Array), so palette animation never needs re-decoding.

import { ByteReader } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'

export interface DefFrameHeader {
  /** Offset of the frame header inside the DEF. */
  offset: number
  size: number
  compression: 0 | 1 | 2 | 3
  fullWidth: number
  fullHeight: number
  width: number
  height: number
  x: number
  y: number
  /** Offset where compressed pixel data starts. */
  dataOffset: number
}

export interface DefFrameRef {
  name: string
  /** Index in the concatenated frame list of all groups (terrain "view index" space). */
  viewIndex: number
  header: DefFrameHeader
}

export interface DefGroup {
  type: number
  frames: DefFrameRef[]
}

export interface DefSprite {
  name: string
  bytes: Uint8Array
  type: number
  fullWidth: number
  fullHeight: number
  /** 256 × RGB. */
  palette: Uint8Array
  groups: DefGroup[]
  /** All frames of all groups in file order. */
  frameOrder: DefFrameRef[]
}

export interface DefFrame extends DefFrameHeader {
  /** width × height palette indices. */
  pixels: Uint8Array
}

const MAX_GROUPS = 4096
const MAX_FRAMES = 65_536
const MAX_DIM = 4096

export function parseDef(bytes: Uint8Array, name: string): DefSprite {
  const r = new ByteReader(bytes, { file: name, format: 'def' })
  const { type, fullWidth, fullHeight, groupCount } = r.scope('header', () => ({
    type: r.u32(),
    fullWidth: r.u32(),
    fullHeight: r.u32(),
    groupCount: r.u32(),
  }))
  if (fullWidth > MAX_DIM || fullHeight > MAX_DIM) r.invalid(`sprite size ${fullWidth}x${fullHeight} exceeds ${MAX_DIM}`, 4)
  if (groupCount > MAX_GROUPS) r.invalid(`group count ${groupCount} exceeds ${MAX_GROUPS}`, 12)
  const palette = r.scope('palette', () => r.bytesCopy(768))

  const groups: DefGroup[] = []
  const frameOrder: DefFrameRef[] = []
  const headerCache = new Map<number, DefFrameHeader>()
  for (let g = 0; g < groupCount; g++) {
    r.scope(`groups[${g}]`, () => {
      const groupType = r.u32()
      const count = r.u32()
      if (count > MAX_FRAMES) r.invalid(`frame count ${count} exceeds ${MAX_FRAMES}`)
      r.skipKnown(8, 'group header unknown bytes')
      const names: string[] = []
      for (let i = 0; i < count; i++) names.push(r.scope(`names[${i}]`, () => r.fixedString(13)))
      const offsets: number[] = []
      for (let i = 0; i < count; i++) offsets.push(r.scope(`offsets[${i}]`, () => r.u32()))
      const frames: DefFrameRef[] = []
      for (let i = 0; i < count; i++) {
        const offset = offsets[i] as number
        let header = headerCache.get(offset)
        if (header === undefined) {
          header = r.scope(`frames[${i}]`, () => readFrameHeader(bytes, name, offset))
          headerCache.set(offset, header)
        }
        const ref: DefFrameRef = { name: names[i] as string, viewIndex: frameOrder.length, header }
        frames.push(ref)
        frameOrder.push(ref)
      }
      groups.push({ type: groupType, frames })
    })
  }
  return { name, bytes, type, fullWidth, fullHeight, palette, groups, frameOrder }
}

function readFrameHeader(bytes: Uint8Array, file: string, offset: number): DefFrameHeader {
  const r = new ByteReader(bytes, { file, format: 'def' }, 0)
  if (offset + 32 > bytes.length) {
    throw new FormatError({ code: FORMAT_ERROR_CODES.TRUNCATED, file, offset, format: 'def', structure: 'frame header', message: `frame header at ${offset} beyond end (${bytes.length})` })
  }
  r.seek(offset)
  return r.scope(`frame@${offset}`, () => {
    const size = r.u32()
    const compression = r.u32()
    const fullWidth = r.u32()
    const fullHeight = r.u32()
    let width = r.u32()
    let height = r.u32()
    let x = r.i32()
    let y = r.i32()
    let dataOffset = offset + 32
    if (compression > 3) r.invalid(`unknown compression ${compression}`, offset + 4)
    // Old-format quirk: compression 1 frames with width/height larger than the full size have a
    // 16-byte header (no x/y and no separate width/height).
    if (compression === 1 && width > fullWidth && height > fullHeight) {
      width = fullWidth
      height = fullHeight
      x = 0
      y = 0
      dataOffset = offset + 16
    }
    if (width > MAX_DIM || height > MAX_DIM || fullWidth > MAX_DIM || fullHeight > MAX_DIM) {
      r.invalid(`frame size ${width}x${height} (full ${fullWidth}x${fullHeight}) exceeds ${MAX_DIM}`, offset + 8)
    }
    if (x < 0 || y < 0 || x + width > fullWidth || y + height > fullHeight) {
      r.invalid(`frame rect ${x},${y} ${width}x${height} outside full size ${fullWidth}x${fullHeight}`, offset + 16)
    }
    if (dataOffset + size > bytes.length) {
      r.fail(FORMAT_ERROR_CODES.TRUNCATED, `frame data ${dataOffset}+${size} beyond end (${bytes.length})`, offset)
    }
    return { offset, size, compression: compression as 0 | 1 | 2 | 3, fullWidth, fullHeight, width, height, x, y, dataOffset }
  })
}

/** Decodes a frame's pixels into palette indices. */
export function decodeFrame(def: DefSprite, ref: DefFrameRef | DefFrameHeader): DefFrame {
  const h = 'header' in ref ? ref.header : ref
  const { bytes } = def
  const { width: w, height: hgt, dataOffset: base } = h
  const pixels = new Uint8Array(w * hgt)
  const r = new ByteReader(bytes, { file: def.name, format: 'def' })
  const structure = `frame@${h.offset}.pixels(compression ${h.compression})`
  r.scope(structure, () => {
    if (w === 0 || hgt === 0) return
    switch (h.compression) {
      case 0: {
        r.seek(base)
        pixels.set(r.bytesView(w * hgt))
        break
      }
      case 1: {
        for (let row = 0; row < hgt; row++) {
          r.seek(base + row * 4)
          const rowOffset = r.u32()
          r.seek(base + rowOffset)
          let col = 0
          while (col < w) {
            const at = r.offset
            const index = r.u8()
            const len = r.u8() + 1
            if (col + len > w) r.invalid(`row ${row}: run of ${len} at column ${col} exceeds width ${w}`, at)
            const dst = row * w + col
            if (index === 0xff) pixels.set(r.bytesView(len), dst)
            else pixels.fill(index, dst, dst + len)
            col += len
          }
        }
        break
      }
      case 2:
      case 3: {
        for (let row = 0; row < hgt; row++) {
          if (h.compression === 2) {
            if (row === 0) {
              r.seek(base)
              r.seek(base + r.u16())
            }
          } else {
            r.seek(base + row * 2 * Math.floor(w / 32))
            r.seek(base + r.u16())
          }
          let col = 0
          while (col < w) {
            const at = r.offset
            const code = r.u8()
            const index = code >> 5
            const len = (code & 0x1f) + 1
            if (col + len > w) r.invalid(`row ${row}: run of ${len} at column ${col} exceeds width ${w}`, at)
            const dst = row * w + col
            if (index === 7) pixels.set(r.bytesView(len), dst)
            else pixels.fill(index, dst, dst + len)
            col += len
          }
        }
        break
      }
    }
  })
  return { ...h, pixels }
}

/** Frame pixels placed inside the full frame (fullWidth × fullHeight), index 0 elsewhere. */
export function fullFramePixels(frame: DefFrame): Uint8Array {
  const out = new Uint8Array(frame.fullWidth * frame.fullHeight)
  for (let row = 0; row < frame.height; row++) {
    const src = row * frame.width
    out.set(frame.pixels.subarray(src, src + frame.width), (frame.y + row) * frame.fullWidth + frame.x)
  }
  return out
}
