// Opening game files named on the command line (contracts/inspect-cli.md "File arguments").

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { parseH3mFile } from '../../src/core/formats/h3m/h3m.ts'
import type { H3mMap } from '../../src/core/formats/h3m/types.ts'
import { NodeFileSource } from '../shared/node-source.ts'
import { resolveGameFile, splitEntryArg } from '../shared/game-files.ts'
import { usage } from '../shared/errors.ts'

const archives = new Map<string, Promise<LodArchive>>()

export function openArchive(arg: string): Promise<LodArchive> {
  const path = resolveGameFile(arg)
  let p = archives.get(path)
  if (p === undefined) {
    p = NodeFileSource.open(path).then((s) => LodArchive.open(s))
    archives.set(path, p)
  }
  return p
}

/** Bytes named by `archive.lod:ENTRY` or by a plain file path. */
export async function readEntryArg(arg: string): Promise<{ name: string; bytes: Uint8Array }> {
  const { file, entry } = splitEntryArg(arg)
  if (entry === undefined) {
    if (file.toLowerCase().endsWith('.lod')) throw usage(`expected ${file}:ENTRY`)
    const path = resolveGameFile(file)
    return { name: basename(path), bytes: new Uint8Array(await readFile(path)) }
  }
  const lod = await openArchive(file)
  const e = lod.get(entry)
  return { name: e.name, bytes: await lod.read(e) }
}

export async function openMap(arg: string): Promise<{ path: string; map: H3mMap; sha256: string }> {
  const path = resolveGameFile(arg)
  const bytes = new Uint8Array(await readFile(path))
  const map = await parseH3mFile(bytes, basename(path))
  return { path, map, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
