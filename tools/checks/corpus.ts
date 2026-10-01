// `yarn verify corpus`: a soft regression check over every game still (spec 005 research "Draw order:
// who stands below whom"). Draw-order and shadow work changes many views at once; a change may fix
// one map and break another. The committed corpus file records, per capture, how many pixels differ
// from the game; the check re-runs fidelity on every still whose map file is present and fails when a
// view got worse by more than the tolerance. `--update` records the current numbers. Captures stay
// local (git-ignored); the file holds only capture ids, map hashes and pixel counts.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../reference-env/config.ts'
import { scanRecords } from '../reference-env/store/lookup.ts'
import { flag, opt } from '../shared/cli-runner.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { gameDirs } from '../shared/game-files.ts'
import { fidelityCommand } from './fidelity/index.ts'

export const CORPUS_PATH = join('test', 'real', 'fidelity-corpus.json')

/** A view regresses when it differs on more than max(pixels, share × recorded) extra pixels. */
export const CORPUS_TOLERANCE = { pixels: 50, share: 0.02 } as const

export interface CorpusEntry {
  capture: string
  map: string
  mapSha256: string
  level: number
  differing: number
}

interface CorpusFile {
  note: string
  tolerance: typeof CORPUS_TOLERANCE
  captures: CorpusEntry[]
}

/** Every map file of that name in dev-assets and both installs, by content hash. */
function mapFilesByHash(): Map<string, string> {
  const dirs = gameDirs()
  const out = new Map<string, string>()
  for (const dir of [dirs.devAssets, dirs.mapsDir, dirs.hotaMapsDir]) {
    if (dir === undefined || !existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.h3m')) continue
      const path = join(dir, name)
      const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
      if (!out.has(sha)) out.set(sha, path)
    }
  }
  return out
}

export function regressed(recorded: number, now: number): boolean {
  return now > recorded + Math.max(CORPUS_TOLERANCE.pixels, recorded * CORPUS_TOLERANCE.share)
}

export async function corpusCommand(args: ParsedArgs): Promise<CommandResult> {
  const only = opt(args, 'only')?.toLowerCase()
  const update = flag(args, 'update')
  const recorded: CorpusFile = existsSync(CORPUS_PATH) ? (JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as CorpusFile) : { note: '', tolerance: CORPUS_TOLERANCE, captures: [] }
  let capturesDir: string
  try {
    capturesDir = loadConfig(process.env, process.cwd()).capturesDir
  } catch {
    return { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no-config', detail: 'no reference environment configured' }
  }
  const stills = scanRecords(capturesDir).filter((c) => c.record.source === 'game' && c.record.kind === 'still')
  const files = mapFilesByHash()
  // One fidelity run per map file; captures of other versions of a map are not part of the corpus.
  const byMap = new Map<string, { name: string; sha: string }>()
  const stale: string[] = []
  for (const c of stills) {
    if (only !== undefined && !c.record.map.name.toLowerCase().includes(only)) continue
    const path = files.get(c.record.map.sha256)
    if (path === undefined) stale.push(c.record.id)
    else byMap.set(path, { name: c.record.map.name, sha: c.record.map.sha256 })
  }
  const now = new Map<string, CorpusEntry>()
  const failures: string[] = []
  for (const [path, m] of [...byMap].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const r = await fidelityCommand({ positional: [], flags: new Map([['map', [path]], ['kind', ['still']], ['all-regions', ['true']]]) })
    for (const res of (r.results as Record<string, unknown>[] | undefined) ?? []) {
      if (typeof res.capture !== 'string' || typeof res.differing !== 'number') {
        if (res.outcome !== 'skip') failures.push(`${m.name}: ${JSON.stringify(res).slice(0, 200)}`)
        continue
      }
      now.set(res.capture, { capture: res.capture, map: m.name, mapSha256: m.sha, level: Number(res.level), differing: res.differing })
    }
  }

  const regressions: Record<string, unknown>[] = []
  const improvements: Record<string, unknown>[] = []
  const missing: string[] = []
  for (const e of recorded.captures) {
    if (only !== undefined && !e.map.toLowerCase().includes(only)) continue
    const n = now.get(e.capture)
    if (n === undefined) {
      missing.push(e.capture)
      continue
    }
    const row = { capture: e.capture, map: e.map, recorded: e.differing, now: n.differing, delta: n.differing - e.differing }
    if (regressed(e.differing, n.differing)) regressions.push(row)
    else if (n.differing < e.differing) improvements.push(row)
  }
  const known = new Set(recorded.captures.map((e) => e.capture))
  const added = [...now.values()].filter((e) => !known.has(e.capture)).map((e) => ({ capture: e.capture, map: e.map, now: e.differing }))
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
  const compared = recorded.captures.filter((e) => now.has(e.capture))
  const baselineOf = new Map(stills.map((c) => [c.record.id, c.record.baseline ?? 'complete']))
  const byBaseline: Record<string, { recorded: number; now: number; views: number }> = {}
  for (const e of compared) {
    const b = baselineOf.get(e.capture) ?? 'complete'
    const t = (byBaseline[b] ??= { recorded: 0, now: 0, views: 0 })
    t.recorded += e.differing
    t.now += (now.get(e.capture) as CorpusEntry).differing
    t.views++
  }
  const totals = { recorded: sum(compared.map((e) => e.differing)), now: sum(compared.map((e) => (now.get(e.capture) as CorpusEntry).differing)), views: compared.length }

  if (update) {
    // Entries of captures not run now (other maps with --only, absent captures) are kept.
    const merged = new Map(recorded.captures.map((e) => [e.capture, e]))
    for (const [id, e] of now) merged.set(id, e)
    const file: CorpusFile = {
      note: 'Differing pixels per game still, recorded by `yarn verify corpus --update` (tools/checks/corpus.ts). Soft regression check for draw order and shadows; captures are local.',
      tolerance: CORPUS_TOLERANCE,
      captures: [...merged.values()].sort((a, b) => a.map.localeCompare(b.map) || a.capture.localeCompare(b.capture)),
    }
    writeFileSync(CORPUS_PATH, `${JSON.stringify(file, null, 2)}\n`)
  }
  const ok = regressions.length === 0 && failures.length === 0
  if (now.size === 0 && recorded.captures.length === 0) return { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no-capture', detail: 'no game stills with a matching map file' }
  return { ok, exitCode: ok ? 0 : 1, outcome: ok ? 'pass' : 'fail', totals, byBaseline, regressions, improvements: improvements.length, improved: improvements.sort((a, b) => (a.delta as number) - (b.delta as number)).slice(0, 20), added, missing, staleCaptures: stale.length, failures, updated: update }
}
