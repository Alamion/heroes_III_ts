import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { BaselineProfile } from '../data/baselines.ts'
import type { WhitelistEntry } from '../data/staging-whitelist.ts'
import { ERROR_CODES, RefError } from '../errors.ts'

/** File name of the map inside the staging root's Maps/ folder. */
export const STAGED_MAP_NAME = 'reference.h3m'

export interface StagingAction {
  kind: 'copy' | 'symlink' | 'mkdir' | 'map' | 'text'
  from?: string
  to: string
  rewrite?: WhitelistEntry['rewrite']
}

export type ListDir = (dir: string) => string[]

const defaultListDir: ListDir = (dir) => (existsSync(dir) ? readdirSync(dir) : [])

/** Resolves a relative path case-insensitively, segment by segment. */
export function resolveCaseInsensitive(root: string, relPath: string, listDir: ListDir = defaultListDir): string | undefined {
  let current = root
  for (const segment of relPath.split('/')) {
    const match = listDir(current).find((n) => n.toLowerCase() === segment.toLowerCase())
    if (match === undefined) return undefined
    current = join(current, match)
  }
  return current
}

export function planStaging(
  profile: BaselineProfile,
  bundleDir: string,
  mapPath: string | undefined,
  listDir: ListDir = defaultListDir,
): StagingAction[] {
  const actions: StagingAction[] = [
    { kind: 'mkdir', to: 'Data' },
    { kind: 'mkdir', to: 'Maps' },
    { kind: 'mkdir', to: 'Games' },
  ]
  const missing: string[] = []
  for (const entry of profile.whitelist) {
    const src = resolveCaseInsensitive(bundleDir, entry.path, listDir)
    if (src === undefined) {
      if (entry.required) missing.push(entry.path)
      continue
    }
    if (profile.neverStage.some((p) => p.test(basename(entry.path)))) {
      throw new RefError(ERROR_CODES.CONFIG_INVALID, `whitelist entry ${entry.path} matches a name forbidden for the ${profile.id} baseline`)
    }
    actions.push({ kind: entry.mode, from: src, to: entry.path, ...(entry.rewrite !== undefined ? { rewrite: entry.rewrite } : {}) })
  }
  if (missing.length > 0) {
    throw new RefError(
      ERROR_CODES.PREREQ_MISSING,
      `the ${profile.id} game folder is missing required files: ${missing.join(', ')}`,
      { details: { baseline: profile.id, bundleDir, missing } },
    )
  }
  // The map is staged under a fixed ASCII name: the game lists no scenarios when the file name
  // cannot be represented in the Windows code page (e.g. Cyrillic names under an English locale).
  if (mapPath !== undefined) actions.push({ kind: 'map', from: mapPath, to: `Maps/${STAGED_MAP_NAME}` })
  return actions
}

function sameFile(a: string, b: string): boolean {
  if (!existsSync(b)) return false
  const sa = statSync(a)
  const sb = statSync(b)
  return sa.size === sb.size && Math.floor(sa.mtimeMs) === Math.floor(sb.mtimeMs)
}

/** Applies a plan idempotently. Maps/ is emptied first so it holds only the requested map. */
export function applyStaging(plan: StagingAction[], stagingRoot: string): void {
  mkdirSync(stagingRoot, { recursive: true })
  const mapsDir = join(stagingRoot, 'Maps')
  if (existsSync(mapsDir)) rmSync(mapsDir, { recursive: true, force: true })
  for (const a of plan) {
    const to = join(stagingRoot, a.to)
    if (a.kind === 'mkdir') {
      mkdirSync(to, { recursive: true })
      continue
    }
    const from = a.from as string
    mkdirSync(dirname(to), { recursive: true })
    if (a.kind === 'text') {
      // Configuration the game may rewrite: staged as a private copy, so a write from inside the
      // game can never reach the original installation.
      const wanted = (a.rewrite ?? ((t: string) => t))(readFileSync(from, 'utf8'))
      if (!existsSync(to) || readFileSync(to, 'utf8') !== wanted) writeFileSync(to, wanted)
    } else if (a.kind === 'symlink') {
      let exists = false
      try {
        exists = lstatSync(to).isSymbolicLink() && readlinkSync(to) === from
        if (!exists) unlinkSync(to)
      } catch {
        // Not present yet.
      }
      if (!exists) symlinkSync(from, to)
    } else if (!sameFile(from, to)) {
      copyFileSync(from, to)
      // Keep mtime so sameFile() recognises the copy next time.
      const st = statSync(from)
      utimesSync(to, st.atime, st.mtime)
    }
  }
}

export interface ManifestEntry {
  relPath: string
  size: number
  mtimeMs: number
}

/** Top-level files and Data/ of the bundle: used to prove the tooling never modifies it. */
export function bundleManifest(bundleDir: string): ManifestEntry[] {
  const out: ManifestEntry[] = []
  for (const sub of ['', 'Data']) {
    const dir = join(bundleDir, sub)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const st = statSync(join(dir, name))
      if (!st.isFile()) continue
      out.push({ relPath: sub ? `${sub}/${name}` : name, size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export function diffManifest(before: ManifestEntry[], after: ManifestEntry[]): string[] {
  const key = (e: ManifestEntry) => `${e.relPath}|${e.size}|${e.mtimeMs}`
  const a = new Set(before.map(key))
  const b = new Set(after.map(key))
  const changed = new Set<string>()
  for (const k of a) if (!b.has(k)) changed.add(k.split('|')[0] as string)
  for (const k of b) if (!a.has(k)) changed.add(k.split('|')[0] as string)
  return [...changed].sort()
}
