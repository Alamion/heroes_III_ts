import { describe, expect, it } from 'vitest'
import { ACTIONS, SETTINGS } from '../../src/adapters/shared/settings.ts'
import { projectJson } from '../../tools/package/manifests/wallpaper-engine.ts'

type Prop = { type: string; text: string; value: unknown; options?: { label: string; value: string }[]; condition?: string; fileType?: string; min?: number; max?: number }

describe('Wallpaper Engine project.json (spec 004 FR-014)', () => {
  const pj = projectJson() as { type: string; file: string; preview: string; general: { properties: Record<string, Prop>; localization: Record<string, Record<string, string>> } }
  const props = pj.general.properties

  it('is a web wallpaper with every setting and no old properties', () => {
    expect(pj).toMatchObject({ type: 'web', file: 'index.html' })
    expect(Object.keys(props).sort()).toEqual([...SETTINGS, ...ACTIONS].map((d) => d.key).sort())
    expect(props.viewreroll).toMatchObject({ type: 'bool', value: false, condition: 'viewmode.value == "random"' })
    expect(props).not.toHaveProperty('lodfile')
    expect(props).not.toHaveProperty('hotalodfile')
  })

  it('declares file properties without a file type restriction', () => {
    for (const key of ['spritearchive', 'dataarchive', 'mapfile']) {
      expect(props[key]?.type).toBe('file')
      expect(props[key]).not.toHaveProperty('fileType')
    }
  })

  it('matches the definition for combos, sliders and conditions', () => {
    for (const def of SETTINGS) {
      const p = props[def.key] as Prop
      if (def.type === 'enum') {
        expect(p.type).toBe('combo')
        expect(p.options?.map((o) => o.value)).toEqual(def.options.map((o) => o.value))
        expect(p.value).toBe(def.default)
      }
      if (def.type === 'int' && def.input === 'number') expect(p).toMatchObject({ type: 'textinput', value: String(def.default) })
      else if (def.type === 'int') expect(p).toMatchObject({ type: 'slider', min: def.min, max: def.max, value: def.default })
    }
    expect(props.viewx?.condition).toBe('viewmode.value == "coords"')
    expect(props.viewinterval?.condition).toBe('viewmode.value == "random"')
  })

  it('localizes every token in en-us and ru-ru', () => {
    const tokens = new Set<string>()
    for (const p of Object.values(props)) {
      tokens.add(p.text)
      p.options?.forEach((o) => tokens.add(o.label))
    }
    for (const locale of ['en-us', 'ru-ru']) {
      const table = pj.general.localization[locale] as Record<string, string>
      for (const t of tokens) expect(table[t], `${locale} ${t}`).toBeTruthy()
    }
  })
})
