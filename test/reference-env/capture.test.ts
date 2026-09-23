import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FrameTimelineBuilder, frameAt, toTimeline } from '../../tools/reference-env/analysis/frame-timeline.ts'
import { cropForRegion, tileToMinimapPoint, viewMapping } from '../../tools/reference-env/analysis/geometry.ts'
import { drawnEdges, findViewRect, rectToViewOrigin, shroudFraction } from '../../tools/reference-env/analysis/minimap.ts'
import { buildVolatileMask, compareWithMasks } from '../../tools/reference-env/analysis/volatile-mask.ts'
import { aggregate } from '../../tools/reference-env/commands/doctor.ts'
import { GAME_LAYOUT, GAME_VIEW } from '../../tools/reference-env/data/game-layout.ts'
import { planStaging } from '../../tools/reference-env/env/staging.ts'
import { baselineProfile } from '../../tools/reference-env/data/baselines.ts'
import { ERROR_CODES } from '../../tools/reference-env/errors.ts'
import { captureDir, captureId, writeCaptureAtomically } from '../../tools/reference-env/store/capture-store.ts'
import { makeRecord } from './fixtures.ts'

const temps: string[] = []
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const MM = GAME_LAYOUT.minimap
const COLOR = GAME_LAYOUT.viewRectColor

/** 800×600 black frame with a dashed view rectangle drawn like the game (clipped to the minimap). */
function screenWithView(mapSize: number, origin: { x: number; y: number }, fill: [number, number, number] = [90, 60, 30]): { width: number; rgb: Buffer } {
  const width = 800
  const rgb = Buffer.alloc(width * 600 * 3)
  const set = (x: number, y: number, c: readonly number[]) => {
    const i = (y * width + x) * 3
    rgb[i] = c[0] as number
    rgb[i + 1] = c[1] as number
    rgb[i + 2] = c[2] as number
  }
  for (let y = MM.y; y < MM.y + MM.h; y++) for (let x = MM.x; x < MM.x + MM.w; x++) set(x, y, fill)
  const scale = MM.w / mapSize
  const x0 = MM.x + Math.round(origin.x * scale)
  const y0 = MM.y + Math.round(origin.y * scale)
  const x1 = MM.x + Math.round((origin.x + GAME_VIEW.viewTiles.w) * scale) - 1
  const y1 = MM.y + Math.round((origin.y + GAME_VIEW.viewTiles.h) * scale) - 1
  const inside = (x: number, y: number) => x >= MM.x && x < MM.x + MM.w && y >= MM.y && y < MM.y + MM.h
  for (let x = x0; x <= x1; x++) {
    if ((x - x0) % 4 < 3) {
      if (inside(x, y0)) set(x, y0, COLOR)
      if (inside(x, y1)) set(x, y1, COLOR)
    }
  }
  for (let y = y0; y <= y1; y++) {
    if ((y - y0) % 4 < 3) {
      if (inside(x0, y)) set(x0, y, COLOR)
      if (inside(x1, y)) set(x1, y, COLOR)
    }
  }
  return { width, rgb }
}

describe('minimap', () => {
  for (const size of [36, 72, 144]) {
    it(`recovers the view origin on a ${size}×${size} map, including clipped edges`, () => {
      const origins = [
        { x: 5, y: 7 },
        { x: -9, y: -8 },
        { x: size - 10, y: size - 9 },
        // Top edge clipped by one tile: on 36×36 the side dashes start in a gap below the minimap
        // top, which used to be misread as an unclipped edge at origin 0.
        { x: 1, y: -1 },
        { x: -1, y: 3 },
      ]
      for (const origin of origins) {
        const frame = screenWithView(size, origin)
        const rect = findViewRect(frame, MM, COLOR)
        expect(rect).toBeDefined()
        const view = rectToViewOrigin(rect!, MM, size, GAME_VIEW.viewTiles, drawnEdges(frame, rect!, COLOR))
        expect({ x: view.originX, y: view.originY }).toEqual(origin)
      }
    })
  }
  it('measures shroud', () => {
    const revealed = screenWithView(36, { x: 1, y: 1 })
    expect(shroudFraction(revealed, MM, GAME_LAYOUT.shroudColor)).toBe(0)
    const shrouded = screenWithView(36, { x: 1, y: 1 }, [0, 0, 0])
    expect(shroudFraction(shrouded, MM, GAME_LAYOUT.shroudColor)).toBeGreaterThan(0.9)
  })
})

