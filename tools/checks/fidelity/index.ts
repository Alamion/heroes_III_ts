// `yarn verify fidelity` (contracts/checks-cli.md, spec US4).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { loadConfig } from '../../reference-env/config.ts'
import type { CaptureRecord } from '../../reference-env/model/types.ts'
import { CHECK_THRESHOLDS } from '../../../src/core/data/thresholds.ts'
import type { CommandResult, ParsedArgs, Region } from '../../shared/cli-runner.ts'
import { flag, opt, parseRegion, required } from '../../shared/cli-runner.ts'
import { hasChromium } from '../../shared/browser.ts'
import { usage } from '../../shared/errors.ts'
import { gameDirs, requireGameFile } from '../../shared/game-files.ts'
import { validateJson } from '../../shared/json-schema.ts'
import { encodePng } from '../../shared/png.ts'
import { HeadlessRenderer } from '../../shared/render-page.ts'
import { allGameCaptures, findFor, loadCapture, mayBeMisaligned, selectCaptures, uiCornerMask } from './captures.ts'
import { buildMapContext, buildObjectContext } from './masks.ts'
import type { MapContext, ObjectContext } from './masks.ts'
import { runFidelity } from './run.ts'
import type { LoadedCapture, UiMask } from './captures.ts'
import type { HeadlessRenderer as Renderer } from '../../shared/render-page.ts'

const SCHEMA_PATH = resolve(import.meta.dirname, '../../../specs/003-map-objects/contracts/report.schema.json')

function capturesDir(): string {
  try {
    return loadConfig(process.env, process.cwd()).capturesDir
  } catch {
    return resolve(process.env.H3REF_CAPTURES_DIR ?? 'reference-captures')
  }
}

interface VisualReviewEntry {
  map: string
  level: number
  region: Region
  captureId: string
  reason: string
  addedAt: string
}

function appendVisualReview(dir: string, entry: VisualReviewEntry): void {
  const file = join(dir, 'visual-review.json')
  const list: VisualReviewEntry[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as VisualReviewEntry[]) : []
  if (!list.some((e) => e.captureId === entry.captureId && JSON.stringify(e.region) === JSON.stringify(entry.region))) list.push(entry)
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
}

async function findMisregistration(capture: LoadedCapture, ctx: MapContext, renderer: Renderer, region: Region | undefined, ui: UiMask | null, compared: number): Promise<{ dx: number; dy: number; differing: number } | undefined> {
  for (const [dx, dy] of [[0, 32], [0, -32], [32, 0], [-32, 0], [32, 32], [-32, -32], [32, -32], [-32, 32]] as const) {
    const record = structuredClone(capture.record)
    record.mapping.originPixel.x += dx
    record.mapping.originPixel.y += dy
    const shifted = { ...capture, record } as LoadedCapture
    const r = await runFidelity({ capture: shifted, ctx, renderer, region, ui, verifyGpu: false, excludeObjects: true })
    if (r.pixels.differing <= 0.01 * compared) return { dx, dy, differing: r.pixels.differing }
  }
  return undefined
}

