// File kind detection by content (spec 004 FR-002, research R6): a user file given to any setting or
// dropped without a telling name goes to the slot of its kind. Work is bounded — the LOD header and
// index, or at most the first 64 KB of an inflated map — so it may run on the main thread.

import { terrainLayerDefs } from '../core/data/terrain.ts'
import { KNOWN_OTHER_VERSIONS, versionFromCode } from '../core/formats/h3m/h3m.ts'
import { readMapSummary } from '../core/formats/h3m/summary.ts'
import type { MapSummary } from '../core/formats/h3m/summary.ts'
import type { H3mVersion } from '../core/formats/h3m/types.ts'
import { LodArchive } from '../core/formats/lod/lod.ts'
import { DATA_ARCHIVE_ENTRIES } from './decode.ts'
import { BlobSource } from './file-source.ts'

export type FileKind =
  | { kind: 'spriteArchive' }
  | { kind: 'dataArchive' }
  /** HotA archive (spec 005): obfuscated index, or the HotA-only terrain tiles. */
  | { kind: 'hotaArchive' }
  | { kind: 'map'; version: H3mVersion }
  /** HotA, WoG, Chronicles or an unknown version code. */
  | { kind: 'unsupportedMap'; versionCode: number; format: string | null }
  | { kind: 'unknownArchive'; reason: string }
  | { kind: 'unknown' }

/** Upper bound of inflated bytes read to find a gzip map's version. */
export const MAP_PROBE_BYTES = 64 * 1024

/** Entries only HotA ships: the Highlands and Wasteland tile sets (research M1, M7). */
const HOTA_MARKER_ENTRIES = ['hglnt000.pcx', 'wstlt000.pcx'] as const

const isLodMagic = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x4c && b[1] === 0x4f && b[2] === 0x44 && b[3] === 0
const isGzipMagic = (b: Uint8Array): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b

/** Reads inflated bytes of a gzip blob until `need` bytes are available, then cancels the stream. */
export async function inflatePrefix(blob: Blob, need: number, limit = MAP_PROBE_BYTES): Promise<{ bytes: Uint8Array; inflated: number }> {
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < need && total < limit) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } catch {
    // A corrupt stream: whatever was inflated so far decides.
  } finally {
    reader.cancel().catch(() => undefined)
  }
  const out = new Uint8Array(Math.min(total, limit))
  let at = 0
  for (const c of chunks) {
    if (at >= out.length) break
    const part = c.subarray(0, out.length - at)
    out.set(part, at)
    at += part.length
  }
  return { bytes: out, inflated: total }
}

function mapKind(prefix: Uint8Array): FileKind {
  if (prefix.byteLength < 4) return { kind: 'unknown' }
  const code = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0, true)
  const version = versionFromCode(code)
  if (version !== undefined) return { kind: 'map', version }
  const known = KNOWN_OTHER_VERSIONS[code]
  if (known !== undefined) return { kind: 'unsupportedMap', versionCode: code, format: known }
  return { kind: 'unknown' }
}

export async function classifyFile(blob: Blob, name = 'file'): Promise<FileKind> {
  if (blob.size < 4) return { kind: 'unknown' }
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  if (isLodMagic(head)) {
    let lod: LodArchive
    try {
      lod = await LodArchive.open(new BlobSource(blob, name))
    } catch (err) {
      return { kind: 'unknownArchive', reason: err instanceof Error ? err.message : String(err) }
    }
    // Checked first: a HotA archive holds some data tables and some sprites, but neither set in
    // full (it has no artraits.txt and only four terrain DEFs), so the role checks below miss it.
    if (lod.kind === 'obfuscated' || HOTA_MARKER_ENTRIES.every((e) => lod.has(e))) return { kind: 'hotaArchive' }
    if (DATA_ARCHIVE_ENTRIES.every((e) => lod.has(e))) return { kind: 'dataArchive' }
    if (terrainLayerDefs().every((d) => lod.has(d))) return { kind: 'spriteArchive' }
    return { kind: 'unknownArchive', reason: 'the archive has neither map sprites nor the data tables' }
  }
  if (isGzipMagic(head)) return mapKind((await inflatePrefix(blob, 4)).bytes)
  const raw = mapKind(head)
  // An uncompressed map must at least look like one; random bytes stay unknown.
  return raw.kind === 'map' ? raw : { kind: 'unknown' }
}

/**
 * The map's summary (spec 007 research R4) from at most MAP_PROBE_BYTES of inflated data, so a map
 * folder can be filtered without parsing whole maps. Throws the reader's FormatError.
 */
export async function summarizeMapFile(blob: Blob, name = 'map'): Promise<MapSummary> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  const bytes = isGzipMagic(head) ? (await inflatePrefix(blob, MAP_PROBE_BYTES)).bytes : new Uint8Array(await blob.slice(0, MAP_PROBE_BYTES).arrayBuffer())
  return readMapSummary(bytes, name)
}
