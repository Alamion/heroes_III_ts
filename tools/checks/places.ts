// `yarn verify places` (spec 009 FR-008, SC-001, SC-002, SC-004): random places on every local map,
// drawn once uniformly (as before spec 009) and once with the coverage choice. Fails when a draw ends
// below its first candidate, when maps of 72×72 and up do not cut the share of sparse draws to a
// quarter, or when a draw is not repeatable. Node only, no browser.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { BUSY_COVERAGE, placeView } from '../../src/core/render/view-placement.ts'
import type { PlacementInput } from '../../src/core/render/view-placement.ts'
import { coverageGrid, viewCoverage } from '../../src/core/state/coverage.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { flag, intOpt, opt } from '../shared/cli-runner.ts'
import { gameDirs, hotaInstallMaps, installMaps } from '../shared/game-files.ts'
import { parseViewport, readMapWorld } from '../shared/map-world.ts'

const BORDER_TILES = 8
const BIG_MAP = 72

/** Placement and level seeds of draw i (fixed, so a report row can be reproduced with `yarn h3 map place`). */
export function drawSeeds(i: number): { seed: number; levelSeed: number } {
  const seed = (i * 0x9e3779b1 + 17) >>> 0
  return { seed, levelSeed: (seed ^ 0x85ebca6b) >>> 0 }
}

function localMaps(): string[] {
  const dirs = gameDirs()
  let dev: string[] = []
  try {
    dev = readdirSync(dirs.devAssets)
      .filter((f) => f.toLowerCase().endsWith('.h3m'))
      .sort()
      .map((f) => join(dirs.devAssets, f))
  } catch {
    dev = []
  }
  return [...dev, ...installMaps(dirs), ...hotaInstallMaps(dirs)]
}

interface MapRow {
  map: string
  size: number
  levels: number
  draws: number
  belowBefore: number
  belowAfter: number
  switchedLevel: number
  worstChosen: { coverage: number; seed: number; levelSeed: number }
}

const share = (n: number, of: number): number => (of === 0 ? 0 : Math.round((10000 * n) / of) / 10000)

export async function placesCommand(args: ParsedArgs): Promise<CommandResult> {
  const seeds = intOpt(args, 'seeds', 50)
  const { width, height } = parseViewport(opt(args, 'viewport') ?? '1920x1080')
  const only = opt(args, 'only')
  const files = localMaps().filter((f) => only === undefined || basename(f) === only)
  if (files.length === 0) {
    const missing = { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no maps found in dev-assets or a configured install' }
    return flag(args, 'require') ? { ...missing, ok: false, exitCode: 3, outcome: 'prereq-missing' } : missing
  }

  const seen = new Set<string>()
  const rows: MapRow[] = []
  const skipped: { map: string; reason: string }[] = []
  const failures: string[] = []
  let grid = { map: '', size: 0, ms: 0 }
  let sumFirst = 0
  let sumChosen = 0
  for (const file of files) {
    let loaded
    try {
      loaded = readMapWorld(file)
    } catch (err) {
      skipped.push({ map: basename(file), reason: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (seen.has(loaded.sha256)) continue
    seen.add(loaded.sha256)
    const { world } = loaded
    const t0 = performance.now()
    const coverage = coverageGrid(world)
    const ms = performance.now() - t0
    if (world.size > grid.size || (world.size === grid.size && ms > grid.ms)) grid = { map: basename(file), size: world.size, ms: Math.round(ms * 100) / 100 }
    const row: MapRow = { map: basename(file), size: world.size, levels: world.levels, draws: seeds, belowBefore: 0, belowAfter: 0, switchedLevel: 0, worstChosen: { coverage: 2, seed: 0, levelSeed: 0 } }
    for (let i = 0; i < seeds; i++) {
      const { seed, levelSeed } = drawSeeds(i)
      const input: PlacementInput = { mapSize: world.size, levels: world.levels, level: { random: levelSeed }, placement: { mode: 'random', seed }, overscan: BORDER_TILES * TILE_SIZE, width, height, scale: 1 }
      const before = placeView(input)
      const after = placeView({ ...input, coverage })
      const first = viewCoverage(coverage, before.camera)
      const chosen = viewCoverage(coverage, after.camera)
      sumFirst += first
      sumChosen += chosen
      if (first < BUSY_COVERAGE) row.belowBefore++
      if (chosen < BUSY_COVERAGE) row.belowAfter++
      if (after.camera.level !== before.camera.level) row.switchedLevel++
      if (chosen < row.worstChosen.coverage) row.worstChosen = { coverage: Math.round(chosen * 1000) / 1000, seed, levelSeed }
      if (chosen < first) failures.push(`${row.map}: seed ${seed} chose ${chosen.toFixed(3)} below its first candidate ${first.toFixed(3)}`)
      if (i % 10 === 0 && JSON.stringify(placeView({ ...input, coverage })) !== JSON.stringify(after)) failures.push(`${row.map}: seed ${seed} is not repeatable`)
    }
    rows.push(row)
  }

  const total = (pick: (r: MapRow) => number, rs: MapRow[]): number => rs.reduce((a, r) => a + pick(r), 0)
  const big = rows.filter((r) => r.size >= BIG_MAP)
  const draws = total((r) => r.draws, rows)
  const bigDraws = total((r) => r.draws, big)
  const totals = {
    maps: rows.length,
    draws,
    belowBefore: share(total((r) => r.belowBefore, rows), draws),
    belowAfter: share(total((r) => r.belowAfter, rows), draws),
    big: { maps: big.length, draws: bigDraws, belowBefore: share(total((r) => r.belowBefore, big), bigDraws), belowAfter: share(total((r) => r.belowAfter, big), bigDraws) },
    meanFirst: share(sumFirst, draws),
    meanChosen: share(sumChosen, draws),
    switchedLevel: total((r) => r.switchedLevel, rows),
  }
  if (bigDraws > 0 && totals.big.belowAfter > totals.big.belowBefore / 4)
    failures.push(`maps ≥ ${BIG_MAP}: ${totals.big.belowAfter} of draws below ${BUSY_COVERAGE} after, more than a quarter of ${totals.big.belowBefore} before (SC-002)`)

  const generated = new Date().toISOString()
  const report = { generated, threshold: BUSY_COVERAGE, viewport: `${width}x${height}`, seeds, totals, gridBuild: grid, failures, skipped, maps: rows }
  const dir = join('check-reports', 'places')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const ok = failures.length === 0
  return { ok, exitCode: ok ? 0 : 1, outcome: ok ? 'pass' : 'fail', threshold: BUSY_COVERAGE, viewport: report.viewport, totals, gridBuild: grid, skipped: skipped.length, failures: failures.slice(0, 20), report: join(dir, 'report.json') }
}
