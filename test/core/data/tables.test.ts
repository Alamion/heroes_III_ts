import { describe, expect, it } from 'vitest'
import { HIDDEN_CLASSES, HOTA_FACTION_COUNT, OBJECT_CLASS, TOWN_SPRITES, FACTION_COUNT } from '../../../src/core/data/object-classes.ts'
import { HERO_CLASS_COUNT, HERO_TYPE_COUNT, heroClassOfType } from '../../../src/core/data/heroes.ts'
import { MAX_CREATURE_ID, creatureInfo, creaturesOfLevel } from '../../../src/core/data/creatures.ts'
import { NEUTRAL_SLOT, PLAYER_FLAG_SHADES, flagColors } from '../../../src/core/data/players.ts'
import { SHADOW_KINDS, FLAG_INDEX, shadowChannel } from '../../../src/core/data/animation.ts'
import { parseRiffPal } from '../../../src/core/formats/pal/riff-pal.ts'
import { parseArtTraits } from '../../../src/core/formats/text/artraits.ts'
import { FormatError } from '../../../src/core/util/errors.ts'
import { syntheticPlayersPalette, writeRiffPal } from '../../fixtures/synthetic/object-defs.ts'

describe('object tables', () => {
  it('hides events and the grail only', () => {
    expect([...HIDDEN_CLASSES].sort()).toEqual([OBJECT_CLASS.EVENT, OBJECT_CLASS.GRAIL].sort())
  })

  it('has five distinct town sprites per faction, including the HotA factions', () => {
    // Base-game factions plus HotA's Cove and Factory (spec 005 FR-013).
    expect(TOWN_SPRITES).toHaveLength(HOTA_FACTION_COUNT)
    expect(HOTA_FACTION_COUNT).toBe(FACTION_COUNT + 2)
    for (const t of TOWN_SPRITES) {
      const forms = [t.village, t.fort, t.citadel, t.castle, t.capitol].filter((d): d is string => d !== null)
      expect(forms).toHaveLength(5)
      expect(new Set(forms).size).toBe(5)
      for (const d of forms) expect(d).toBe(d.toLowerCase())
    }
  })
})

describe('hero tables', () => {
  it('maps every base-game hero type to a class', () => {
    expect(HERO_TYPE_COUNT).toBe(156)
    for (let t = 0; t < HERO_TYPE_COUNT; t++) {
      const c = heroClassOfType(t)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(HERO_CLASS_COUNT)
    }
    expect(heroClassOfType(0)).toBe(0)
    expect(heroClassOfType(143)).toBe(17)
    expect(heroClassOfType(156)).toBeUndefined()
  })
})

describe('creature table', () => {
  it('gives a level to every used creature id', () => {
    const unused = new Set([122, 124, 126, 128])
    for (let id = 0; id <= MAX_CREATURE_ID; id++) {
      const info = creatureInfo(id)
      if (unused.has(id)) expect(info).toBeUndefined()
      else expect(info?.level).toBeGreaterThanOrEqual(1)
    }
    expect(creatureInfo(0)).toEqual({ faction: 0, level: 1, upgraded: false })
    expect(creatureInfo(13)).toEqual({ faction: 0, level: 7, upgraded: true })
    expect(creatureInfo(111)).toEqual({ faction: 7, level: 7, upgraded: true })
  })

  it('has creatures of every level for every town', () => {
    for (let level = 1; level <= 7; level++) {
      const factions = new Set(creaturesOfLevel(level).map((id) => creatureInfo(id)?.faction))
      for (let f = 0; f < FACTION_COUNT; f++) expect(factions.has(f)).toBe(true)
    }
  })
})

describe('flag colours and shadows', () => {
  it('reads flag colours from the palette, not from literals', () => {
    const pal = parseRiffPal(writeRiffPal(syntheticPlayersPalette()), 'game.pal')
    const colors = flagColors({ 'game.pal': pal })
    expect(colors).toHaveLength((NEUTRAL_SLOT + 1) * 3)
    PLAYER_FLAG_SHADES.forEach((s, i) => {
      expect(Array.from(colors.subarray(i * 3, i * 3 + 3))).toEqual(Array.from(pal.subarray(s.entry * 3, s.entry * 3 + 3)))
    })
  })

  it('never treats the flag index as a shadow', () => {
    expect(SHADOW_KINDS.has(FLAG_INDEX)).toBe(false)
    expect(SHADOW_KINDS.has(0)).toBe(false)
  })

  it('darkens 5/6-bit channels as measured (dark halves, light keeps three quarters)', () => {
    // Pairs measured on test_map.h3m stills (5-bit red of the display colour).
    for (const [c, d] of [[8, 4], [9, 4], [10, 5], [13, 6], [18, 9]]) expect(shadowChannel(c as number, 'dark')).toBe(d)
    for (const [c, l] of [[8, 6], [9, 6], [10, 7], [12, 9], [14, 10], [16, 12], [20, 15], [26, 19]]) expect(shadowChannel(c as number, 'light')).toBe(l)
    for (let c = 0; c < 64; c++) {
      expect(shadowChannel(c, 'dark')).toBeLessThanOrEqual(c)
      expect(shadowChannel(c, 'light')).toBeLessThanOrEqual(c)
    }
  })
})

describe('RIFF palette', () => {
  it('round-trips 256 colours and rejects other files', () => {
    const colors = syntheticPlayersPalette()
    expect(parseRiffPal(writeRiffPal(colors), 'p.pal')).toEqual(colors)
    expect(() => parseRiffPal(new Uint8Array(40), 'x.pal')).toThrow(FormatError)
  })
})

describe('ArtTraits.txt', () => {
  const row = (name: string, cls: string, desc: string) => [name, '100', ...Array.from({ length: 19 }, () => ' '), cls, desc].join('\t')
  it('reads classes in id order with quoted multi-line descriptions and trailing blank rows', () => {
    const text = ['\t\tHero Slots', 'Name\tCost', row('Book', 'S', '"{Book}\n\nline\twith tab"'), row('Sword', 'T', '"x"'), row('Crown', 'R', 'plain'), row('', '', '')].join('\r\n')
    expect(parseArtTraits(new TextEncoder().encode(text))).toEqual(['special', 'treasure', 'relic'])
  })

  it('fails on an unknown class letter', () => {
    const text = ['h', 'h', row('Odd', 'Q', 'x')].join('\n')
    expect(() => parseArtTraits(new TextEncoder().encode(text))).toThrow(FormatError)
  })
})
