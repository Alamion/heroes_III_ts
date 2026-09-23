// HotA map format on synthetic fixtures (spec 005 FR-006, FR-007, FR-009, FR-010).
// These run without game files, so CI keeps covering the format.

import { describe, expect, it } from 'vitest'
import { parseH3m } from '../../../src/core/formats/h3m/h3m.ts'
import { featuresFor, HOTA_MAX_SUBVERSION } from '../../../src/core/formats/h3m/features.ts'
import { ByteWriter } from '../../fixtures/synthetic/writer.ts'
import { writeHotaMap } from '../../fixtures/synthetic/hota-map.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import { buildRenderObjects } from '../../../src/core/state/render-objects.ts'
import { createRng } from '../../../src/core/util/rng.ts'
import { HOTA_FACTION_COUNT, TOWN_SPRITES } from '../../../src/core/data/object-classes.ts'

const parse = (opts: Parameters<typeof writeHotaMap>[0], name = 'synthetic-hota.h3m') => parseH3m(writeHotaMap(opts), name)

describe('HotA map format', () => {
  it('reads the header of sub-version 10, including the HotA build', () => {
    const map = parse({ subVersion: 10, underground: true })
    expect(map.version).toBe('HotA')
    expect(map.versionCode).toBe(0x20)
    expect(map.subVersion).toBe(10)
    expect(map.hota?.version).toEqual({ major: 1, minor: 8, patch: 1 })
    expect(map.hota?.terrainTypeCount).toBe(12)
    expect(map.hota?.townTypeCount).toBe(12)
    expect(map.info.hasUnderground).toBe(true)
    expect(map.trailerLength).toBe(124)
  })

  it('reads sub-version 9, which has no sub-10 tails', () => {
    const nine = parse({ subVersion: 9 })
    const ten = parse({ subVersion: 10 })
    expect(nine.subVersion).toBe(9)
    expect(nine.hota?.version).toEqual({ major: 1, minor: 8, patch: 0 })
    // The sub-10 quest and seer-hut tails make the same map longer.
    expect(ten.byteLength).toBeGreaterThan(nine.byteLength)
  })

  it('accepts the HotA terrains and the victory conditions HotA adds', () => {
    const map = parse({ hotaTerrains: true })
    const terrains = new Set<number>()
    for (let o = 0; o < map.tiles.length; o += 7) terrains.add(map.tiles[o] as number)
    expect(terrains.has(10)).toBe(true)
    expect(terrains.has(11)).toBe(true)
    expect(map.victory.kind).toBe('defeatAllMonsters')
  })

  it('reads the HotA object bodies the fixture places', () => {
    const map = parse({})
    const kinds = map.objects.map((o) => `${o.classId}:${o.body.kind}`)
    expect(kinds).toContain('98:town')
    expect(kinds).toContain('71:monster')
    // Class 145 has no body in the base game and a reward block in HotA.
    expect(kinds).toContain('145:hotaReward')
    expect(kinds).toContain('83:seerHut')
  })

  it('walks the event-system block and reports its byte length', () => {
    const inactive = parse({ scriptActive: false })
    const active = parse({ scriptActive: true })
    expect(inactive.hota?.scriptBytes).toBe(0)
    expect(active.hota?.scriptBytes).toBeGreaterThan(0)
    expect(active.byteLength - inactive.byteLength).toBe(active.hota?.scriptBytes)
    expect(active.trailerLength).toBe(124)
  })

  it('fails with a typed error when the event-system block carries an unknown action', () => {
    const bytes = writeHotaMap({ scriptActive: true })
    // The fixture's only action is "show message" (29); make it an opcode no reader knows.
    const at = bytes.indexOf(29, bytes.indexOf(0x20) + 1)
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    for (let i = 0; i < bytes.length - 4; i++) {
      if (view.getInt32(i, true) === 29 && view.getInt32(i - 4, true) === 1) {
        view.setInt32(i, 9999, true)
        break
      }
    }
    expect(at).toBeGreaterThan(0)
    expect(() => parseH3m(bytes, 'bad-script.h3m')).toThrow(/unknown event-system action|TRAILING_DATA|expected/)
  })

  it('rejects a sub-version this reader does not know', () => {
    expect(() => parse({ subVersion: HOTA_MAX_SUBVERSION + 5 })).toThrow(/sub-version/)
  })

  it('rejects trailing data after the map', () => {
    const bytes = writeHotaMap({})
    const longer = new Uint8Array(bytes.length + 1)
    longer.set(bytes)
    longer[bytes.length] = 7
    expect(() => parseH3m(longer, 'trailing.h3m')).toThrow()
  })

  it('gates every HotA delta on its sub-version', () => {
    const six = featuresFor('HotA', 6)
    const ten = featuresFor('HotA', 10)
    const sod = featuresFor('SoD', null)
    // Sub 6 predates the difficulty mask and the event system; sub 10 has everything.
    expect(six.hotaEventDifficulties).toBe(false)
    expect(six.hotaEventLegacyTail).toBe(true)
    expect(six.hotaScriptSection).toBe(false)
    expect(ten.hotaScriptSection).toBe(true)
    expect(ten.hotaQuestTail).toBe(true)
    expect(ten.hotaEventLegacyTail).toBe(false)
    // A base-game version must not take any HotA branch.
    expect(Object.entries(sod).filter(([k, v]) => k.startsWith('hota') && v === true)).toEqual([])
  })

  it('still reports a genuinely unknown format', () => {
    const wog = new ByteWriter().u32(0x33).zeros(40).toBytes()
    expect(() => parseH3m(wog, 'wog.h3m')).toThrow(/not supported/)
  })
})

