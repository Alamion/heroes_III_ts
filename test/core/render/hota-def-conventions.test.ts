// HotA sprite conventions (spec 005 FR-015).

import { describe, expect, it } from 'vitest'
import { SHADOW_KINDS, shadowChannel } from '../../../src/core/data/animation.ts'
import { flagIndexFor, HOTA_FLAG_AT_255 } from '../../../src/core/data/hota-def-conventions.ts'

describe('HotA shadow indices', () => {
  it('treats index 3 like the base light shadow and index 2 like the base dark one', () => {
    // Measured: HotA sprites shade with indices 2 and 3, where 3 behaves like base index 1 and 2
    // like base index 4 (spec 005 T041 sweep).
    expect(SHADOW_KINDS.get(3)).toBe(SHADOW_KINDS.get(1))
    expect(SHADOW_KINDS.get(2)).toBe(SHADOW_KINDS.get(4))
    expect(SHADOW_KINDS.get(1)).toBe('light')
    expect(SHADOW_KINDS.get(4)).toBe('dark')
  })

  it('keeps the measured darkening of each kind', () => {
    // light → (c >> 1) + (c >> 2), dark → c >> 1, on 5/6-bit channels.
    expect(shadowChannel(31, 'light')).toBe(15 + 7)
    expect(shadowChannel(31, 'dark')).toBe(15)
    expect(shadowChannel(63, 'light')).toBe(31 + 15)
    expect(shadowChannel(63, 'dark')).toBe(31)
  })

  it('does not treat the base-game colour indices as shadows', () => {
    for (const index of [5, 8, 100, 254, 255]) expect(SHADOW_KINDS.get(index)).toBeUndefined()
  })
})

describe('HotA flag colour index', () => {
  it('moves the flag slot to 255 only for the listed sprites', () => {
    expect(flagIndexFor('avwjugg.def', 5)).toBe(255)
    expect(flagIndexFor('AVWJUGG.DEF', 5)).toBe(255)
    expect(flagIndexFor('avccasx0.def', 5)).toBe(5)
    expect(flagIndexFor('ah00_.def', 5)).toBe(5)
  })

  it('keeps the list small, since index 255 is an ordinary colour elsewhere', () => {
    // 1052 of 1369 base-game adventure sprites use index 255 as a normal colour, so this rule can
    // only ever be a short, explicit list (spec 005 R10).
    expect(HOTA_FLAG_AT_255.size).toBeLessThan(20)
    for (const name of HOTA_FLAG_AT_255) expect(name).toBe(name.toLowerCase())
  })
})
