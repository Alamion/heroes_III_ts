// Objects of every base-game map in the install (spec 003 SC-007): resolve, build render objects and
// the object atlas, and plan every view on both levels. Skips without game files.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDef } from '../../src/core/formats/def/def.ts'
import type { DefSprite } from '../../src/core/formats/def/def.ts'
import { parseH3mFile } from '../../src/core/formats/h3m/h3m.ts'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { parseArtTraits } from '../../src/core/formats/text/artraits.ts'
import { parseObjectsTxt } from '../../src/core/formats/text/objects-txt.ts'
import { buildObjectAtlas, MAX_OBJECT_PAGES } from '../../src/core/render/object-atlas.ts'
import { buildObjectPlan } from '../../src/core/render/object-plan.ts'
import { ObjectIndex } from '../../src/core/state/object-index.ts'
import { buildRenderObjects } from '../../src/core/state/render-objects.ts'
import { fromH3m } from '../../src/core/state/world.ts'
import { FormatError } from '../../src/core/util/errors.ts'
import { createRng } from '../../src/core/util/rng.ts'
import { OBJECT_CLASS } from '../../src/core/data/object-classes.ts'
import { NodeFileSource } from '../../tools/shared/node-source.ts'
import { installMaps, requireGameFile, requireTestMap } from '../../tools/shared/game-files.ts'
import { buildMapContext, buildObjectContext } from '../../tools/checks/fidelity/masks.ts'

const sprites = requireGameFile('h3sprite.lod')
const bitmaps = requireGameFile('h3bitmap.lod')
const maps = sprites === null || bitmaps === null ? [] : installMaps()

describe.skipIf(maps.length === 0)('objects of all install maps (SC-007)', () => {
  it('builds render objects, atlases and view plans without errors', async () => {
    const spriteLod = await LodArchive.open(await NodeFileSource.open(sprites as string))
    const data = await LodArchive.open(await NodeFileSource.open(bitmaps as string))
    const tables = { templates: parseObjectsTxt(await data.read('Objects.txt')), artifactClasses: parseArtTraits(await data.read('artraits.txt')) }
    const defCache = new Map<string, DefSprite>()
    let rendered = 0
    const missing = new Set<string>()
    for (const path of maps) {
      let map
      try {
        map = await parseH3mFile(new Uint8Array(readFileSync(path)), basename(path))
      } catch (err) {
        // HotA and other unsupported versions are rejected by the parser (spec 002).
        expect(err).toBeInstanceOf(FormatError)
        continue
      }
      const state = fromH3m(map, { sha256: 'x', name: basename(path), version: map.version })
      const { objects } = buildRenderObjects(state, tables, createRng(1))
      const defs: DefSprite[] = []
      for (const name of new Set(objects.map((o) => o.def))) {
        if (!spriteLod.has(name)) {
          missing.add(name)
          continue
        }
        let def = defCache.get(name)
        if (def === undefined) {
          def = parseDef(await spriteLod.read(name), name)
          defCache.set(name, def)
        }
        defs.push(def)
      }
      const atlas = buildObjectAtlas(defs)
      expect(atlas.layout.pageCount).toBeLessThanOrEqual(MAX_OBJECT_PAGES)
      const index = new ObjectIndex(objects, state.size, state.levels)
      for (let z = 0; z < state.levels; z++) {
        for (let y = 0; y < state.size; y += 17) {
          for (let x = 0; x < state.size; x += 19) buildObjectPlan(index, atlas.layout, z, { x0: x, y0: y, x1: x + 18, y1: y + 16 }, 0)
        }
      }
      rendered++
    }
    expect(rendered).toBeGreaterThan(100)
    // Missing sprites are reported, not thrown; the base game has none.
    expect([...missing]).toEqual([])
  }, 900_000)
})

const testMap = requireTestMap()

describe.skipIf(testMap === null || sprites === null || bitmaps === null)('test_map.h3m town zone draw list', () => {
  it('lists every town anchored in the zone with the parsed owners, and no hidden objects', async () => {
    const ctx = await buildMapContext(testMap as string, sprites as string, bitmaps as string)
    const oc = await buildObjectContext(ctx, { dataArchive: bitmaps as string })
    const region = { x0: 7, y0: 65, x1: 25, y1: 81 }
    const plan = buildObjectPlan(oc.index, oc.atlas.layout, 0, region, 0, { drawList: true })
    const entries = plan.entries ?? []
    const townsInZone = [...ctx.state.objects.values()].filter((o) => o.z === 0 && o.classId === OBJECT_CLASS.TOWN && o.x >= region.x0 && o.x <= region.x1 && o.y >= region.y0 && o.y <= region.y1)
    expect(townsInZone.length).toBe(9)
    for (const t of townsInZone) {
      const e = entries.find((d) => d.id === t.id)
      expect(e?.className).toBe('town')
      expect(e?.owner).toBe(t.owner)
    }
    expect(entries.some((e) => e.className === 'event' || e.className === 'grail')).toBe(false)
  }, 300_000)
})
