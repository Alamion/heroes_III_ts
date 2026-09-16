// `yarn verify budget` (contracts/checks-cli.md, spec US5).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { CommandResult, ParsedArgs } from '../../shared/cli-runner.ts'
import { flag, intOpt, opt } from '../../shared/cli-runner.ts'
import { hasChromium, launchBrowser, startServer } from '../../shared/browser.ts'
import { installMaps, requireGameFile, requireTestMap } from '../../shared/game-files.ts'
import { validateJson } from '../../shared/json-schema.ts'
import { SMALL_MAP, STRESS_MAP, writeStressFiles } from '../../../test/fixtures/synthetic/stress-map.ts'
import { entry, evaluateMap, evaluateSc007, LIMITS } from './evaluate.ts'
import type { BudgetEntry } from './evaluate.ts'
import { measureFrameWork, measureMap } from './metrics.ts'
import { measureRuntimeSize } from './size.ts'

const SCHEMA_PATH = resolve(import.meta.dirname, '../../../specs/003-map-objects/contracts/report.schema.json')

function mapSize(path: string): { size: number; levels: number } {
  const raw = new Uint8Array(readFileSync(path))
  const data = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(gunzipSync(raw)) : raw
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { size: view.getUint32(5, true), levels: data[9] === 1 ? 2 : 1 }
}

/** The largest base-game map in the install (144×144 two-level preferred). */
function largestInstallMap(): string | undefined {
  let best: { path: string; score: number } | undefined
  for (const path of installMaps()) {
    const raw = new Uint8Array(readFileSync(path))
    const data = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(gunzipSync(raw)) : raw
    const version = new DataView(data.buffer, data.byteOffset).getUint32(0, true)
    if (![0x0e, 0x15, 0x1c].includes(version)) continue
    const { size, levels } = mapSize(path)
    const score = size * size * levels
    if (best === undefined || score > best.score) best = { path, score }
  }
  return best?.path
}

export async function budgetCommand(args: ParsedArgs): Promise<CommandResult> {
  if (!hasChromium()) return { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no-chromium' }
  const [vw, vh] = (opt(args, 'viewport') ?? '1920x1080').split('x').map(Number) as [number, number]
  const viewport = { width: vw, height: vh }
  const throttle = intOpt(args, 'throttle', 4)
  const idleMs = intOpt(args, 'idle-ms', 5000)
  const budgets: BudgetEntry[] = []
  const maps: { name: string; size: number; levels: number; synthetic: boolean }[] = []

  const server = await startServer('preview', { rebuild: !flag(args, 'no-build') })
  const synthetic = writeStressFiles()
  const browser = await launchBrowser()
  try {
    const size = measureRuntimeSize(resolve('dist'))
    budgets.push(entry('runtime-js-gzip', size.runtimeGzipBytes, LIMITS.runtimeJsGzipBytes, 'bytes', undefined, size.files.map((f) => `${f.file}${f.role === 'harness' ? ' (harness, excluded)' : ''}: ${f.gzipBytes}`).join(', ')))
    const opts = { browser, baseUrl: server.url, viewport, throttle }

    const archive = requireGameFile('h3sprite.lod')
    const dataArchive = requireGameFile('h3bitmap.lod') ?? undefined
    const requested = args.flags.get('map')
    const realMaps: string[] = []
    if (archive !== null) {
      const names = requested ?? ['Arrogance.h3m']
      for (const n of names) {
        const p = requireGameFile(n)
        if (p !== null) realMaps.push(p)
      }
      const testMap = requested === undefined ? requireTestMap() : null
      if (testMap !== null) realMaps.push(testMap)
      if (requested === undefined) {
        const largest = largestInstallMap()
        if (largest !== undefined) realMaps.push(largest)
      }
    }
    if (archive === null || realMaps.length === 0) {
      for (const id of ['cold-start', 'warm-start', 'memory', 'surface', 'hidden-frames', 'hidden-timers', 'idle-cadence']) budgets.push({ id, status: 'skip', note: 'real game files absent; synthetic maps measured below' })
    }
    for (const p of realMaps) {
      const m = await measureMap(opts, basename(p), archive as string, p, idleMs, dataArchive)
      maps.push({ name: basename(p), ...mapSize(p), synthetic: false })
      budgets.push(...evaluateMap(m))
    }

    // The synthetic 252×252×2 map runs within the same budgets (SC-006 for the largest map size).
    const stressPath = synthetic.maps[STRESS_MAP] as string
    const smallPath = synthetic.maps[SMALL_MAP] as string
    const stress = await measureMap(opts, STRESS_MAP, synthetic.archive, stressPath, idleMs, synthetic.dataArchive)
    maps.push({ name: STRESS_MAP, size: 252, levels: 2, synthetic: true }, { name: SMALL_MAP, size: 96, levels: 2, synthetic: true })
    budgets.push(...evaluateMap(stress))

    const small = await measureFrameWork(opts, synthetic.archive, smallPath, 60, synthetic.dataArchive)
    const large = await measureFrameWork(opts, synthetic.archive, stressPath, 60, synthetic.dataArchive)
    budgets.push(...evaluateSc007(small, large))
  } finally {
    await browser.close()
    await server.close()
    rmSync(synthetic.dir, { recursive: true, force: true })
  }

  const report = { ok: budgets.every((b) => b.status !== 'fail'), createdAt: new Date().toISOString(), throttle, viewport: { ...viewport, dpr: 1 }, maps, budgets }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>
  const errors = validateJson(schema, (schema.$defs as Record<string, Record<string, unknown>>).budget as Record<string, unknown>, report)
  if (errors.length > 0) throw new Error(`budget report does not match its schema: ${JSON.stringify(errors.slice(0, 5))}`)
  const outDir = resolve('check-reports', 'budget', report.createdAt.replace(/[:.]/g, '-'))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return { ...report, report: join(outDir, 'report.json'), exitCode: report.ok ? 0 : 1 }
}