describe('geometry', () => {
  it('maps tiles to minimap centres', () => {
    expect(tileToMinimapPoint({ x: 0, y: 0 }, 36, MM)).toEqual({ x: 632, y: 28 })
    expect(tileToMinimapPoint({ x: 35, y: 35 }, 36, MM)).toEqual({ x: 772, y: 168 })
    expect(tileToMinimapPoint({ x: 10, y: 20 }, 144, MM)).toEqual({ x: 640, y: 46 })
    expect(tileToMinimapPoint({ x: 10, y: 20 }, 72, MM)).toEqual({ x: 651, y: 67 })
  })
  it('computes the visible range and mapping measured in the game', () => {
    // Target (10, 12) → origin (1, 4); the origin tile is drawn at (0, 8).
    const { visible, mapping } = viewMapping({ x: 1, y: 4 }, GAME_VIEW.originTilePixel, GAME_VIEW.viewport, 36)
    expect(visible).toEqual({ x0: 1, y0: 4, x1: 19, y1: 20, partialEdges: ['left', 'right'] })
    expect(cropForRegion(mapping, { x0: 10, y0: 12, x1: 10, y1: 12 })).toEqual({ x: 288, y: 264, w: 32, h: 32 })
  })
  it('clips the visible range at map edges', () => {
    const { visible, mapping } = viewMapping({ x: -9, y: -8 }, GAME_VIEW.originTilePixel, GAME_VIEW.viewport, 36)
    expect(visible).toMatchObject({ x0: 0, y0: 0, x1: 9, y1: 8 })
    expect(cropForRegion(mapping, { x0: 0, y0: 0, x1: 0, y1: 0 })).toEqual({ x: 288, y: 264, w: 32, h: 32 })
  })
})

describe('volatile mask', () => {
  it('marks changing pixels and ignores them when comparing', () => {
    const a = Buffer.alloc(2 * 2 * 3)
    const b = Buffer.from(a)
    b[3] = 9 // pixel 1 changes
    const mask = buildVolatileMask([a, b, a], 2, 2)
    expect([...mask]).toEqual([0, 255, 0, 0])
    const other = Buffer.from(a)
    other[3] = 50
    expect(compareWithMasks(a, other, 2, 2, mask)).toEqual({ compared: 3, differing: 0 })
    other[0] = 1
    expect(compareWithMasks(a, other, 2, 2, mask)).toEqual({ compared: 3, differing: 1 })
  })
})