export async function fidelityCommand(args: ParsedArgs): Promise<CommandResult> {
  const mapArg = required(args, 'map')
  const levelArg = opt(args, 'level')
  const allRegions = flag(args, 'all-regions')
  const kindArg = opt(args, 'kind')
  if (kindArg !== undefined && kindArg !== 'still' && kindArg !== 'clip') throw usage('--kind must be still or clip')
  const region = opt(args, 'region') === undefined ? undefined : parseRegion(opt(args, 'region') as string)
  if (!allRegions && (region === undefined || levelArg === undefined)) throw usage('give --level and --region, or --all-regions')
  const requireRun = flag(args, 'require')
  const skip = (reason: string, detail: string): CommandResult => ({ ok: !requireRun, exitCode: requireRun ? 3 : 4, outcome: 'skip', skipReason: reason, detail })

  const mapPath = requireGameFile(mapArg)
  const archivePath = requireGameFile(opt(args, 'archive') ?? 'h3sprite.lod')
  if (mapPath === null || archivePath === null || gameDirs().bundleDir === undefined) return skip('no-game-files', 'map, sprite archive or game install (for object sprites) not found')
  if (!hasChromium()) return skip('no-chromium', 'headless Chromium not found (set H3_CHROMIUM)')

  const dir = capturesDir()
  let targets: { dir: string; record: CaptureRecord }[]
  const captureId = opt(args, 'capture')
  if (captureId !== undefined) targets = allGameCaptures(dir, mapArg).filter((c) => c.record.id === captureId)
  else if (allRegions) targets = allGameCaptures(dir, mapArg).filter((c) => (levelArg === undefined || c.record.level === Number(levelArg)) && (kindArg === undefined || c.record.kind === kindArg))
  else targets = findFor(dir, mapArg, Number(levelArg) as 0 | 1, region as Region, kindArg as 'still' | 'clip' | undefined)
  // Only captures of the current map file count (spec 003 T031); older versions are reported once.
  const mapSha = createHash('sha256').update(readFileSync(mapPath)).digest('hex')
  const selected = selectCaptures(targets, mapSha, allRegions)
  const stale = selected.stale
  targets = allRegions || captureId !== undefined ? selected.current : selected.current.slice(0, 1)
  const excludeObjects = flag(args, 'exclude-objects')
  if (targets.length === 0) {
    if (stale.length > 0) return skip('map-changed', `${stale.length} captures of ${mapArg} were taken from a different version of the map file`)
    return skip('no-capture', `no game capture of ${mapArg} matches`)
  }

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = resolve('check-reports', 'fidelity', stamp)
  mkdirSync(outDir, { recursive: true })
  const ui = uiCornerMask(dir)
  let ctx: MapContext | undefined
  let objects: ObjectContext | undefined
  const dataArchive = excludeObjects ? null : requireGameFile(opt(args, 'data-archive') ?? 'h3bitmap.lod')
  const seedArg = opt(args, 'seed')
  const seed = seedArg === undefined ? undefined : Number(seedArg)
  if (seed !== undefined && !Number.isInteger(seed)) throw usage('--seed must be an integer')
  const renderer = await HeadlessRenderer.open({ rebuild: flag(args, 'rebuild'), width: 800, height: 600 })
  const results: Record<string, unknown>[] = []
  if (stale.length > 0) results.push({ outcome: 'skip', skipReason: 'map-changed', captures: stale.map((t) => t.record.id), detail: 'captures taken from a different version of the map file (sha256 differs)' })
  try {
    for (const t of targets) {
      ctx ??= await buildMapContext(mapPath, archivePath)
      if (dataArchive !== null && objects === undefined) objects = await buildObjectContext(ctx, { dataArchive, ...(seed !== undefined ? { seed } : {}) })
      const capture = loadCapture(t.dir, t.record)
      // Without the data archive objects cannot be drawn: fall back to excluding them.
      const r = await runFidelity({ capture, ctx, renderer, region, ui, excludeObjects: excludeObjects || objects === undefined, ...(objects !== undefined ? { objects } : {}) })
      // Captures verified at record time (spec 003) cannot be misaligned; older ones may be.
      if (r.outcome === 'fail' && mayBeMisaligned(t.record) && r.pixels.differing > 0.05 * r.pixels.compared) {
        // A large difference may be a capture whose recorded tile mapping is off by a tile (seen on
        // item 1 stills clamped at the top map edge). Try one-tile shifts before reporting a failure.
        const shift = await findMisregistration(capture, ctx, renderer, region, ui, r.pixels.compared)
        if (shift !== undefined) {
          results.push({ capture: t.record.id, kind: t.record.kind, level: t.record.level, outcome: 'skip', skipReason: 'capture-misaligned', detail: `recorded mapping is off by (${shift.dx}, ${shift.dy}) px; with that shift ${shift.differing} pixels differ`, shift })
          continue
        }
      }
      const reportDir = join(outDir, t.record.id)
      mkdirSync(reportDir, { recursive: true })
      const diffPath = join(reportDir, 'diff.png')
      if (r.diff.width > 0) {
        const png = (data: Uint8Array): Uint8Array => encodePng({ width: r.diff.width, height: r.diff.height, channels: 4, data })
        writeFileSync(diffPath, png(r.diff.rgba))
        writeFileSync(join(reportDir, 'reference.png'), png(r.images.reference))
        writeFileSync(join(reportDir, 'rendered.png'), png(r.images.rendered))
      }
      const usedRegion = region ?? { x0: t.record.visible.x0, y0: t.record.visible.y0, x1: t.record.visible.x1, y1: t.record.visible.y1 }
      const report = {
        outcome: r.outcome,
        createdAt: new Date().toISOString(),
        map: { name: t.record.map.name, sha256: t.record.map.sha256 },
        level: t.record.level,
        region: usedRegion,
        capture: { id: t.record.id, kind: t.record.kind, dir: t.dir },
        gpuMatchesReference: r.gpuMatchesReference,
        paletteStep: r.paletteStep,
        ...(r.paletteStepsBySprite !== undefined ? { paletteStepsBySprite: r.paletteStepsBySprite } : {}),
        ...(r.objectFramesByObject !== undefined ? { objectFramesByObject: r.objectFramesByObject } : {}),
        pixels: r.pixels,
        tiles: r.tiles.filter((x) => x.differing > 0),
        randomCauses: r.randomCauses,
        thresholds: { notCheckableComparedShare: CHECK_THRESHOLDS.notCheckableComparedShare },
        ...(r.clip !== undefined ? { clip: r.clip } : {}),
        diffImage: diffPath,
      }
      const errors = validateJson(schema, (schema.$defs as Record<string, Record<string, unknown>>).fidelity as Record<string, unknown>, report)
      if (errors.length > 0) throw new Error(`fidelity report does not match its schema: ${JSON.stringify(errors.slice(0, 5))}`)
      writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
      if (r.outcome === 'not-checkable') {
        appendVisualReview(dir, { map: t.record.map.name, level: t.record.level, region: usedRegion, captureId: t.record.id, reason: `compared ${r.pixels.compared} of ${r.pixels.inMap} in-map pixels`, addedAt: report.createdAt })
      }
      results.push({ capture: t.record.id, kind: t.record.kind, level: t.record.level, outcome: r.outcome, gpuMatchesReference: r.gpuMatchesReference, paletteStep: r.paletteStep, compared: r.pixels.compared, comparedAnimated: r.pixels.comparedAnimated, comparedObject: r.pixels.comparedObject, differing: r.pixels.differing, excluded: r.pixels.excluded, badTiles: r.tiles.filter((x) => x.differing > 0).length, ...(r.clip !== undefined ? { clip: { pass: r.clip.pass, stepMsMeasured: r.clip.stepMsMeasured, objectStepMsMeasured: r.clip.objectStepMsMeasured } } : {}), report: join(reportDir, 'report.json') })
    }
  } finally {
    await renderer.close()
  }
  const failed = results.filter((r) => r.outcome === 'fail').length
  const outcome = failed > 0 ? 'fail' : results.every((r) => r.outcome === 'not-checkable') ? 'not-checkable' : results.every((r) => r.outcome === 'skip') ? 'skip' : 'pass'
  return { ok: failed === 0, exitCode: failed > 0 ? 1 : outcome === 'skip' ? (requireRun ? 3 : 4) : 0, outcome, reports: outDir, results }
}
