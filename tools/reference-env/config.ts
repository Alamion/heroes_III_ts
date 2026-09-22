import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ERROR_CODES, RefError } from './errors.ts'
import type { ReferenceConfig, Timeouts } from './model/types.ts'

export const CONFIG_FILE = 'reference-env.config.json'

export const DEFAULT_TIMEOUTS: Timeouts = {
  still: 120_000,
  clipBase: 60_000,
  editor: 120_000,
  step: 30_000,
  lockWait: 300_000,
}

type Env = Record<string, string | undefined>

function invalid(message: string): never {
  throw new RefError(ERROR_CODES.CONFIG_INVALID, message)
}

function readFileConfig(repoRoot: string): Record<string, unknown> {
  const path = join(repoRoot, CONFIG_FILE)
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) invalid(`${path}: expected a JSON object`)
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof RefError) throw err
    throw new RefError(ERROR_CODES.CONFIG_INVALID, `${path}: ${(err as Error).message}`, { cause: err })
  }
}

function optString(file: Record<string, unknown>, key: string): string | undefined {
  const v = file[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.length === 0) invalid(`${CONFIG_FILE}: "${key}" must be a non-empty string`)
  return v
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function loadConfig(env: Env, repoRoot: string): ReferenceConfig {
  const root = resolve(repoRoot)
  const file = readFileConfig(root)

  const bundleDir = env.H3REF_BUNDLE_DIR ?? optString(file, 'bundleDir')
  if (bundleDir === undefined) {
    invalid(`bundleDir is not set: export H3REF_BUNDLE_DIR or set it in ${CONFIG_FILE} (see reference-env.config.example.json)`)
  }

  const hotaBundleDir = env.H3REF_HOTA_BUNDLE_DIR ?? optString(file, 'hotaBundleDir')

  const home = env.HOME ?? homedir()
  const stateBase = env.XDG_STATE_HOME ?? join(home, '.local', 'state')
  const stateDir = resolve(env.H3REF_STATE_DIR ?? optString(file, 'stateDir') ?? join(stateBase, 'h3-reference'))
  if (isInside(stateDir, root)) invalid(`stateDir must be outside the repository (got ${stateDir})`)

  const capturesDir = resolve(root, env.H3REF_CAPTURES_DIR ?? optString(file, 'capturesDir') ?? 'reference-captures')

  let mapSearchDirs = [join(root, 'public', 'dev-assets'), join(bundleDir, 'Maps')]
  if (file.mapSearchDirs !== undefined) {
    if (!Array.isArray(file.mapSearchDirs) || !file.mapSearchDirs.every((d) => typeof d === 'string')) {
      invalid(`${CONFIG_FILE}: "mapSearchDirs" must be an array of strings`)
    }
    mapSearchDirs = (file.mapSearchDirs as string[]).map((d) => resolve(root, d))
  }

  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS }
  if (file.timeouts !== undefined) {
    if (typeof file.timeouts !== 'object' || file.timeouts === null) invalid(`${CONFIG_FILE}: "timeouts" must be an object`)
    for (const [k, v] of Object.entries(file.timeouts as Record<string, unknown>)) {
      if (!(k in timeouts)) invalid(`${CONFIG_FILE}: unknown timeout "${k}"`)
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) invalid(`${CONFIG_FILE}: timeout "${k}" must be a positive integer`)
      timeouts[k as keyof Timeouts] = v
    }
  }

  if (env.H3REF_LOCK_WAIT_MS !== undefined) {
    const v = Number(env.H3REF_LOCK_WAIT_MS)
    if (!Number.isInteger(v) || v < 0) invalid('H3REF_LOCK_WAIT_MS must be a non-negative integer')
    timeouts.lockWait = v
  }

  return {
    repoRoot: root,
    bundleDir: resolve(bundleDir),
    hotaBundleDir: hotaBundleDir === undefined ? undefined : resolve(hotaBundleDir),
    wineBinary: env.H3REF_WINE ?? optString(file, 'wineBinary') ?? 'wine',
    stateDir,
    capturesDir,
    mapSearchDirs,
    timeouts,
  }
}
