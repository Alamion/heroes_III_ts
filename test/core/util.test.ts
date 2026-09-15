import { describe, expect, it } from 'vitest'
import { ByteReader } from '../../src/core/util/byte-reader.ts'
import { FormatError } from '../../src/core/util/errors.ts'
import { inflate, isGzip } from '../../src/core/util/inflate.ts'
import { createRng, hashInts } from '../../src/core/util/rng.ts'
import { ManualClock } from '../../src/core/util/clock.ts'
import { MemorySource } from '../../src/core/util/byte-source.ts'
import { ByteWriter, gzip, zlib } from '../fixtures/synthetic/writer.ts'

const ctx = { file: 'test.bin', format: 'h3m' as const }

function catchError(fn: () => unknown): FormatError {
  try {
    fn()
  } catch (err) {
    if (err instanceof FormatError) return err
    throw err
  }
  throw new Error('expected a FormatError')
}

describe('ByteReader', () => {
  it('reads little-endian integers and strings', () => {
    const bytes = new ByteWriter().u8(7).u16(0x1234).u32(0xdeadbeef).i32(-5).string('Привет, map').fixedString('abc', 8).toBytes()
    const r = new ByteReader(bytes, ctx)
    expect(r.u8()).toBe(7)
    expect(r.u16()).toBe(0x1234)
    expect(r.u32()).toBe(0xdeadbeef)
    expect(r.i32()).toBe(-5)
    const s = r.string()
    expect(s.text).toBe('Привет, map')
    expect(s.bytes.length).toBe(11)
    expect(r.fixedString(8)).toBe('abc')
    r.expectEnd()
  })

  it('reports truncation with offset and structure path', () => {
    const r = new ByteReader(new Uint8Array([1, 2, 3]), { ...ctx, version: 'SoD' })
    r.u8()
    const err = catchError(() => r.scope('objects[2]', () => r.scope('body', () => r.u32())))
    expect(err.code).toBe('TRUNCATED')
    expect(err.offset).toBe(1)
    expect(err.structure).toBe('objects[2].body')
    expect(err.version).toBe('SoD')
    expect(err.file).toBe('test.bin')
  })

  it('rejects non-boolean bytes and oversized strings', () => {
    expect(catchError(() => new ByteReader(new Uint8Array([2]), ctx).bool()).code).toBe('INVALID_VALUE')
    const big = new ByteWriter().u32(1_000_000).toBytes()
    expect(catchError(() => new ByteReader(big, ctx).string(1000)).code).toBe('INVALID_VALUE')
  })

  it('checks zero padding and trailing data', () => {
    expect(catchError(() => new ByteReader(new Uint8Array([0, 1]), ctx).zeros(2, 'pad')).offset).toBe(1)
    const r = new ByteReader(new Uint8Array([0, 0]), ctx)
    r.u8()
    expect(catchError(() => r.expectEnd()).code).toBe('TRAILING_DATA')
  })

  it('serializes errors to JSON and back', () => {
    const err = catchError(() => new ByteReader(new Uint8Array(0), ctx).u8())
    const json = err.toJSON()
    expect(json.name).toBe('FormatError')
    expect(FormatError.fromJSON(json).toJSON()).toEqual(json)
  })
})

describe('inflate', () => {
  const data = new TextEncoder().encode('hello hello hello hello')
  const ictx = { file: 'x.lod', format: 'lod' as const, offset: 10, structure: 'entry' }

  it('inflates zlib and gzip', async () => {
    expect(await inflate(zlib(data), 'deflate', ictx, data.length)).toEqual(data)
    const gz = gzip(data)
    expect(isGzip(gz)).toBe(true)
    expect(await inflate(gz, 'gzip', ictx)).toEqual(data)
  })

  it('fails with DECOMPRESS_FAILED on corrupt data or size mismatch', async () => {
    await expect(inflate(new Uint8Array([1, 2, 3, 4]), 'deflate', ictx)).rejects.toMatchObject({ code: 'DECOMPRESS_FAILED', offset: 10 })
    await expect(inflate(zlib(data), 'deflate', ictx, 3)).rejects.toMatchObject({ code: 'DECOMPRESS_FAILED' })
  })
})

describe('rng and clock', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 5 }, () => a.int(1000))
    const seqB = Array.from({ length: 5 }, () => b.int(1000))
    expect(seqA).toEqual(seqB)
    expect(createRng(43).int(1000)).not.toBe(seqA[0])
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3))
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1))
  })

  it('manual clock only moves when told', () => {
    const c = new ManualClock(5)
    c.advance(10)
    expect(c.now()).toBe(15)
  })

  it('memory source reads ranges and rejects out-of-bounds reads', async () => {
    const s = new MemorySource('m', new Uint8Array([1, 2, 3, 4]))
    expect(await s.read(1, 2)).toEqual(new Uint8Array([2, 3]))
    await expect(s.read(3, 2)).rejects.toThrow(RangeError)
  })
})
