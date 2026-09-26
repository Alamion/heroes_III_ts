// Synthetic map folders (spec 007): maps of chosen sizes, level counts and versions, nested
// sub-folders, non-map files and broken maps — as a list of entries, a folder on disk or a .zip.
// No game content: every map is built by the committed H3M writer.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeZip } from '../../../tools/shared/archive.ts'
import type { ArchiveEntry } from '../../../tools/shared/archive.ts'
import type { H3mVersion } from '../../../src/core/formats/h3m/types.ts'
import { mapWithVersion } from './bad-files.ts'
import { buildMap, h3s, writeH3mGz } from './h3m.ts'
import { writeHotaMapGz } from './hota-map.ts'

export interface FolderMapSpec {
  /** Relative path inside the folder, `/`-separated. */
  path: string
  size?: number
  underground?: boolean
  version?: H3mVersion | 'HotA'
  /** Map title stored in the header (base-game versions only). */
  title?: string
  /** A file that is not a usable map. */
  broken?: 'truncated' | 'wog' | 'text'
  /** Raw content (non-map files); overrides everything else. */
  raw?: string
}

export function mapBytes(spec: FolderMapSpec): Uint8Array {
  if (spec.raw !== undefined) return new TextEncoder().encode(spec.raw)
  if (spec.broken === 'text') return new TextEncoder().encode('this is not a map')
  if (spec.broken === 'wog') return mapWithVersion(0x33)
  const size = spec.size ?? 36
  const underground = spec.underground ?? false
  let bytes: Uint8Array
  if (spec.version === 'HotA') {
    bytes = writeHotaMapGz({ size, underground })
  } else {
    const map = buildMap({ version: spec.version ?? 'SoD', size, underground })
    map.info = { ...map.info, name: h3s(spec.title ?? spec.path.split('/').pop()?.replace(/\.h3m$/i, '') ?? 'map') }
    bytes = writeH3mGz(map)
  }
  return spec.broken === 'truncated' ? bytes.slice(0, Math.max(20, Math.floor(bytes.length / 3))) : bytes
}

export function mapFolderEntries(specs: readonly FolderMapSpec[]): ArchiveEntry[] {
  return specs.map((s) => ({ path: s.path, data: mapBytes(s) }))
}

/** Writes the folder under `dir` (created as needed). */
export function writeMapFolder(dir: string, specs: readonly FolderMapSpec[]): void {
  for (const e of mapFolderEntries(specs)) {
    const target = join(dir, ...e.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, e.data)
  }
}

/** The folder as a .zip; incompressible gzip maps are stored, text files deflated. */
export function mapFolderZip(specs: readonly FolderMapSpec[]): Uint8Array {
  return writeZip(mapFolderEntries(specs))
}

/** Five usable maps of different sizes/levels, a sub-folder, a Cyrillic name and non-map files. */
export const MIXED_FOLDER: readonly FolderMapSpec[] = [
  { path: 'small.h3m', size: 36, title: 'Small one' },
  { path: 'medium two.h3m', size: 72, underground: true, title: 'Medium two levels' },
  { path: 'Карты/Большая.h3m', size: 108, title: 'Большая карта' },
  { path: 'nested/deeper/xl.H3M', size: 144, underground: true, title: 'Extra large' },
  { path: 'nested/odd.h3m', size: 50, title: 'Odd size' },
  { path: 'readme.txt', raw: 'notes' },
  { path: 'save.GM1', raw: 'not a save either' },
  { path: 'campaign.h3c', raw: 'campaign' },
  { path: '.hidden.h3m', size: 36, title: 'hidden' },
]

/** Half usable, half broken. */
export const HALF_BROKEN_FOLDER: readonly FolderMapSpec[] = [
  { path: 'good1.h3m', size: 36 },
  { path: 'good2.h3m', size: 72 },
  { path: 'good3.h3m', size: 36, underground: true },
  { path: 'bad-truncated.h3m', broken: 'truncated' },
  { path: 'bad-wog.h3m', broken: 'wog' },
  { path: 'bad-text.h3m', broken: 'text' },
]

export const BROKEN_ONLY_FOLDER: readonly FolderMapSpec[] = [
  { path: 'a.h3m', broken: 'truncated' },
  { path: 'b.h3m', broken: 'wog' },
  { path: 'c.h3m', broken: 'text' },
]

/** Folders the host simulations use (spec 007 invariants 14–20), each also as a .zip next to it. */
export const HOST_FOLDERS = {
  mixed: MIXED_FOLDER,
  five: ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ path: `${n}.h3m`, size: 36 + i * 2, title: `Map ${n}` })),
  sizes: [
    { path: 's1.h3m', size: 36 },
    { path: 's2.h3m', size: 36, underground: true },
    { path: 'm.h3m', size: 72 },
    { path: 'l.h3m', size: 108, underground: true },
  ],
  half: HALF_BROKEN_FOLDER,
  broken: BROKEN_ONLY_FOLDER,
  empty: [{ path: 'readme.txt', raw: 'no maps here' }],
} as const satisfies Record<string, readonly FolderMapSpec[]>

export type HostFolderName = keyof typeof HOST_FOLDERS

/** Writes every host folder under `root` (the mixed one under a Cyrillic name) plus a .zip of each. */
export function writeHostFolders(root: string): Record<HostFolderName, { dir: string; zip: string }> {
  const out = {} as Record<HostFolderName, { dir: string; zip: string }>
  for (const [name, specs] of Object.entries(HOST_FOLDERS) as [HostFolderName, readonly FolderMapSpec[]][]) {
    const dirName = name === 'mixed' ? 'Карты mixed' : name
    const dir = join(root, dirName)
    writeMapFolder(dir, specs)
    mkdirSync(dir, { recursive: true })
    const zip = join(root, `${dirName}.zip`)
    writeFileSync(zip, mapFolderZip(specs))
    out[name] = { dir, zip }
  }
  return out
}
