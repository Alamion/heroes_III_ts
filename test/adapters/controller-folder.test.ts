// Wallpaper controller with the folder source (spec 007 US1–US4): real synthetic maps for the summaries,
// the fake engine for prepare/show, fake timers for the map interval.
import { describe, expect, it } from 'vitest'
import { filesCatalogue, ListingUnsupportedError } from '../../src/runtime/catalogue.ts'
import type { CatalogueEntry } from '../../src/runtime/catalogue.ts'
import type { FolderMapSpec } from '../fixtures/synthetic/map-folder.ts'
import { BROKEN_ONLY_FOLDER, HALF_BROKEN_FOLDER, MIXED_FOLDER, mapFolderEntries } from '../fixtures/synthetic/map-folder.ts'
import type { FakeTimers } from './controller-fixtures.ts'
import { setup } from './controller-fixtures.ts'

const blob = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>])
const catalogue = (specs: readonly FolderMapSpec[]): CatalogueEntry[] => filesCatalogue(mapFolderEntries(specs).map((e) => ({ path: e.path, file: blob(e.data) })))

const FOLDERS: Record<string, readonly FolderMapSpec[]> = {
  mixed: MIXED_FOLDER,
  half: HALF_BROKEN_FOLDER,
  broken: BROKEN_ONLY_FOLDER,
  empty: [{ path: 'readme.txt', raw: 'no maps here' }],
  hota: [{ path: 'hota-only.h3m', version: 'HotA', size: 36 }],
  hotafive: ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ path: `${n}.h3m`, version: 'HotA' as const, size: 36 + i })),
  five: ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ path: `${n}.h3m`, size: 36 + i })),
  sizes: [
    { path: 's1.h3m', size: 36 },
    { path: 's2.h3m', size: 36, underground: true },
    { path: 'm.h3m', size: 72 },
    { path: 'l.h3m', size: 108, underground: true },
    { path: 'xl.h3m', size: 144 },
  ],
}

function folderSetup(opts: { seed?: number; missing?: Set<string> } = {}) {
  const t = setup({
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    openCatalogue: async (url) => {
      const key = url.replace('file:///', '')
      if (key === 'unreadable') throw new Error('cannot list the folder')
      if (key === 'unlistable') throw new ListingUnsupportedError(key)
      const entries = catalogue(FOLDERS[key] ?? [])
      if (opts.missing === undefined) return entries
      const missing = opts.missing
      return entries.map((e) => ({ ...e, read: () => (missing.has(e.path) ? Promise.reject(new Error('the file is missing')) : e.read()) }))
    },
  })
  return t
}

const ARCHIVES = { spritearchive: 'H3sprite.lod', dataarchive: 'H3bitmap.lod' }
const shownPath = (c: ReturnType<typeof setup>['c']) => c.state().folder?.shown?.path
const codes = (c: ReturnType<typeof setup>['c']) => c.state().messages.map((m) => m.code)

/** Runs the timer that is due after `ms` (the one with that delay). */
function fireAfter(timers: FakeTimers, ms: number): boolean {
  for (const [h, delay] of timers.delays) {
    if (delay !== ms) continue
    const cb = timers.pending.get(h) as () => void
    timers.clear(h)
    cb()
    return true
  }
  return false
}

