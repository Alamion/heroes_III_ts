import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parsePcx, pcxToRgba } from '../../src/core/formats/pcx/pcx.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { positional, required } from '../shared/cli-runner.ts'
import { encodePng } from '../shared/png.ts'
import { readEntryArg } from './files.ts'

export async function pcxDump(args: ParsedArgs): Promise<CommandResult> {
  const { name, bytes } = await readEntryArg(positional(args, 0, 'FILE:ENTRY'))
  const img = parsePcx(bytes, name)
  return { ok: true, name, width: img.width, height: img.height, kind: img.kind }
}

export async function pcxPng(args: ParsedArgs): Promise<CommandResult> {
  const { name, bytes } = await readEntryArg(positional(args, 0, 'FILE:ENTRY'))
  const img = parsePcx(bytes, name)
  const out = resolve(required(args, 'out'))
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, encodePng({ width: img.width, height: img.height, channels: 4, data: pcxToRgba(img) }))
  return { ok: true, out, width: img.width, height: img.height }
}
