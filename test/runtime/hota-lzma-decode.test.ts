// Spec 008 FR-009, FR-010: a HotA archive of another build — LZMA entries, an entry of an unknown
// compression type, a damaged override — decodes with the base archive instead of failing.

import { describe, expect, it } from 'vitest'
import { noCache } from '../../src/runtime/cache-key.ts'
import { decodeArchive } from '../../src/runtime/decode.ts'
import { classifyFile } from '../../src/runtime/file-kind.ts'
import { SYNTHETIC_HOTA_BAD_ENTRIES, syntheticHotaArchive } from '../fixtures/synthetic/hota-archive.ts'
import { syntheticTerrainArchive } from '../fixtures/synthetic/terrain-archive.ts'

const blob = (b: Uint8Array): Blob => new Blob([b as Uint8Array<ArrayBuffer>])

describe('a HotA archive with LZMA and unusable entries', () => {
  it('is classified as the HotA archive and decodes in front of the base archive', async () => {
    const hota = blob(syntheticHotaArchive())
    expect(await classifyFile(hota, 'HotA.lod')).toEqual({ kind: 'hotaArchive' })
    const r = await decodeArchive([{ file: hota, name: 'HotA.lod' }, { file: blob(syntheticTerrainArchive()), name: 'h3sprite.lod' }], noCache)
    const codes = r.warnings.map((w) => w.code)
    // Both HotA tile sets were read (half of them LZMA): no incomplete terrain.
    expect(codes).not.toContain('MISSING_TERRAIN_TILE')
    expect(r.warnings.find((w) => w.code === 'ENTRY_UNREADABLE')?.message).toMatch(new RegExp(`${SYNTHETIC_HOTA_BAD_ENTRIES.damaged}.*using the copy in h3sprite\\.lod`))
    expect(r.warnings.find((w) => w.code === 'LOD_WARNING' && w.message.includes('unknown compression type 9'))).toBeDefined()
  })
})
