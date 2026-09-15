import { basename } from 'node:path'
import { className } from '../../src/core/data/object-classes.ts'
import type { H3mMap } from '../../src/core/formats/h3m/types.ts'
import { computeFloatingTiles, toTileList } from '../../src/core/state/floating.ts'
import type { FloatingTileSet } from '../../src/core/state/floating.ts'
import { coveredPixels, placeMask, templateAreaMask, tileKey } from '../../src/core/state/footprint.ts'
import type { Footprint } from '../../src/core/state/footprint.ts'
import { fromH3m } from '../../src/core/state/world.ts'
import type { WorldState } from '../../src/core/state/world.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { opt, parseRegion, positional } from '../shared/cli-runner.ts'
import { usage } from '../shared/errors.ts'
import { openGameSprites } from '../shared/game-sprites.ts'
import type { GameSprites } from '../shared/game-sprites.ts'
import { openMap } from './files.ts'

function spriteOpts(args: ParsedArgs): { sprites?: string[]; bitmaps?: string } {
  const sprites = args.flags.get('sprites')
  const bitmaps = opt(args, 'bitmaps')
  return { ...(sprites !== undefined ? { sprites } : {}), ...(bitmaps !== undefined ? { bitmaps } : {}) }
}

export interface FloatingResult {
  state: WorldState
  floating: FloatingTileSet
  sprites: GameSprites
}

export async function floatingFor(map: H3mMap, sha256: string, args: ParsedArgs): Promise<FloatingResult> {
  const state = fromH3m(map, { sha256, name: map.fileName, version: map.version })
  const sprites = await openGameSprites(spriteOpts(args))
  await sprites.preloadForState(state)
  const floating = computeFloatingTiles(state, sprites.candidates, sprites.lookup)
  return { state, floating, sprites }
}

export async function mapFloating(args: ParsedArgs): Promise<CommandResult> {
  const { map, sha256, path } = await openMap(positional(args, 0, 'MAP'))
  const format = opt(args, 'format') ?? 'list'
  if (format !== 'list' && format !== 'json') throw usage('--format must be list or json')
  const levelArg = opt(args, 'level')
  const levels = map.info.hasUnderground ? 2 : 1
  if (levelArg !== undefined && !(Number(levelArg) >= 0 && Number(levelArg) < levels && Number.isInteger(Number(levelArg)))) {
    throw usage(`--level must be 0${levels === 2 ? ' or 1' : ''}`)
  }
  const regionArg = opt(args, 'region')
  const region = regionArg === undefined ? undefined : parseRegion(regionArg)
  const { floating } = await floatingFor(map, sha256, args)
  const inRegion = (t: { x: number; y: number }) => region === undefined || (t.x >= region.x0 && t.x <= region.x1 && t.y >= region.y0 && t.y <= region.y1)
  if (format === 'list') {
    const z = levelArg === undefined ? 0 : Number(levelArg)
    const filtered: FloatingTileSet = { ...floating, levels: floating.levels.map((l) => ({ ...l, tiles: l.tiles.filter(inRegion) })) }
    const tiles = toTileList(filtered, z)
    return { ok: true, map: basename(path), level: z, tiles, count: filtered.levels[z]?.tiles.length ?? 0, warnings: floating.warnings }
  }
  const selected = levelArg === undefined ? floating.levels : floating.levels.filter((l) => l.z === Number(levelArg))
  return {
    ok: true,
    map: basename(path),
    levels: selected.map((l) => ({
      level: l.z,
      count: l.tiles.filter(inRegion).length,
      tiles: l.tiles.filter(inRegion).map((t) => ({
        x: t.x,
        y: t.y,
        pixels: coveredPixels(l.footprint.get(tileKey(t.x, t.y)) ?? { x: 0, y: 0, rows: new Uint32Array(32) }),
        causes: t.causes.map((c) => (c.kind === 'randomObject' ? { kind: c.kind, index: c.objectId, classId: c.classId, className: className(c.classId) } : { kind: c.kind, index: c.townObjectId, player: c.player })),
      })),
    })),
    warnings: floating.warnings,
  }
}

/** For `map tile`: objects whose sprite footprint covers the tile, and whether it is floating. */
export async function footprintCoverage(args: ParsedArgs, map: H3mMap, x: number, y: number, z: number): Promise<Record<string, unknown>> {
  let result: FloatingResult
  try {
    result = await floatingFor(map, '', args)
  } catch (err) {
    return { footprint: { unavailable: String(err instanceof Error ? err.message : err) } }
  }
  const { state, floating, sprites } = result
  const covering: { index: number; classId: number; className: string; pixels: number }[] = []
  for (const o of state.objects.values()) {
    if (o.z !== z) continue
    const fp: Footprint = new Map()
    placeMask(fp, sprites.lookup(o.template.defName) ?? templateAreaMask(o.template.defName, o.template.passable, o.template.active), o.x, o.y)
    const cov = fp.get(tileKey(x, y))
    if (cov !== undefined) covering.push({ index: o.id, classId: o.classId, className: className(o.classId), pixels: coveredPixels(cov) })
  }
  const tile = floating.levels[z]?.tiles.find((t) => t.x === x && t.y === y)
  return { coveredBy: covering, floating: tile !== undefined, floatingCauses: tile?.causes ?? [] }
}
