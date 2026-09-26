import { describe, expect, it } from 'vitest'
import { checkBbcode, renderInline, renderMarkup, validateChangelogMarkup } from '../../tools/release/markup.ts'

const SECTION = `### Added

- **HotA** maps with *soil-tinted* shadows
- Folder of maps, see [README](https://github.com/Alamion/heroes_III_ts#readme)
  - rotation every \`N\` minutes

A closing paragraph
over two lines.`

describe('markup subset (spec 006 research R3)', () => {
  it('keeps Markdown unchanged', () => {
    expect(renderMarkup(SECTION, 'markdown')).toBe(SECTION.replace('paragraph\nover', 'paragraph over'))
  })

  it('renders Steam BBCode', () => {
    expect(renderMarkup(SECTION, 'steam')).toBe(
      '[h2]Added[/h2]\n\n[list]\n[*][b]HotA[/b] maps with [i]soil-tinted[/i] shadows\n[*]Folder of maps, see [url=https://github.com/Alamion/heroes_III_ts#readme]README[/url]\n[list]\n[*]rotation every [code]N[/code] minutes\n[/list]\n[/list]\n\nA closing paragraph over two lines.',
    )
  })

  it('renders KDE BBCode without heading tags', () => {
    const out = renderMarkup(SECTION, 'kde')
    expect(out.startsWith('[b]Added[/b]\n\n[list]')).toBe(true)
    expect(out).not.toMatch(/\[h\d\]/)
    expect(checkBbcode(out, 'kde')).toEqual([])
    expect(checkBbcode(renderMarkup(SECTION, 'steam'), 'steam')).toEqual([])
  })

  it('renders plain text with links written out', () => {
    expect(renderInline('Go to [GitHub Issues](https://github.com/x/issues), use `code`.', 'text')).toBe('Go to GitHub Issues (https://github.com/x/issues), use code.')
  })

  it('rejects everything outside the subset with the line', () => {
    const bad: [string, RegExp][] = [
      ['| a | b |', /tables/],
      ['## Heading', /###/],
      ['#### Deep', /deeper/],
      ['![img](x.png)', /images/],
      ['<b>x</b>', /HTML/],
      ['```\ncode\n```', /code blocks/],
      ['> quote', /quotes/],
      ['1. first', /numbered/],
      ['* star', /"-"/],
      ['- a\n      - too deep', /nesting/],
      ['__bold__', /underscores/],
      ['open `code', /unbalanced `/],
      ['---', /horizontal/],
    ]
    for (const [src, re] of bad) {
      expect(() => validateChangelogMarkup(`ok\n\n${src}`, 10), src).toThrow(re)
      try {
        validateChangelogMarkup(`ok\n\n${src}`, 10)
      } catch (err) {
        expect((err as { code: string; line: number }).code).toBe('MARKUP_UNSUPPORTED')
        expect((err as { line: number }).line).toBe(src.startsWith('- a') ? 15 : 14)
      }
    }
  })

  it('checks store tags and balance', () => {
    expect(checkBbcode('[table][tr][/tr][/table]', 'steam')).toHaveLength(4)
    expect(checkBbcode('[h2]x[/h2]', 'kde')[0]).toMatch(/KDE Store/)
    expect(checkBbcode('[b]x', 'steam')).toEqual(['unclosed tags: [b]'])
    expect(checkBbcode('[b][i]x[/b][/i]', 'steam').length).toBeGreaterThan(0)
  })

  it('renders pictures only where allowed (spec 006 FR-012a)', () => {
    const src = 'Intro\n\n![A snowy town](../img/snow-town.png)\n\nMore'
    const url = (f: string) => `https://raw.githubusercontent.com/Alamion/heroes_III_ts/v0.1.0/docs/img/${f}`
    expect(renderMarkup(src, 'steam', 1, { images: true, imageUrl: url })).toBe('Intro\n\n[img]https://raw.githubusercontent.com/Alamion/heroes_III_ts/v0.1.0/docs/img/snow-town.png[/img]\n\nMore')
    expect(renderMarkup(src, 'markdown', 1, { images: true })).toContain('![A snowy town](../img/snow-town.png)')
    expect(checkBbcode(renderMarkup(src, 'kde', 1, { images: true, imageUrl: url }), 'kde')).toEqual([])
    // Changelog sections never take pictures, and a picture must be a line of its own in docs/img/.
    expect(() => validateChangelogMarkup(src, 1)).toThrow(/images/)
    expect(() => renderMarkup('see ![x](../img/a.png) here', 'steam', 1, { images: true, imageUrl: url })).toThrow(/images are not supported/)
    expect(() => renderMarkup('![x](https://example.com/a.png)', 'steam', 1, { images: true, imageUrl: url })).toThrow(/line of its own/)
  })
})
