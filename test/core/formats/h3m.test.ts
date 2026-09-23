import { describe, expect, it } from 'vitest'
import { parseH3m, parseH3mFile } from '../../../src/core/formats/h3m/h3m.ts'
import { readTile } from '../../../src/core/formats/h3m/types.ts'
import type { H3mVersion } from '../../../src/core/formats/h3m/types.ts'
import { bodyFamily, isKnownClass, MAX_BASE_CLASS_ID } from '../../../src/core/data/object-classes.ts'
import { FormatError } from '../../../src/core/util/errors.ts'
import { ByteWriter } from '../../fixtures/synthetic/writer.ts'
import { allBodiesMap, blankTemplate, buildMap, writeH3m, writeH3mGz } from '../../fixtures/synthetic/h3m.ts'

const VERSIONS: H3mVersion[] = ['RoE', 'AB', 'SoD']

function stripOffsets<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (k, v) => (k === 'offset' || k === 'byteLength' || k === 'fileName' ? undefined : v instanceof Uint8Array ? Array.from(v) : v)))
}

function catchFormatError(fn: () => unknown): FormatError {
  try {
    fn()
  } catch (e) {
    if (e instanceof FormatError) return e
    throw e
  }
  throw new Error('expected FormatError')
}

describe('H3M synthetic round trip', () => {
  for (const version of VERSIONS) {
    it(`${version}: every section and object body parses back to the same values`, async () => {
      const map = allBodiesMap(version)
      const bytes = writeH3m(map)
      const parsed = parseH3m(bytes, 'syn.h3m')
      expect(parsed.version).toBe(version)
      expect(stripOffsets(parsed)).toEqual(stripOffsets(map))
      expect(writeH3m(parsed)).toEqual(bytes)
      const gz = await parseH3mFile(writeH3mGz(map), 'syn.h3m')
      expect(gz.objects).toHaveLength(map.objects.length)
      const families = new Set(parsed.objects.map((o) => bodyFamily(o.classId)))
      if (version !== 'RoE') {
        for (const f of ['none', 'event', 'hero', 'monster', 'message', 'seerHut', 'witchHut', 'scholar', 'garrison', 'artifact', 'spellScroll', 'resource', 'town', 'owned', 'shrine', 'pandora', 'grail', 'randomDwelling', 'randomDwellingLevel', 'randomDwellingFaction', 'questGuard', 'heroPlaceholder']) {
          expect(families.has(f as never), f).toBe(true)
        }
      }
    })
  }

  it('reads tiles with the documented index order', () => {
    const map = buildMap({ version: 'SoD', size: 5, underground: true, tile: (x, y, z) => [z === 1 ? 6 : 8, x, y % 5, y, (x + y) % 4, z, (x & 1) | ((y & 1) << 1)] })
    const parsed = parseH3m(writeH3m(map), 't.h3m')
    expect(readTile(parsed.tiles, 5, 3, 4, 1)).toEqual({ terrain: 6, terrainView: 3, river: 4, riverView: 4, road: 3, roadView: 1, flags: 1 })
    expect(readTile(parsed.tiles, 5, 2, 1, 0).terrain).toBe(8)
  })

  it('covers every class id with an explicit body family', () => {
    for (let id = 1; id <= MAX_BASE_CLASS_ID; id++) expect(bodyFamily(id)).toBeDefined()
    expect(isKnownClass(0)).toBe(false)
    expect(bodyFamily(232)).toBeUndefined()
  })
})

describe('H3M errors', () => {
  it('rejects unknown versions and unknown HotA sub-versions with UNSUPPORTED_VERSION', () => {
    // HotA (0x20) is supported now; a sub-version this reader does not know is not.
    const newerHota = new ByteWriter().u32(0x20).u32(99).zeros(40).toBytes()
    const hotaErr = catchFormatError(() => parseH3m(newerHota, 'hota.h3m'))
    expect(hotaErr.code).toBe('UNSUPPORTED_VERSION')
    expect(hotaErr.version).toBe('HotA sub 99')

    const hota = new ByteWriter().u32(0x33).zeros(40).toBytes()
    const err = catchFormatError(() => parseH3m(hota, 'wog.h3m'))
    expect(err.code).toBe('UNSUPPORTED_VERSION')
    expect(err.version).toBe('0x33')
    expect(err.detail).toContain('WoG')
  })

  it('reports truncation at several offsets with a structure path', () => {
    const bytes = writeH3m(allBodiesMap('SoD'))
    for (const cut of [3, 20, 200, Math.floor(bytes.length / 2), bytes.length - 200]) {
      const err = catchFormatError(() => parseH3m(bytes.slice(0, cut), 'cut.h3m'))
      expect(['TRUNCATED', 'INVALID_VALUE']).toContain(err.code)
      expect(err.offset).toBeLessThanOrEqual(cut)
      expect(err.structure.length).toBeGreaterThan(0)
      expect(err.file).toBe('cut.h3m')
    }
  })

  it('rejects unknown object classes and non-zero trailing data', () => {
    const map = buildMap({ version: 'AB', size: 8, underground: false, templates: [blankTemplate('odd.def', 500)], objects: [{ x: 1, y: 1, z: 0, templateIndex: 0, body: { kind: 'none' } }] })
    const err = catchFormatError(() => parseH3m(writeH3m(map), 'odd.h3m'))
    expect(err.code).toBe('UNSUPPORTED_OBJECT')
    expect(err.structure).toBe('objects[0]')

    const ok = writeH3m(buildMap({ version: 'RoE', size: 8, underground: false }))
    const trailing = new Uint8Array(ok.length + 1)
    trailing.set(ok)
    trailing[trailing.length - 1] = 7
    expect(catchFormatError(() => parseH3m(trailing, 'trail.h3m')).structure).toBe('trailer')
  })

  it('rejects out-of-range tile layer ids', () => {
    const map = buildMap({ version: 'SoD', size: 4, underground: false, tile: (x) => [x === 3 ? 12 : 2, 0, 0, 0, 0, 0, 0] })
    const err = catchFormatError(() => parseH3m(writeH3m(map), 'tiles.h3m'))
    expect(err.structure).toBe('tiles')
    expect(err.detail).toContain('tile (3,0,0)')
  })
})
