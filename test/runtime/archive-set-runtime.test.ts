// US3 (spec 005 FR-026): with base archives only, nothing takes a HotA branch.

import { describe, expect, it } from 'vitest'
import { ArchiveSet } from '../../src/core/formats/lod/archive-set.ts'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { MemorySource } from '../../src/core/util/byte-source.ts'
import { CACHE_SCHEMA, cacheKey } from '../../src/runtime/cache-key.ts'
import { classifyFile } from '../../src/runtime/file-kind.ts'
import { writeHotaLod } from '../fixtures/synthetic/hota-lod.ts'
import { writeLod } from '../fixtures/synthetic/lod.ts'
import { syntheticTerrainArchive } from '../fixtures/synthetic/terrain-archive.ts'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('a base-game archive set', () => {
  it('has one member and answers exactly like the archive itself', async () => {
    const archive = await LodArchive.open(new MemorySource('h3sprite.lod', writeLod([{ name: 'grastl.def', data: text('grass') }])))
    const set = ArchiveSet.of(archive)
    expect(set.archives).toHaveLength(1)
    expect(set.names).toEqual(['h3sprite.lod'])
    expect(set.get('grastl.def').archive).toBe(archive)
    expect(await set.read('grastl.def')).toEqual(await archive.read('grastl.def'))
    expect(archive.kind).toBe('plain')
  })

  it('classifies a base archive as its own kind, never as a HotA one', async () => {
    const blob = new Blob([syntheticTerrainArchive() as unknown as BlobPart])
    expect(await classifyFile(blob, 'h3sprite.lod')).toEqual({ kind: 'spriteArchive' })
  })

  it('classifies an obfuscated archive as the HotA one', async () => {
    const hota = writeHotaLod([
      { name: 'hglnt000.pcx', data: text('tile') },
      { name: 'wstlt000.pcx', data: text('tile') },
    ])
    expect(await classifyFile(new Blob([hota as unknown as BlobPart]), 'HotA.lod')).toEqual({ kind: 'hotaArchive' })
  })

  it('keys the cache by the schema, so entries of the previous layout are never reused', () => {
    // Bumped to 6 when archive identity became an archive set's ordered identity.
    expect(CACHE_SCHEMA).toBeGreaterThanOrEqual(6)
    expect(cacheKey('atlas', 'abc')).toBe(`atlas:${CACHE_SCHEMA}:abc`)
  })
})
