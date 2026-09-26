// GitHub Release upload through the GitHub CLI (spec 006 FR-005, FR-006, FR-008, contracts/cli.md
// "publish"): create the release or fill the existing one, replace assets, keep notes a person wrote.
// Never deletes a release, an asset or a tag.

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME } from '../../src/adapters/shared/strings.ts'
import { NOTES_FILE } from './assets.ts'

/** Runs `gh` with arguments; returns stdout. Injected in tests. */
export type GhRunner = (args: readonly string[]) => string

export const realGh: GhRunner = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export interface PublishResult {
  created: boolean
  notesWritten: boolean
  uploaded: string[]
}

export function publishRelease(opts: { tag: string; version: string; prerelease: boolean; dir: string; gh?: GhRunner }): PublishResult {
  const gh = opts.gh ?? realGh
  const notes = join(opts.dir, NOTES_FILE)
  const assets = readdirSync(opts.dir)
    .filter((f) => f !== NOTES_FILE)
    .sort()
    .map((f) => join(opts.dir, f))
  let existing: { body: string; isPrerelease: boolean } | undefined
  try {
    existing = JSON.parse(gh(['release', 'view', opts.tag, '--json', 'body,isPrerelease'])) as { body: string; isPrerelease: boolean }
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? (err as Error).message)
    if (!/release not found|not found/i.test(stderr)) throw err
  }
  let created = false
  let notesWritten = false
  if (existing === undefined) {
    gh(['release', 'create', opts.tag, '--verify-tag', '--title', `${APP_NAME} ${opts.version}`, '--notes-file', notes, ...(opts.prerelease ? ['--prerelease'] : [])])
    created = true
    notesWritten = true
  } else {
    const edits: string[] = []
    // A release made by hand keeps its notes (FR-005); only an empty body is filled.
    if (existing.body.trim() === '') {
      edits.push('--notes-file', notes)
      notesWritten = true
    }
    if (opts.prerelease && !existing.isPrerelease) edits.push('--prerelease')
    if (edits.length > 0) gh(['release', 'edit', opts.tag, ...edits])
  }
  gh(['release', 'upload', opts.tag, ...assets, '--clobber'])
  return { created, notesWritten, uploaded: assets.map((a) => a.slice(opts.dir.length + 1)) }
}