/**
 * The adventure sprite of a HotA town follows the fortification built, not the town hall, and the
 * capitol form is the castle with a capitol on top. Measured against HotA 1.8.1 on twenty towns of
 * four factions (spec 005 research US4); this keeps the rule covered without game files.
 */
describe('HotA town forms', () => {
  const BIT = { capitol: 1 << 2, fort: 1 << 3, citadel: 1 << 4, castle: 1 << 5 }
  const cove = TOWN_SPRITES[9] as (typeof TOWN_SPRITES)[number]

  const spritesFor = (townBuildings: (number | null)[]): string[] => {
    const map = parseH3m(writeHotaMap({ townBuildings }), 'forms.h3m')
    const state = fromH3m(map, { sha256: 'x', name: 'forms.h3m', version: map.version }, 1)
    // Towns take their sprite from the map's template and the buildings, not from Objects.txt.
    const { objects } = buildRenderObjects(state, { templates: [], artifactClasses: [] }, createRng(1))
    // The template's own town comes first; the extras follow in the order they were written.
    return objects.filter((o) => o.classId === 98).map((o) => o.def).slice(1)
  }

  it('picks the form from the fortification built', () => {
    expect(spritesFor([null, BIT.fort, BIT.fort | BIT.citadel, BIT.fort | BIT.citadel | BIT.castle])).toEqual([
      cove.village,
      cove.fort,
      cove.citadel,
      cove.castle,
    ])
  })

  it('shows the capitol form only when the castle is built too', () => {
    // A capitol without a castle is impossible in play but placeable in the editor, and the game
    // draws the fort: measured 858 differing pixels against 13 942 for the capitol form.
    expect(spritesFor([BIT.fort | BIT.capitol])).toEqual([cove.fort])
    expect(spritesFor([BIT.fort | BIT.citadel | BIT.castle | BIT.capitol])).toEqual([cove.capitol])
  })

  it('knows the twelfth faction, whose five forms ship in HotA 1.8.1', () => {
    expect(TOWN_SPRITES).toHaveLength(HOTA_FACTION_COUNT)
    expect(TOWN_SPRITES[11]).toEqual({
      village: 'avcbule0.def',
      fort: 'avcbulf0.def',
      citadel: 'avcbulc0.def',
      castle: 'avcbulx0.def',
      capitol: 'avcbulz0.def',
    })
  })
})
