// A consistent synthetic file set for host simulations (spec 004): sprite archive, data archive,
// a two-level map and a one-level map, plus bad inputs, written to a temp folder.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { badFiles } from './bad-files.ts'
import { writeSyntheticFiles } from './terrain-archive.ts'

export interface WallpaperSet {
  dir: string
  spriteArchive: string
  dataArchive: string
  map: string
  mapOneLevel: string
  bad: Record<'hotaMap' | 'wogMap' | 'truncatedMap' | 'plainArchive' | 'randomBytes' | 'empty', string>
}

export function writeWallpaperSet(): WallpaperSet {
  const files = writeSyntheticFiles([
    { name: 'synthetic-48.h3m', size: 48, underground: true },
    { name: 'synthetic-36-surface.h3m', size: 36, underground: false },
  ])
  const bad = badFiles()
  const names = { hotaMap: 'hota.h3m', wogMap: 'wog.h3m', truncatedMap: 'truncated.h3m', plainArchive: 'plain.lod', randomBytes: 'random.bin', empty: 'empty.h3m' } as const
  const out = {} as WallpaperSet['bad']
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const p = join(files.dir, names[key])
    writeFileSync(p, bad[key])
    out[key] = p
  }
  return {
    dir: files.dir,
    spriteArchive: files.archive,
    dataArchive: files.dataArchive,
    map: files.maps['synthetic-48.h3m'] as string,
    mapOneLevel: files.maps['synthetic-36-surface.h3m'] as string,
    bad: out,
  }
}
