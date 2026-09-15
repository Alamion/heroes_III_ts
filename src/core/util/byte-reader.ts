// Bounds-checked little-endian reader (constitution VII). Every read is checked against the
// buffer; failures throw FormatError carrying the current offset and structure path.

import { FORMAT_ERROR_CODES, FormatError } from './errors.ts'
import type { FormatErrorCode, FormatName } from './errors.ts'
import { textDecoder } from './web-globals.ts'
import type { TextDecoderLike } from './web-globals.ts'

export interface H3String {
  /** Raw bytes as stored (exact). */
  bytes: Uint8Array
  /** Text decoded as windows-1251 (the encoding of the original game's maps). */
  text: string
}

let cp1251: TextDecoderLike | undefined

export function decodeCp1251(bytes: Uint8Array): string {
  cp1251 ??= textDecoder('windows-1251')
  return cp1251.decode(bytes)
}

export interface ReaderContext {
  file: string
  format: FormatName
  version?: string
}

export class ByteReader {
  readonly bytes: Uint8Array
  readonly ctx: ReaderContext
  private readonly view: DataView
  private pos: number
  private readonly path: string[] = []

  constructor(bytes: Uint8Array, ctx: ReaderContext, offset = 0) {
    this.bytes = bytes
    this.ctx = { ...ctx }
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.pos = offset
  }

  get offset(): number {
    return this.pos
  }

  get length(): number {
    return this.bytes.byteLength
  }

  get remaining(): number {
    return this.bytes.byteLength - this.pos
  }

  setVersion(version: string): void {
    this.ctx.version = version
  }

  /** Current structure path, e.g. `objects[3].body.town`. */
  get structure(): string {
    return this.path.length === 0 ? '(root)' : this.path.join('.').replace(/\.\[/g, '[')
  }

  /** Runs `fn` with `name` appended to the structure path. */
  scope<T>(name: string, fn: () => T): T {
    this.path.push(name)
    try {
      return fn()
    } finally {
      this.path.pop()
    }
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.bytes.byteLength) this.fail(FORMAT_ERROR_CODES.TRUNCATED, `seek to ${offset} outside 0..${this.bytes.byteLength}`)
    this.pos = offset
  }

  fail(code: FormatErrorCode, message: string, at: number = this.pos): never {
    throw new FormatError({
      code,
      file: this.ctx.file,
      offset: at,
      format: this.ctx.format,
      structure: this.structure,
      message,
      ...(this.ctx.version !== undefined ? { version: this.ctx.version } : {}),
    })
  }

  invalid(message: string, at?: number): never {
    return this.fail(FORMAT_ERROR_CODES.INVALID_VALUE, message, at)
  }

  private need(n: number, what: string): void {
    if (n < 0 || this.pos + n > this.bytes.byteLength) {
      this.fail(FORMAT_ERROR_CODES.TRUNCATED, `need ${n} byte(s) for ${what}, ${this.remaining} left`)
    }
  }

  u8(): number {
    this.need(1, 'u8')
    return this.bytes[this.pos++] as number
  }

  i8(): number {
    this.need(1, 'i8')
    return this.view.getInt8(this.pos++)
  }

  u16(): number {
    this.need(2, 'u16')
    const v = this.view.getUint16(this.pos, true)
    this.pos += 2
    return v
  }

  u32(): number {
    this.need(4, 'u32')
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }

  i32(): number {
    this.need(4, 'i32')
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }

  /** A boolean byte; the game writes 0 or 1, other values are rejected rather than guessed. */
  bool(): boolean {
    const at = this.pos
    const v = this.u8()
    if (v > 1) this.invalid(`boolean byte is ${v}`, at)
    return v === 1
  }

  /** A byte where any non-zero value means true (fields the game treats as flags). */
  flag(): boolean {
    return this.u8() !== 0
  }

  bytesView(n: number): Uint8Array {
    this.need(n, `${n} bytes`)
    const out = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  bytesCopy(n: number): Uint8Array {
    return this.bytesView(n).slice()
  }

  /** Skips a documented fixed-size field (never used for variable-length data). */
  skipKnown(n: number, what: string): void {
    this.need(n, what)
    this.pos += n
  }

  /** Skips a field that must be all zero bytes. */
  zeros(n: number, what: string): void {
    const at = this.pos
    const b = this.bytesView(n)
    for (let i = 0; i < n; i++) {
      if (b[i] !== 0) this.invalid(`${what}: expected zero byte at +${i}, got ${b[i]}`, at + i)
    }
  }

  /** u32 length-prefixed string. `maxLength` guards against misaligned reads. */
  string(maxLength = 100_000): H3String {
    const at = this.pos
    const len = this.u32()
    if (len > maxLength) this.invalid(`string length ${len} exceeds ${maxLength}`, at)
    const bytes = this.bytesCopy(len)
    return { bytes, text: decodeCp1251(bytes) }
  }

  /** Fixed-size NUL-padded field; text ends at the first NUL. */
  fixedString(n: number): string {
    const b = this.bytesView(n)
    let end = b.indexOf(0)
    if (end < 0) end = n
    return decodeCp1251(b.subarray(0, end))
  }

  expectEnd(): void {
    if (this.remaining !== 0) this.fail(FORMAT_ERROR_CODES.TRAILING_DATA, `${this.remaining} unread byte(s) after end of data`)
  }
}
