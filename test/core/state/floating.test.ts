import { describe, expect, it } from 'vitest'
import { parseDef } from '../../../src/core/formats/def/def.ts'
import type { ObjectsTxtRow } from '../../../src/core/formats/text/objects-txt.ts'
import { CandidateMasks, computeFloatingTiles, toTileList } from '../../../src/core/state/floating.ts'
import { coveredPixels, isCovered, placeMask, spriteMaskFromDef, unionMasks } from '../../../src/core/state/footprint.ts'
import type { Footprint, SpriteMask } from '../../../src/core/state/footprint.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import { OBJECT_CLASS } from '../../../src/core/data/object-classes.ts'
import { parseTiles } from '../../../tools/reference-env/commands/selfcheck.ts'
import { writeDef } from '../../fixtures/synthetic/def.ts'
import { blankTemplate, buildMap, h3s } from '../../fixtures/synthetic/h3m.ts'
import type { ObjectBody, ObjectTemplate } from '../../../src/core/formats/h3m/types.ts'

function solidMask(name: string, width: number, height: number): SpriteMask {
  return { name, width, height, mask: new Uint8Array(width * height).fill(1) }
}

function row(defName: string, classId: number): ObjectsTxtRow {
  const t = blankTemplate(defName, classId)
  return { defName, passable: t.passable, active: t.active, allowedTerrains: 0x1ff, editorGroups: 1, classId, subclassId: 0, group: 0, isOverlay: false }
}

const identity = { sha256: 'x', name: 'syn.h3m', version: 'SoD' }
const monsterBody: ObjectBody = { kind: 'monster', identifier: 1, count: 0, disposition: 0, message: null, resources: null, artifact: null, neverFlees: false, noGrowth: false }

describe('sprite footprints', () => {
  it('anchors the full frame bottom-right on the object tile', () => {
    const fp: Footprint = new Map()
    placeMask(fp, solidMask('m', 64, 64), 5, 7)
    expect([...fp.keys()].sort()).toEqual(['4,6', '4,7', '5,6', '5,7'])
    expect(coveredPixels(fp.get('5,7') as never)).toBe(1024)
  })

  it('handles partial tiles and sprites crossing the map origin', () => {
    const fp: Footprint = new Map()
    placeMask(fp, solidMask('m', 40, 10), 0, 0)
    expect(coveredPixels(fp.get('0,0') as never)).toBe(32 * 10)
    expect(coveredPixels(fp.get('-1,0') as never)).toBe(8 * 10)
    expect(isCovered(fp.get('0,0'), 0, 22)).toBe(true)
    expect(isCovered(fp.get('0,0'), 0, 21)).toBe(false)
  })

  it('unions all frames of a sprite', () => {
    const w = 8
    const h = 8
    const frameA = { name: 'a', compression: 0 as const, width: 2, height: 2, x: 0, y: 0, pixels: Uint8Array.of(9, 9, 9, 9) }
    const frameB = { name: 'b', compression: 1 as const, width: 2, height: 2, x: 6, y: 6, pixels: Uint8Array.of(0, 9, 9, 0) }
    const def = parseDef(writeDef({ fullWidth: w, fullHeight: h, groups: [{ type: 0, frames: [frameA, frameB] }] }), 'u.def')
    const mask = spriteMaskFromDef(def)
    expect(mask.mask.reduce((a, b) => a + b, 0)).toBe(6)
    expect(mask.mask[7 * 8 + 6]).toBe(1)
    expect(mask.mask[6 * 8 + 6]).toBe(0)
    const u = unionMasks('u', [mask, solidMask('s', 4, 2)])
    expect([u.width, u.height]).toEqual([8, 8])
    expect(u.mask[6 * 8 + 4]).toBe(1)
  })
})

