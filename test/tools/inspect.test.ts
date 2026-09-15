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

  it('uses documented exit codes and error JSON', async () => {
    const usage = await h3(['map', 'object', mapPath])
    expect(usage.code).toBe(2)
    const missing = await h3(['map', 'info', 'definitely-missing.h3m'])
    expect(missing.code).toBe(3)
    const broken = join(dir, 'broken.h3m')
    writeFileSync(broken, Uint8Array.of(0x20, 0, 0, 0, 1, 2))
    const bad = await h3(['map', 'info', broken])
    expect(bad.code).toBe(1)
    expect(bad.json).toMatchObject({ ok: false, error: { name: 'FormatError', code: 'UNSUPPORTED_VERSION', file: 'broken.h3m' } })
    const unknown = await h3(['nope'])
    expect(unknown.code).toBe(2)
  })
})
