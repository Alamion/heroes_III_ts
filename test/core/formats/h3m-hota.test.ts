// HotA map format on synthetic fixtures (spec 005 FR-006, FR-007, FR-009, FR-010).
// These run without game files, so CI keeps covering the format.

import { describe, expect, it } from 'vitest'
import { parseH3m } from '../../../src/core/formats/h3m/h3m.ts'
import { featuresFor, HOTA_MAX_SUBVERSION } from '../../../src/core/formats/h3m/features.ts'
import { ByteWriter } from '../../fixtures/synthetic/writer.ts'
import { writeHotaMap } from '../../fixtures/synthetic/hota-map.ts'

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
