import { describe, expect, it } from 'vitest'
import { applyEvent, UnsupportedEventError } from '../../../src/core/sim/events.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import { OBJECT_CLASS } from '../../../src/core/data/object-classes.ts'
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
})
