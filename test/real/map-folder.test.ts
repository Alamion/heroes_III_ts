// Spec 007 SC-004, SC-005: full rotation cycles over the install's map folders with every filter
// combination show only matching maps, and broken files among them change nothing. Skips without an
// install (bundleDir / hotaBundleDir).
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filesCatalogue } from '../../src/runtime/catalogue.ts'
import type { CatalogueEntry } from '../../src/runtime/catalogue.ts'
import { mapFilter, passesFilter, Rotation } from '../../src/runtime/rotation.ts'
import type { MapSummary } from '../../src/core/formats/h3m/summary.ts'
import { summarizeMapFile } from '../../src/runtime/file-kind.ts'
import { gameDirs, hotaInstallMaps, installMaps } from '../../tools/shared/game-files.ts'
import { mapBytes } from '../fixtures/synthetic/map-folder.ts'

const base = installMaps()
const hota = hotaInstallMaps()
const all = [...base, ...hota]
if (all.length === 0) process.stderr.write('[real-file test skipped] map-folder: no game install configured (bundleDir)\n')

async function catalogueOf(paths: string[], extra: { path: string; data: Uint8Array }[] = []): Promise<CatalogueEntry[]> {
  const dirs = gameDirs()
  const root = dirs.bundleDir ?? '/'
  const files = await Promise.all(paths.map(async (p) => ({ path: relative(root, p), file: new Blob([new Uint8Array(await readFile(p))]) })))
  return filesCatalogue([...files, ...extra.map((e) => ({ path: e.path, file: new Blob([e.data as Uint8Array<ArrayBuffer>]) }))])
}

/** One full cycle as the controller walks it: summaries decide eligibility, failures are dropped. */
async function cycle(entries: CatalogueEntry[], filter: ReturnType<typeof mapFilter>, hotaLoaded: boolean) {
  const summaries = new Map<number, MapSummary>()
  const failed = new Set<number>()
  const eligible = (id: number) => !failed.has(id) && (summaries.get(id) === undefined || (passesFilter(summaries.get(id) as MapSummary, filter) && (hotaLoaded || !(summaries.get(id) as MapSummary).needsHota)))
  const rotation = new Rotation(entries.length, 20260925)
  const shown: MapSummary[] = []
  for (let i = 0; i < entries.length * 2; i++) {
    const id = rotation.next(eligible)
    if (id === undefined) break
    const entry = entries[id] as CatalogueEntry
    if (!summaries.has(id)) {
      try {
        summaries.set(id, await summarizeMapFile(await entry.read(), entry.path))
      } catch {
        failed.add(id)
        continue
      }
    }
    if (!eligible(id)) continue
    shown.push(summaries.get(id) as MapSummary)
    rotation.markShown(id)
    if (shown.length >= 60) break
  }
  return { shown, failed: failed.size }
}

describe.skipIf(all.length === 0)('map folders of the install (spec 007 SC-004, SC-005)', () => {
  it('every filter combination shows only matching maps', async () => {
    const entries = await catalogueOf(all)
    expect(entries.length).toBeGreaterThan(0)
    const combos = [
      { mapsizemin: 's', mapsizemax: 'g', mapunderground: 'any' },
      { mapsizemin: 's', mapsizemax: 's', mapunderground: 'any' },
      { mapsizemin: 'l', mapsizemax: 'xl', mapunderground: 'two' },
      { mapsizemin: 'm', mapsizemax: 'l', mapunderground: 'one' },
      { mapsizemin: 'h', mapsizemax: 'g', mapunderground: 'any' },
    ] as const
    for (const c of combos) {
      const f = mapFilter(c)
      const { shown } = await cycle(entries, f, hota.length > 0)
      for (const s of shown) expect(passesFilter(s, f), `${JSON.stringify(c)} showed ${s.title} ${s.size} ${s.levels}`).toBe(true)
      if (c.mapsizemax === 'g' && c.mapsizemin === 's') expect(shown.length).toBeGreaterThan(0)
    }
  }, 600_000)

  it('broken files among the maps are skipped and the good ones still rotate', async () => {
    const good = base.slice(0, 20)
    const broken = [
      { path: 'broken/truncated.h3m', data: mapBytes({ path: 'x.h3m', broken: 'truncated' }) },
      { path: 'broken/wog.h3m', data: mapBytes({ path: 'x.h3m', broken: 'wog' }) },
      { path: 'broken/text.h3m', data: mapBytes({ path: 'x.h3m', broken: 'text' }) },
    ]
    const entries = await catalogueOf(good, broken)
    const { shown, failed } = await cycle(entries, mapFilter({ mapsizemin: 's', mapsizemax: 'g', mapunderground: 'any' }), false)
    expect(failed).toBeGreaterThanOrEqual(3)
    expect(new Set(shown.map((s) => s.title + s.size)).size).toBeGreaterThan(0)
    expect(shown.length).toBeGreaterThanOrEqual(Math.min(20, good.length) - 1)
  }, 300_000)
})
