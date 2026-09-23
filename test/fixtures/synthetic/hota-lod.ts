// Synthetic HotA 1.8 LOD archive writer (no game content).
//
// The obfuscated index keeps the vanilla 92-byte header and 32-byte entries, but stores a u32 XOR
// key at header offset 12, replaces the name with a u32 FNV-1a hash and XORs offset/size/
// compressed size (specs/005-hota-support/contracts/archives.md).

import { lodNameHash } from '../../../src/core/formats/lod/name-hash.ts'
import { ByteWriter, zlib } from './writer.ts'

/** Compression types of an obfuscated index: 0 raw, 1 unknown, 2 LZMA, 3 zlib. */
export const HOTA_COMPRESSION = { raw: 0, unknown: 1, lzma: 2, zlib: 3 } as const

export interface SyntheticHotaEntry {
  name: string
  data: Uint8Array
  /** Defaults to zlib when the entry has data, raw when empty. */
  compression?: number
}

export interface SyntheticHotaLodOptions {
  version?: number
  /** Index XOR key. 0 and 0x7E0213 mean "plain archive", so a fixture key must avoid them. */
  key?: number
  /** Fills the 15 bytes after the compression byte, as the real archive does. */
  filler?: number
}

export function writeHotaLod(entries: SyntheticHotaEntry[], opts: SyntheticHotaLodOptions = {}): Uint8Array {
  const key = opts.key ?? 0xb5a4d744
  const filler = opts.filler ?? 0xa5
  const stored = entries.map((e) => {
    const compression = e.compression ?? (e.data.length === 0 ? HOTA_COMPRESSION.raw : HOTA_COMPRESSION.zlib)
    const payload = compression === HOTA_COMPRESSION.raw ? e.data : zlib(e.data)
    return { compression, payload }
  })

  const header = new ByteWriter()
    .bytes([0x4c, 0x4f, 0x44, 0x00])
    .u32(opts.version ?? 200)
    .u32(entries.length)
    .u32(key)
  header.zeros(92 - header.length)

  const w = new ByteWriter().bytes(header.toBytes())
  let offset = 92 + entries.length * 32
  entries.forEach((e, i) => {
    const s = stored[i] as { compression: number; payload: Uint8Array }
    const compressedSize = s.compression === HOTA_COMPRESSION.raw ? 0 : s.payload.length
    w.u32(lodNameHash(e.name))
      .u32((offset ^ key) >>> 0)
      .u32((e.data.length ^ key) >>> 0)
      .u32((compressedSize ^ key) >>> 0)
      .u8(s.compression)
    for (let f = 0; f < 15; f++) w.u8(filler)
    offset += s.payload.length
  })
  for (const s of stored) w.bytes(s.payload)
  return w.toBytes()
}
