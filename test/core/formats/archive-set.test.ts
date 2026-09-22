// Archive precedence and identity (spec 005 FR-004).

import { describe, expect, it } from 'vitest'
import { ArchiveSet } from '../../../src/core/formats/lod/archive-set.ts'
import { LodArchive } from '../../../src/core/formats/lod/lod.ts'
import { MemorySource } from '../../../src/core/util/byte-source.ts'
import { writeHotaLod } from '../../fixtures/synthetic/hota-lod.ts'
import { writeLod } from '../../fixtures/synthetic/lod.ts'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)
const decode = (b: Uint8Array): string => new TextDecoder().decode(b)

async function base(): Promise<LodArchive> {
  return LodArchive.open(
    new MemorySource(
      'h3sprite.lod',
      writeLod([
        { name: 'grastl.def', data: text('base grass') },
        { name: 'AVCCAST0.def', data: text('base village') },
        { name: 'artraits.txt', data: text('base artifacts') },
      ]),
    ),
  )
}

async function hota(): Promise<LodArchive> {
  return LodArchive.open(
    new MemorySource(
      'HotA.lod',
      writeHotaLod([
        { name: 'grastl.def', data: text('hota grass') },
        { name: 'avccovx0.def', data: text('cove castle') },
      ]),
    ),
  )
}

describe('ArchiveSet', () => {
  it('resolves a shared name from the first archive and a missing one from the later archive', async () => {
    const set = new ArchiveSet([await hota(), await base()])
    // HotA overrides four vanilla sprites and game.pal (research M1).
    expect(decode(await set.read('grastl.def'))).toBe('hota grass')
    // Several town sprites and artraits.txt exist only in the base archive.
    expect(decode(await set.read('AVCCAST0.def'))).toBe('base village')
    expect(decode(await set.read('artraits.txt'))).toBe('base artifacts')
    expect(decode(await set.read('avccovx0.def'))).toBe('cove castle')
    expect(set.get('grastl.def').archive.source.name).toBe('HotA.lod')
    expect(set.get('AVCCAST0.def').archive.source.name).toBe('h3sprite.lod')
  })

  it('reverses the winner when the order is reversed', async () => {
    const set = new ArchiveSet([await base(), await hota()])
    expect(decode(await set.read('grastl.def'))).toBe('base grass')
  })

  it('reports a name missing from every archive, naming them all', async () => {
    const set = new ArchiveSet([await hota(), await base()])
    expect(set.has('nope.def')).toBe(false)
    expect(() => set.get('nope.def')).toThrow(/no entry named "nope.def" in HotA\.lod, h3sprite\.lod/)
    await expect(set.read('nope.def')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('works with a single archive and refuses an empty set', async () => {
    const set = ArchiveSet.of(await base())
    expect(set.names).toEqual(['h3sprite.lod'])
    expect(decode(await set.read('grastl.def'))).toBe('base grass')
    expect(() => new ArchiveSet([])).toThrow(TypeError)
  })
})
