// `yarn h3 map place` (spec 009 FR-009): one random-place draw as the engine makes it, with every
// candidate tried, its coverage and the view's tile region (for `yarn h3 render --region`).

import { basename } from 'node:path'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { BUSY_COVERAGE, placeView } from '../../src/core/render/view-placement.ts'
import type { LevelChoice } from '../../src/core/render/view-placement.ts'
import { coverageGrid, viewTiles } from '../../src/core/state/coverage.ts'
import { fromH3m } from '../../src/core/state/world.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { intOpt, opt, positional } from '../shared/cli-runner.ts'
import { usage } from '../shared/errors.ts'
import { parseViewport } from '../shared/map-world.ts'
import { openMap } from './files.ts'

function levelChoice(value: string, levelSeed: number): LevelChoice {
  if (value === 'random') return { random: levelSeed }
  if (value === 'surface') return 0
  if (value === 'underground') return 1
  throw usage(`--level must be random, surface or underground, got "${value}"`)
}

export async function mapPlace(args: ParsedArgs): Promise<CommandResult> {
  const seed = intOpt(args, 'seed', 1) >>> 0
  const levelSeed = intOpt(args, 'level-seed', seed) >>> 0
  const level = levelChoice(opt(args, 'level') ?? 'random', levelSeed)
  const { width, height } = parseViewport(opt(args, 'viewport') ?? '1920x1080')
  const scale = Number(opt(args, 'scale') ?? '1')
  if (!(scale > 0)) throw usage('--scale must be a positive number')
  const border = intOpt(args, 'border', 8)
  const { path, map, sha256 } = await openMap(positional(args, 0, 'MAP'))
  const world = fromH3m(map, { sha256, name: basename(path), version: map.version })
  const r = placeView({ mapSize: world.size, levels: world.levels, level, placement: { mode: 'random', seed }, overscan: border * TILE_SIZE, width, height, scale, coverage: coverageGrid(world) })
  const choice = r.choice as NonNullable<typeof r.choice>
  const view = viewTiles({ ...r.camera, level: 0 })
  const clamp = (v: number): number => Math.min(world.size - 1, Math.max(0, v))
  const candidates = choice.candidates.map((c) => {
    const t = viewTiles(placeView({ mapSize: world.size, levels: world.levels, level: c.level, placement: { mode: 'coords', fx: c.fx, fy: c.fy }, overscan: border * TILE_SIZE, width, height, scale }).camera)
    return { level: c.level, fx: c.fx, fy: c.fy, coverage: Math.round(c.coverage * 1000) / 1000, region: `${clamp(t.x0)},${clamp(t.y0)},${clamp(t.x1)},${clamp(t.y1)}` }
  })
  return {
    ok: true,
    map: basename(path),
    size: world.size,
    levels: world.levels,
    view: { cols: view.x1 - view.x0 + 1, rows: view.y1 - view.y0 + 1, scale },
    threshold: BUSY_COVERAGE,
    chosen: choice.chosen,
    reached: choice.reached,
    candidates,
  }
}
