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
    // LZMA does not occur in HotA 1.8.1, but the format allows it (research M1, R12).
    const bytes = writeHotaLod(entries)
    bytes[92 + 16] = HOTA_COMPRESSION.lzma
    const lod = await LodArchive.open(new MemorySource('HotA.lod', bytes))
    await expect(lod.read('Objects.txt')).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
      message: expect.stringContaining('LZMA'),
    })
    expect(await lod.read('hglnt000.pcx')).toEqual(entries[1]?.data)
  })
})
