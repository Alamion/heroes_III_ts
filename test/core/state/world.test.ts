import { describe, expect, it } from 'vitest'
import { applyEvent, UnsupportedEventError } from '../../../src/core/sim/events.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import { OBJECT_CLASS } from '../../../src/core/data/object-classes.ts'
import { maskOffsets } from '../../../src/core/formats/h3m/types.ts'
import { allBodiesMap } from '../../fixtures/synthetic/h3m.ts'

describe('world state', () => {
  const map = allBodiesMap('SoD')
  const state = fromH3m(map, { sha256: 'abc', name: 'syn.h3m', version: 'SoD' })

  it('is built from a parsed map', () => {
    expect(state.size).toBe(36)
    expect(state.levels).toBe(2)
    expect(state.terrain).toBe(map.tiles)
    expect(state.objects.size).toBe(map.objects.length)
    expect(state.day).toBe(1)
    expect(state.animationTimeMs).toBe(0)
    const heroes = [...state.heroes.values()]
    expect(heroes.every((h) => state.objects.get(h.id)?.classId !== OBJECT_CLASS.PRISON)).toBe(true)
    const randomTown = [...state.towns.values()].find((t) => t.faction === 'random')
    expect(randomTown?.owner).toBe(0)
    const random = [...state.objects.values()].filter((o) => o.random !== null)
    expect(random.map((o) => o.random?.kind)).toContain('dwelling')
    expect(state.players[0]?.mainTown).toEqual({ x: 1, y: 1, z: 0, generateHero: true })
  })

  it('changes only through simulation events, sharing unchanged data', () => {
    const next = applyEvent(state, { kind: 'advanceTime', deltaMs: 180 })
    expect(next.animationTimeMs).toBe(180)
    expect(next.terrain).toBe(state.terrain)
    expect(next.objects).toBe(state.objects)
    expect(state.animationTimeMs).toBe(0)
    expect(applyEvent(next, { kind: 'setTime', timeMs: 5 }).animationTimeMs).toBe(5)
    expect(applyEvent(state, { kind: 'advanceTime', deltaMs: 0 })).toBe(state)
    expect(() => applyEvent(state, { kind: 'advanceTime', deltaMs: -1 })).toThrow(RangeError)
    expect(() => applyEvent(state, { kind: 'dayAdvanced' })).toThrow(UnsupportedEventError)
  })

  it('puts a hero stored at a town\'s own position into the town gate', () => {
    // Editors store a hero standing in a town with the town's coordinates (every local SoD and HotA
    // map); the game shows it in the gate, i.e. its visit tile is the town's entrance.
    const town = map.objects.find((o) => o.body.kind === 'town') as (typeof map.objects)[number]
    const hero = map.objects.find((o) => o.classId === OBJECT_CLASS.HERO) as (typeof map.objects)[number]
    const other = map.objects.find((o) => o.classId === OBJECT_CLASS.TREASURE_CHEST) as (typeof map.objects)[number]
    const moved = { ...map, objects: map.objects.map((o) => (o === hero || o === other ? { ...o, x: town.x, y: town.y, z: town.z } : o)) }
    const inTown = fromH3m(moved, { sha256: 'abc', name: 'syn.h3m', version: 'SoD' })
    const gate = maskOffsets(map.templates[town.templateIndex]?.active as Uint8Array)[0] as { dx: number; dy: number }
    const expected = { x: town.x + gate.dx + 1, y: town.y + gate.dy }
    expect(inTown.heroes.get(hero.index)).toMatchObject(expected)
    expect(inTown.objects.get(hero.index)).toMatchObject(expected)
    // Other objects keep their position.
    expect(inTown.objects.get(other.index)).toMatchObject({ x: town.x, y: town.y })
  })
})
