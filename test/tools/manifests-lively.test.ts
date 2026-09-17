import { describe, expect, it } from 'vitest'
import { ACTIONS, SETTINGS } from '../../src/adapters/shared/settings.ts'
import { livelyInfo, livelyProperties, livelyPropertiesLoc } from '../../tools/package/manifests/lively.ts'

type Control = { type: string; text: string; items?: string[]; value: unknown; folder?: string; filter?: string; help?: string }

describe('Lively manifests (spec 004 FR-016)', () => {
  it('is a web wallpaper with pause events', () => {
    expect(livelyInfo()).toMatchObject({ Type: 1, FileName: 'index.html', Arguments: '--pause-event true', IsAbsolutePath: false })
  })

  it('maps settings to Lively controls in definition order', () => {
    const props = livelyProperties() as Record<string, Control>
    expect(Object.keys(props)).toEqual([...SETTINGS, ...ACTIONS].sort((a, b) => a.order - b.order).map((d) => d.key))
    expect(props.viewreroll).toMatchObject({ type: 'button' })
    for (const def of SETTINGS) {
      const c = props[def.key] as Control
      if (def.type === 'file') expect(c).toMatchObject({ type: 'folderDropdown', folder: 'userfiles', filter: def.fileFilter, value: null })
      if (def.type === 'enum') {
        expect(c.type).toBe('dropdown')
        expect(c.items).toHaveLength(def.options.length)
        expect(c.value).toBe(def.options.findIndex((o) => o.value === def.default))
      }
      if (def.type === 'int' && def.input === 'number') expect(c).toMatchObject({ type: 'textbox', value: String(def.default) })
      else if (def.type === 'int') expect(c).toMatchObject({ type: 'slider', min: def.min, max: def.max, value: def.default })
      if (def.type === 'bool') expect(c).toMatchObject({ type: 'checkbox', value: def.default })
    }
  })

  it('localizes every control in Russian', () => {
    const props = livelyProperties() as Record<string, Control>
    const ru = (livelyPropertiesLoc() as { Languages: { ru: Record<string, Control> } }).Languages.ru
    for (const [key, c] of Object.entries(props)) {
      expect(ru[key]?.text, key).toBeTruthy()
      expect(ru[key]?.text).not.toBe(c.text)
      if (c.items !== undefined) expect(ru[key]?.items).toHaveLength(c.items.length)
    }
  })
})
