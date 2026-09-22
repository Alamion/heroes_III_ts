// HotA maps from the owner's files (spec 005 FR-006, FR-007, FR-009).
//
// The strongest available proof that a layout is right is that the parse ends exactly at the last
// byte: the parser only accepts a map whose 124 trailing zero bytes are followed by end of file.
// Skips with a message when the files are absent.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseH3mFile } from '../../src/core/formats/h3m/h3m.ts'
import { FormatError } from '../../src/core/util/errors.ts'
import { gameDirs, requireGameFile } from '../../tools/shared/game-files.ts'

const testMapHota = requireGameFile('test_map_hota.h3m')
const devilMap = requireGameFile('[HotA] The Devil Is in the Detail.h3m')
const scriptMap = requireGameFile('По праву силы.h3m')

const parse = async (path: string) => parseH3mFile(new Uint8Array(readFileSync(path)), basename(path))

describe.skipIf(testMapHota === null)('test_map_hota.h3m (the primary HotA check map)', () => {
  it('parses to the exact end of file as sub-version 10', async () => {
    const map = await parse(testMapHota as string)
    expect(map.version).toBe('HotA')
    expect(map.versionCode).toBe(0x20)
    expect(map.subVersion).toBe(10)
    expect(map.hota?.version).toEqual({ major: 1, minor: 8, patch: 1 })
    expect(map.info.size).toBe(144)
    expect(map.info.hasUnderground).toBe(true)
    expect(map.trailerLength).toBe(124)
    expect(map.objects.length).toBeGreaterThan(3000)
  })

  it('uses the HotA terrains, and no new river or road ids', async () => {
    const map = await parse(testMapHota as string)
    const terrains = new Set<number>()
    const rivers = new Set<number>()
    const roads = new Set<number>()
    for (let o = 0; o < map.tiles.length; o += 7) {
      terrains.add(map.tiles[o] as number)
      rivers.add(map.tiles[o + 2] as number)
      roads.add(map.tiles[o + 4] as number)
    }
    // 10 Highlands and 11 Wasteland (research M4, M7).
    expect(terrains.has(10)).toBe(true)
    expect(terrains.has(11)).toBe(true)
    expect(Math.max(...rivers)).toBeLessThanOrEqual(4)
    expect(Math.max(...roads)).toBeLessThanOrEqual(3)
  })
})

describe.skipIf(devilMap === null)('[HotA] The Devil Is in the Detail.h3m (252x252, sub-version 9)', () => {
  it('parses to the exact end of file', async () => {
    const map = await parse(devilMap as string)
    expect(map.subVersion).toBe(9)
    expect(map.hota?.version).toEqual({ major: 1, minor: 8, patch: 0 })
    expect(map.info.size).toBe(252)
    expect(map.objects).toHaveLength(23803)
    expect(map.trailerLength).toBe(124)
  })
})

describe.skipIf(scriptMap === null)('maps with an active HotA event system', () => {
  it('walks the event-system block to the byte', async () => {
    // The block has no length prefix, so the only proof is that the body consumes exactly the
    // measured number of bytes and the map still ends at its 124-byte trailer (research M5).
    const map = await parse(scriptMap as string)
    expect(map.hota?.scriptBytes).toBe(3574)
    expect(map.trailerLength).toBe(124)
  })

  it('walks the other three local maps that carry one', async () => {
    const dir = gameDirs().hotaMapsDir
    if (dir === undefined) return
    const expected: Record<string, number> = { '[HotA] Help!.h3m': 10630, '[HotA] Ice Assault.h3m': 3371, '[HotA] Invasion.h3m': 4051 }
    for (const [file, bytes] of Object.entries(expected)) {
      const path = join(dir, file)
      if (!existsSync(path)) continue
      const map = await parse(path)
      expect({ file, bytes: map.hota?.scriptBytes }).toEqual({ file, bytes })
      expect(map.trailerLength).toBe(124)
    }
  }, 60_000)
})

const hotaMaps = (): string[] => {
  const dir = gameDirs().hotaMapsDir
  if (dir === undefined) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.h3m'))
    .sort()
    .map((f) => join(dir, f))
}

const corpus = hotaMaps()
if (corpus.length === 0) process.stderr.write('[real-file test skipped] HotA map corpus: no HotA install configured (hotaBundleDir)\n')

describe.skipIf(corpus.length === 0)('the HotA install map corpus', () => {
  it('parses every map to the exact end of file', async () => {
    const bySubVersion = new Map<string, number>()
    const unsupported: string[] = []
    const failed: string[] = []
    for (const path of corpus) {
      try {
        const map = await parse(path)
        const key = map.version === 'HotA' ? `HotA sub ${map.subVersion}` : map.version
        bySubVersion.set(key, (bySubVersion.get(key) ?? 0) + 1)
      } catch (err) {
        if (err instanceof FormatError && err.structure === 'scriptSection') unsupported.push(basename(path))
        else failed.push(`${basename(path)}: ${String(err)}`)
      }
    }
    expect(failed).toEqual([])
    expect(unsupported).toEqual([])
    expect(bySubVersion.size).toBeGreaterThan(0)
    process.stderr.write(`[hota-maps] ${JSON.stringify(Object.fromEntries([...bySubVersion].sort()))}\n`)
  }, 300_000)
})
