import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { parseH3m } from '../../../src/core/formats/h3m/h3m.ts'
import { parseObjectsTxt } from '../../../src/core/formats/text/objects-txt.ts'
import type { ArtifactClass } from '../../../src/core/formats/text/artraits.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import type { WorldState } from '../../../src/core/state/world.ts'
import { buildRenderObjects } from '../../../src/core/state/render-objects.ts'
import { resolveRandomObjects } from '../../../src/core/state/random.ts'
import type { GameTables } from '../../../src/core/state/random.ts'
import { MAX_SPRITE_EXTENT, ObjectIndex } from '../../../src/core/state/object-index.ts'
import { createRng } from '../../../src/core/util/rng.ts'
import { OBJECT_CLASS, HIDDEN_CLASSES } from '../../../src/core/data/object-classes.ts'
import { creatureInfo } from '../../../src/core/data/creatures.ts'
import { syntheticObjectsTxt, syntheticTerrainMap } from '../../fixtures/synthetic/terrain-archive.ts'

const identity = { sha256: 's', name: 'syn.h3m', version: 'SoD' }

function world(size: number): WorldState {
  const map = parseH3m(gunzipSync(syntheticTerrainMap(size, true)), 'syn.h3m')
  return fromH3m(map, identity, 7)
}

const tables: GameTables = {
  templates: parseObjectsTxt(new TextEncoder().encode(syntheticObjectsTxt())),
  artifactClasses: Array.from({ length: 10 }, (): ArtifactClass => 'treasure'),
}

describe('random resolution', () => {
  it('is deterministic per seed and respects the monster level', () => {
    const state = world(36)
    const a = resolveRandomObjects(state, tables, createRng(1))
    const b = resolveRandomObjects(state, tables, createRng(1))
    expect([...a.entries()]).toEqual([...b.entries()])
    const randoms = [...state.objects.values()].filter((o) => o.classId === OBJECT_CLASS.RANDOM_MONSTER)
    expect(randoms.length).toBeGreaterThan(0)
    for (const o of randoms) {
      const r = a.get(o.id)
      expect(r?.classId).toBe(OBJECT_CLASS.MONSTER)
      // Synthetic Objects.txt only has creatures 0–13, so outcomes come from them.
      expect(creatureInfo(r?.subclassId as number)?.faction).toBe(0)
      expect(r?.def).toMatch(/^synmon\d+\.def$/)
    }
  })
})

describe('render objects', () => {
  const state = world(36)
  const { objects } = buildRenderObjects(state, tables, createRng(state.seed))

  it('skips hidden classes and yields body + flag per hero', () => {
    expect(objects.some((o) => HIDDEN_CLASSES.has(o.classId))).toBe(false)
    const heroes = [...state.heroes.values()]
    for (const h of heroes) {
      const entries = objects.filter((o) => o.id === h.id)
      expect(entries.map((e) => e.kind).sort()).toEqual(['heroBody', 'heroFlag'])
      expect(entries.find((e) => e.kind === 'heroFlag')?.def).toBe(`af0${h.owner}.def`)
    }
  })

  it('adds a floating generated hero at a main town with generateHero', () => {
    // The synthetic map's player 0 has a main town at (1, 1) that generates a hero.
    const generated = objects.filter((o) => o.id < 0)
    expect(generated.map((g) => g.kind).sort()).toEqual(['heroBody', 'heroFlag'])
    expect(generated.every((g) => g.floating && g.x === 2 && g.y === 1 && g.owner === 0)).toBe(true)
  })

  it('draws towns with the fort sprite and random objects as floating', () => {
    expect(objects.filter((o) => o.classId === OBJECT_CLASS.TOWN).every((o) => o.def === 'avccasx0.def')).toBe(true)
    expect(objects.filter((o) => o.random !== null).every((o) => o.floating)).toBe(true)
    expect(objects.find((o) => o.def === 'synflat.def')?.flat).toBe(true)
  })

  it('gives objects individual animation phases shared by a hero body and its flag', () => {
    expect(new Set(objects.map((o) => o.phase)).size).toBeGreaterThan(objects.length / 4)
    for (const h of state.heroes.values()) expect(new Set(objects.filter((o) => o.id === h.id).map((o) => o.phase)).size).toBe(1)
  })

  it('is identical for the same seed', () => {
    expect(buildRenderObjects(state, tables, createRng(state.seed)).objects).toEqual(objects)
  })
})

describe('shadow tint (spec 005 research "Shadow recolouring follows the object")', () => {
  const base = world(36)
  const withSoil = (version: string, soil: (x: number, y: number) => number | undefined): WorldState => {
    const terrain = base.terrain.slice()
    for (let y = 0; y < base.size; y++) for (let x = 0; x < base.size; x++) {
      const t = soil(x, y)
      if (t !== undefined) terrain[(y * base.size + x) * 7] = t
    }
    return { ...base, terrain, map: { ...base.map, version } } as WorldState
  }
  const mine = [...base.objects.values()].find((o) => o.classId !== OBJECT_CLASS.HERO && o.template.active.some((b) => b !== 0) && o.z === 0) as NonNullable<ReturnType<typeof base.objects.get>>
  const entrance = { x: mine.x, y: mine.y } // the synthetic visitable templates use the anchor tile (bit 7, row 5)
  const tintOf = (state: WorldState) => buildRenderObjects(state, tables, createRng(state.seed)).objects.find((o) => o.id === mine.id)?.shadowTint

  it('follows the soil under the entrance on HotA maps', () => {
    expect(tintOf(withSoil('HotA', (x, y) => (x === entrance.x && y === entrance.y ? 11 : undefined)))).toBe(2)
    expect(tintOf(withSoil('HotA', (x, y) => (x === entrance.x && y === entrance.y ? 1 : 11)))).toBe(1)
    expect(tintOf(withSoil('HotA', () => 4))).toBeUndefined()
  })

  it('is never set on base-game maps, where the Complete edition draws black on sand', () => {
    expect(buildRenderObjects(withSoil('SoD', () => 1), tables, createRng(1)).objects.some((o) => o.shadowTint !== undefined)).toBe(false)
  })
})

describe('object index', () => {
  it('returns exactly the objects whose sprite can reach a range', () => {
    const state = world(252)
    const { objects } = buildRenderObjects(state, tables, createRng(1))
    const index = new ObjectIndex(objects, state.size, state.levels)
    for (const range of [{ x0: 0, y0: 0, x1: 18, y1: 16 }, { x0: 100, y0: 57, x1: 130, y1: 80 }, { x0: 240, y0: 240, x1: 251, y1: 251 }]) {
      for (const z of [0, 1]) {
        const expected = objects.map((o, i) => ({ o, i })).filter(({ o }) => o.z === z && o.x >= range.x0 && o.x <= range.x1 + MAX_SPRITE_EXTENT.left && o.y >= range.y0 && o.y <= range.y1 + MAX_SPRITE_EXTENT.up).map(({ i }) => i)
        expect(index.query(z, range)).toEqual(expected)
      }
    }
  })
})
