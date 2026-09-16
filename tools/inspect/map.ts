import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { className, HIDDEN_CLASSES } from '../../src/core/data/object-classes.ts'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { readTile } from '../../src/core/formats/h3m/types.ts'
import type { H3mMap, MapObject } from '../../src/core/formats/h3m/types.ts'
import { FormatError } from '../../src/core/util/errors.ts'
import type { CommandResult, ParsedArgs, Region } from '../shared/cli-runner.ts'
import { intOpt, opt, parseRegion, positional } from '../shared/cli-runner.ts'
import { gameDirs } from '../shared/game-files.ts'
import { usage } from '../shared/errors.ts'
import { openMap } from './files.ts'

function levelOpt(args: ParsedArgs, map: H3mMap, fallback?: number): number | undefined {
  const raw = opt(args, 'level')
  if (raw === undefined) return fallback
  const z = Number(raw)
  if (!(z === 0 || (z === 1 && map.info.hasUnderground))) throw usage(`--level must be 0${map.info.hasUnderground ? ' or 1' : ''}`)
  return z
}

function regionOpt(args: ParsedArgs, map: H3mMap): Region {
  const raw = opt(args, 'region')
  const size = map.info.size
  if (raw === undefined) return { x0: 0, y0: 0, x1: size - 1, y1: size - 1 }
  return parseRegion(raw)
}

function inRegion(x: number, y: number, r: Region): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

export function describeObject(map: H3mMap, o: MapObject): Record<string, unknown> {
  const t = map.templates[o.templateIndex]
  return { index: o.index, x: o.x, y: o.y, z: o.z, classId: o.classId, className: className(o.classId), subclassId: o.subclassId, template: t, body: o.body }
}

export function textOf(value: unknown): unknown {
  // H3String → text for readability; raw bytes are dropped from CLI output.
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => {
      if (v !== null && typeof v === 'object' && 'text' in v && 'bytes' in v) return (v as { text: string }).text
      if (v instanceof Uint8Array) return Array.from(v)
      return v
    }),
  )
}

export async function mapInfo(args: ParsedArgs): Promise<CommandResult> {
  const { map, sha256, path } = await openMap(positional(args, 0, 'MAP'))
  const classCounts: Record<string, number> = {}
  for (const o of map.objects) classCounts[className(o.classId)] = (classCounts[className(o.classId)] ?? 0) + 1
  return {
    ok: true,
    file: basename(path),
    sha256,
    version: map.version,
    size: map.info.size,
    hasUnderground: map.info.hasUnderground,
    info: textOf(map.info),
    players: textOf(map.players.map((p, i) => ({ index: i, ...p, unusedBlock: undefined }))),
    victory: map.victory,
    loss: map.loss,
    teams: map.teams,
    rumors: map.rumors.length,
    counts: { templates: map.templates.length, objects: map.objects.length, events: map.events.length },
    classCounts,
  }
}

export async function mapTile(args: ParsedArgs): Promise<CommandResult> {
  const { map } = await openMap(positional(args, 0, 'MAP'))
  const x = intOpt(args, 'x')
  const y = intOpt(args, 'y')
  const z = levelOpt(args, map, 0) as number
  const size = map.info.size
  if (x < 0 || y < 0 || x >= size || y >= size) throw usage(`tile (${x},${y}) outside the ${size}x${size} map`)
  const tile = readTile(map.tiles, size, x, y, z)
  const objectsHere = map.objects.filter((o) => o.x === x && o.y === y && o.z === z).map((o) => ({ index: o.index, classId: o.classId, className: className(o.classId) }))
  const footprint = await coveringObjects(args, map, x, y, z)
  return { ok: true, x, y, z, tile, objectsAnchoredHere: objectsHere, ...footprint }
}

/** Filled in by the floating-tiles feature (tasks.md T061); returns {} when sprites are unavailable. */
async function coveringObjects(args: ParsedArgs, map: H3mMap, x: number, y: number, z: number): Promise<Record<string, unknown>> {
  const { footprintCoverage } = await import('./floating.ts')
  return footprintCoverage(args, map, x, y, z)
}

