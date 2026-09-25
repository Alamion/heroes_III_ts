import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { decodePng } from '../../tools/shared/png.ts'
import { patternPixels, proceduralPalette, writeDef } from '../fixtures/synthetic/def.ts'
import { writeLod } from '../fixtures/synthetic/lod.ts'
import { writePcxIndexed } from '../fixtures/synthetic/pcx.ts'
import { allBodiesMap, writeH3mGz } from '../fixtures/synthetic/h3m.ts'
import { runTool } from '../fixtures/run-tool.ts'
import { writeSyntheticFiles } from '../fixtures/synthetic/terrain-archive.ts'
import { MIXED_FOLDER, mapFolderZip, writeMapFolder } from '../fixtures/synthetic/map-folder.ts'

const dir = mkdtempSync(join(tmpdir(), 'inspect-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const def = writeDef({ fullWidth: 32, fullHeight: 32, groups: [{ type: 0, frames: [{ name: 'a.pcx', compression: 1, width: 32, height: 32, pixels: patternPixels(32, 32, 1) }, { name: 'b.pcx', compression: 3, width: 32, height: 32, pixels: patternPixels(32, 32, 2) }] }] })
const lodPath = join(dir, 'syn.lod')
writeFileSync(lodPath, writeLod([{ name: 'watrtl.def', data: def, compress: true }, { name: 'pic.pcx', data: writePcxIndexed(4, 3, patternPixels(4, 3), proceduralPalette()) }]))
const mapPath = join(dir, 'syn.h3m')
writeFileSync(mapPath, writeH3mGz(allBodiesMap('AB')))
// Point the install lookup away from any real game files.
const env = { H3REF_BUNDLE_DIR: join(dir, 'no-install') }
const h3 = (args: string[]) => runTool('tools/inspect/cli.ts', args, env)

describe('yarn h3 (synthetic files)', () => {
  it('lists and extracts LOD entries', async () => {
    const list = await h3(['lod', 'list', lodPath, '--filter', '*.def'])
    expect(list.code).toBe(0)
    expect(list.json).toMatchObject({ ok: true, count: 1, total: 2 })
    const out = join(dir, 'out.def')
    const ex = await h3(['lod', 'extract', `${lodPath}:WATRTL.DEF`, '--out', out])
    expect(ex.code).toBe(0)
    expect(new Uint8Array(readFileSync(out))).toEqual(def)
  })

  it('dumps DEFs and exports frames and palettes', async () => {
    const dump = await h3(['def', 'dump', `${lodPath}:watrtl.def`])
    expect(dump.json).toMatchObject({ ok: true, frameCount: 2, rotations: [{ start: 229, length: 12 }, { start: 242, length: 12 }] })
    const png = join(dir, 'f.png')
    const r = await h3(['def', 'png', `${lodPath}:watrtl.def`, '--frame', '1', '--out', png, '--opaque'])
    expect(r.json).toMatchObject({ ok: true, width: 32, height: 32, viewIndex: 1 })
    expect(decodePng(new Uint8Array(readFileSync(png)))).toMatchObject({ width: 32, height: 32, channels: 4 })
    const pal = await h3(['def', 'palette', `${lodPath}:watrtl.def`, '--step', '1'])
    const colors = pal.json.palette as number[][]
    const base = proceduralPalette()
    // One step moves the last colour of the range (240) to its start (229).
    expect(colors[229]).toEqual([base[240 * 3], base[240 * 3 + 1], base[240 * 3 + 2]])
  })

  it('reads PCX images', async () => {
    const r = await h3(['pcx', 'dump', `${lodPath}:pic.pcx`])
    expect(r.json).toMatchObject({ ok: true, width: 4, height: 3, kind: 'indexed' })
  })

  it('inspects maps', async () => {
    const info = await h3(['map', 'info', mapPath])
    expect(info.json).toMatchObject({ ok: true, version: 'AB', size: 36, hasUnderground: true })
    const tiles = await h3(['map', 'tiles', mapPath, '--region', '0,0,2,1'])
    expect((tiles.json.rows as unknown[]).length).toBe(2)
    const objects = await h3(['map', 'objects', mapPath, '--class', '98'])
    expect(objects.json).toMatchObject({ ok: true, count: 1 })
    const one = await h3(['map', 'object', mapPath, '--index', '0'])
    expect(one.json).toMatchObject({ ok: true, object: { index: 0 } })
    const all = await h3(['map', 'parse-all', '--dir', dir])
    expect(all.json).toMatchObject({ ok: true, parsed: 1, failed: [] })
  })

  it('lists the object draw list and random outcomes (spec 003)', async () => {
    const files = writeSyntheticFiles([{ name: 'objects.h3m', size: 36, underground: true }])
    const common = ['--archive', files.archive, '--data-archive', files.dataArchive]
    const map = files.maps['objects.h3m'] as string
    const list = await h3(['map', 'draw-list', map, '--level', '0', '--region', '0,0,18,16', '--tick', '3', ...common])
    expect(list.code).toBe(0)
    const json = list.json as { ok: boolean; tick: number; entries: { className: string; kind: string; x: number; y: number; frame: number; frameCount: number; phase: number; flat: boolean }[]; hidden: { className: string }[] }
    expect(json).toMatchObject({ ok: true, tick: 3 })
    expect(json.hidden.map((h) => h.className)).toEqual(['event'])
    expect(json.entries.some((e) => e.className === 'event')).toBe(false)
    const heroParts = json.entries.filter((e) => e.kind !== 'object')
    expect(heroParts.filter((e) => e.kind === 'heroBody').length).toBeGreaterThan(0)
    expect(heroParts.filter((e) => e.kind === 'heroFlag').length).toBe(heroParts.filter((e) => e.kind === 'heroBody').length)
    // Flat objects first; animated frames follow tick + phase.
    const firstStanding = json.entries.findIndex((e) => !e.flat)
    expect(json.entries.slice(firstStanding).every((e) => !e.flat)).toBe(true)
    for (const e of json.entries) expect(e.frame).toBe((3 + e.phase) % e.frameCount)
    const random = await h3(['map', 'random', map, '--seed', '5', ...common])
    expect(random.code).toBe(0)
    const outcomes = (random.json as { outcomes: { className: string; resolved: { classId: number } }[] }).outcomes
    expect(outcomes.filter((o) => o.className === 'random_monster').every((o) => o.resolved.classId === 54)).toBe(true)
    rmSync(files.dir, { recursive: true, force: true })
  })

  it('uses documented exit codes and error JSON', async () => {
    const usage = await h3(['map', 'object', mapPath])
    expect(usage.code).toBe(2)
    const missing = await h3(['map', 'info', 'definitely-missing.h3m'])
    expect(missing.code).toBe(3)
    const broken = join(dir, 'broken.h3m')
    // 0x33 is WoG: a format the reader knows of but does not support.
    writeFileSync(broken, Uint8Array.of(0x33, 0, 0, 0, 1, 2))
    const bad = await h3(['map', 'info', broken])
    expect(bad.code).toBe(1)
    expect(bad.json).toMatchObject({ ok: false, error: { name: 'FormatError', code: 'UNSUPPORTED_VERSION', file: 'broken.h3m' } })
    const unknown = await h3(['nope'])
    expect(unknown.code).toBe(2)
  })
})

describe('yarn h3 map summary | catalogue (spec 007)', () => {
  it('summarises a map and lists a folder and a .zip with verdicts', async () => {
    const sum = await h3(['map', 'summary', mapPath])
    expect(sum.json).toMatchObject({ ok: true, version: 'AB', levels: 2 })
    const folder = join(dir, 'Карты')
    writeMapFolder(folder, MIXED_FOLDER)
    const zip = join(dir, 'maps.zip')
    writeFileSync(zip, mapFolderZip(MIXED_FOLDER))
    for (const target of [folder, zip]) {
      const cat = await h3(['map', 'catalogue', target, '--size-max', 'l', '--underground', 'any'])
      expect(cat.code).toBe(0)
      const json = cat.json as { count: number; eligible: number; entries: { path: string; verdict: string }[] }
      expect(json.count).toBe(5)
      expect(json.eligible).toBe(4)
      expect(json.entries.find((e) => e.path === 'nested/deeper/xl.H3M')?.verdict).toBe('filtered')
    }
    expect((await h3(['map', 'catalogue', folder, '--size-min', 'huge'])).code).toBe(2)
  })
})
