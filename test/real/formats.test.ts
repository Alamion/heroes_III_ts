// Tests on the user's game files; they skip with a logged reason when the files are absent.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { decodeFrame, parseDef } from '../../src/core/formats/def/def.ts'
import { parseH3mFile } from '../../src/core/formats/h3m/h3m.ts'
import { readTile } from '../../src/core/formats/h3m/types.ts'
import { parseObjectsTxt } from '../../src/core/formats/text/objects-txt.ts'
import { parseArtTraits } from '../../src/core/formats/text/artraits.ts'
import { parseRiffPal } from '../../src/core/formats/pal/riff-pal.ts'
import { NodeFileSource } from '../../tools/shared/node-source.ts'
import { requireGameFile } from '../../tools/shared/game-files.ts'

const sprites = requireGameFile('h3sprite.lod')
const bitmaps = requireGameFile('h3bitmap.lod')
const arrogance = requireGameFile('Arrogance.h3m')
const hotaMap = requireGameFile('По праву силы.h3m')

describe.skipIf(sprites === null)('h3sprite.lod (SC-001)', () => {
  it('extracts every entry and decodes every DEF', async () => {
    const lod = await LodArchive.open(await NodeFileSource.open(sprites as string))
    expect(lod.entries.length).toBeGreaterThan(1000)
    let defs = 0
    let frames = 0
    for (const entry of lod.entries) {
      const bytes = await lod.read(entry)
      expect(bytes.length).toBe(entry.size)
      if (!entry.name.toLowerCase().endsWith('.def')) continue
      const def = parseDef(bytes, entry.name)
      const seen = new Set<number>()
      for (const ref of def.frameOrder) {
        if (seen.has(ref.header.offset)) continue
        seen.add(ref.header.offset)
        decodeFrame(def, ref)
        frames++
      }
      defs++
    }
    expect(defs).toBeGreaterThan(2000)
    expect(frames).toBeGreaterThan(20_000)
  }, 180_000)

  it('has every terrain, river, road and border sprite', async () => {
    const { terrainLayerDefs } = await import('../../src/core/data/terrain.ts')
    const lod = await LodArchive.open(await NodeFileSource.open(sprites as string))
    for (const name of terrainLayerDefs()) expect(lod.has(name), name).toBe(true)
  })
})

describe.skipIf(arrogance === null)('Arrogance.h3m (SC-002)', () => {
  it('parses to the exact end with known values', async () => {
    const map = await parseH3mFile(new Uint8Array(await readFile(arrogance as string)), 'Arrogance.h3m')
    expect(map.version).toBe('SoD')
    expect(map.info.size).toBe(36)
    expect(map.info.hasUnderground).toBe(true)
    expect(map.tiles.length).toBe(36 * 36 * 2 * 7)
    expect(map.objects.length).toBeGreaterThan(100)
    expect(map.objects.every((o) => o.body !== undefined)).toBe(true)
    const tile = readTile(map.tiles, 36, 10, 12, 0)
    expect(tile.terrain).toBeLessThan(10)
  })
})

describe.skipIf(hotaMap === null)('HotA map rejection', () => {
  it('fails with UNSUPPORTED_VERSION', async () => {
    await expect(parseH3mFile(new Uint8Array(await readFile(hotaMap as string)), 'По праву силы.h3m')).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION', version: '0x20' })
  })
})

describe.skipIf(bitmaps === null)('Objects.txt from h3bitmap.lod', () => {
  it('parses all templates', async () => {
    const lod = await LodArchive.open(await NodeFileSource.open(bitmaps as string))
    const rows = parseObjectsTxt(await lod.read('Objects.txt'))
    expect(rows.length).toBeGreaterThan(1000)
    expect(rows.some((r) => r.classId === 54)).toBe(true)
    expect(rows.some((r) => r.classId === 98)).toBe(true)
  })
})

describe.skipIf(bitmaps === null)('h3bitmap.lod data files (spec 003)', () => {
  it('reads artifact classes and the player palette', async () => {
    const lod = await LodArchive.open(await NodeFileSource.open(bitmaps as string))
    const classes = parseArtTraits(await lod.read('artraits.txt'))
    expect(classes.length).toBeGreaterThanOrEqual(141)
    expect(classes.slice(0, 7).every((c) => c === 'special')).toBe(true)
    expect(parseRiffPal(await lod.read('game.pal'), 'game.pal')).toHaveLength(768)
  })
})
