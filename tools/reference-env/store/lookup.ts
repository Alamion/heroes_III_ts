import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import { cropForRegion, rangeContains } from '../analysis/geometry.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import { recordBaseline } from '../data/baselines.ts'
import type { Baseline, CaptureMatch, CaptureQuery, CaptureRecord, Kind, Source } from '../model/types.ts'
import { resolveMap } from './capture-store.ts'
import { validateRecord } from '../model/validate-record.ts'

export interface StoredCapture {
  dir: string
  record: CaptureRecord
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    if (!statSync(p).isDirectory()) continue
    if (existsSync(join(p, 'record.json'))) out.push(p)
    else walk(p, out)
  }
}

/** All valid capture records under capturesDir; invalid ones are skipped with a warning. */
export function scanRecords(capturesDir: string): StoredCapture[] {
  const dirs: string[] = []
  walk(capturesDir, dirs)
  const out: StoredCapture[] = []
  for (const dir of dirs) {
    try {
      out.push({ dir, record: validateRecord(JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'))) })
    } catch (err) {
      log.warn(`skipping invalid capture ${dir}: ${(err as Error).message}`)
    }
  }
  return out
}

function matchesMap(record: CaptureRecord, map: string): boolean {
  const m = map.normalize('NFC')
  return record.map.key === m || record.map.name.toLowerCase() === m.toLowerCase() || record.map.name.replace(/\.h3m$/i, '').toLowerCase() === m.toLowerCase()
}

const newestFirst = (a: StoredCapture, b: StoredCapture) => b.record.createdAt.localeCompare(a.record.createdAt)

export function findCaptures(capturesDir: string, q: CaptureQuery): CaptureMatch[] {
  return scanRecords(capturesDir)
    .filter(({ record: r }) =>
      matchesMap(r, q.map) &&
      r.level === q.level &&
      (q.source === undefined || r.source === q.source) &&
      (q.kind === undefined || r.kind === q.kind) &&
      (q.baseline === undefined || recordBaseline(r) === q.baseline) &&
      rangeContains(r.visible, q.region),
    )
    .sort(newestFirst)
    .slice(0, q.limit ?? Infinity)
    .map(({ dir, record }) => ({ id: record.id, dir, record, crop: cropForRegion(record.mapping, q.region) }))
}

function dirSize(dir: string): number {
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    total += st.isDirectory() ? dirSize(p) : st.size
  }
  return total
}

export interface ListFilters {
  map?: string
  source?: Source
  kind?: Kind
  baseline?: Baseline
  before?: string
}

export function listCaptures(capturesDir: string, f: ListFilters): { id: string; dir: string; createdAt: string; sizeBytes: number }[] {
  return scanRecords(capturesDir)
    .filter(({ record: r }) =>
      (f.map === undefined || matchesMap(r, f.map)) &&
      (f.source === undefined || r.source === f.source) &&
      (f.kind === undefined || r.kind === f.kind) &&
      (f.baseline === undefined || recordBaseline(r) === f.baseline) &&
      (f.before === undefined || r.createdAt < f.before),
    )
    .sort(newestFirst)
    .map(({ dir, record }) => ({ id: record.id, dir, baseline: recordBaseline(record), createdAt: record.createdAt, sizeBytes: dirSize(dir) }))
}

/**
 * Whether a record's map hash equals the current file of that map name (searched in `searchDirs`);
 * null when the file is not found. Hashes are cached per resolved path.
 */
export function mapHashChecker(searchDirs: string[]): (record: CaptureRecord) => boolean | null {
  const cache = new Map<string, string | null>()
  return (record) => {
    let sha = cache.get(record.map.name)
    if (sha === undefined) {
      try {
        sha = createHash('sha256').update(readFileSync(resolveMap(record.map.name, searchDirs))).digest('hex')
      } catch {
        sha = null
      }
      cache.set(record.map.name, sha)
    }
    return sha === null ? null : sha === record.map.sha256
  }
}

export function pruneCaptures(capturesDir: string, opts: { ids?: string[]; before?: string; dryRun: boolean }): string[] {
  if ((opts.ids === undefined || opts.ids.length === 0) && opts.before === undefined) {
    throw new RefError(ERROR_CODES.USAGE, 'prune needs --id or --before')
  }
  const root = resolve(capturesDir)
  const targets = scanRecords(capturesDir).filter(({ record }) =>
    (opts.ids?.includes(record.id) ?? false) || (opts.before !== undefined && record.createdAt < opts.before),
  )
  const removed: string[] = []
  for (const { dir, record } of targets) {
    const rel = relative(root, resolve(dir))
    if (rel.startsWith('..') || rel === '') {
      throw new RefError(ERROR_CODES.USAGE, `refusing to delete outside capturesDir: ${dir}`)
    }
    if (!opts.dryRun) rmSync(dir, { recursive: true, force: true })
    removed.push(record.id)
  }
  return removed
}
