// Release tag rules (spec 006 FR-003, data-model "ReleaseTag"): checked in order before anything is
// built or published; the first failure stops the run with a code and a message naming the values.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChangelogError, changelogSection, parseChangelog } from './changelog.ts'
import { isAncestor, listTags, refExists, revParse, showFile, tagCommit } from './git.ts'
import { compareVersions, formatVersion, isPrerelease, livelyVersion, parseVersion } from './semver.ts'
import type { Version } from './semver.ts'

export type ReleaseFailureCode =
  | 'TAG_FORMAT'
  | 'TAG_MISSING'
  | 'VERSION_MISMATCH'
  | 'NOT_ON_TESTING'
  | 'VERSION_NOT_HIGHER'
  | 'TAG_TAKEN'
  | 'CHANGELOG_MISSING'
  | 'CHANGELOG_EMPTY'
  | 'CHANGELOG_FORMAT'
  | 'MARKUP_UNSUPPORTED'
  | 'LIVELY_VERSION_RANGE'

export interface ReleaseCheck {
  ok: boolean
  tag: string
  version?: string
  kind?: 'final' | 'prerelease'
  commit?: string
  livelyVersion?: number
  /** The changelog section body (Markdown) on success. */
  changelog?: string
  failure?: { code: ReleaseFailureCode; message: string }
}

export interface CheckOptions {
  tag: string
  repoRoot: string
  /** Before tagging: the tag need not exist, the commit is HEAD, files come from the working tree. */
  local?: boolean
  /** Branch the commit must be on (default: `testing` locally, `origin/testing` otherwise). */
  branch?: string
  /** Extra rule for the changelog body (spec 006 US3: the markup subset); throws with `code`. */
  validateChangelog?: (body: string, line: number) => void
}

export function checkRelease(opts: CheckOptions): ReleaseCheck {
  const { tag, repoRoot } = opts
  const local = opts.local === true
  const fail = (code: ReleaseFailureCode, message: string, extra: Partial<ReleaseCheck> = {}): ReleaseCheck => ({ ok: false, tag, ...extra, failure: { code, message } })

  const m = /^v(.+)$/.exec(tag)
  let version: Version
  try {
    if (m === null) throw new Error('a release tag is "v" followed by the version')
    version = parseVersion(m[1] as string)
  } catch (err) {
    return fail('TAG_FORMAT', `tag "${tag}": ${(err as Error).message}`)
  }
  const v = formatVersion(version)
  const kind = isPrerelease(version) ? 'prerelease' : 'final'
  const base = { version: v, kind } as const

  const existing = tagCommit(repoRoot, tag)
  let commit: string
  if (local) {
    commit = revParse(repoRoot, 'HEAD')
    if (existing !== undefined && existing !== commit) return fail('TAG_TAKEN', `tag ${tag} already exists on ${existing.slice(0, 10)}, not on HEAD ${commit.slice(0, 10)}`, base)
  } else {
    if (existing === undefined) return fail('TAG_MISSING', `tag ${tag} does not exist (push it first, or use --local before tagging)`, base)
    commit = existing
  }
  const read = (path: string): string | undefined => {
    if (!local) return showFile(repoRoot, commit, path)
    try {
      return readFileSync(join(repoRoot, path), 'utf8')
    } catch {
      return undefined
    }
  }

  const pkgText = read('package.json')
  const pkgVersion = pkgText === undefined ? undefined : (JSON.parse(pkgText) as { version?: string }).version
  if (pkgVersion !== v) return fail('VERSION_MISMATCH', `tag ${tag} but package.json says ${pkgVersion ?? '(none)'}`, { ...base, commit })

  const branch = opts.branch ?? (local ? 'testing' : 'origin/testing')
  if (!refExists(repoRoot, branch)) return fail('NOT_ON_TESTING', `branch ${branch} is not available (fetch it first)`, { ...base, commit })
  if (!isAncestor(repoRoot, commit, branch)) return fail('NOT_ON_TESTING', `commit ${commit.slice(0, 10)} is not on ${branch}`, { ...base, commit })

  if (kind === 'final') {
    for (const other of listTags(repoRoot)) {
      if (other === tag) continue
      let ov: Version
      try {
        ov = parseVersion(other.slice(1))
      } catch {
        continue
      }
      if (isPrerelease(ov)) continue
      if (compareVersions(version, ov) <= 0) return fail('VERSION_NOT_HIGHER', `${v} is not higher than the released ${formatVersion(ov)} (${other})`, { ...base, commit })
    }
  }

  let body: string
  try {
    const text = read('CHANGELOG.md')
    if (text === undefined) throw new ChangelogError('CHANGELOG_MISSING', 'CHANGELOG.md does not exist')
    const section = changelogSection(parseChangelog(text), v)
    opts.validateChangelog?.(section.body, section.line)
    body = section.body
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'CHANGELOG_MISSING' || code === 'CHANGELOG_EMPTY' || code === 'CHANGELOG_FORMAT' || code === 'MARKUP_UNSUPPORTED') return fail(code, (err as Error).message, { ...base, commit })
    throw err
  }

  let lively: number
  try {
    lively = livelyVersion(version)
  } catch (err) {
    return fail('LIVELY_VERSION_RANGE', (err as Error).message, { ...base, commit })
  }
  return { ok: true, tag, ...base, commit, livelyVersion: lively, changelog: body }
}
