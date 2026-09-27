// Every entry of every HotA archive at hand reads to its declared size (spec 008 FR-009, FR-010):
// the configured HotA install (1.8.1: raw and zlib only) and any `HotA*.lod` in public/dev-assets/
// (the owner keeps HotA-1.8.0.lod there: 2970 of its 5169 entries are LZMA). A byte-level check against
// liblzma is in spec 008 research R1; this keeps the whole archive readable from now on.
// Skips with a message when no archive is present.

import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { hotaArchivePath } from '../../tools/shared/game-files.ts'
import { NodeFileSource } from '../../tools/shared/node-source.ts'

const devAssets = join(process.cwd(), 'public', 'dev-assets')
const archives = [
  ...(existsSync(devAssets) ? readdirSync(devAssets).filter((f) => /^hota.*\.lod$/i.test(f)).map((f) => join(devAssets, f)) : []),
  ...[hotaArchivePath()].filter((p): p is string => p !== undefined && existsSync(p)),
]
if (archives.length === 0) process.stderr.write('[real-file test skipped] HotA archives: no HotA*.lod in public/dev-assets and no HotA install configured\n')

describe.skipIf(archives.length === 0)('HotA archives at hand', () => {
  it.each(archives)('reads every entry of %s', async (path) => {
    const lod = await LodArchive.open(await NodeFileSource.open(path))
    expect(lod.unreadable).toEqual([])
    const failures: string[] = []
    for (const e of lod.entries) {
      try {
        const bytes = await lod.read(e)
        if (bytes.length !== e.size) failures.push(`${e.name}: ${bytes.length} of ${e.size} bytes`)
      } catch (err) {
        failures.push(`${e.name} (type ${e.type}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    expect(failures).toEqual([])
  }, 180_000)
})
