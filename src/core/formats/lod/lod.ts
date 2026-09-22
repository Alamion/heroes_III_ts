// LOD archive reader (research.md §4). Reads the index once, entries by range on demand.

import { ByteReader } from '../../util/byte-reader.ts'
import type { ByteSource } from '../../util/byte-source.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { inflate } from '../../util/inflate.ts'
import { hashDisplayName, lodNameHash, parseHashDisplayName } from './name-hash.ts'

export interface LodEntry {
  /** Name as stored (original casing); `#<hex hash>` when the index stores hashes only. */
  name: string
  /** FNV-1a-32 of the lower-cased name: read from an obfuscated index, computed for a plain one. */
  nameHash: number
  offset: number
  /** Uncompressed size. */
  size: number
  /** Stored (zlib) size; 0 when the entry is stored uncompressed. */
  compressedSize: number
  /** Plain index: the stored file-type field. Obfuscated index: the compression type (0/1/2/3). */
  type: number
}

export type LodIndexKind = 'plain' | 'obfuscated'

export const LOD_HEADER_SIZE = 92
export const LOD_ENTRY_SIZE = 32
const MAX_ENTRIES = 100_000
/**
 * The u32 at header offset 12 is the XOR key of an obfuscated HotA 1.8+ index. Two values mean
 * "plain": 0, and 0x7E0213, which is uninitialised filler left there by the original game in
 * h3sprite.lod, sprite.lod and lsprite.lod. (Measured across 16 local archives, research M2. The
 * old check compared only the low byte against one build's key and never fired on the real 1.8.1
 * archive, which then died with a misleading TRUNCATED error.)
 */
const PLAIN_INDEX_KEYS = new Set<number>([0, 0x7e0213])

/** Compression types of an obfuscated index. Only 0 and 3 occur in HotA 1.8.1 (research M1). */
const COMPRESSION_RAW = 0
const COMPRESSION_ZLIB = 3
const COMPRESSION_NAMES: Record<number, string> = { 1: 'unknown type 1', 2: 'LZMA' }

export class LodArchive {
  readonly source: ByteSource
  readonly version: number
  readonly kind: LodIndexKind
  readonly entries: readonly LodEntry[]
  readonly warnings: readonly string[]
  private readonly byHash: ReadonlyMap<number, LodEntry>
  /** Raw header + index bytes (used for source identity). */
  readonly indexBytes: Uint8Array

  private constructor(
    source: ByteSource,
    version: number,
    kind: LodIndexKind,
    entries: LodEntry[],
    warnings: string[],
    indexBytes: Uint8Array,
  ) {
    this.source = source
    this.version = version
    this.kind = kind
    this.entries = entries
    this.warnings = warnings
    this.indexBytes = indexBytes
    // Hashing the wanted name is what makes an obfuscated archive addressable without a name
    // dictionary; for a plain archive the hash of the stored name is the same key.
    const map = new Map<number, LodEntry>()
    for (const e of entries) if (!map.has(e.nameHash)) map.set(e.nameHash, e)
    this.byHash = map
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
    const xorKey = r.scope('header.xorKey', () => r.u32())
    const kind: LodIndexKind = PLAIN_INDEX_KEYS.has(xorKey) ? 'plain' : 'obfuscated'
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
      const entry =
        kind === 'plain'
          ? tr.scope(`entries[${i}]`, () => {
              const name = tr.fixedString(16)
              const offset = tr.u32()
              const size = tr.u32()
              const type = tr.u32()
              const compressedSize = tr.u32()
              return { name, nameHash: lodNameHash(name), offset, size, compressedSize, type }
            })
          : tr.scope(`entries[${i}]`, () => {
              // Obfuscated index: the name is a hash, and offset/size/compressedSize are XORed
              // with the archive key. The compression byte is stored in the clear.
              const nameHash = tr.u32()
              const offset = (tr.u32() ^ xorKey) | 0
              const size = (tr.u32() ^ xorKey) | 0
              const compressedSize = (tr.u32() ^ xorKey) | 0
              const type = tr.u8()
              tr.skipKnown(15, 'entry filler')
              return { name: hashDisplayName(nameHash), nameHash, offset, size, compressedSize, type }
            })
      if (kind === 'obfuscated') {
        // A wrong key is indistinguishable from corruption, so every field is checked before use.
        const where = `entries[${i}] (${entry.name})`
        if (entry.offset < 0 || entry.size < 0 || entry.compressedSize < 0) {
          fail(FORMAT_ERROR_CODES.INVALID_VALUE, at, where, `negative field after de-obfuscation with key 0x${xorKey.toString(16)}: offset ${entry.offset}, size ${entry.size}, compressed ${entry.compressedSize}`)
        }
        if ((entry.compressedSize === 0) !== (entry.type === COMPRESSION_RAW)) {
          fail(FORMAT_ERROR_CODES.INVALID_VALUE, at, where, `compression type ${entry.type} disagrees with compressed size ${entry.compressedSize}`)
        }
        if (entry.type > COMPRESSION_ZLIB) {
          fail(FORMAT_ERROR_CODES.INVALID_VALUE, at, where, `unknown compression type ${entry.type}`)
        }
      }
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
    return new LodArchive(source, version, kind, entries, warnings, indexBytes)
  }

  /** Looks an entry up by name, or by the `#<hex>` form of its hash. */
  find(name: string): LodEntry | undefined {
    return this.byHash.get(parseHashDisplayName(name) ?? lodNameHash(name))
  }

  has(name: string): boolean {
    return this.find(name) !== undefined
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
    if (this.kind === 'obfuscated' && entry.type !== COMPRESSION_RAW && entry.type !== COMPRESSION_ZLIB) {
      // Not present in HotA 1.8.1 (research M1); reported per entry so the rest stays readable.
      throw new FormatError({
        code: FORMAT_ERROR_CODES.UNSUPPORTED_VERSION,
        file: this.source.name,
        offset: entry.offset,
        format: 'lod',
        structure: `entry "${entry.name}"`,
        message: `compression type ${entry.type} (${COMPRESSION_NAMES[entry.type] ?? 'unknown'}) is not supported`,
      })
    }
    if (entry.compressedSize === 0) {
      return this.source.read(entry.offset, entry.size)
    }
    const stored = await this.source.read(entry.offset, entry.compressedSize)
    return inflate(stored, 'deflate', { file: this.source.name, format: 'lod', offset: entry.offset, structure: `entry "${entry.name}"` }, entry.size)
  }
}