export async function mapTiles(args: ParsedArgs): Promise<CommandResult> {
  const { map } = await openMap(positional(args, 0, 'MAP'))
  const z = levelOpt(args, map, 0) as number
  const r = regionOpt(args, map)
  const rows: number[][][] = []
  for (let y = r.y0; y <= Math.min(r.y1, map.info.size - 1); y++) {
    const row: number[][] = []
    for (let x = r.x0; x <= Math.min(r.x1, map.info.size - 1); x++) {
      const t = readTile(map.tiles, map.info.size, x, y, z)
      row.push([t.terrain, t.terrainView, t.river, t.riverView, t.road, t.roadView, t.flags])
    }
    rows.push(row)
  }
  return { ok: true, level: z, region: r, fields: ['terrain', 'terrainView', 'river', 'riverView', 'road', 'roadView', 'flags'], rows }
}

export async function mapObjects(args: ParsedArgs): Promise<CommandResult> {
  const { map } = await openMap(positional(args, 0, 'MAP'))
  const z = levelOpt(args, map)
  const r = regionOpt(args, map)
  const cls = opt(args, 'class')
  const objects = map.objects.filter((o) => (z === undefined || o.z === z) && inRegion(o.x, o.y, r) && (cls === undefined || o.classId === Number(cls)))
  // With --seed: what the renderer draws for each object (spec 003), from the user's archives.
  let render: Map<number, { def: string; group: number; flat: boolean; visitable: boolean }[]> | undefined
  if (opt(args, 'seed') !== undefined) {
    const { buildMapContext, buildObjectContext } = await import('../checks/fidelity/masks.ts')
    const { resolveGameFile } = await import('../shared/game-files.ts')
    const ctx = await buildMapContext(resolveGameFile(positional(args, 0, 'MAP')), resolveGameFile(opt(args, 'archive') ?? 'h3sprite.lod'))
    const oc = await buildObjectContext(ctx, { seed: Number(opt(args, 'seed')) })
    render = new Map()
    for (const o of oc.objects) {
      const list = render.get(o.id) ?? []
      list.push({ def: o.def, group: o.group, flat: o.flat, visitable: o.visitable })
      render.set(o.id, list)
    }
  }
  return {
    ok: true,
    count: objects.length,
    objects: textOf(
      objects.map((o) => ({
        ...describeObject(map, o),
        hidden: HIDDEN_CLASSES.has(o.classId),
        ...(render !== undefined ? { render: render.get(o.index) ?? [] } : {}),
      })),
    ),
  }
}

export async function mapObject(args: ParsedArgs): Promise<CommandResult> {
  const { map } = await openMap(positional(args, 0, 'MAP'))
  const index = intOpt(args, 'index')
  const o = map.objects[index]
  if (o === undefined) throw usage(`--index must be 0..${map.objects.length - 1}`)
  return { ok: true, object: textOf(describeObject(map, o)) }
}

export async function mapParseAll(args: ParsedArgs): Promise<CommandResult> {
  const dir = opt(args, 'dir') ?? gameDirs().mapsDir
  if (dir === undefined) throw usage('no --dir and no game install configured')
  const files = readdirSync(resolve(dir)).filter((f) => f.toLowerCase().endsWith('.h3m')).sort()
  let parsed = 0
  const unsupported: { file: string; version: string | undefined }[] = []
  const failed: { file: string; error: unknown }[] = []
  for (const f of files) {
    try {
      const raw = new Uint8Array(await readFile(join(resolve(dir), f)))
      const data = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(gunzipSync(raw)) : raw
      parseH3m(data, f)
      parsed++
    } catch (err) {
      if (err instanceof FormatError && err.code === 'UNSUPPORTED_VERSION') unsupported.push({ file: f, version: err.version })
      else failed.push({ file: f, error: err instanceof FormatError ? err.toJSON() : String(err) })
    }
  }
  return { ok: failed.length === 0, dir: resolve(dir), total: files.length, parsed, unsupported, failed }
}
