// Locates game files: public/dev-assets/ first, then the local install configured for item 1
// (`bundleDir`: Maps/ and Data/), then the optional HotA install (`hotaBundleDir`, spec 005).
// Nothing found here is ever copied into the repository.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
  /** Optional HotA install (spec 005); undefined when it is not configured. */
  hotaBundleDir: string | undefined
  hotaMapsDir: string | undefined
  hotaDataDir: string | undefined
}

let cached: GameDirs | undefined

export function gameDirs(env: Record<string, string | undefined> = process.env, repoRoot = process.cwd()): GameDirs {
  if (cached !== undefined && cached.repoRoot === resolve(repoRoot)) return cached
  let bundleDir: string | undefined
  let hotaBundleDir: string | undefined
  try {
    const config = loadConfig(env, repoRoot)
    bundleDir = config.bundleDir
    hotaBundleDir = config.hotaBundleDir
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
    hotaBundleDir,
    hotaMapsDir: findDir(hotaBundleDir, 'Maps'),
    hotaDataDir: findDir(hotaBundleDir, 'Data'),
  }
  return cached
}

function findIn(dir: string | undefined, name: string): string | undefined {
  if (dir === undefined || !existsSync(dir)) return undefined
  const lower = name.normalize('NFC').toLowerCase()
  const hit = readdirSync(dir).find((e) => e.normalize('NFC').toLowerCase() === lower)
  return hit === undefined ? undefined : join(dir, hit)
}

/** Folders searched for a bare file name, in order: dev assets, base install, HotA install. */
function searchDirs(dirs: GameDirs): string[] {
  return [dirs.devAssets, dirs.mapsDir, dirs.dataDir, dirs.hotaMapsDir, dirs.hotaDataDir].filter(
    (d): d is string => d !== undefined,
  )
}

/** Resolves a file argument: an existing path, or a bare name searched in the game dirs. */
export function resolveGameFile(arg: string, dirs: GameDirs = gameDirs()): string {
  const direct = resolve(arg)
  if (existsSync(direct) && statSync(direct).isFile()) return direct
  if (!arg.includes('/')) {
    const hits = searchDirs(dirs)
      .map((dir) => findIn(dir, arg))
      .filter((hit): hit is string => hit !== undefined)
    if (hits.length > 1) {
      // Both installs ship a HotA.lod (1.7.x plain, 1.8.x obfuscated) and the base archives exist
      // twice as well, so say which copy won instead of letting the caller guess.
      log.warn(`"${arg}" exists in several game folders; using ${hits[0] as string} (others: ${hits.slice(1).join(', ')})`)
    }
    if (hits.length > 0) return hits[0] as string
  }
  throw new ToolError(TOOL_ERROR_CODES.PREREQ_MISSING, `game file not found: ${arg}`, {
    details: { searched: searchDirs(dirs) },
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

/** All `.h3m` files in the HotA install's Maps folder (empty when it is not configured). */
export function hotaInstallMaps(dirs: GameDirs = gameDirs()): string[] {
  const dir = dirs.hotaMapsDir
  if (dir === undefined) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.h3m'))
    .sort()
    .map((f) => join(dir, f))
}

/** sha256 of the primary check map `test_map.h3m` (specs/003-map-objects/spec.md Context). */
export const TEST_MAP_SHA256 = '6dcdb07d8417f5960e7a197af918ddbacb8433cc90ea4437dc56266506b1b23c'

/**
 * For checks and tests: the path of `test_map.h3m`, or null with a logged skip reason. Warns when
 * the file was edited since its zones were measured (spec 003 Context must then be updated).
 */
export function requireTestMap(dirs: GameDirs = gameDirs()): string | null {
  const path = requireGameFile('test_map.h3m', dirs)
  if (path === null) return null
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (sha !== TEST_MAP_SHA256) {
    log.warn(`test_map.h3m changed (sha256 ${sha}); update the zones and hash in specs/003-map-objects/spec.md`)
  }
  return path
}
