// Helpers shared by commands: option parsing and the map/hash context of a capture.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readH3mHeader } from '../analysis/h3m-header.ts'
import { parseH3mFile } from '../../../src/core/formats/h3m/h3m.ts'
import type { ParsedArgs } from '../cli.ts'
import { loadConfig } from '../config.ts'
import { EDITOR_EXE, GAME_EXE, HASHED_ARCHIVES } from '../data/staging-whitelist.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { FileHash, Level, MapInfo, Point, ReferenceConfig, StartMode } from '../model/types.ts'
import { resolveMap } from '../store/capture-store.ts'
import { mapKey, sha256Buffer, sha256File } from '../store/identity.ts'
import { stagingRoot } from '../env/session.ts'

export function config(): ReferenceConfig {
  return loadConfig(process.env, process.cwd())
}

export function opt(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.at(-1)
}

export function required(args: ParsedArgs, name: string): string {
  const v = opt(args, name)
  if (v === undefined) throw new RefError(ERROR_CODES.USAGE, `missing required option --${name}`)
  return v
}

export function intOpt(args: ParsedArgs, name: string, fallback?: number): number {
  const v = opt(args, name)
  if (v === undefined) {
    if (fallback !== undefined) return fallback
    throw new RefError(ERROR_CODES.USAGE, `missing required option --${name}`)
  }
  const n = Number(v)
  if (!Number.isInteger(n)) throw new RefError(ERROR_CODES.USAGE, `--${name} must be an integer`)
  return n
}

export function flag(args: ParsedArgs, name: string): boolean {
  return opt(args, name) === 'true'
}

export interface TargetContext {
  mapPath: string
  map: MapInfo
  level: Level
  target: Point
}

export async function targetContext(cfg: ReferenceConfig, args: ParsedArgs): Promise<TargetContext> {
  const mapPath = resolveMap(required(args, 'map'), cfg.mapSearchDirs)
  const bytes = readFileSync(mapPath)
  const header = readH3mHeader(bytes, basename(mapPath))
  const sha = sha256Buffer(bytes)
  const level = intOpt(args, 'level', 0)
  if (level !== 0 && level !== 1) throw new RefError(ERROR_CODES.USAGE, '--level must be 0 or 1')
  if (level === 1 && !header.hasUnderground) {
    throw new RefError(ERROR_CODES.USAGE, `${basename(mapPath)} has no underground level`)
  }
  const target = { x: intOpt(args, 'x'), y: intOpt(args, 'y') }
  if (target.x < 0 || target.y < 0 || target.x >= header.sizeTiles || target.y >= header.sizeTiles) {
    throw new RefError(ERROR_CODES.USAGE, `tile (${target.x}, ${target.y}) is outside the ${header.sizeTiles}×${header.sizeTiles} map`)
  }
  const name = basename(mapPath).normalize('NFC')
  return { mapPath, level, target, map: { name, key: mapKey(name, sha), sha256: sha, ...header } }
}

/** Terrain id per tile for every level of a map (`[z][y * size + x]`), for minimap level detection. */
export async function levelTerrains(mapPath: string): Promise<Uint8Array[]> {
  let map
  try {
    map = await parseH3mFile(new Uint8Array(readFileSync(mapPath)), basename(mapPath))
  } catch (err) {
    throw new RefError(ERROR_CODES.MAP_UNSUPPORTED, `cannot read the tiles of ${basename(mapPath)}: ${(err as Error).message}`, { cause: err })
  }
  const size = map.info.size
  const levels = map.info.hasUnderground ? 2 : 1
  return Array.from({ length: levels }, (_, z) => {
    const out = new Uint8Array(size * size)
    for (let i = 0; i < size * size; i++) out[i] = map.tiles[(z * size * size + i) * 7] as number
    return out
  })
}

export async function stagedHashes(cfg: ReferenceConfig): Promise<{ game: string; editor: string; archives: FileHash[] }> {
  const root = stagingRoot(cfg.stateDir)
  const archives: FileHash[] = []
  for (const a of HASHED_ARCHIVES) archives.push({ file: a, sha256: await sha256File(join(root, a)) })
  return {
    game: await sha256File(join(root, GAME_EXE)),
    editor: await sha256File(join(root, EDITOR_EXE)),
    archives,
  }
}

export function startMode(value: string | undefined): StartMode {
  if (value === undefined || value === 'fixed') return 'fixed'
  if (value === 'random') return 'random'
  throw new RefError(ERROR_CODES.USAGE, '--start must be fixed or random')
}
