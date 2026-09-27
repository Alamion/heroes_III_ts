// HotA sprite conventions (spec 005 FR-015).

import { describe, expect, it } from 'vitest'
import { SHADOW_KINDS, isFlagMarker, shadowChannel } from '../../../src/core/data/animation.ts'

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

describe('HotA flag markers', () => {
  it('reads index 5 as a flag only when the sprite marks it', () => {
    // Base game (255,255,0); HotA Inferno towns (0,255,0), Factory town forms (255,0,0).
    expect(isFlagMarker(255, 255, 0)).toBe(true)
    expect(isFlagMarker(0, 255, 0)).toBe(true)
    expect(isFlagMarker(255, 0, 0)).toBe(true)
    // The one-way portal exits fill their gate with (6,8,5) at index 5 (spec 005 research "Flag markers").
    expect(isFlagMarker(6, 8, 5)).toBe(false)
    expect(isFlagMarker(23, 20, 11)).toBe(false)
  })
})
