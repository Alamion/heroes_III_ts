// `yarn verify maps` (spec 005 FR-020, SC-001): every kind of map the user owns opens.
//
// The owner's bar is "every distinct variant and edge case", not every file, so maps are grouped
// into coverage classes by their own properties and at least one map of every class is opened.
// A class that appears for the first time is picked up by the classification itself; `--all` opens
// every discoverable map instead.


import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseH3mFile } from '../../../src/core/formats/h3m/h3m.ts'
import type { H3mMap } from '../../../src/core/formats/h3m/types.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import { buildRenderObjects } from '../../../src/core/state/render-objects.ts'
import { FormatError } from '../../../src/core/util/errors.ts'
import { createRng } from '../../../src/core/util/rng.ts'
import { TILE_RECORD_SIZE } from '../../../src/core/formats/h3m/types.ts'
import type { CommandResult, ParsedArgs } from '../../shared/cli-runner.ts'
import { flag } from '../../shared/cli-runner.ts'
import { gameDirs, requireGameFile } from '../../shared/game-files.ts'
import { openGameSprites } from '../../shared/game-sprites.ts'

/**
 * What makes two maps different for coverage purposes. Object content is deliberately not part of
 * the key — it would make almost every map its own class. Instead a map is opened whenever it
 * introduces an object class:subtype pair no earlier map had, which is the same "a new variant is
 * picked up automatically" property without opening half the corpus.
 */
interface CoverageClass {
  format: string
  subVersion: number | null
  levels: number
  sizeClass: number
  terrains: string
  nameEncoding: 'ascii' | 'non-ascii'
  scriptActive: boolean
}

interface MapRow {
  file: string
  dir: string
  classKey: string
  opened: boolean
  edgeCases: string[]
  newObjectKinds?: number
  error?: { code: string; structure: string; offset: number; message: string }
  objects?: number
  unresolved?: { def: string; count: number }[]
}

const SIZE_CLASSES = [36, 72, 108, 144, 180, 216, 252]

function sizeClassOf(size: number): number {
  return SIZE_CLASSES.find((s) => size <= s) ?? size
}

/** Reads the header and templates only: enough to classify without resolving objects. */
function classify(map: H3mMap): CoverageClass {
  const terrains = new Set<number>()
  for (let o = 0; o < map.tiles.length; o += TILE_RECORD_SIZE) terrains.add(map.tiles[o] as number)
  return {
    format: map.version,
    subVersion: map.subVersion,
    levels: map.info.hasUnderground ? 2 : 1,
    sizeClass: sizeClassOf(map.info.size),
    terrains: [...terrains].sort((a, b) => a - b).join('.'),
    nameEncoding: /^[\x20-\x7e]*$/.test(map.fileName) ? 'ascii' : 'non-ascii',
    scriptActive: (map.hota?.scriptBytes ?? 0) > 0,
  }
}

const classKey = (c: CoverageClass): string =>
  `${c.format}${c.subVersion === null ? '' : ` sub ${c.subVersion}`} | ${c.levels}L | ≤${c.sizeClass} | terrain ${c.terrains}${c.nameEncoding === 'non-ascii' ? ' | non-ascii name' : ''}${c.scriptActive ? ' | script' : ''}`

/** Edge cases the check always opens, whatever the sampling picks (spec 005 FR-020). */
function edgeCasesOf(map: H3mMap): string[] {
  const out: string[] = []
  if (map.info.size >= 252 && map.info.hasUnderground) out.push('largest map')
  if (!/^[\x20-\x7e]*$/.test(map.fileName)) out.push('non-ascii file name')
  if ((map.hota?.scriptBytes ?? 0) > 0) out.push('active event system')
  if (map.version === 'HotA') out.push(`HotA sub ${map.subVersion}`)
  else out.push(map.version)
  return out
}

function discover(dirs: readonly string[]): { dir: string; file: string }[] {
  const out: { dir: string; file: string }[] = []
  for (const dir of dirs) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of entries.sort()) if (f.toLowerCase().endsWith('.h3m')) out.push({ dir, file: f })
  }
  return out
}

