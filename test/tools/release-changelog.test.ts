import { describe, expect, it } from 'vitest'
import { changelogSection, draftFromSubjects, parseChangelog } from '../../tools/release/changelog.ts'

const TEXT = `# Changelog

Intro text.

## [Unreleased]

- not yet

## [0.2.0] - 2026-10-10

### Added

- Folder of maps

## [0.1.1] - 2026-10-01

## [0.1.0] - 2026-09-30

First release.
`

describe('changelog (spec 006 FR-010, research R3)', () => {
  it('finds sections by version and ignores Unreleased', () => {
    const s = parseChangelog(TEXT)
    expect(s.map((x) => x.version)).toEqual(['0.2.0', '0.1.1', '0.1.0'])
    expect(changelogSection(s, '0.2.0')).toMatchObject({ date: '2026-10-10', body: '### Added\n\n- Folder of maps', line: 9 })
    expect(changelogSection(s, '0.1.0').body).toBe('First release.')
  })

  it('names missing and empty sections', () => {
    const s = parseChangelog(TEXT)
    expect(() => changelogSection(s, '0.3.0')).toThrow(expect.objectContaining({ code: 'CHANGELOG_MISSING' }))
    expect(() => changelogSection(s, '0.1.1')).toThrow(expect.objectContaining({ code: 'CHANGELOG_EMPTY' }))
  })

  it('lets a pre-release use its final version section', () => {
    const s = parseChangelog(TEXT)
    expect(changelogSection(s, '0.2.0-beta.1').version).toBe('0.2.0')
    expect(() => changelogSection(s, '0.3.0-rc.1')).toThrow(expect.objectContaining({ code: 'CHANGELOG_MISSING' }))
  })

  it('rejects malformed headings with the line', () => {
    expect(() => parseChangelog('## [0.1.0] - 30.09.2026\n\nx\n')).toThrow(/CHANGELOG.md:1/)
    expect(() => parseChangelog('## 0.1.0\n\nx\n')).toThrow(expect.objectContaining({ code: 'CHANGELOG_FORMAT' }))
    expect(() => parseChangelog('## [v0.1.0] - 2026-09-30\n')).toThrow(expect.objectContaining({ code: 'CHANGELOG_FORMAT' }))
  })

  it('drafts a section from feat/fix subjects without spec scopes', () => {
    const draft = draftFromSubjects(['feat(005): HotA shadows tinted by soil', 'docs(006): plan', 'fix(004): KDE stays paused', 'fix: small thing', 'merge: x'])
    expect(draft).toBe('## [Unreleased]\n\n### Added\n\n- HotA shadows tinted by soil\n\n### Fixed\n\n- KDE stays paused\n- Small thing\n')
  })
})
