// Locates game files: public/dev-assets/ first, then the local install configured for item 1
// (`bundleDir`: Maps/ and Data/). Nothing found here is ever copied into the repository.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../reference-env/config.ts'
import { ERROR_CODES, RefError } from '../reference-env/errors.ts'
import { log } from '../../src/core/util/log.ts'
import { TOOL_ERROR_CODES, ToolError } from './errors.ts'

export interface GameDirs {
  repoRoot: string
  devAssets: string
  bundleDir: string | undefined
  mapsDir: string | undefined
  dataDir: string | undefined
}

let cached: GameDirs | undefined

export function gameDirs(env: Record<string, string | undefined> = process.env, repoRoot = process.cwd()): GameDirs {
  if (cached !== undefined && cached.repoRoot === resolve(repoRoot)) return cached
  let bundleDir: string | undefined
  try {
    bundleDir = loadConfig(env, repoRoot).bundleDir
  } catch (err) {
    if (err instanceof RefError && err.code === ERROR_CODES.CONFIG_INVALID) {
      log.debug(`no game install configured, using public/dev-assets only: ${err.message}`)
    } else {
      throw err
    }
  }
  const root = resolve(repoRoot)
  const findDir = (parent: string | undefined, name: string): string | undefined => {
    if (parent === undefined || !existsSync(parent)) return undefined
    const hit = readdirSync(parent).find((e) => e.toLowerCase() === name.toLowerCase())
    return hit === undefined ? undefined : join(parent, hit)
  }
  cached = {
    repoRoot: root,
    devAssets: join(root, 'public', 'dev-assets'),
    bundleDir,
    mapsDir: findDir(bundleDir, 'Maps'),
    dataDir: findDir(bundleDir, 'Data'),
  }
  return cached
}

/** Clears the cached directory lookup (tests change env/config). */
export function resetGameDirs(): void {
  cached = undefined
}

function findIn(dir: string | undefined, name: string): string | undefined {
  if (dir === undefined || !existsSync(dir)) return undefined
  const lower = name.normalize('NFC').toLowerCase()
  const hit = readdirSync(dir).find((e) => e.normalize('NFC').toLowerCase() === lower)
  return hit === undefined ? undefined : join(dir, hit)
}

/** Resolves a file argument: an existing path, or a bare name searched in the game dirs. */
export function resolveGameFile(arg: string, dirs: GameDirs = gameDirs()): string {
  const direct = resolve(arg)
  if (existsSync(direct) && statSync(direct).isFile()) return direct
  if (!arg.includes('/')) {
    for (const dir of [dirs.devAssets, dirs.mapsDir, dirs.dataDir]) {
      const hit = findIn(dir, arg)
      if (hit !== undefined) return hit
    }
  }
  throw new ToolError(TOOL_ERROR_CODES.PREREQ_MISSING, `game file not found: ${arg}`, {
    details: { searched: [dirs.devAssets, dirs.mapsDir, dirs.dataDir].filter((d) => d !== undefined) },
  })
}

/** Splits `archive.lod:ENTRY` into its parts; `entry` is undefined for plain files. */
export function splitEntryArg(arg: string): { file: string; entry: string | undefined } {
  const m = /^(.*\.lod):([^/]+)$/i.exec(arg)
  if (m === null) return { file: arg, entry: undefined }
  return { file: m[1] as string, entry: m[2] as string }
}

/** For tests: the resolved path, or null with a logged skip reason. */
export function requireGameFile(name: string, dirs: GameDirs = gameDirs()): string | null {
  try {
    return resolveGameFile(name, dirs)
  } catch (err) {
    if (err instanceof ToolError) {
      process.stderr.write(`[real-file test skipped] ${name}: not found in dev-assets or the configured install\n`)
      return null
    }
    throw err
  }
}

/** All `.h3m` files in the install's Maps folder (empty when no install is configured). */
export function installMaps(dirs: GameDirs = gameDirs()): string[] {
  if (dirs.mapsDir === undefined) return []
  return readdirSync(dirs.mapsDir)
    .filter((f) => f.toLowerCase().endsWith('.h3m'))
    .sort()
    .map((f) => join(dirs.mapsDir as string, f))
}
