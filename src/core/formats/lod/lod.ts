// LOD archive reader (research.md §4). Reads the index once, entries by range on demand.

import { ByteReader } from '../../util/byte-reader.ts'
import type { ByteSource } from '../../util/byte-source.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { inflate } from '../../util/inflate.ts'
import { HOTA_LZMA_PROPERTIES, lzmaDecodeRaw } from '../../util/lzma.ts'
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

/**
 * Compression types of an obfuscated index. HotA 1.8.1 uses only 0 and 3 (005 research M1); other
 * builds (1.8.0 in a user's report) also store 2, raw LZMA1 (spec 008 research R1).
 */
const COMPRESSION_RAW = 0
const COMPRESSION_LZMA = 2
const COMPRESSION_ZLIB = 3
const COMPRESSION_NAMES: Record<number, string> = { 1: 'unknown type 1' }
/** An LZMA entry: a 0 byte, the stream, then two i64 (size, stored size + 5) — hota-lod-convert. */
const LZMA_FOOTER = 16

/**
 * One entry of an unknown compression type or with data past the end of the file does not make the
 * archive unreadable (spec 008 FR-010): it is left out with a warning, so a name it held falls
 * through to the next archive of a set. Only when most entries are bad is the archive itself wrong
 * (a cut file), and opening fails.
 */
const maxBadEntries = (count: number): number => Math.floor(count / 2)

/** An index entry left out of lookups, with the reason (spec 008). */
export interface UnreadableEntry {
  entry: LodEntry
  error: FormatError
}

export class LodArchive {
  readonly source: ByteSource
  readonly version: number
  readonly kind: LodIndexKind
  readonly entries: readonly LodEntry[]
  readonly warnings: readonly string[]
  /** Index entries that cannot be read; lookups do not see them (spec 008). */
  readonly unreadable: readonly UnreadableEntry[]
  private readonly byHash: ReadonlyMap<number, LodEntry>
  /** Raw header + index bytes (used for source identity). */
  readonly indexBytes: Uint8Array

