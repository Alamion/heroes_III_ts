// CHANGELOG.md sections (spec 006 FR-010, research R3, data-model "ChangelogSection"): one
// `## [X.Y.Z] - YYYY-MM-DD` section per version, written for users; `## [Unreleased]` is ignored.

import { readFileSync } from 'node:fs'
import { coreVersion, formatVersion, parseVersion } from './semver.ts'

export interface ChangelogSection {
  version: string
  date: string
  body: string
  /** 1-based line of the heading. */
  line: number
}

export class ChangelogError extends Error {
  readonly code: 'CHANGELOG_MISSING' | 'CHANGELOG_EMPTY' | 'CHANGELOG_FORMAT'
  constructor(code: ChangelogError['code'], message: string) {
    super(message)
    this.name = 'ChangelogError'
    this.code = code
  }
}

const VERSION_HEADING = /^## \[([^\]]+)\](?:\s+-\s+(.*))?\s*$/

export function parseChangelog(text: string, file = 'CHANGELOG.md'): ChangelogSection[] {
  const lines = text.split(/\r?\n/)
  const sections: ChangelogSection[] = []
  let current: { version: string; date: string; line: number; body: string[] } | undefined
  const close = () => {
    if (current !== undefined) sections.push({ version: current.version, date: current.date, line: current.line, body: current.body.join('\n').trim() })
    current = undefined
  }
  lines.forEach((l, i) => {
    if (!l.startsWith('## ')) {
      current?.body.push(l)
      return
    }
    close()
    const m = VERSION_HEADING.exec(l)
    if (m === null) throw new ChangelogError('CHANGELOG_FORMAT', `${file}:${i + 1}: a section heading must be "## [X.Y.Z] - YYYY-MM-DD" (got "${l}")`)
    const name = m[1] as string
    if (name.toLowerCase() === 'unreleased') return
    try {
      parseVersion(name)
    } catch (err) {
      throw new ChangelogError('CHANGELOG_FORMAT', `${file}:${i + 1}: ${(err as Error).message}`)
    }
    const date = (m[2] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ChangelogError('CHANGELOG_FORMAT', `${file}:${i + 1}: section ${name} needs a date "YYYY-MM-DD" (got "${date}")`)
    current = { version: name, date, line: i + 1, body: [] }
  })
  close()
  return sections
}

export function readChangelog(path: string): ChangelogSection[] {
  return parseChangelog(readFileSync(path, 'utf8'), path)
}

/** The section of a version; a pre-release falls back to its final version's section. */
export function changelogSection(sections: readonly ChangelogSection[], version: string): ChangelogSection {
  const core = formatVersion(coreVersion(parseVersion(version)))
  const found = sections.find((s) => s.version === version) ?? (core !== version ? sections.find((s) => s.version === core) : undefined)
  if (found === undefined) throw new ChangelogError('CHANGELOG_MISSING', `CHANGELOG.md has no section "## [${version}] - YYYY-MM-DD"${core !== version ? ` (nor [${core}])` : ''}`)
  if (found.body === '') throw new ChangelogError('CHANGELOG_EMPTY', `CHANGELOG.md section [${found.version}] (line ${found.line}) is empty`)
  return found
}

/** A draft of the next section from commit subjects (FR-010): features and fixes, spec scopes removed. */
export function draftFromSubjects(subjects: readonly string[]): string {
  const added: string[] = []
  const fixed: string[] = []
  for (const s of subjects) {
    const m = /^(feat|fix)(?:\([^)]*\))?!?:\s*(.+)$/.exec(s.trim())
    if (m === null) continue
    const text = (m[2] as string).replace(/^[-*\s]+/, '').replace(/^./, (c) => c.toUpperCase())
    if (text === '') continue
    ;(m[1] === 'feat' ? added : fixed).push(`- ${text}`)
  }
  const parts = ['## [Unreleased]']
  if (added.length > 0) parts.push('', '### Added', '', ...added)
  if (fixed.length > 0) parts.push('', '### Fixed', '', ...fixed)
  if (added.length + fixed.length === 0) parts.push('', '(no feat/fix commits since the last release)')
  return `${parts.join('\n')}\n`
}
