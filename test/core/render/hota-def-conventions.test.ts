// HotA sprite conventions (spec 005 FR-015).

import { describe, expect, it } from 'vitest'
import { SHADOW_KINDS, shadowChannel } from '../../../src/core/data/animation.ts'
import { flagIndexFor, HOTA_FLAG_AT_255 } from '../../../src/core/data/hota-def-conventions.ts'

describe('HotA shadow indices', () => {
  it('gives indices 3 and 2 their own strengths, between and around the base ones', () => {
    // Measured on HotA captures (spec 005 research "Four shadow strengths"): 3 is the faintest,
    // then 1, 2 and 4, which matches the markers (255,50,255), (255,150,255), (255,100,255), (255,0,255).
    expect(SHADOW_KINDS.get(3)).toBe('faint')
    expect(SHADOW_KINDS.get(1)).toBe('light')
    expect(SHADOW_KINDS.get(2)).toBe('medium')
    expect(SHADOW_KINDS.get(4)).toBe('dark')
  })

  it('keeps the measured darkening of each kind', () => {
    // Black keeps 7/8, 3/4, 5/8 and 1/2 through shifts, on 5/6-bit channels.
    expect(shadowChannel(31, 'faint')).toBe(15 + 7 + 3)
    expect(shadowChannel(31, 'light')).toBe(15 + 7)
    expect(shadowChannel(31, 'medium')).toBe(15 + 3)
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
