import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { opt, positional, required } from '../shared/cli-runner.ts'
import { splitEntryArg } from '../shared/game-files.ts'
import { hotaNames } from '../shared/hota-names.ts'
import { usage } from '../shared/errors.ts'
import { openArchive, sha256 } from './files.ts'

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

export async function lodList(args: ParsedArgs): Promise<CommandResult> {
  const file = positional(args, 0, 'FILE')
  const lod = await openArchive(file)
  const filter = opt(args, 'filter')
  const re = filter === undefined ? undefined : globToRegExp(filter)
  // An obfuscated index stores hashes, so listing resolves names through the local dictionary and
  // leaves the stable #<hex> form where a name is unknown (FR-003).
  const names = lod.kind === 'obfuscated' ? hotaNames() : undefined
  let resolved = 0
  const all = lod.entries.map((e) => {
    const name = names?.nameOf(e.nameHash)
    if (name !== undefined) resolved++
    return name === undefined ? e : { ...e, name }
  })
  const entries = all.filter((e) => re === undefined || re.test(e.name))
  return {
    ok: true,
    file: lod.source.name,
    version: lod.version,
    kind: lod.kind,
    count: entries.length,
    total: lod.entries.length,
    ...(lod.kind === 'obfuscated' ? { namesResolved: resolved, namesUnresolved: lod.entries.length - resolved } : {}),
    warnings: lod.warnings,
    entries,
  }
}

export async function lodExtract(args: ParsedArgs): Promise<CommandResult> {
  const arg = positional(args, 0, 'FILE:ENTRY')
  const { file, entry } = splitEntryArg(arg)
  if (entry === undefined) throw usage('expected FILE:ENTRY')
  const out = resolve(required(args, 'out'))
  const lod = await openArchive(file)
  const e = lod.get(entry)
  const bytes = await lod.read(e)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, bytes)
  return { ok: true, entry: e.name, bytes: bytes.length, sha256: sha256(bytes), out }
}
