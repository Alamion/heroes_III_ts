import { describe, expect, it } from 'vitest'
import { defaultSettings, RESERVED_KEYS, SETTINGS, validateSettings } from '../../src/adapters/shared/settings.ts'

describe('wallpaper settings definition (spec 004 FR-003)', () => {
  it('defines every setting once with lowercase ASCII keys and matching defaults', () => {
    const keys = SETTINGS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z]+$/)
    for (const k of RESERVED_KEYS) expect(keys).not.toContain(k)
    const defaults = defaultSettings()
    for (const d of SETTINGS) {
      const v = defaults[d.key]
      if (d.type === 'enum') expect(String(v)).toBe(d.default)
      else expect(v).toBe(d.default)
    }
    expect(defaults).toMatchObject({ level: 'random', viewmode: 'random', scale: 1, objects: true })
  })

  it('validates, clamps and ignores unknown keys', () => {
    const r = validateSettings({ viewx: 150, viewy: '-3', scale: 2, level: 'underground', viewmode: 'bogus', objects: 'false', mapfile: '', lodfile: 'x', hotalodfile: 'y' })
    expect(r.patch).toEqual({ viewx: 100, viewy: 0, scale: 2, level: 'underground', viewmode: 'random', objects: false, mapfile: null })
    expect(r.ignored.sort()).toEqual(['hotalodfile', 'lodfile'])
    expect(r.corrected.sort()).toEqual(['viewmode', 'viewx', 'viewy'])
  })

  it('accepts enum values as strings or numbers', () => {
    expect(validateSettings({ scale: '3' }).patch.scale).toBe(3)
    expect(validateSettings({ scale: 7 }).patch.scale).toBe(1)
    expect(validateSettings({ viewx: 'abc' }).patch.viewx).toBe(50)
  })

  it('parses typed interval text and corrects bad input', () => {
    const v = (raw: unknown) => validateSettings({ viewinterval: raw })
    expect(v('15').patch.viewinterval).toBe(15)
    expect(v(' 7 ').corrected).toEqual([])
    expect(v('1,5').patch.viewinterval).toBe(2)
    expect(v('2.4').patch.viewinterval).toBe(2)
    expect(v('-5').patch.viewinterval).toBe(0)
    expect(v('999').patch.viewinterval).toBe(120)
    for (const bad of ['', 'abc', '5 min', '1e3', 'Infinity', null, {}]) {
      expect(v(bad).patch.viewinterval, String(bad)).toBe(0)
      expect(v(bad).corrected).toEqual(['viewinterval'])
    }
    expect(v(Number.NaN).patch.viewinterval).toBe(0)
  })
})