describe('floating tiles', () => {
  const sprites = new Map<string, SpriteMask>([
    ['mon.def', solidMask('mon.def', 64, 64)],
    ['rnd.def', solidMask('rnd.def', 32, 32)],
    ['hero.def', solidMask('hero.def', 96, 64)],
    ['af00.def', solidMask('af00.def', 96, 64)],
    ['ah00_.def', solidMask('ah00_.def', 96, 64)],
    ['town.def', solidMask('town.def', 32, 32)],
  ])
  const lookup = (n: string) => sprites.get(n.toLowerCase())
  const rows = [row('mon.def', OBJECT_CLASS.MONSTER), row('hero.def', OBJECT_CLASS.HERO)]

  function state(objects: { cls: number; x: number; y: number; z: number; def: string; body?: ObjectBody }[], generateHero = false) {
    const templates: ObjectTemplate[] = objects.map((o) => blankTemplate(o.def, o.cls))
    const map = buildMap({
      version: 'SoD',
      size: 16,
      underground: true,
      templates,
      objects: objects.map((o, i) => ({ x: o.x, y: o.y, z: o.z, templateIndex: i, body: o.body ?? { kind: 'none' } })),
    })
    const p0 = map.players[0]
    if (p0 !== undefined) p0.mainTown = generateHero ? { generateHero: true, townType: 0, pos: { x: 10, y: 10, z: 0 } } : null
    map.players.forEach((p, i) => {
      if (i > 0) p.mainHeroName = h3s('')
    })
    return fromH3m(map, identity)
  }

  it('covers the 2×2 area of a random monster on its level only', () => {
    const s = state([{ cls: OBJECT_CLASS.RANDOM_MONSTER_L3, x: 5, y: 5, z: 1, def: 'rnd.def', body: monsterBody }])
    const set = computeFloatingTiles(s, new CandidateMasks(rows, lookup), lookup)
    expect(toTileList(set, 0)).toBe('')
    expect(toTileList(set, 1)).toBe('4,4;5,4;4,5;5,5')
    expect(set.levels[1]?.tiles[0]?.causes).toEqual([{ kind: 'randomObject', objectId: 0, classId: OBJECT_CLASS.RANDOM_MONSTER_L3 }])
    expect(parseTiles([toTileList(set, 1)]).size).toBe(4)
  })

  it('ignores non-random objects and returns an explicit empty set', () => {
    const s = state([{ cls: OBJECT_CLASS.MONSTER, x: 5, y: 5, z: 0, def: 'mon.def', body: monsterBody }])
    const set = computeFloatingTiles(s, new CandidateMasks(rows, lookup), lookup)
    expect(set.levels.map((l) => l.tiles.length)).toEqual([0, 0])
  })

  it('adds the area of a hero generated at a main town', () => {
    const s = state([{ cls: OBJECT_CLASS.TOWN, x: 12, y: 10, z: 0, def: 'town.def' }], true)
    const set = computeFloatingTiles(s, new CandidateMasks(rows, lookup), lookup)
    // The Objects.txt hero row (blankTemplate) is visited at its anchor; the hero sprite is 3×2 tiles.
    expect(toTileList(set, 0)).toBe('8,9;9,9;10,9;8,10;9,10;10,10')
    // Without a hero row the map convention applies: anchor one tile right of the visited tile.
    const noRow = computeFloatingTiles(state([{ cls: OBJECT_CLASS.TOWN, x: 12, y: 10, z: 0, def: 'town.def' }], true), new CandidateMasks([row('mon.def', OBJECT_CLASS.MONSTER)], lookup), lookup)
    expect(toTileList(noRow, 0)).toBe('9,9;10,9;11,9;9,10;10,10;11,10')
    expect(set.levels[0]?.tiles[0]?.causes[0]).toMatchObject({ kind: 'generatedHero', player: 0 })
    const noHero = computeFloatingTiles(state([{ cls: OBJECT_CLASS.TOWN, x: 12, y: 10, z: 0, def: 'town.def' }], false), new CandidateMasks(rows, lookup), lookup)
    expect(toTileList(noHero, 0)).toBe('')
  })

  it('warns about missing candidate sprites instead of failing', () => {
    const s = state([{ cls: OBJECT_CLASS.RANDOM_MONSTER, x: 3, y: 3, z: 0, def: 'rnd.def', body: monsterBody }])
    const set = computeFloatingTiles(s, new CandidateMasks([...rows, row('missing.def', OBJECT_CLASS.MONSTER)], lookup), lookup)
    expect(set.warnings.some((w) => w.includes('missing.def'))).toBe(true)
    expect(toTileList(set, 0)).toBe('2,2;3,2;2,3;3,3')
  })
})
