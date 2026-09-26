import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ZipArchive } from '../../../src/core/formats/zip/zip.ts'
import { MemorySource } from '../../../src/core/util/byte-source.ts'
import { FormatError } from '../../../src/core/util/errors.ts'
import { writeZip } from '../../../tools/shared/archive.ts'
import { MIXED_FOLDER, mapFolderEntries } from '../../fixtures/synthetic/map-folder.ts'

const open = (bytes: Uint8Array, name = 'maps.zip') => ZipArchive.open(new MemorySource(name, bytes), name)

async function openError(bytes: Uint8Array): Promise<FormatError> {
  try {
    await open(bytes)
  } catch (e) {
    if (e instanceof FormatError) return e
    throw e
  }
  throw new Error('expected FormatError')
}

/** A one-member archive written by hand, so flags, method and names can be anything. */
function handZip(opts: { name: Uint8Array; data: Uint8Array; method?: number; flags?: number; extra?: Uint8Array; size?: number }): Uint8Array {
  const method = opts.method ?? 0
  const payload = method === 8 ? deflateRawSync(opts.data) : opts.data
  const extra = opts.extra ?? new Uint8Array(0)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(opts.flags ?? 0, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(opts.size ?? opts.data.length, 22)
  local.writeUInt16LE(opts.name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(opts.flags ?? 0, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(opts.size ?? opts.data.length, 24)
  central.writeUInt16LE(opts.name.length, 28)
  central.writeUInt16LE(extra.length, 30)
  const localPart = Buffer.concat([local, opts.name, payload])
  const cd = Buffer.concat([central, opts.name, extra])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)
  return new Uint8Array(Buffer.concat([localPart, cd, eocd]))
}

describe('ZipArchive (spec 007 research R3)', () => {
  it('lists nested and Cyrillic UTF-8 paths and reads stored and deflated members', async () => {
    const entries = mapFolderEntries(MIXED_FOLDER)
    const zip = await open(writeZip(entries))
    const listed = zip.entries().filter((e) => !e.isDirectory)
    expect(listed.map((e) => e.path).sort()).toEqual(entries.map((e) => e.path).sort())
    expect(new Set(listed.map((e) => e.method))).toEqual(new Set([0, 8]))
    for (const e of listed) {
      const expected = entries.find((x) => x.path === e.path)!.data
      expect(await zip.read(e)).toEqual(expected)
    }
  })

  it('decodes legacy names as CP866 and prefers the Unicode Path extra field', async () => {
    const cp866 = new Uint8Array([0x8a, 0xa0, 0xe0, 0xe2, 0xa0, 0x2e, 0x68, 0x33, 0x6d]) // "Карта.h3m"
    expect((await open(handZip({ name: cp866, data: new Uint8Array([1]) }))).entries()[0]!.path).toBe('Карта.h3m')
    const utf8 = Buffer.from('Юникод.h3m', 'utf8')
    const extra = Buffer.alloc(9 + utf8.length)
    extra.writeUInt16LE(0x7075, 0)
    extra.writeUInt16LE(5 + utf8.length, 2)
    extra.writeUInt8(1, 4)
    utf8.copy(extra, 9)
    expect((await open(handZip({ name: Buffer.from('legacy.h3m'), data: new Uint8Array([1]), extra }))).entries()[0]!.path).toBe('Юникод.h3m')
  })

  it('an empty archive has no entries', async () => {
    expect((await open(writeZip([]))).entries()).toEqual([])
  })

  it('rejects non-archives, a truncated central directory and ZIP64', async () => {
    expect((await openError(new TextEncoder().encode('not a zip archive at all, just text'))).code).toBe('BAD_MAGIC')
    const good = writeZip(mapFolderEntries(MIXED_FOLDER))
    const cut = good.slice()
    // Claim a central directory larger than the file holds.
    const view = new DataView(cut.buffer)
    view.setUint32(cut.length - 22 + 12, 0x7fffffff, true)
    expect((await openError(cut)).code).toBe('TRUNCATED')
    const z64 = good.slice()
    new DataView(z64.buffer).setUint16(z64.length - 22 + 10, 0xffff, true)
    expect((await openError(z64)).code).toBe('UNSUPPORTED_VERSION')
  })

  it('refuses to read encrypted members and unknown methods', async () => {
    const enc = await open(handZip({ name: Buffer.from('a.h3m'), data: new Uint8Array([1, 2]), flags: 1 }))
    await expect(enc.read(enc.entries()[0]!)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' })
    const bz = await open(handZip({ name: Buffer.from('b.h3m'), data: new Uint8Array([1, 2]), method: 12 }))
    await expect(bz.read(bz.entries()[0]!)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' })
  })

  it('a deflated member of the wrong size is a decompression error', async () => {
    const zip = await open(handZip({ name: Buffer.from('c.h3m'), data: new Uint8Array(100).fill(7), method: 8, size: 99 }))
    await expect(zip.read(zip.entries()[0]!)).rejects.toMatchObject({ code: 'DECOMPRESS_FAILED' })
  })
})
