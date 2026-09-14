import type { Command } from '../cli.ts'
import { pruneCaptures } from '../store/lookup.ts'
import { config, flag, opt } from './common.ts'

export const pruneCommand: Command = async (args) => {
  const cfg = config()
  const before = opt(args, 'before')
  const removed = pruneCaptures(cfg.capturesDir, {
    ids: args.flags.get('id') ?? [],
    ...(before !== undefined ? { before } : {}),
    dryRun: flag(args, 'dry-run'),
  })
  return { ok: true, removed, dryRun: flag(args, 'dry-run') }
}
