// Entry-name dictionary for obfuscated HotA archives (spec 005 FR-003, R2).
//
// A HotA 1.8 index stores only a hash per entry, so listing an archive needs a name list. Lookups
// never need one (the wanted name is hashed), and the dictionary is game-file metadata from a
// third-party project, so it is NOT committed here: it is read from the local, git-ignored
// `context/hota-lod-convert/data/hashes.txt` when that folder is present, and entries whose name
// cannot be recovered keep their stable `#<hex>` form.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../../src/core/util/log.ts'

export const HOTA_NAMES_PATH = join('context', 'hota-lod-convert', 'data', 'hashes.txt')

export interface HotaNames {
  /** Entry count of the dictionary; 0 when it is not available. */
  size: number
  nameOf(hash: number): string | undefined
}

const EMPTY: HotaNames = { size: 0, nameOf: () => undefined }

let cached: { root: string; names: HotaNames } | undefined

/** Loads the dictionary once per repository root; returns an empty one when it is absent. */
export function hotaNames(repoRoot: string = process.cwd()): HotaNames {
  if (cached !== undefined && cached.root === repoRoot) return cached.names
  const path = join(repoRoot, HOTA_NAMES_PATH)
  if (!existsSync(path)) {
    log.debug(`HotA name dictionary not found at ${HOTA_NAMES_PATH}; obfuscated entries will be listed as #<hash>`)
    cached = { root: repoRoot, names: EMPTY }
    return EMPTY
  }
  const map = new Map<number, string>()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{1,8})\s+(\S+)$/.exec(line.trim())
    if (m === null) continue
    map.set(Number.parseInt(m[1] as string, 16) >>> 0, m[2] as string)
  }
  const names: HotaNames = { size: map.size, nameOf: (hash) => map.get(hash >>> 0) }
  cached = { root: repoRoot, names }
  return names
}
