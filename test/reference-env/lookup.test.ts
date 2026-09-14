import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseRegion } from '../../tools/reference-env/commands/find.ts'
import { ERROR_CODES } from '../../tools/reference-env/errors.ts'
import type { CaptureRecord } from '../../tools/reference-env/model/types.ts'
import { captureDir } from '../../tools/reference-env/store/capture-store.ts'
import { findCaptures, listCaptures, pruneCaptures, scanRecords } from '../../tools/reference-env/store/lookup.ts'
import { makeRecord } from './fixtures.ts'

const temps: string[] = []
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function store(records: CaptureRecord[]): string {
  const root = mkdtempSync(join(tmpdir(), 'h3ref-lookup-'))
  temps.push(root)
  for (const r of records) {
    const dir = captureDir(root, r.map.key, r.level, r.source, r.kind, r.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'record.json'), JSON.stringify(r))
    writeFileSync(join(dir, 'still.png'), 'x')
  }
  return root
}

const older = makeRecord({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' })
const newer = makeRecord({ id: 'new', createdAt: '2026-09-10T00:00:00.000Z' })
const editor = makeRecord({
  id: 'ed',
  createdAt: '2026-09-05T00:00:00.000Z',
  source: 'editor',
  positionSource: 'editor-view',
  visibility: { method: 'editor', overlays: [] },
  executable: { file: 'h3maped.exe', sha256: 'c'.repeat(64), label: 'h3maped.exe (original)' },
})
delete (editor as Partial<CaptureRecord>).startSetup
const elsewhere = makeRecord({ id: 'far', visible: { x0: 17, y0: 19, x1: 35, y1: 35, partialEdges: [] }, requested: { x: 26, y: 27 } })

describe('lookup', () => {
  it('returns containing captures newest first with crops', () => {
    const root = store([older, newer, editor, elsewhere])
    const m = findCaptures(root, { map: 'Test.h3m', level: 0, region: { x0: 10, y0: 12, x1: 11, y1: 13 } })
    expect(m.map((x) => x.id)).toEqual(['new', 'ed', 'old'])
    // originTile (1,3) at pixel (8,8): tile (10,12) → (8 + 9*32, 8 + 9*32).
    expect(m[0]?.crop).toEqual({ x: 296, y: 296, w: 64, h: 64 })
  })
  it('filters by source, kind, limit and map key; empty when nothing contains the region', () => {
    const root = store([older, newer, editor])
    expect(findCaptures(root, { map: 'Test-aaaaaaaa', level: 0, region: { x0: 5, y0: 5, x1: 5, y1: 5 }, source: 'editor' }).map((x) => x.id)).toEqual(['ed'])
    expect(findCaptures(root, { map: 'Test', level: 0, region: { x0: 5, y0: 5, x1: 5, y1: 5 }, limit: 1 }).map((x) => x.id)).toEqual(['new'])
    expect(findCaptures(root, { map: 'Test', level: 0, region: { x0: 5, y0: 5, x1: 5, y1: 5 }, kind: 'clip' })).toEqual([])
    expect(findCaptures(root, { map: 'Test', level: 1, region: { x0: 5, y0: 5, x1: 5, y1: 5 } })).toEqual([])
    expect(findCaptures(root, { map: 'Test', level: 0, region: { x0: 30, y0: 30, x1: 31, y1: 31 } })).toEqual([])
  })
  it('skips invalid records', () => {
    const root = store([newer])
    const bad = join(root, 'x', '0', 'game-still', 'bad')
    mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'record.json'), '{"schemaVersion": 2}')
    expect(scanRecords(root).map((s) => s.record.id)).toEqual(['new'])
  })
})

describe('list and prune', () => {
  it('lists with sizes and filters', () => {
    const root = store([older, newer])
    const all = listCaptures(root, {})
    expect(all.map((c) => c.id)).toEqual(['new', 'old'])
    expect(all[0]?.sizeBytes).toBeGreaterThan(0)
    expect(listCaptures(root, { before: '2026-09-05T00:00:00.000Z' }).map((c) => c.id)).toEqual(['old'])
  })
  it('prunes by id or date, honours dry-run', () => {
    const root = store([older, newer])
    expect(pruneCaptures(root, { before: '2026-09-05T00:00:00.000Z', dryRun: true })).toEqual(['old'])
    expect(listCaptures(root, {}).length).toBe(2)
    expect(pruneCaptures(root, { ids: ['new'], dryRun: false })).toEqual(['new'])
    expect(existsSync(captureDir(root, newer.map.key, 0, 'game', 'still', 'new'))).toBe(false)
    expect(() => pruneCaptures(root, { dryRun: false })).toThrow(expect.objectContaining({ code: ERROR_CODES.USAGE }))
  })
})

describe('region option', () => {
  it('parses and validates', () => {
    expect(parseRegion('1,2,3,4')).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 })
    expect(() => parseRegion('3,2,1,4')).toThrow()
    expect(() => parseRegion('1,2,3')).toThrow()
  })
})
