import { describe, expect, it } from 'vitest'
import { ACTIONS, defaultSettings, MAP_SIZE_SETTINGS, SETTINGS, validateSettings } from '../../src/adapters/shared/settings.ts'
import { SIZE_CLASS_IDS } from '../../src/core/data/map-sizes.ts'

describe('wallpaper settings definition (spec 004 FR-003)', () => {
  it('defines every setting once with lowercase ASCII keys and matching defaults', () => {
    const keys = SETTINGS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z]+$/)
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
    expect(v('999').patch.viewinterval).toBe(999)
    expect(v('1440').patch.viewinterval).toBe(1440)
    expect(v('5000').patch.viewinterval).toBe(1440)
    for (const bad of ['', 'abc', '5 min', '1e3', 'Infinity', null, {}]) {
      expect(v(bad).patch.viewinterval, String(bad)).toBe(0)
      expect(v(bad).corrected).toEqual(['viewinterval'])
    }
    expect(v(Number.NaN).patch.viewinterval).toBe(0)
  })
})

describe('map folder settings (spec 007 contracts/settings.md)', () => {
  it('the keys reserved by spec 004 carry their reserved meaning, next to the filters and the action', () => {
    const keys = SETTINGS.map((d) => d.key)
    for (const k of ['mapsource', 'mapfolder', 'maprotation', 'mapsizemin', 'mapsizemax', 'mapunderground']) expect(keys).toContain(k)
    expect(ACTIONS.map((a) => a.key)).toEqual(['mapnext', 'viewreroll'])
    expect(defaultSettings()).toMatchObject({ mapsource: 'single', mapfolder: null, maprotation: 0, mapsizemin: 's', mapsizemax: 'g', mapunderground: 'any' })
    for (const k of ['mapfolder', 'maprotation', 'mapsizemin', 'mapsizemax', 'mapunderground']) expect(SETTINGS.find((d) => d.key === k)?.visibleWhen).toEqual({ key: 'mapsource', equals: 'folder' })
    expect(SETTINGS.find((d) => d.key === 'mapfile')?.visibleWhen).toEqual({ key: 'mapsource', equals: 'single' })
  })

  it('size settings list the size classes of the core table', () => {
    expect([...MAP_SIZE_SETTINGS]).toEqual([...SIZE_CLASS_IDS])
  })

  it('validates the new values', () => {
    expect(validateSettings({ mapsource: 'folder', mapfolder: ' game/maps ', mapsizemin: 'm', mapsizemax: 'xh', mapunderground: 'two' }).patch).toEqual({ mapsource: 'folder', mapfolder: ' game/maps ', mapsizemin: 'm', mapsizemax: 'xh', mapunderground: 'two' })
    const bad = validateSettings({ mapsource: 'cloud', mapsizemin: 'huge', mapunderground: 3, mapfolder: '  ' })
    expect(bad.patch).toEqual({ mapsource: 'single', mapsizemin: 's', mapunderground: 'any', mapfolder: null })
    expect(bad.corrected.sort()).toEqual(['mapsizemin', 'mapsource', 'mapunderground'])
    const r = (raw: unknown) => validateSettings({ maprotation: raw }).patch.maprotation
    expect([r('30'), r('1,5'), r('-2'), r('9999'), r('five')]).toEqual([30, 2, 0, 1440, 0])
  })

  it('settings stored by the previous version keep their meaning (SC-006)', () => {
    const old = { spritearchive: 'game/H3sprite.lod', dataarchive: 'game/h3bitmap.lod', mapfile: 'game/Arrogance.h3m', level: 'surface', viewmode: 'coords', viewx: 20, viewy: 70, viewinterval: 5, scale: '2', objects: true }
    const r = validateSettings(old)
    expect(r.ignored).toEqual([])
    expect(r.corrected).toEqual([])
    const settings = { ...defaultSettings(), ...r.patch }
    expect(settings).toMatchObject({ mapsource: 'single', mapfile: 'game/Arrogance.h3m', level: 'surface', viewmode: 'coords', viewx: 20, viewy: 70, viewinterval: 5, scale: 2 })
  })
})
