import { describe, expect, it } from 'vitest'
import { ACTIONS, SETTINGS } from '../../src/adapters/shared/settings.ts'
import { DISPLAY_KEYS, projectJson } from '../../tools/package/manifests/wallpaper-engine.ts'

type Prop = { type: string; text: string; value: unknown; order?: number; options?: { label: string; value: string }[]; condition?: string; fileType?: string; min?: number; max?: number }

describe('Wallpaper Engine project.json (spec 004 FR-014)', () => {
  const pj = projectJson() as { type: string; file: string; preview: string; general: { properties: Record<string, Prop>; localization: Record<string, Record<string, string>> } }
  const props = pj.general.properties

  it('is a web wallpaper with every setting and no old properties', () => {
    expect(pj).toMatchObject({ type: 'web', file: 'index.html' })
    const keys = Object.keys(props).filter((k) => !DISPLAY_KEYS.includes(k))
    expect(keys.sort()).toEqual([...SETTINGS, ...ACTIONS].map((d) => d.key).sort())
    expect(props.viewreroll).toMatchObject({ type: 'bool', value: false, condition: 'viewmode.value == "random"' })
    expect(props).not.toHaveProperty('lodfile')
    expect(props).not.toHaveProperty('hotalodfile')
  })

  it('leads with a read-only notice about the wallpaper-folder rule (Workshop text-element pattern)', () => {
    expect(props.notice).toMatchObject({ type: 'text', text: 'ui_notice_wallpaper_engine', order: 100 })
    for (const locale of ['en-us', 'ru-ru']) {
      expect(pj.general.localization[locale].ui_notice_wallpaper_engine).toContain('game')
      expect(pj.general.localization[locale].ui_notice_wallpaper_engine.endsWith('<br></br>')).toBe(true)
    }
  })

  it('keeps dense integer orders and separates the file settings with a spacer element', () => {
    const orders = Object.values(props).map((p) => p.order ?? 0)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(orders[0]).toBe(100)
    expect(props.spacer).toMatchObject({ type: 'text', text: 'ui_spacer_wallpaper_engine' })
    // The spacer closes the files-and-maps group (spec 007 adds the folder settings to it).
    expect(props.spacer?.order).toBe((props.mapnext?.order ?? 0) + 1)
    expect(props.mapfile?.order).toBeLessThan(props.mapfolder?.order ?? 0)
    expect(props.level?.order).toBe((props.spacer?.order ?? 0) + 1)
    for (const locale of ['en-us', 'ru-ru']) expect(pj.general.localization[locale].ui_spacer_wallpaper_engine).toBe('<br></br>')
  })

  it('presents the three file settings as text inputs (WE file dialog takes images and videos only)', () => {
    for (const key of ['spritearchive', 'dataarchive', 'mapfile']) {
      expect(props[key]?.type).toBe('textinput')
      expect(props[key]).not.toHaveProperty('fileType')
    }
    // The archives default to the README convention (files copied into a game/ subfolder); the map has
    // no default because its name is up to the owner.
    expect(props.spritearchive?.value).toBe('game/H3sprite.lod')
    expect(props.dataarchive?.value).toBe('game/h3bitmap.lod')
    expect(props.mapfile?.value).toBe('')
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

  it('shows the folder settings only with the folder source (spec 007)', () => {
    expect(props.mapfile?.condition).toBe('mapsource.value == "single"')
    for (const key of ['mapfolder', 'maprotation', 'mapsizemin', 'mapsizemax', 'mapunderground', 'mapnext']) expect(props[key]?.condition, key).toBe('mapsource.value == "folder"')
    expect(props.mapfolder).toMatchObject({ type: 'textinput', value: 'game/maps' })
    expect(props.mapnext).toMatchObject({ type: 'bool', value: false })
    expect(props.mapsource).toMatchObject({ type: 'combo', value: 'single' })
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
