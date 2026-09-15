// LOD archive reader (research.md §4). Reads the index once, entries by range on demand.

import { ByteReader } from '../../util/byte-reader.ts'
import type { ByteSource } from '../../util/byte-source.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { inflate } from '../../util/inflate.ts'

export interface LodEntry {
  /** Name as stored (original casing). */
  name: string
  offset: number
  /** Uncompressed size. */
  size: number
  /** Stored (zlib) size; 0 when the entry is stored uncompressed. */
  compressedSize: number
  type: number
}

export const LOD_HEADER_SIZE = 92
export const LOD_ENTRY_SIZE = 32
const MAX_ENTRIES = 100_000
/** Byte 12 of HotA 1.8+ archives (encrypted index). */
const HOTA18_MARKER = 135

export class LodArchive {
  readonly source: ByteSource
  readonly version: number
  readonly entries: readonly LodEntry[]
  readonly warnings: readonly string[]
  private readonly byName: ReadonlyMap<string, LodEntry>
  /** Raw header + index bytes (used for source identity). */
  readonly indexBytes: Uint8Array

  private constructor(source: ByteSource, version: number, entries: LodEntry[], warnings: string[], indexBytes: Uint8Array) {
    this.source = source
    this.version = version
    this.entries = entries
    this.warnings = warnings
    this.indexBytes = indexBytes
    const map = new Map<string, LodEntry>()
    for (const e of entries) {
      const key = e.name.toLowerCase()
      if (!map.has(key)) map.set(key, e)
    }
    this.byName = map
  }

  static async open(source: ByteSource): Promise<LodArchive> {
    const fail = (code: (typeof FORMAT_ERROR_CODES)[keyof typeof FORMAT_ERROR_CODES], offset: number, structure: string, message: string): never => {
      throw new FormatError({ code, file: source.name, offset, format: 'lod', structure, message })
    }
    if (source.size < LOD_HEADER_SIZE) fail(FORMAT_ERROR_CODES.TRUNCATED, 0, 'header', `file is ${source.size} bytes, header needs ${LOD_HEADER_SIZE}`)
    const header = await source.read(0, LOD_HEADER_SIZE)
    const r = new ByteReader(header, { file: source.name, format: 'lod' })
    const magic = r.scope('header.magic', () => r.bytesView(4))
    if (magic[0] !== 0x4c || magic[1] !== 0x4f || magic[2] !== 0x44 || magic[3] !== 0x00) {
      fail(FORMAT_ERROR_CODES.BAD_MAGIC, 0, 'header.magic', 'not a LOD archive (expected "LOD\\0")')
    }
    const version = r.scope('header.version', () => r.u32())
    const count = r.scope('header.count', () => r.u32())
    if (header[12] === HOTA18_MARKER) {
      fail(FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, 12, 'header', 'HotA 1.8+ archive with encrypted index is not supported yet')
    }
    if (count > MAX_ENTRIES) fail(FORMAT_ERROR_CODES.INVALID_VALUE, 8, 'header.count', `entry count ${count} exceeds ${MAX_ENTRIES}`)
    const tableEnd = LOD_HEADER_SIZE + count * LOD_ENTRY_SIZE
    if (tableEnd > source.size) fail(FORMAT_ERROR_CODES.TRUNCATED, LOD_HEADER_SIZE, 'entries', `index of ${count} entries ends at ${tableEnd}, file is ${source.size} bytes`)

    const table = await source.read(LOD_HEADER_SIZE, count * LOD_ENTRY_SIZE)
    const tr = new ByteReader(table, { file: source.name, format: 'lod', version: String(version) })
    const entries: LodEntry[] = []
    const warnings: string[] = []
    const seen = new Set<string>()
    for (let i = 0; i < count; i++) {
      const at = LOD_HEADER_SIZE + i * LOD_ENTRY_SIZE
      const entry = tr.scope(`entries[${i}]`, () => {
        const name = tr.fixedString(16)
        const offset = tr.u32()
        const size = tr.u32()
        const type = tr.u32()
        const compressedSize = tr.u32()
        return { name, offset, size, compressedSize, type }
      })
      const stored = entry.compressedSize === 0 ? entry.size : entry.compressedSize
      if (entry.name.length === 0) {
        fail(FORMAT_ERROR_CODES.INVALID_VALUE, at, `entries[${i}].name`, 'empty entry name')
      }
      if (entry.offset + stored > source.size) {
        fail(FORMAT_ERROR_CODES.TRUNCATED, at, `entries[${i}]`, `entry "${entry.name}" data ${entry.offset}+${stored} beyond end of file (${source.size})`)
      }
      const key = entry.name.toLowerCase()
      if (seen.has(key)) warnings.push(`duplicate entry name "${entry.name}" at index ${i}; the first one is used`)
      seen.add(key)
      entries.push(entry)
    }
    const indexBytes = new Uint8Array(header.length + table.length)
    indexBytes.set(header, 0)
    indexBytes.set(table, header.length)
    return new LodArchive(source, version, entries, warnings, indexBytes)
  }

  find(name: string): LodEntry | undefined {
    return this.byName.get(name.toLowerCase())
  }

  has(name: string): boolean {
    return this.byName.has(name.toLowerCase())
  }

  get(name: string): LodEntry {
    const e = this.find(name)
    if (e === undefined) {
      throw new FormatError({
        code: FORMAT_ERROR_CODES.NOT_FOUND,
        file: this.source.name,
        offset: LOD_HEADER_SIZE,
        format: 'lod',
        structure: 'entries',
        message: `no entry named "${name}"`,
      })
    }
    return e
  }

  /** Returns the entry's uncompressed bytes (byte-exact). */
  async read(nameOrEntry: string | LodEntry): Promise<Uint8Array> {
    const entry = typeof nameOrEntry === 'string' ? this.get(nameOrEntry) : nameOrEntry
    if (entry.compressedSize === 0) {
      return this.source.read(entry.offset, entry.size)
    }
    const stored = await this.source.read(entry.offset, entry.compressedSize)
    return inflate(stored, 'deflate', { file: this.source.name, format: 'lod', offset: entry.offset, structure: `entry "${entry.name}"` }, entry.size)
  }
}
