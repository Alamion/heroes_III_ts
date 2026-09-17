// Synthetic inputs that adapters must reject with a clear message (spec 004 edge cases): maps of
// unsupported versions, a truncated gzip map, archives of neither kind, random and empty files.

import { gzip } from './writer.ts'
import { writeLod } from './lod.ts'
import { syntheticTerrainMap } from './terrain-archive.ts'

/** A gzip map whose first four inflated bytes are `versionCode` (the rest is a SoD body). */
export function mapWithVersion(versionCode: number): Uint8Array {
  const body = new Uint8Array(64)
  new DataView(body.buffer).setUint32(0, versionCode, true)
  return gzip(body)
}

export interface BadFiles {
  hotaMap: Uint8Array
  wogMap: Uint8Array
  truncatedMap: Uint8Array
  plainArchive: Uint8Array
  randomBytes: Uint8Array
  empty: Uint8Array
}

export function badFiles(): BadFiles {
  const good = syntheticTerrainMap(36, false, false)
  const randomBytes = new Uint8Array(4096)
  let s = 12345
  for (let i = 0; i < randomBytes.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    randomBytes[i] = s >>> 24
  }
  // Never starts with LOD magic or gzip magic.
  randomBytes[0] = 0x42
  return {
    hotaMap: mapWithVersion(0x20),
    wogMap: mapWithVersion(0x33),
    truncatedMap: good.slice(0, Math.floor(good.length / 3)),
    plainArchive: writeLod([{ name: 'readme.txt', data: new TextEncoder().encode('not a game archive') }]),
    randomBytes,
    empty: new Uint8Array(0),
  }
}
