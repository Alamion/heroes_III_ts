import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseH3m } from '../../../src/core/formats/h3m/h3m.ts'
import { readMapSummary } from '../../../src/core/formats/h3m/summary.ts'
import type { H3mVersion } from '../../../src/core/formats/h3m/types.ts'
import { FormatError } from '../../../src/core/util/errors.ts'
import { summarizeMapFile } from '../../../src/runtime/file-kind.ts'
import { mapWithVersion } from '../../fixtures/synthetic/bad-files.ts'
import { buildMap, h3s, writeH3m, writeH3mGz } from '../../fixtures/synthetic/h3m.ts'
import { writeHotaMap, writeHotaMapGz } from '../../fixtures/synthetic/hota-map.ts'

const blob = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>])

function error(fn: () => unknown): FormatError {
  try {
    fn()
  } catch (e) {
    if (e instanceof FormatError) return e
    throw e
  }
  throw new Error('expected FormatError')
}

describe('readMapSummary (spec 007 research R4)', () => {
  const versions: H3mVersion[] = ['RoE', 'AB', 'SoD']
  for (const version of versions) {
    for (const [size, sizeClass] of [[36, 's'], [72, 'm'], [108, 'l'], [144, 'xl']] as const) {
      for (const underground of [false, true]) {
        it(`${version} ${size} ${underground ? 'two levels' : 'one level'}`, () => {
          const map = buildMap({ version, size, underground })
          map.info = { ...map.info, name: h3s('Карта героев') }
          const bytes = writeH3m(map)
          const s = readMapSummary(bytes, 'x.h3m')
          expect(s).toEqual({ version, size, sizeClass, levels: underground ? 2 : 1, title: 'Карта героев', needsHota: false })
          const full = parseH3m(bytes, 'x.h3m')
          expect(s.size).toBe(full.info.size)
          expect(s.levels).toBe(full.info.hasUnderground ? 2 : 1)
          expect(s.title).toBe(full.info.name.text)
        })
      }
    }
  }

  it('HotA sizes above XL and the HotA flag', () => {
    for (const [size, sizeClass] of [[180, 'h'], [216, 'xh'], [252, 'g']] as const) {
      const s = readMapSummary(writeHotaMap({ size, underground: true }), 'h.h3m')
      expect(s).toMatchObject({ version: 'HotA', size, sizeClass, levels: 2, needsHota: true })
    }
  })

  it('a non-standard size takes the next class', () => {
    expect(readMapSummary(writeH3m(buildMap({ version: 'SoD', size: 50, underground: false })), 'x.h3m').sizeClass).toBe('m')
  })

  it('a prefix that ends before the name is TRUNCATED; unknown versions are UNSUPPORTED_VERSION', () => {
    const bytes = writeH3m(buildMap({ version: 'SoD', size: 36, underground: false }))
    expect(error(() => readMapSummary(bytes.slice(0, 9), 'x.h3m')).code).toBe('TRUNCATED')
    expect(error(() => readMapSummary(gunzipSync(mapWithVersion(0x33)), 'w.h3m')).code).toBe('UNSUPPORTED_VERSION')
  })

  it('summarizeMapFile reads gzip and raw maps from a Blob', async () => {
    const map = buildMap({ version: 'SoD', size: 72, underground: true })
    expect(await summarizeMapFile(blob(writeH3mGz(map)), 'a.h3m')).toMatchObject({ size: 72, levels: 2 })
    expect(await summarizeMapFile(blob(writeH3m(map)), 'a.h3m')).toMatchObject({ size: 72, levels: 2 })
    expect(await summarizeMapFile(blob(writeHotaMapGz({ size: 36 })), 'h.h3m')).toMatchObject({ needsHota: true })
  })
})
