// Map catalogue (spec 007 data-model "CatalogueEntry", research R1–R3): the candidate maps of a folder,
// each read on demand. Every host turns its folder value into the same list — a file:// directory
// listing (Wallpaper Engine, KDE), a .zip (every host; the way on Lively) or files the browser was
// given — so everything after this module is host-neutral. DOM-free apart from Blob.

import { ZipArchive } from '../core/formats/zip/zip.ts'
import { log } from '../core/util/log.ts'
import { BlobSource } from './file-source.ts'

export interface CatalogueEntry {
  /** Index in the catalogue, stable for the session. */
  readonly id: number
  /** Path inside the folder or archive, `/`-separated. */
  readonly path: string
  readonly read: () => Promise<Blob>
}

/** Bounds of a listing walk (research R2): deep enough for sorted collections, safe for huge folders. */
export const CATALOGUE_LIMITS = { maxEntries: 5000, maxDepth: 4 } as const

/** A single-scenario map: `.h3m` in any case; hidden names (a segment starting with a dot) are skipped. */
export function isMapPath(path: string): boolean {
  const segments = path.split('/').filter((s) => s !== '')
  return segments.length > 0 && segments.every((s) => !s.startsWith('.')) && /\.h3m$/i.test(segments[segments.length - 1] as string)
}

export interface ListingRow {
  name: string
  /** URL-encoded name relative to the listed folder. */
  url: string
  isDir: boolean
  size: number
}

/**
 * Parses Chromium's directory listing of a file:// folder (research R2, measured 2026-09-25): one
 * `addRow(name, url, isDir, size, sizeText, mtime, mtimeText)` call per entry, arguments written with
 * JSON escaping. Anything else in the page is ignored; a page without rows is an empty folder.
 */
export function parseDirectoryListing(html: string): ListingRow[] {
  const rows: ListingRow[] = []
  const re = /addRow\((.*?)\);<\/script>/g
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    let args: unknown
    try {
      args = JSON.parse(`[${m[1] ?? ''}]`)
    } catch {
      continue
    }
    if (!Array.isArray(args) || typeof args[0] !== 'string' || typeof args[1] !== 'string') continue
    const [name, url, isDir, size] = args as [string, string, unknown, unknown]
    if (name === '.' || name === '..') continue
    rows.push({ name, url, isDir: isDir === 1 || isDir === true, size: typeof size === 'number' ? size : 0 })
  }
  return rows
}

export interface ListingDeps {
  /** Reads a file:// URL (the page's usual reader). */
  readFile: (url: string) => Promise<Blob>
}

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

function numbered(items: { path: string; read: () => Promise<Blob> }[]): CatalogueEntry[] {
  // Sorted, so ids — and with them a seeded rotation — do not depend on the host's listing order.
  const sorted = items.filter((i) => isMapPath(i.path)).sort(byPath)
  if (sorted.length > CATALOGUE_LIMITS.maxEntries) log.warn(`map catalogue capped at ${CATALOGUE_LIMITS.maxEntries} of ${sorted.length} maps`)
  return sorted.slice(0, CATALOGUE_LIMITS.maxEntries).map((i, id) => ({ id, path: i.path, read: i.read }))
}

/** Walks a folder through the host's directory listing, depth-first to CATALOGUE_LIMITS.maxDepth. */
export async function listingCatalogue(rootUrl: string, deps: ListingDeps): Promise<CatalogueEntry[]> {
  const root = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`
  const found: { path: string; read: () => Promise<Blob> }[] = []
  let capped = false
  const walk = async (url: string, prefix: string, depth: number): Promise<void> => {
    const rows = parseDirectoryListing(await (await deps.readFile(url)).text())
    for (const row of rows) {
      if (row.name.startsWith('.')) continue
      if (found.length >= CATALOGUE_LIMITS.maxEntries) {
        capped = true
        return
      }
      const path = `${prefix}${row.name}`
      if (row.isDir) {
        if (depth < CATALOGUE_LIMITS.maxDepth) {
          // A sub-folder that cannot be listed is skipped; the rest of the folder still counts.
          await walk(`${url}${row.url.replace(/\/?$/, '/')}`, `${path}/`, depth + 1).catch((err: unknown) => log.warn(`cannot list ${path}`, String(err)))
        }
        continue
      }
      if (!isMapPath(path)) continue
      const fileUrl = `${url}${row.url}`
      found.push({ path, read: () => deps.readFile(fileUrl) })
    }
  }
  await walk(root, '', 1)
  if (capped) log.warn(`map folder listing stopped at ${CATALOGUE_LIMITS.maxEntries} maps`)
  return numbered(found)
}

/** The maps of a .zip; members are read (and inflated) only when picked. */
export async function zipCatalogue(blob: Blob, name: string): Promise<CatalogueEntry[]> {
  const zip = await ZipArchive.open(new BlobSource(blob, name), name)
  return numbered(
    zip
      .entries()
      .filter((e) => !e.isDirectory)
      .map((e) => ({ path: e.path, read: async () => new Blob([(await zip.read(e)) as Uint8Array<ArrayBuffer>]) })),
  )
}

/** Files the browser was given (a picked or dropped folder, or the remembered folder). */
export function filesCatalogue(files: readonly { path: string; file: Blob }[]): CatalogueEntry[] {
  return numbered(files.map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\/+/, ''), read: () => Promise.resolve(f.file) })))
}

export const isZipValue = (value: string): boolean => /\.zip$/i.test(value.trim())

/**
 * A host folder value → catalogue: a `.zip` is read and opened, anything else is listed as a folder.
 * `url` is the value already turned into a URL by the host's file-url function.
 */
export async function openCatalogueAt(url: string, name: string, deps: ListingDeps): Promise<CatalogueEntry[]> {
  if (isZipValue(url) || isZipValue(name)) return zipCatalogue(await deps.readFile(url), name)
  return listingCatalogue(url, deps)
}
