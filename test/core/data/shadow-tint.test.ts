import { describe, expect, it } from 'vitest'
import { SHADOW_TINT, SHADOW_TINT_WEIGHT, shadowChannel, shadowTintOfTerrain, shadowTintOfWeight } from '../../../src/core/data/animation.ts'

const channels = [0, 1, 2] as const

describe('HotA shadow tints (spec 005 research "Shadow recolouring")', () => {
  it('keeps the base-game shifts for black', () => {
    for (const c of [0, 1, 17, 31, 63]) {
      expect(shadowChannel(c, 'dark')).toBe(c >> 1)
      expect(shadowChannel(c, 'light')).toBe((c >> 1) + (c >> 2))
      for (const ch of channels) expect(shadowChannel(c, 'dark', SHADOW_TINT.black, ch)).toBe(c >> 1)
    }
  })

  it('keeps 7/8 and 5/8 for the HotA-only strengths in black', () => {
    for (const c of [0, 9, 20, 31, 63]) {
      expect(shadowChannel(c, 'faint')).toBe((c >> 1) + (c >> 2) + (c >> 3))
      expect(shadowChannel(c, 'medium')).toBe((c >> 1) + (c >> 3))
    }
  })

  it('adds a dark brown on sand', () => {
    for (const c of [0, 9, 20, 31]) {
      expect(channels.map((ch) => shadowChannel(c, 'dark', SHADOW_TINT.sand, ch))).toEqual([(c >> 1) + 3, (c >> 1) + 1, c >> 1])
      expect(channels.map((ch) => shadowChannel(c, 'light', SHADOW_TINT.sand, ch))).toEqual([(c >> 1) + (c >> 2) + 1, (c >> 1) + (c >> 2), (c >> 1) + (c >> 2)])
    }
  })

  it('blends towards (3, 2, 0) on wasteland with α = k × 0.15 for the four strengths', () => {
    expect(channels.map((ch) => shadowChannel(20, 'dark', SHADOW_TINT.wasteland, ch))).toEqual([(20 * 51 + 231) >> 7, (20 * 51 + 154) >> 7, (20 * 51) >> 7])
    expect(channels.map((ch) => shadowChannel(40, 'light', SHADOW_TINT.wasteland, ch))).toEqual([(40 * 179 + 231) >> 8, (40 * 179 + 154) >> 8, (40 * 179) >> 8])
    expect(channels.map((ch) => shadowChannel(23, 'medium', SHADOW_TINT.wasteland, ch))).toEqual([(23 * 141 + 3 * 115) >> 8, (23 * 141 + 2 * 115) >> 8, (23 * 141) >> 8])
    expect(channels.map((ch) => shadowChannel(20, 'faint', SHADOW_TINT.wasteland, ch))).toEqual([(20 * 218 + 3 * 38) >> 8, (20 * 218 + 2 * 38) >> 8, (20 * 218) >> 8])
    // Stronger than black at full brightness, yet black never becomes lighter than the tint colour.
    expect(shadowChannel(31, 'dark', SHADOW_TINT.wasteland, 2)).toBeLessThan(shadowChannel(31, 'dark'))
    expect(shadowChannel(0, 'dark', SHADOW_TINT.wasteland, 0)).toBe(1)
  })

  it('picks the tint from the soil and from accumulated weights', () => {
    expect(shadowTintOfTerrain(1)).toBe(SHADOW_TINT.sand)
    expect(shadowTintOfTerrain(11)).toBe(SHADOW_TINT.wasteland)
    for (const t of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(shadowTintOfTerrain(t)).toBe(SHADOW_TINT.black)
    expect(shadowTintOfWeight(0)).toBe(SHADOW_TINT.black)
    expect(shadowTintOfWeight(SHADOW_TINT_WEIGHT[1] * 3)).toBe(SHADOW_TINT.sand)
    expect(shadowTintOfWeight(SHADOW_TINT_WEIGHT[2] + SHADOW_TINT_WEIGHT[1])).toBe(SHADOW_TINT.wasteland)
  })
})
