import { describe, expect, it } from 'vitest'
import { CATALOGUE_LIMITS, filesCatalogue, isMapPath, listingCatalogue, openCatalogueAt, parseDirectoryListing, zipCatalogue } from '../../src/runtime/catalogue.ts'
import { MIXED_FOLDER, mapFolderEntries, mapFolderZip } from '../fixtures/synthetic/map-folder.ts'

const blob = (b: Uint8Array | string) => new Blob([typeof b === 'string' ? b : (b as Uint8Array<ArrayBuffer>)])

/** A listing page as Chromium writes it (research R2), with the lines that matter. */
function listingPage(rows: [string, string, 0 | 1, number][]): string {
  const head = '<!DOCTYPE html>\n<html dir="ltr" lang="ru">\n<script>function addRow(name, url, isdir,\n size, size_string, date_modified, date_modified_string) {}</script>\n<script>start("/x/");</script>\n'
  return head + rows.map(([n, u, d, s]) => `<script>addRow(${JSON.stringify(n)},${JSON.stringify(u)},${d},${s},"${s} B",1790293378,"25.09.2026, 02:42:58");</script>`).join('\n')
}

/** A fake file:// tree: folder URLs return listings, file URLs return their bytes. */
function fakeTree(files: Record<string, Uint8Array | string>, root = 'file:///maps/') {
  const reads: string[] = []
  const readFile = async (url: string): Promise<Blob> => {
    reads.push(url)
    if (!url.startsWith(root)) throw new Error(`outside ${url}`)
    const rel = decodeURIComponent(url.slice(root.length))
    if (rel === '' || rel.endsWith('/')) {
      const children = new Map<string, [string, string, 0 | 1, number]>()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(rel)) continue
        const rest = path.slice(rel.length)
        const [first, ...more] = rest.split('/')
        const name = first as string
        children.set(name, [name, encodeURIComponent(name), more.length > 0 ? 1 : 0, 10])
      }
      return blob(listingPage([['..', '..', 1, 0], ...children.values()]))
    }
    const content = files[rel]
    if (content === undefined) throw new Error(`missing ${rel}`)
    return blob(content)
  }
  return { readFile, reads }
}

describe('directory listing parser (spec 007 research R2)', () => {
  it('reads names, URLs and folder flags; skips parent links and JSON-escaped names survive', () => {
    const page = listingPage([
      ['..', '..', 1, 0],
      ['sub', 'sub', 1, 60],
      ['Карта.h3m', '%D0%9A%D0%B0%D1%80%D1%82%D0%B0.h3m', 0, 2],
      ['a map.h3m', 'a%20map.h3m', 0, 2],
      ['quote "x".h3m', 'quote%20%22x%22.h3m', 0, 5],
    ])
    expect(parseDirectoryListing(page)).toEqual([
      { name: 'sub', url: 'sub', isDir: true, size: 60 },
      { name: 'Карта.h3m', url: '%D0%9A%D0%B0%D1%80%D1%82%D0%B0.h3m', isDir: false, size: 2 },
      { name: 'a map.h3m', url: 'a%20map.h3m', isDir: false, size: 2 },
      { name: 'quote "x".h3m', url: 'quote%20%22x%22.h3m', isDir: false, size: 5 },
    ])
  })

  it('a page without rows is an empty folder', () => {
    expect(parseDirectoryListing('<html><body>nothing</body></html>')).toEqual([])
  })

  it('only .h3m files, any case, no hidden names', () => {
    expect(['a.h3m', 'A.H3M', 'x/y.h3m', 'b.h3c', 'c.GM1', 'readme.txt', '.hidden.h3m', '.dir/a.h3m', 'h3m'].map(isMapPath)).toEqual([true, true, true, false, false, false, false, false, false])
  })
})

describe('map catalogues (spec 007 data-model "CatalogueEntry")', () => {
  const expected = MIXED_FOLDER.filter((s) => isMapPath(s.path)).map((s) => s.path).sort()

  it('walks a listed folder with sub-folders and Cyrillic names; entries read their own file', async () => {
    const files = Object.fromEntries(mapFolderEntries(MIXED_FOLDER).map((e) => [e.path, e.data]))
    const tree = fakeTree(files)
    const cat = await listingCatalogue('file:///maps', tree)
    expect(cat.map((e) => e.path)).toEqual(expected)
    expect(cat.map((e) => e.id)).toEqual(cat.map((_, i) => i))
    const big = cat.find((e) => e.path === 'Карты/Большая.h3m')
    expect(new Uint8Array(await (await big!.read()).arrayBuffer())).toEqual(files['Карты/Большая.h3m'])
  })

  it('stops at the depth limit', async () => {
    const deep = `${Array.from({ length: CATALOGUE_LIMITS.maxDepth }, (_, i) => `d${i}`).join('/')}/too-deep.h3m`
    const tree = fakeTree({ 'top.h3m': 'x', [deep]: 'y', 'd0/d1/ok.h3m': 'z' })
    expect((await listingCatalogue('file:///maps/', tree)).map((e) => e.path)).toEqual(['d0/d1/ok.h3m', 'top.h3m'])
  })

  it('stops at the entry limit', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < CATALOGUE_LIMITS.maxEntries + 20; i++) files[`m${String(i).padStart(5, '0')}.h3m`] = 'x'
    expect(await listingCatalogue('file:///maps/', fakeTree(files))).toHaveLength(CATALOGUE_LIMITS.maxEntries)
  })

  it('a .zip gives the same entries; members are inflated on read', async () => {
    const zip = mapFolderZip(MIXED_FOLDER)
    const cat = await zipCatalogue(blob(zip), 'maps.zip')
    expect(cat.map((e) => e.path)).toEqual(expected)
    const tree = fakeTree({ 'maps.zip': zip }, 'file:///')
    const viaValue = await openCatalogueAt('file:///maps.zip', 'maps.zip', tree)
    expect(viaValue.map((e) => e.path)).toEqual(expected)
    const want = mapFolderEntries(MIXED_FOLDER).find((e) => e.path === 'small.h3m')!.data
    expect(new Uint8Array(await (await viaValue.find((e) => e.path === 'small.h3m')!.read()).arrayBuffer())).toEqual(want)
  })

  it('files handed over by the browser, with Windows separators', () => {
    const cat = filesCatalogue([
      { path: 'maps\\b.h3m', file: blob('b') },
      { path: '/maps/a.h3m', file: blob('a') },
      { path: 'maps/notes.txt', file: blob('n') },
    ])
    expect(cat.map((e) => e.path)).toEqual(['maps/a.h3m', 'maps/b.h3m'])
  })
})