describe('staging plan', () => {
  const tree: Record<string, string[]> = {
    '/b': ['Heroes3.exe', 'h3maped.exe', 'BINKW32.DLL', 'smackw32.dll', 'mss32.dll', 'MP3DEC.ASI', 'IFC20.dll', 'zdraw.dll', 'HotA.dll', 'Heroes3_HD.exe', '_HD3_.dll', 'Data', 'Mp3'],
    '/b/Data': ['h3bitmap.lod', 'h3sprite.lod', 'h3ab_bmp.lod', 'H3ab_spr.lod', 'heroes3.snd', 'H3ab_ahd.snd', 'video.vid', 'H3ab_ahd.vid', 'HotA.lod'],
  }
  const listDir = (d: string) => tree[d] ?? []

  it('stages whitelisted files case-insensitively and nothing from HotA/HD Mod', () => {
    const plan = planStaging(baselineProfile('complete'), '/b', '/maps/A.h3m', listDir)
    const froms = plan.map((a) => a.from).filter(Boolean)
    expect(froms).toContain('/b/BINKW32.DLL')
    expect(froms).toContain('/b/Data/H3ab_spr.lod')
    expect(froms.some((f) => /hota|_hd3_|heroes3_hd/i.test(f as string))).toBe(false)
    expect(plan.filter((a) => a.kind === 'map')).toEqual([{ kind: 'map', from: '/maps/A.h3m', to: 'Maps/reference.h3m' }])
    expect(plan.find((a) => a.to === 'Heroes3.exe')?.kind).toBe('copy')
  })
  it('reports missing required files', () => {
    const partial = (d: string) => (d === '/b' ? ['Heroes3.exe', 'Data'] : [])
    expect(() => planStaging(baselineProfile('complete'), '/b', undefined, partial)).toThrow(expect.objectContaining({ code: ERROR_CODES.PREREQ_MISSING }))
  })
})

describe('doctor aggregation', () => {
  it('fails only on fail checks', () => {
    expect(aggregate([{ id: 'a', status: 'pass', detail: '' }, { id: 'b', status: 'warn', detail: '' }]).ok).toBe(true)
    expect(aggregate([{ id: 'a', status: 'fail', detail: 'x', fix: 'y' }]).ok).toBe(false)
  })
})

describe('capture store', () => {
  function temp(): string {
    const d = mkdtempSync(join(tmpdir(), 'h3ref-store-'))
    temps.push(d)
    return d
  }
  it('names captures and writes atomically', async () => {
    const root = temp()
    const record = makeRecord()
    const id = captureId(new Date('2026-09-14T10:00:00.000Z'), record.visible)
    expect(id).toBe('2026-09-14T10-00-00-000Z_x1-19_y3-21')
    const dir = captureDir(root, 'complete', record.map.key, 0, 'game', 'still', id)
    await writeCaptureAtomically(dir, record, async (tmp) => {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(tmp, 'still.png'), 'x')
      writeFileSync(join(tmp, 'volatile-mask.png'), 'x')
    })
    expect(existsSync(join(dir, 'record.json'))).toBe(true)
    await expect(writeCaptureAtomically(dir, record, async () => undefined)).rejects.toMatchObject({ code: ERROR_CODES.GRAB_FAILED })
  })
  it('leaves nothing behind on failure', async () => {
    const root = temp()
    const record = makeRecord()
    const dir = captureDir(root, 'complete', record.map.key, 0, 'game', 'still', 'x')
    await expect(writeCaptureAtomically(dir, record, async () => undefined)).rejects.toMatchObject({ code: ERROR_CODES.GRAB_FAILED })
    expect(readdirSync(join(dir, '..'))).toEqual([])
  })
})

describe('frame timeline', () => {
  it('merges identical frames into a contiguous timeline', () => {
    const b = new FrameTimelineBuilder(10)
    const f = (v: number) => Buffer.from([v, v, v])
    for (const v of [1, 1, 2, 2, 2, 2, 3, 3, 3, 4]) b.push(f(v))
    const r = b.finish()
    expect(r.frames.map((x) => [x.tStartMs, x.tEndMs])).toEqual([[0, 200], [200, 600], [600, 900], [900, 1000]])
    expect(r.shortestStepMs).toBe(300)
    expect(r.resolvesAllSteps).toBe(true)
    const t = toTimeline(10, r.frames, (i) => `frames/${i}.png`)
    expect(frameAt(t, 650)?.file).toBe('frames/2.png')
    expect(frameAt(t, 1000)).toBeUndefined()
  })
  it('flags grabs too slow for the animation', () => {
    const b = new FrameTimelineBuilder(10)
    for (const v of [1, 2, 3, 4]) b.push(Buffer.from([v]))
    expect(b.finish().resolvesAllSteps).toBe(false)
  })
})
