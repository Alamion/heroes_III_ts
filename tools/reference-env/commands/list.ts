import type { Command } from '../cli.ts'
import { listCaptures } from '../store/lookup.ts'
import { config, opt } from './common.ts'
import { parseKind, parseSource } from './find.ts'

export const listCommand: Command = async (args) => {
  const cfg = config()
  const map = opt(args, 'map')
  const source = parseSource(opt(args, 'source'))
  const kind = parseKind(opt(args, 'kind'))
  const before = opt(args, 'before')
  const captures = listCaptures(cfg.capturesDir, {
    ...(map !== undefined ? { map } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(before !== undefined ? { before } : {}),
  })
  return { ok: true, captures }
}
