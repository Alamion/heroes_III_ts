import { describe, expect, it } from 'vitest'
import { projectLinks } from '../../tools/release/links.ts'
import { checkStoreText, storeDescription, storeTexts } from '../../tools/release/store-texts.ts'
import { whichFileBlock } from '../../tools/release/which-file.ts'

const links = projectLinks()
const none = projectLinks({ workshopId: null, kdeStoreUrl: null })

describe('which file do I need (spec 006 US2)', () => {
  it('names every archive and both store pages', () => {
    const b = whichFileBlock('0.1.0', links)
    for (const f of ['heroes3-living-map-wallpaper-engine-0.1.0.zip', 'heroes3-living-map-lively-0.1.0.zip', 'heroes3-living-map-kde-0.1.0.tar.gz', 'SHA256SUMS']) expect(b).toContain(f)
    expect(b).toContain('https://steamcommunity.com/sharedfiles/filedetails/?id=3808342201')
    expect(b).toContain('https://store.kde.org/p/2374098/')
    expect(b).toContain(links.pages)
    expect(b).toContain(links.issues)
  })

  it('falls back to the package and README without store pages (FR-014b)', () => {
    const b = whichFileBlock('0.1.0', none)
    expect(b).not.toMatch(/steamcommunity|store\.kde\.org|null|\(\)/)
    expect(b).toContain('heroes3-living-map-wallpaper-engine-0.1.0.zip')
    expect(b.match(/#readme/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('store texts (spec 006 FR-011–FR-013)', () => {
  it('builds five texts that pass their checks', () => {
    const texts = storeTexts('0.1.0', '### Added\n\n- First release', links)
    expect(texts.map((t) => t.name)).toEqual(['workshop-title.txt', 'workshop-description.bbcode', 'kde-store-description.bbcode', 'changenote-0.1.0.bbcode', 'kde-changelog-0.1.0.bbcode'])
    for (const t of texts) expect(checkStoreText(t), t.name).toEqual([])
    expect(texts[0]?.content).toBe('Heroes 3 Living Map\n')
  })

  it('puts English before Russian with every required point (FR-012)', () => {
    const steam = storeDescription('steam', links)
    const kde = storeDescription('kde', links)
    for (const d of [steam, kde]) {
      expect(d.indexOf('[b]English[/b]')).toBe(0)
      expect(d.indexOf('[b]Русский[/b]')).toBeGreaterThan(d.indexOf('No game files are included'))
      expect(d).toContain(links.repository)
      expect(d).toContain(`[url=${links.issues}]`)
      expect(d).toContain('GitHub Issues')
      expect(d).not.toMatch(/\{\w+\}/)
    }
    expect(steam).toContain('game\\maps.zip')
    expect(steam).toContain('[url=https://store.kde.org/p/2374098/]')
    expect(kde).toContain('qml6-module-qtwebengine')
    expect(kde).toContain('[url=https://steamcommunity.com/sharedfiles/filedetails/?id=3808342201]')
    expect(kde).not.toContain('[h')
  })

  it('leaves out a store line without its page', () => {
    expect(storeDescription('steam', none)).not.toContain('store.kde.org')
    expect(storeDescription('kde', none)).not.toContain('steamcommunity')
  })

  it('fails a text over its limit, naming bytes and excess', () => {
    const t = { name: 'workshop-description.bbcode', store: 'steam' as const, kind: 'description' as const, limit: 8000, content: 'ж'.repeat(4001) }
    expect(checkStoreText(t)).toEqual(['workshop-description.bbcode: 8002 bytes, 2 over the limit of 8000'])
  })

  it('rejects foreign links in descriptions and unsupported tags', () => {
    const t = { name: 'kde-store-description.bbcode', store: 'kde' as const, kind: 'description' as const, limit: 8000, content: '[h2]x[/h2] https://example.com' }
    expect(checkStoreText(t)).toHaveLength(3)
  })
})