describe('folder source: start (spec 007 US1)', () => {
  it('shows a random usable map of the folder; other files are ignored; the map slot is untouched', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'mixed' })
    await c.idle()
    const s = c.state()
    expect(s.phase).toBe('showing')
    expect(s.source).toBe('folder')
    expect(s.folder).toMatchObject({ name: 'mixed', entries: 5, failed: 0, switching: false })
    expect(['small.h3m', 'medium two.h3m', 'Карты/Большая.h3m', 'nested/deeper/xl.H3M', 'nested/odd.h3m']).toContain(shownPath(c))
    expect(s.slots.map.status).toBe('missing')
    expect(engine.calls.some((x) => x.startsWith('map:'))).toBe(false)
    expect(engine.calls.filter((x) => x.startsWith('show:'))).toHaveLength(1)
    expect(s.messages).toEqual([])
  })

  it('the same seed picks the same first map', async () => {
    const first = async (seed: number) => {
      const { c } = folderSetup({ seed })
      await c.start()
      c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'five' })
      await c.idle()
      return shownPath(c)
    }
    expect(await first(11)).toBe(await first(11))
    const picks = new Set(await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(first)))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('skips broken maps without a message; all broken → FOLDER_UNREADABLE; none → FOLDER_EMPTY', async () => {
    const half = folderSetup()
    await half.c.start()
    half.c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'half' })
    await half.c.idle()
    for (let i = 0; i < 8; i++) {
      half.c.nextMap()
      await half.c.idle()
      expect(shownPath(half.c)).toMatch(/^good/)
    }
    expect(half.c.state().folder?.failed).toBe(3)
    expect(codes(half.c)).toEqual([])

    for (const [folder, code] of [['broken', 'FOLDER_UNREADABLE'], ['empty', 'FOLDER_EMPTY'], ['unreadable', 'FOLDER_EMPTY'], ['unlistable', 'FOLDER_NEEDS_ZIP']] as const) {
      const t = folderSetup()
      await t.c.start()
      t.c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: folder })
      await t.c.idle()
      expect(t.c.state().phase, folder).toBe('problem')
      expect(codes(t.c), folder).toEqual([code])
      expect(t.c.state().messages[0]?.file).toBe(folder)
    }
  })

  it('a HotA map waits for the HotA archive', async () => {
    const { c } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'hota' })
    await c.idle()
    expect(codes(c)).toEqual(['FOLDER_FILTERED'])
    c.applySettings({ hotaarchive: 'HotA.lod' })
    await c.idle()
    expect(shownPath(c)).toBe('hota-only.h3m')
    expect(codes(c)).toEqual([])
  })

  it('HotA arriving with the other archives does not pick before they are loaded', async () => {
    // The sprite archive is the slow one, so HotA's load returns while it is still reading; a pick at
    // that moment would show the map without objects and the normal pick would replace it (WE 2026-09-25).
    const { c, engine } = folderSetup()
    engine.slotDelays = { archive: 40, data: 5, hota: 0 }
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'hotafive', hotaarchive: 'HotA.lod' })
    await c.idle()
    expect(['a.h3m', 'b.h3m', 'c.h3m', 'd.h3m', 'e.h3m']).toContain(shownPath(c))
    expect(engine.calls.filter((x) => x.startsWith('prepare:'))).toHaveLength(1)
    expect(engine.calls.filter((x) => x.startsWith('show:'))).toHaveLength(1)
  })

  it('switching back to "single" loads the single map again', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapfile: 'a.h3m', mapsource: 'folder', mapfolder: 'five' })
    await c.idle()
    expect(engine.calls.some((x) => x === 'map:a.h3m')).toBe(false)
    c.applySettings({ mapsource: 'single' })
    await c.idle()
    expect(engine.calls.filter((x) => x === 'map:a.h3m')).toHaveLength(1)
    expect(c.state()).toMatchObject({ source: 'single', folder: null, phase: 'showing' })
  })

  it('a map that disappeared is skipped silently', async () => {
    const all = ['a.h3m', 'b.h3m', 'c.h3m', 'd.h3m']
    const { c } = folderSetup({ missing: new Set(all) })
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'five' })
    await c.idle()
    expect(shownPath(c)).toBe('e.h3m')
    expect(c.state().folder?.failed).toBe(4)
    expect(codes(c)).toEqual([])
  })
})

describe('folder source: rotation (spec 007 US2)', () => {
  it('"next map" shows every map once per cycle and never the same twice in a row', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'five' })
    await c.idle()
    const seq = [shownPath(c)]
    for (let i = 0; i < 14; i++) {
      c.nextMap()
      await c.idle()
      seq.push(shownPath(c))
    }
    for (let k = 0; k < 3; k++) expect(new Set(seq.slice(k * 5, k * 5 + 5)).size).toBe(5)
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1])
    expect(engine.prepared.size).toBe(0)
  })

  it('a new map gets a newly drawn place and level, like a start', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'five' })
    await c.idle()
    const before = engine.placements.length
    c.nextMap()
    await c.idle()
    const last = engine.placements.at(-1)
    expect(engine.placements.length).toBe(before + 1)
    expect(last?.placement).toMatchObject({ mode: 'random' })
    expect(typeof last?.level).toBe('object')
  })

  it('the interval counts visible time only and nothing is prepared while hidden', async () => {
    const { c, engine, timers, setNow } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'five', maprotation: 2 })
    await c.idle()
    expect([...timers.delays.values()]).toContain(120_000)
    setNow(50_000)
    c.setHidden(true)
    expect([...timers.delays.values()]).not.toContain(120_000)
    const prepares = engine.calls.filter((x) => x.startsWith('prepare:')).length
    setNow(600_000)
    c.setHidden(false)
    // 50 s of the 120 s were used before hiding; the 550 s hidden do not count.
    expect([...timers.delays.values()]).toContain(70_000)
    expect(engine.calls.filter((x) => x.startsWith('prepare:')).length).toBe(prepares)
    const first = shownPath(c)
    expect(fireAfter(timers, 70_000)).toBe(true)
    await c.idle()
    expect(shownPath(c)).not.toBe(first)
    // A fresh interval after the switch.
    expect([...timers.delays.values()]).toContain(120_000)
  })

  it('interval 0 changes maps only at start and on request; "next map" is ignored with a single map source', async () => {
    const { c, engine, timers } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'five', maprotation: 0 })
    await c.idle()
    expect([...timers.delays.values()].some((d) => d >= 60_000)).toBe(false)
    const single = folderSetup()
    await single.c.start()
    single.c.applySettings({ ...ARCHIVES, mapfile: 'a.h3m' })
    await single.c.idle()
    single.c.nextMap()
    await single.c.idle()
    expect(single.engine.calls.some((x) => x.startsWith('prepare:'))).toBe(false)
    expect(engine.calls.filter((x) => x.startsWith('show:'))).toHaveLength(1)
  })

  it('a folder with one usable map only draws a new place on "next map"', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'hota', hotaarchive: 'HotA.lod' })
    await c.idle()
    const shows = engine.calls.filter((x) => x.startsWith('show:')).length
    const places = engine.placements.length
    c.nextMap()
    await c.idle()
    expect(engine.calls.filter((x) => x.startsWith('show:')).length).toBe(shows)
    expect(engine.placements.length).toBe(places + 1)
  })
})