export async function mapsCommand(args: ParsedArgs): Promise<CommandResult> {
  const dirs = gameDirs()
  const extra = args.flags.get('dir') ?? []
  const searchDirs = [dirs.devAssets, dirs.mapsDir, dirs.hotaMapsDir, ...extra.map((d) => resolve(d))].filter((d): d is string => d !== undefined)
  const candidates = discover(searchDirs)
  if (candidates.length === 0) {
    const missing = { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no maps found in dev-assets or a configured install' }
    return flag(args, 'require') ? { ...missing, ok: false, exitCode: 3, outcome: 'prereq-missing' } : missing
  }

  const all = flag(args, 'all')
  const sprites = requireGameFile('h3sprite.lod')
  const bitmaps = requireGameFile('h3bitmap.lod')
  // The HotA archive goes first so HotA sprites and tables win, as they do at runtime (FR-004).
  const hotaArchive = dirs.hotaDataDir === undefined ? undefined : join(dirs.hotaDataDir, 'HotA.lod')
  const archiveSet = [...(hotaArchive !== undefined && existsSync(hotaArchive) ? [hotaArchive] : []), ...(sprites === null ? [] : [sprites])]
  // Objects can only be resolved with the archives; without them the check still proves parsing.
  const game = sprites === null || bitmaps === null ? null : await openGameSprites({ sprites: archiveSet, bitmaps: hotaArchive !== undefined && existsSync(hotaArchive) ? hotaArchive : bitmaps })

  const rows: MapRow[] = []
  const classes = new Map<string, { opened: number; files: string[] }>()
  const seenEdgeCases = new Set<string>()
  const seenObjectKinds = new Set<string>()
  const failures: string[] = []

  for (const { dir, file } of candidates) {
    const path = join(dir, file)
    let map: H3mMap
    try {
      map = await parseH3mFile(new Uint8Array(readFileSync(path)), file)
    } catch (err) {
      const e = err instanceof FormatError ? err.toJSON() : null
      const row: MapRow = {
        file,
        dir,
        classKey: 'unparsed',
        opened: false,
        edgeCases: [],
        error: { code: e?.code ?? 'INTERNAL', structure: e?.structure ?? '', offset: e?.offset ?? 0, message: e?.message ?? String(err) },
      }
      rows.push(row)
      failures.push(`${file}: ${row.error?.code} at ${row.error?.offset} in ${row.error?.structure}: ${row.error?.message}`)
      continue
    }
    const key = classKey(classify(map))
    const edgeCases = edgeCasesOf(map)
    const known = classes.get(key)
    const newEdgeCase = edgeCases.some((c) => !seenEdgeCases.has(c))
    // A map that carries an object kind nothing before it had is always opened.
    const newObjectKinds = map.templates.filter((t) => !seenObjectKinds.has(`${t.classId}:${t.subclassId}`)).length
    const open = all || known === undefined || newEdgeCase || newObjectKinds > 0
    for (const t of map.templates) seenObjectKinds.add(`${t.classId}:${t.subclassId}`)
    for (const c of edgeCases) seenEdgeCases.add(c)
    classes.set(key, { opened: (known?.opened ?? 0) + (open ? 1 : 0), files: [...(known?.files ?? []), file].slice(0, 5) })
    const row: MapRow = { file, dir, classKey: key, opened: open, edgeCases, ...(newObjectKinds > 0 ? { newObjectKinds } : {}) }
    if (open && game !== null) {
      // Resolving objects and their sprites is what proves the map's content is renderable
      // (FR-016, FR-017): an object whose sprite no archive has is unresolved.
      const state = fromH3m(map, { sha256: 'coverage', name: file, version: map.version })
      const { objects } = buildRenderObjects(state, { templates: game.templates, artifactClasses: [] }, createRng(1))
      row.objects = objects.length
      const wanted = [...new Set(objects.map((o) => o.def.toLowerCase()))]
      await game.preload(wanted)
      const unresolved = wanted.filter((d) => game.lookup(d) === undefined)
      if (unresolved.length > 0) {
        row.unresolved = unresolved.map((def) => ({ def, count: objects.filter((o) => o.def.toLowerCase() === def).length }))
        const total = row.unresolved.reduce((n, u) => n + u.count, 0)
        failures.push(`${file}: ${total} object(s) have no sprite (${unresolved.slice(0, 5).join(', ')}${unresolved.length > 5 ? ', …' : ''})`)
      }
    }
    rows.push(row)
  }

  const openedRows = rows.filter((r) => r.opened)
  const report = {
    generated: new Date().toISOString(),
    dirs: searchDirs,
    mode: all ? 'all' : 'coverage classes',
    totals: {
      discovered: candidates.length,
      opened: openedRows.length,
      classes: classes.size,
      failed: failures.length,
    },
    classes: [...classes].map(([key, v]) => ({ class: key, maps: v.files, opened: v.opened })),
    edgeCases: [...seenEdgeCases].sort(),
    failures,
    maps: rows,
  }
  const dir = join('check-reports', 'maps', report.generated.replace(/[:.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const ok = failures.length === 0
  return {
    ok,
    exitCode: ok ? 0 : 1,
    outcome: ok ? 'pass' : 'fail',
    mode: report.mode,
    discovered: candidates.length,
    opened: openedRows.length,
    coverageClasses: classes.size,
    edgeCases: report.edgeCases,
    failures: failures.slice(0, 10),
    objectsResolved: game !== null,
    report: join(dir, 'report.json'),
  }
}
