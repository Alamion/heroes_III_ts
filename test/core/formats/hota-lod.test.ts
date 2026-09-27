// Obfuscated HotA 1.8 LOD index (spec 005 FR-001, FR-002, FR-003, FR-005).

import { describe, expect, it } from 'vitest'
import { LodArchive } from '../../../src/core/formats/lod/lod.ts'
import { hashDisplayName, lodNameHash, parseHashDisplayName } from '../../../src/core/formats/lod/name-hash.ts'
import { MemorySource } from '../../../src/core/util/byte-source.ts'
import { HOTA_COMPRESSION, writeHotaLod } from '../../fixtures/synthetic/hota-lod.ts'
import { writeLod } from '../../fixtures/synthetic/lod.ts'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)

const entries = [
  { name: 'Objects.txt', data: text('1883\r\ndefault.def 000000000 ...\r\n') },
  { name: 'hglnt000.pcx', data: text('tile bytes'), compression: HOTA_COMPRESSION.raw },
  { name: 'AVCcovx0.def', data: text('a'.repeat(300)) },
]

describe('HotA obfuscated LOD index', () => {
  it('reads entries through the XOR key and finds them by name', async () => {
    const lod = await LodArchive.open(new MemorySource('HotA.lod', writeHotaLod(entries)))
    expect(lod.kind).toBe('obfuscated')
    expect(lod.entries).toHaveLength(3)
    // Names are not stored: lookups hash the wanted name, and case does not matter.
    expect(await lod.read('Objects.txt')).toEqual(entries[0]?.data)
    expect(await lod.read('objects.txt')).toEqual(entries[0]?.data)
    expect(await lod.read('HGLNT000.PCX')).toEqual(entries[1]?.data)
    expect(await lod.read('avccovx0.def')).toEqual(entries[2]?.data)
    expect(lod.find('nope.def')).toBeUndefined()
    // A raw entry keeps compressedSize 0; a compressed one carries the zlib type.
    expect(lod.get('hglnt000.pcx')).toMatchObject({ compressedSize: 0, type: HOTA_COMPRESSION.raw })
    expect(lod.get('Objects.txt').type).toBe(HOTA_COMPRESSION.zlib)
  })

  it('exposes an unrecovered name as #<hash> and accepts that form', async () => {
    const lod = await LodArchive.open(new MemorySource('HotA.lod', writeHotaLod(entries)))
    const entry = lod.get('Objects.txt')
    expect(entry.name).toBe(hashDisplayName(lodNameHash('objects.txt')))
    expect(lod.find(entry.name)).toBe(entry)
    expect(parseHashDisplayName(entry.name)).toBe(entry.nameHash)
    expect(parseHashDisplayName('objects.txt')).toBeUndefined()
  })

  it('treats a plain archive as plain, including the 0x7E0213 filler', async () => {
    const plain = writeLod([{ name: 'alpha.def', data: text('x') }])
    expect((await LodArchive.open(new MemorySource('plain.lod', plain))).kind).toBe('plain')

    // h3sprite.lod, sprite.lod and lsprite.lod carry this uninitialised value at offset 12.
    const filler = plain.slice()
    new DataView(filler.buffer, filler.byteOffset).setUint32(12, 0x7e0213, true)
    const lod = await LodArchive.open(new MemorySource('h3sprite.lod', filler))
    expect(lod.kind).toBe('plain')
    expect(await lod.read('alpha.def')).toEqual(text('x'))
  })

  it('fails with a typed error when the key is wrong', async () => {
    const bytes = writeHotaLod(entries)
    // Flip one bit of the key: every offset and size then reads as garbage.
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(12, 0xb5a4d745, true)
    await expect(LodArchive.open(new MemorySource('HotA.lod', bytes))).rejects.toMatchObject({
      format: 'lod',
      file: 'HotA.lod',
      structure: expect.stringContaining('entries['),
    })
  })

  it('rejects an entry whose compression type disagrees with its stored size', async () => {
    const bytes = writeHotaLod([{ name: 'a.def', data: text('hello'), compression: HOTA_COMPRESSION.raw }])
    bytes[92 + 16] = HOTA_COMPRESSION.zlib // raw entry, but claims zlib
    await expect(LodArchive.open(new MemorySource('HotA.lod', bytes))).rejects.toMatchObject({
      code: 'INVALID_VALUE',
      structure: expect.stringContaining('entries[0]'),
    })
  })

  it('reports an unsupported compression type per entry and keeps the rest readable', async () => {
    const bytes = writeHotaLod(entries)
    bytes[92 + 16] = HOTA_COMPRESSION.unknown
    const lod = await LodArchive.open(new MemorySource('HotA.lod', bytes))
    await expect(lod.read('Objects.txt')).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
      message: expect.stringContaining('type 1'),
    })
    expect(await lod.read('hglnt000.pcx')).toEqual(entries[1]?.data)
  })

  it('reads LZMA entries in HotA framing (spec 008 FR-009)', async () => {
    // Every packet kind: literals, matches at short and long distances, reps.
    const def = new Uint8Array(70_000)
    let x = 12345
    for (let i = 0; i < def.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0
      def[i] = i % 4096 < 2048 ? (x >>> 24) & 0x0f : (def[i - 2048] as number)
    }
    const lzma = [
      { name: 'avwlzma.def', data: def, compression: HOTA_COMPRESSION.lzma },
      { name: 'small.txt', data: text('abc'), compression: HOTA_COMPRESSION.lzma },
      ...entries,
    ]
    const lod = await LodArchive.open(new MemorySource('HotA.lod', writeHotaLod(lzma)))
    expect(lod.get('avwlzma.def').type).toBe(HOTA_COMPRESSION.lzma)
    expect(await lod.read('avwlzma.def')).toEqual(def)
    expect(await lod.read('small.txt')).toEqual(text('abc'))
    expect(await lod.read('Objects.txt')).toEqual(entries[0]?.data)
  })

  it('rejects a corrupt LZMA entry with a typed error, per entry', async () => {
    const bytes = writeHotaLod([{ name: 'a.def', data: text('x'.repeat(500)), compression: HOTA_COMPRESSION.lzma }, ...entries])
    const lod = await LodArchive.open(new MemorySource('HotA.lod', bytes))
    const at = lod.get('a.def').offset
    bytes[at] = 1 // the leading 0 byte of HotA's framing
    await expect(lod.read('a.def')).rejects.toMatchObject({ code: 'DECOMPRESS_FAILED', message: expect.stringContaining('expected 0') })
    bytes[at] = 0
    bytes[at + lod.get('a.def').compressedSize - 16] ^= 1 // footer size
    await expect(lod.read('a.def')).rejects.toMatchObject({ code: 'DECOMPRESS_FAILED', message: expect.stringContaining('footer') })
    expect(await lod.read('Objects.txt')).toEqual(entries[0]?.data)
  })

  it('leaves out a bad index entry with a warning instead of failing the archive (spec 008 FR-010)', async () => {
    const bytes = writeHotaLod(entries)
    bytes[92 + 32 * 2 + 16] = 9 // entry 2: unknown compression type
    const lod = await LodArchive.open(new MemorySource('HotA.lod', bytes))
    expect(lod.unreadable).toHaveLength(1)
    expect(lod.has('AVCcovx0.def')).toBe(false)
    expect(lod.warnings.join()).toContain('unknown compression type 9')
    expect(await lod.read('Objects.txt')).toEqual(entries[0]?.data)
  })
})