describe('folder source: filters (spec 007 US3)', () => {
  it('only maps inside the size range and the underground rule are shown', async () => {
    const { c } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'sizes', mapsizemax: 's' })
    await c.idle()
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      seen.add(shownPath(c) as string)
      c.nextMap()
      await c.idle()
    }
    expect([...seen].sort()).toEqual(['s1.h3m', 's2.h3m'])
    c.applySettings({ mapsizemax: 'g', mapunderground: 'two' })
    await c.idle()
    for (let i = 0; i < 6; i++) {
      expect(['s2.h3m', 'l.h3m']).toContain(shownPath(c))
      c.nextMap()
      await c.idle()
    }
  })

  it('a filter change keeps a matching map and replaces one that no longer matches', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'sizes', mapsizemin: 'xl' })
    await c.idle()
    expect(shownPath(c)).toBe('xl.h3m')
    const shows = engine.calls.filter((x) => x.startsWith('show:')).length
    c.applySettings({ mapsizemin: 'l' })
    await c.idle()
    expect(engine.calls.filter((x) => x.startsWith('show:')).length).toBe(shows)
    c.applySettings({ mapsizemin: 's', mapsizemax: 'm' })
    await c.idle()
    expect(['s1.h3m', 's2.h3m', 'm.h3m']).toContain(shownPath(c))
  })

  it('an unsatisfiable filter says so only while nothing is shown; relaxing it shows a map', async () => {
    const t = folderSetup()
    await t.c.start()
    t.c.applySettings({ ...ARCHIVES, mapsource: 'folder', mapfolder: 'sizes', mapsizemin: 'h' })
    await t.c.idle()
    expect(codes(t.c)).toEqual(['FOLDER_FILTERED'])
    expect(t.c.state().messages[0]?.detail).toContain('H (180×180)')
    t.c.applySettings({ mapsizemin: 's' })
    await t.c.idle()
    expect(t.c.state().phase).toBe('showing')
    expect(codes(t.c)).toEqual([])
    // With a map on screen an impossible filter keeps it and only logs.
    t.c.applySettings({ mapsizemin: 'g' })
    await t.c.idle()
    expect(t.c.state().phase).toBe('showing')
    expect(codes(t.c)).toEqual([])
  })
})

describe('folder source: the browser (spec 007 US4)', () => {
  it('a supplied folder switches the source; a dropped single map switches it back', async () => {
    const { c, engine } = folderSetup()
    await c.start()
    c.applySettings(ARCHIVES)
    await c.idle()
    await c.supplyFolder('five', async () => catalogue(FOLDERS.five as FolderMapSpec[]))
    await c.idle()
    expect(c.state()).toMatchObject({ source: 'folder', phase: 'showing', folder: { name: 'five', entries: 5 } })
    // Settings flushed later without a folder value keep the supplied folder.
    c.applySettings({ mapsource: 'folder', scale: 2 })
    await c.idle()
    expect(c.state().folder?.name).toBe('five')
    await c.supplyFiles([Object.assign(new Blob(['a.h3m']), { name: 'a.h3m' })])
    await c.idle()
    expect(c.state()).toMatchObject({ source: 'single', folder: null })
    expect(engine.calls.at(-1)).toBe('map:a.h3m')
  })

  it('a newer folder replaces an older one that is still being listed', async () => {
    const { c } = folderSetup()
    await c.start()
    c.applySettings(ARCHIVES)
    await c.idle()
    let release: (e: CatalogueEntry[]) => void = () => {}
    const slow = new Promise<CatalogueEntry[]>((r) => (release = r))
    const first = c.supplyFolder('slow', () => slow)
    await c.supplyFolder('five', async () => catalogue(FOLDERS.five as FolderMapSpec[]))
    release(catalogue(FOLDERS.sizes as FolderMapSpec[]))
    await first
    await c.idle()
    expect(c.state().folder?.name).toBe('five')
    expect(shownPath(c)).toMatch(/^[a-e]\.h3m$/)
  })
})
