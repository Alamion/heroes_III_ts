// Synthetic HotA archive for the host simulations (spec 008, no game content): an obfuscated index
// with the Highlands and Wasteland tile sets stored as LZMA and zlib entries in turn — what HotA
// builds other than 1.8.1 ship — plus the entries a newer archive may hold that this reader cannot
// use: an unknown compression type and a damaged copy of a base-game sprite.

import { HOTA_TERRAINS, terrainTileName } from '../../../src/core/data/terrain.ts'
import { HOTA_COMPRESSION, writeHotaLod } from './hota-lod.ts'
import type { SyntheticHotaEntry } from './hota-lod.ts'
import { writePcxIndexed } from './pcx.ts'

/** Entries of the archive that are expected to be skipped or replaced, by name. */
export const SYNTHETIC_HOTA_BAD_ENTRIES = { unknownType: 'avwnewer.def', damaged: 'watrtl.def' } as const

function tile(seed: number): Uint8Array {
  const px = new Uint8Array(32 * 32)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px[y * 32 + x] = 16 + ((x * 3 + y * 5 + seed * 7) % 200)
  const palette = new Uint8Array(768)
  for (let i = 0; i < 256; i++) {
    palette[i * 3] = (i * 5 + seed * 11) & 0xff
    palette[i * 3 + 1] = (i * 3 + seed * 17) & 0xff
    palette[i * 3 + 2] = (i * 7 + seed * 5) & 0xff
  }
  return writePcxIndexed(32, 32, px, palette)
}

export function syntheticHotaArchive(): Uint8Array {
  const entries: SyntheticHotaEntry[] = []
  let n = 0
  for (const terrain of HOTA_TERRAINS) {
    for (let i = 0; i < terrain.count; i++) {
      entries.push({ name: terrainTileName(terrain.prefix, i), data: tile(n), compression: n % 2 === 0 ? HOTA_COMPRESSION.lzma : HOTA_COMPRESSION.zlib })
      n++
    }
  }
  entries.push({ name: SYNTHETIC_HOTA_BAD_ENTRIES.unknownType, data: new TextEncoder().encode('from a newer HotA'), compression: 9 })
  // HotA overrides this base sprite; a copy it cannot decode falls back to the base archive's.
  entries.push({ name: SYNTHETIC_HOTA_BAD_ENTRIES.damaged, data: new Uint8Array(4096).fill(7), compression: HOTA_COMPRESSION.lzma, corrupt: true })
  return writeHotaLod(entries)
}