  private constructor(
    source: ByteSource,
    version: number,
    kind: LodIndexKind,
    entries: LodEntry[],
    warnings: string[],
    unreadable: UnreadableEntry[],
    indexBytes: Uint8Array,
  ) {
    this.source = source
    this.version = version
    this.kind = kind
    this.entries = entries
    this.warnings = warnings
    this.unreadable = unreadable
    this.indexBytes = indexBytes
    // Hashing the wanted name is what makes an obfuscated archive addressable without a name
    // dictionary; for a plain archive the hash of the stored name is the same key.
    const map = new Map<number, LodEntry>()
    const bad = new Set(unreadable.map((u) => u.entry))
    for (const e of entries) if (!bad.has(e) && !map.has(e.nameHash)) map.set(e.nameHash, e)
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
    const unreadable: UnreadableEntry[] = []
    const seen = new Set<string>()
    const entryError = (code: (typeof FORMAT_ERROR_CODES)[keyof typeof FORMAT_ERROR_CODES], at: number, structure: string, message: string): FormatError =>
      new FormatError({ code, file: source.name, offset: at, format: 'lod', structure, message, version: String(version) })
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
      let problem: FormatError | undefined
      const where = `entries[${i}] (${entry.name})`
      if (kind === 'obfuscated') {
        // A wrong key is indistinguishable from corruption, so every field is checked before use.
        // These two never hold in a correctly keyed archive (hota-lod-convert asserts them as well),
        // so they fail the archive at once: that is how a wrong key is caught.
        if (entry.offset < 0 || entry.size < 0 || entry.compressedSize < 0) {
          throw entryError(FORMAT_ERROR_CODES.INVALID_VALUE, at, where, `negative field after de-obfuscation with key 0x${xorKey.toString(16)}: offset ${entry.offset}, size ${entry.size}, compressed ${entry.compressedSize}`)
        }
        if ((entry.compressedSize === 0) !== (entry.type === COMPRESSION_RAW)) {
          throw entryError(FORMAT_ERROR_CODES.INVALID_VALUE, at, where, `compression type ${entry.type} disagrees with compressed size ${entry.compressedSize}`)
        }
        // A compression type this reader does not know may come with a newer HotA: left out.
        if (entry.type > COMPRESSION_ZLIB) {
          problem = entryError(FORMAT_ERROR_CODES.INVALID_VALUE, at, where, `unknown compression type ${entry.type}`)
        }
      }
      const stored = entry.compressedSize === 0 ? entry.size : entry.compressedSize
      if (problem === undefined && entry.name.length === 0) {
        problem = entryError(FORMAT_ERROR_CODES.INVALID_VALUE, at, `entries[${i}].name`, 'empty entry name')
      }
      if (problem === undefined && entry.offset + stored > source.size) {
        problem = entryError(FORMAT_ERROR_CODES.TRUNCATED, at, `entries[${i}]`, `entry "${entry.name}" data ${entry.offset}+${stored} beyond end of file (${source.size})`)
      }
      if (problem !== undefined) {
        unreadable.push({ entry, error: problem })
        if (unreadable.length > maxBadEntries(count)) throw unreadable[0]?.error ?? problem
        warnings.push(`entry ${where} is left out: ${problem.detail}`)
      } else {
        const key = entry.name.toLowerCase()
        if (seen.has(key)) warnings.push(`duplicate entry name "${entry.name}" at index ${i}; the first one is used`)
        seen.add(key)
      }
      entries.push(entry)
    }
    const indexBytes = new Uint8Array(header.length + table.length)
    indexBytes.set(header, 0)
    indexBytes.set(table, header.length)
    return new LodArchive(source, version, kind, entries, warnings, unreadable, indexBytes)
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
    const ctx = { file: this.source.name, format: 'lod' as const, offset: entry.offset, structure: `entry "${entry.name}"`, version: String(this.version) }
    const fail = (message: string, code: (typeof FORMAT_ERROR_CODES)[keyof typeof FORMAT_ERROR_CODES] = FORMAT_ERROR_CODES.DECOMPRESS_FAILED): never => {
      throw new FormatError({ code, ...ctx, message })
    }
    if (this.kind === 'obfuscated' && entry.type !== COMPRESSION_RAW && entry.type !== COMPRESSION_ZLIB && entry.type !== COMPRESSION_LZMA) {
      // Reported per entry so the rest stays readable.
      fail(`compression type ${entry.type} (${COMPRESSION_NAMES[entry.type] ?? 'unknown'}) is not supported`, FORMAT_ERROR_CODES.UNSUPPORTED_VERSION)
    }
    if (entry.compressedSize === 0) {
      return this.source.read(entry.offset, entry.size)
    }
    const stored = await this.source.read(entry.offset, entry.compressedSize)
    if (this.kind === 'obfuscated' && entry.type === COMPRESSION_LZMA) {
      if (stored.length < 1 + 5 + LZMA_FOOTER) fail(`LZMA entry of ${stored.length} bytes is shorter than its framing`)
      if (stored[0] !== 0) fail(`LZMA entry starts with byte ${stored[0]}, expected 0`)
      const footer = new DataView(stored.buffer, stored.byteOffset + stored.length - LZMA_FOOTER, LZMA_FOOTER)
      const size = footer.getBigInt64(0, true)
      const storedPlus5 = footer.getBigInt64(8, true)
      if (size !== BigInt(entry.size) || storedPlus5 !== BigInt(entry.compressedSize) + 5n) {
        fail(`LZMA footer says size ${size} and stored ${storedPlus5}, the index says ${entry.size} and ${entry.compressedSize}+5`)
      }
      return lzmaDecodeRaw(stored.subarray(1, stored.length - LZMA_FOOTER), HOTA_LZMA_PROPERTIES, entry.size, { ...ctx, offset: entry.offset + 1 })
    }
    return inflate(stored, 'deflate', ctx, entry.size)
  }
}
