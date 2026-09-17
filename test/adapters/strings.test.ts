import { describe, expect, it } from 'vitest'
import { ACTIONS, SETTINGS } from '../../src/adapters/shared/settings.ts'
import { en, format, pickLanguage, ru } from '../../src/adapters/shared/strings.ts'
import type { StringKey } from '../../src/adapters/shared/strings.ts'
import { messageText } from '../../src/adapters/shared/messages.ts'
import type { MessageCode } from '../../src/adapters/shared/messages.ts'

const CODES: MessageCode[] = ['LOADING', 'FILE_MISSING', 'FILE_UNREADABLE', 'WRONG_KIND', 'UNKNOWN_FILE', 'UNSUPPORTED_MAP', 'CORRUPT_FILE', 'DATA_ARCHIVE_MISSING', 'WEBGL_UNAVAILABLE', 'CONTEXT_LOST', 'CACHE_UNAVAILABLE']

describe('string tables (spec 004 FR-003b)', () => {
  it('have the same non-empty keys in English and Russian', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
    for (const k of Object.keys(en) as StringKey[]) {
      expect(en[k].trim(), k).not.toBe('')
      expect(ru[k].trim(), k).not.toBe('')
      const params = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(params(ru[k]), k).toEqual(params(en[k]))
    }
  })

  it('cover every setting label, option label, hint and message code', () => {
    for (const d of SETTINGS) {
      expect(en).toHaveProperty(d.label)
      if (d.type === 'enum') for (const o of d.options) expect(en).toHaveProperty(o.label)
      if (d.type === 'int' && d.hint !== undefined) expect(en).toHaveProperty(d.hint)
    }
    for (const a of ACTIONS) expect(en).toHaveProperty(a.label)
    for (const c of CODES) expect(en).toHaveProperty(`msg_${c}`)
  })

  it('picks Russian for ru tags and English otherwise', () => {
    expect(pickLanguage('ru-RU')).toBe('ru')
    expect(pickLanguage('ru')).toBe('ru')
    expect(pickLanguage('ru_RU')).toBe('ru')
    expect(pickLanguage('de-DE')).toBe('en')
    expect(pickLanguage('rus')).toBe('en')
    expect(pickLanguage('')).toBe('en')
    expect(pickLanguage(null)).toBe('en')
  })

  it('formats messages with parameters', () => {
    expect(format('en', 'msg_LOADING', { file: 'a.lod' })).toBe('Loading a.lod…')
    expect(messageText('ru', { code: 'WRONG_KIND', level: 'error', file: 'x.h3m', expected: 'spriteArchive', found: 'map' })).toBe('x.h3m — это карта (.h3m), а не архив спрайтов (H3sprite.lod).')
  })
})
