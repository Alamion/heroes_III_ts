// Little-endian byte writer for synthetic fixtures. Synthetic files contain no game content
// (constitution I); they are built in memory or in temp dirs only.

import { deflateSync, gzipSync } from 'node:zlib'

const cp1251Encode = (text: string): Uint8Array => {
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0) as number
    if (code < 0x80) out.push(code)
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0)
    else if (code === 0x401) out.push(0xa8)
    else if (code === 0x451) out.push(0xb8)
    else throw new Error(`synthetic writer: cannot encode U+${code.toString(16)} as windows-1251`)
  }
  return Uint8Array.from(out)
}

export class ByteWriter {
  private buf = new Uint8Array(1024)
  private len = 0

  get length(): number {
    return this.len
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }

  u8(v: number): this {
    this.ensure(1)
    this.buf[this.len++] = v & 0xff
    return this
  }

  i8(v: number): this {
    return this.u8(v < 0 ? v + 256 : v)
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0)
  }

  u16(v: number): this {
    this.ensure(2)
    new DataView(this.buf.buffer).setUint16(this.len, v, true)
    this.len += 2
    return this
  }

  u32(v: number): this {
    this.ensure(4)
    new DataView(this.buf.buffer).setUint32(this.len, v >>> 0, true)
    this.len += 4
    return this
  }

  i32(v: number): this {
    this.ensure(4)
    new DataView(this.buf.buffer).setInt32(this.len, v, true)
    this.len += 4
    return this
  }

  bytes(b: ArrayLike<number>): this {
    this.ensure(b.length)
    this.buf.set(b, this.len)
    this.len += b.length
    return this
  }

  zeros(n: number): this {
    this.ensure(n)
    this.buf.fill(0, this.len, this.len + n)
    this.len += n
    return this
  }

  /** u32 length-prefixed windows-1251 string. */
  string(text: string): this {
    const b = cp1251Encode(text)
    return this.u32(b.length).bytes(b)
  }

  fixedString(text: string, n: number): this {
    const b = cp1251Encode(text)
    if (b.length > n) throw new Error(`fixed string "${text}" longer than ${n}`)
    return this.bytes(b).zeros(n - b.length)
  }

  /** Overwrites a u32 at an earlier position. */
  patchU32(at: number, v: number): this {
    new DataView(this.buf.buffer).setUint32(at, v >>> 0, true)
    return this
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

export function zlib(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(deflateSync(bytes))
}

export function gzip(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(bytes))
}
