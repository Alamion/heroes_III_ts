// Release assets (spec 006 FR-005, data-model "ReleaseAssets"): the four host archives, the store
// texts, SHA256SUMS over all of them, and release-notes.md (used only when the GitHub Release has no
// notes yet). Byte-identical for the same inputs.

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ToolError, TOOL_ERROR_CODES } from '../shared/errors.ts'
import { HOSTS } from '../package/build.ts'
import { artifactName } from '../package/cli.ts'

export interface ReleaseText {
  name: string
  content: string
}

export interface AssetOptions {
  version: string
  /** `yarn package` output with the four archives. */
  packagesDir: string
  /** Folder for this version (emptied first). */
  outDir: string
  /** The changelog section body (Markdown). */
  changelog: string
  /** Appended to the notes after the changelog (the "which file do I need" block, feedback line). */
  notesFooter?: string
  /** Store texts written next to the archives and covered by SHA256SUMS. */
  texts?: readonly ReleaseText[]
}

export interface AssetFile {
  name: string
  bytes: number
  sha256: string
}

export const NOTES_FILE = 'release-notes.md'
export const SUMS_FILE = 'SHA256SUMS'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

export function writeReleaseAssets(opts: AssetOptions): AssetFile[] {
  const archives = HOSTS.map((h) => artifactName(h, opts.version))
  for (const a of archives) {
    if (!existsSync(join(opts.packagesDir, a))) throw new ToolError(TOOL_ERROR_CODES.PREREQ_MISSING, `${a} is missing in ${opts.packagesDir}: run yarn package first (or pass --build)`)
  }
  rmSync(opts.outDir, { recursive: true, force: true })
  mkdirSync(opts.outDir, { recursive: true })
  for (const a of archives) copyFileSync(join(opts.packagesDir, a), join(opts.outDir, a))
  for (const t of opts.texts ?? []) writeFileSync(join(opts.outDir, t.name), t.content)
  const files: AssetFile[] = [...archives, ...(opts.texts ?? []).map((t) => t.name)]
    .sort()
    .map((name) => {
      const data = readFileSync(join(opts.outDir, name))
      return { name, bytes: data.length, sha256: sha256(data) }
    })
  // `sha256sum -c SHA256SUMS` format: "<hash>  <name>".
  writeFileSync(join(opts.outDir, SUMS_FILE), files.map((f) => `${f.sha256}  ${f.name}\n`).join(''))
  const notes = [opts.changelog.trim(), ...(opts.notesFooter !== undefined ? [opts.notesFooter.trim()] : [])].join('\n\n')
  writeFileSync(join(opts.outDir, NOTES_FILE), `${notes}\n`)
  return files
}
