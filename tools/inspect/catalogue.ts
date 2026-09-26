// `yarn h3 map summary MAP` and `yarn h3 map catalogue DIR|ZIP` (spec 007 contracts/engine-api.md
// "Inspection CLI"): what the wallpaper reads from a map for the folder filters, and which maps of a
// folder or .zip it would pick from — through the same code paths the wallpaper uses.

import { readFile } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { CATALOGUE_LIMITS, filesCatalogue, isMapPath, isZipValue, zipCatalogue } from '../../src/runtime/catalogue.ts'
import type { CatalogueEntry } from '../../src/runtime/catalogue.ts'
import { mapFilter, passesFilter } from '../../src/runtime/rotation.ts'
import { isSizeClass } from '../../src/core/data/map-sizes.ts'
import type { SizeClass } from '../../src/core/data/map-sizes.ts'
import { summarizeMapFile } from '../../src/runtime/file-kind.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { opt, positional } from '../shared/cli-runner.ts'
import { usage } from '../shared/errors.ts'
import { resolveGameFile } from '../shared/game-files.ts'

const blobOf = async (path: string): Promise<Blob> => new Blob([new Uint8Array(await readFile(path))])

export async function mapSummary(args: ParsedArgs): Promise<CommandResult> {
  const path = resolveGameFile(positional(args, 0, 'MAP'))
  return { ok: true, file: basename(path), ...(await summarizeMapFile(await blobOf(path), basename(path))) }
}

/** The maps of a folder on disk, with the wallpaper's limits (depth, count, .h3m only, no hidden names). */
function folderEntries(root: string): CatalogueEntry[] {
  const files: { path: string; file: Blob }[] = []
  const walk = (dir: string, depth: number): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || files.length >= CATALOGUE_LIMITS.maxEntries) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (depth < CATALOGUE_LIMITS.maxDepth) walk(full, depth + 1)
        continue
      }
      const rel = relative(root, full).split(/[\\/]/).join('/')
      // An empty placeholder: entries read the file itself (below), only when summarised.
      if (isMapPath(rel)) files.push({ path: rel, file: new Blob([]) })
    }
  }
  walk(root, 1)
  return filesCatalogue(files).map((e) => ({ ...e, read: () => blobOf(join(root, ...e.path.split('/'))) }))
}

function sizeOpt(args: ParsedArgs, key: string, fallback: SizeClass): SizeClass {
  const v = opt(args, key)
  if (v === undefined) return fallback
  if (!isSizeClass(v)) throw usage(`--${key} must be one of s, m, l, xl, h, xh, g`)
  return v
}

export async function mapCatalogue(args: ParsedArgs): Promise<CommandResult> {
  const target = positional(args, 0, 'DIR|ZIP')
  const underground = opt(args, 'underground') ?? 'any'
  if (underground !== 'any' && underground !== 'two' && underground !== 'one') throw usage('--underground must be any, two or one')
  const filter = mapFilter({ mapsizemin: sizeOpt(args, 'size-min', 's'), mapsizemax: sizeOpt(args, 'size-max', 'g'), mapunderground: underground })
  // Like `yarn h3 render --hota HotA.lod`: naming the archive means HotA maps can be shown.
  const hota = opt(args, 'hota') !== undefined
  const entries = isZipValue(target) ? await zipCatalogue(await blobOf(target), basename(target)) : folderEntries(target)
  const rows = []
  let eligible = 0
  for (const e of entries) {
    try {
      const s = await summarizeMapFile(await e.read(), basename(e.path))
      const verdict = !passesFilter(s, filter) ? 'filtered' : s.needsHota && !hota ? 'needs-hota' : 'eligible'
      if (verdict === 'eligible') eligible++
      rows.push({ path: e.path, verdict, ...s })
    } catch (err) {
      rows.push({ path: e.path, verdict: 'failed', reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ok: true, source: target, filter, hota, count: entries.length, eligible, entries: rows }
}
