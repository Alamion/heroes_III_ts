// ZIP reader (spec 007 research R3): the central directory, and stored or deflated members read on
// demand, so a large archive is never inflated whole. Layout: PKWARE APPNOTE 6.3 (sections 4.3.7,
// 4.3.12, 4.3.16). ZIP64, encryption and methods other than store/deflate are explicit errors.

import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import type { FormatErrorCode } from '../../util/errors.ts'
import { inflate } from '../../util/inflate.ts'
import type { ByteSource } from '../../util/byte-source.ts'
import { textDecoder } from '../../util/web-globals.ts'

const EOCD_SIG = 0x06054b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff
/** Info-ZIP Unicode Path extra field: a UTF-8 name next to a legacy-encoded one. */
const UNICODE_PATH_EXTRA = 0x7075

export interface ZipEntry {
  /** Member path, `/`-separated; directories end with `/`. */
  readonly path: string
  readonly method: number
  readonly encrypted: boolean
  readonly compressedSize: number
  readonly size: number
  /** Offset of the local header. */
  readonly offset: number
  readonly isDirectory: boolean
}

function fail(file: string, code: FormatErrorCode, offset: number, structure: string, message: string): never {
  throw new FormatError({ code, file, offset, format: 'zip', structure, message })
}

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8)
const u32 = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0

function isAscii(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b >= 0x80) return false
  return true
}

/**
 * Names without the UTF-8 flag use the OEM code page of the machine that made the archive. Windows'
 * own "Compressed folder" writes Cyrillic names in CP866 on Russian systems, the audience that meets
 * non-ASCII names here, so CP866 is the guess for them.
 */
function decodeName(bytes: Uint8Array, utf8: boolean, extra: Uint8Array): string {
  for (let at = 0; at + 4 <= extra.length; ) {
    const id = u16(extra, at)
    const len = u16(extra, at + 2)
    if (id === UNICODE_PATH_EXTRA && len >= 5 && at + 4 + len <= extra.length) return textDecoder('utf-8').decode(extra.subarray(at + 9, at + 4 + len))
    at += 4 + len
  }
  if (utf8 || isAscii(bytes)) return textDecoder('utf-8').decode(bytes)
  return textDecoder('ibm866').decode(bytes)
}

export class ZipArchive {
  readonly name: string
  private readonly source: ByteSource
  private readonly list: ZipEntry[]

  private constructor(source: ByteSource, name: string, list: ZipEntry[]) {
    this.source = source
    this.name = name
    this.list = list
  }

  static async open(source: ByteSource, name = source.name): Promise<ZipArchive> {
    if (source.size < EOCD_SIZE) fail(name, FORMAT_ERROR_CODES.BAD_MAGIC, 0, 'end of central directory', `${source.size} bytes is too small for a ZIP archive`)
    const tailLength = Math.min(source.size, EOCD_SIZE + MAX_COMMENT)
    const tailStart = source.size - tailLength
    const tail = await source.read(tailStart, tailLength)
    let eocd = -1
    for (let at = tail.length - EOCD_SIZE; at >= 0; at--) {
      if (u32(tail, at) === EOCD_SIG && at + EOCD_SIZE + u16(tail, at + 20) === tail.length) {
        eocd = at
        break
      }
    }
    if (eocd < 0) fail(name, FORMAT_ERROR_CODES.BAD_MAGIC, source.size, 'end of central directory', 'no end-of-central-directory record: not a ZIP archive')
    const at = tailStart + eocd
    const count = u16(tail, eocd + 10)
    const cdSize = u32(tail, eocd + 12)
    const cdOffset = u32(tail, eocd + 16)
    const zip64 = (eocd >= 20 && u32(tail, eocd - 20) === ZIP64_LOCATOR_SIG) || count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff
    if (zip64) fail(name, FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, at, 'end of central directory', 'ZIP64 archives are not supported')
    if (u16(tail, eocd + 4) !== 0 || u16(tail, eocd + 6) !== 0) fail(name, FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, at, 'end of central directory', 'multi-part archives are not supported')
    if (cdOffset + cdSize > at) fail(name, FORMAT_ERROR_CODES.TRUNCATED, at, 'central directory', `central directory ${cdOffset}+${cdSize} runs past its end record at ${at}`)
    const cd = await source.read(cdOffset, cdSize)
    const list: ZipEntry[] = []
    let p = 0
    for (let i = 0; i < count; i++) {
      const where = cdOffset + p
      if (p + 46 > cd.length) fail(name, FORMAT_ERROR_CODES.TRUNCATED, where, `central directory entry ${i}`, 'entry runs past the central directory')
      if (u32(cd, p) !== CENTRAL_SIG) fail(name, FORMAT_ERROR_CODES.BAD_MAGIC, where, `central directory entry ${i}`, 'bad central directory signature')
      const flags = u16(cd, p + 8)
      const nameLen = u16(cd, p + 28)
      const extraLen = u16(cd, p + 30)
      const commentLen = u16(cd, p + 32)
      const end = p + 46 + nameLen + extraLen + commentLen
      if (end > cd.length) fail(name, FORMAT_ERROR_CODES.TRUNCATED, where, `central directory entry ${i}`, 'entry name or extra field runs past the central directory')
      const path = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x0800) !== 0, cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)).replace(/\\/g, '/')
      const compressedSize = u32(cd, p + 20)
      const size = u32(cd, p + 24)
      const offset = u32(cd, p + 42)
      if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) fail(name, FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, where, `central directory entry ${i}`, 'ZIP64 members are not supported')
      list.push({ path, method: u16(cd, p + 10), encrypted: (flags & 1) !== 0, compressedSize, size, offset, isDirectory: path.endsWith('/') })
      p = end
    }
    return new ZipArchive(source, name, list)
  }

  entries(): readonly ZipEntry[] {
    return this.list
  }

  async read(entry: ZipEntry): Promise<Uint8Array> {
    const structure = `member ${entry.path}`
    if (entry.encrypted) fail(this.name, FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, entry.offset, structure, 'encrypted members are not supported')
    if (entry.method !== 0 && entry.method !== 8) fail(this.name, FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, entry.offset, structure, `compression method ${entry.method} is not supported (only store and deflate)`)
    if (entry.offset + 30 > this.source.size) fail(this.name, FORMAT_ERROR_CODES.TRUNCATED, entry.offset, structure, 'local header runs past the end of the archive')
    const local = await this.source.read(entry.offset, 30)
    if (u32(local, 0) !== LOCAL_SIG) fail(this.name, FORMAT_ERROR_CODES.BAD_MAGIC, entry.offset, structure, 'bad local header signature')
    const dataAt = entry.offset + 30 + u16(local, 26) + u16(local, 28)
    if (dataAt + entry.compressedSize > this.source.size) fail(this.name, FORMAT_ERROR_CODES.TRUNCATED, dataAt, structure, `member data ${dataAt}+${entry.compressedSize} runs past the end of the archive`)
    const data = await this.source.read(dataAt, entry.compressedSize)
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) fail(this.name, FORMAT_ERROR_CODES.INVALID_VALUE, entry.offset, structure, `stored member sizes differ (${entry.compressedSize} vs ${entry.size})`)
      return data
    }
    return inflate(data, 'deflate-raw', { file: this.name, format: 'zip', offset: dataAt, structure }, entry.size)
  }
}
