// Synthetic PCX (LOD variant) writer.

import { ByteWriter } from './writer.ts'

export function writePcxIndexed(width: number, height: number, pixels: Uint8Array, palette: Uint8Array): Uint8Array {
  return new ByteWriter().u32(width * height).u32(width).u32(height).bytes(pixels).bytes(palette).toBytes()
}

export function writePcxBgr(width: number, height: number, bgr: Uint8Array): Uint8Array {
  return new ByteWriter().u32(width * height * 3).u32(width).u32(height).bytes(bgr).toBytes()
}
