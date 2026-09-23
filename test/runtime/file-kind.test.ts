import { describe, expect, it } from 'vitest'
import { classifyFile, inflatePrefix, MAP_PROBE_BYTES } from '../../src/runtime/file-kind.ts'
import { badFiles } from '../fixtures/synthetic/bad-files.ts'
import { syntheticDataArchive, syntheticTerrainArchive, syntheticTerrainMap } from '../fixtures/synthetic/terrain-archive.ts'
import { buildMap, writeH3m } from '../fixtures/synthetic/h3m.ts'

const blob = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>])

describe('classifyFile (spec 004 FR-002)', () => {
  it('recognises the sprite archive, the data archive and maps by content', async () => {
    expect(await classifyFile(blob(syntheticTerrainArchive()))).toEqual({ kind: 'spriteArchive' })
    expect(await classifyFile(blob(syntheticDataArchive()))).toEqual({ kind: 'dataArchive' })
    expect(await classifyFile(blob(syntheticTerrainMap(36, true, false)))).toEqual({ kind: 'map', version: 'SoD' })
    expect(await classifyFile(blob(writeH3m(buildMap({ version: 'RoE', size: 36, underground: false }))))).toEqual({ kind: 'map', version: 'RoE' })
  })

  it('reports unsupported maps, other archives and unknown files', async () => {
    const bad = badFiles()
    // HotA maps are supported since spec 005; only genuinely unknown formats are rejected.
    expect(await classifyFile(blob(bad.hotaMap))).toEqual({ kind: 'map', version: 'HotA' })
    expect(await classifyFile(blob(bad.wogMap))).toMatchObject({ kind: 'unsupportedMap', format: 'WoG' })
    expect(await classifyFile(blob(bad.plainArchive))).toMatchObject({ kind: 'unknownArchive' })
    expect(await classifyFile(blob(bad.randomBytes))).toEqual({ kind: 'unknown' })
    expect(await classifyFile(blob(bad.empty))).toEqual({ kind: 'unknown' })
    // The header of a truncated map is intact: it classifies as a map and fails later on load.
    expect(await classifyFile(blob(bad.truncatedMap))).toMatchObject({ kind: 'map' })
  })

  it('never inflates a whole large map', async () => {
    const big = syntheticTerrainMap(252, true, false)
    const r = await inflatePrefix(blob(big), 4)
    expect(r.bytes.byteLength).toBeGreaterThanOrEqual(4)
    expect(r.inflated).toBeLessThanOrEqual(MAP_PROBE_BYTES)
    expect(await classifyFile(blob(big))).toEqual({ kind: 'map', version: 'SoD' })
  })
})
