import type { Command } from '../cli.ts'
import { listCaptures, mapHashChecker, scanRecords } from '../store/lookup.ts'
import { baselineOf, config, opt } from './common.ts'
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
    ...(args.flags.has('baseline') ? { baseline: baselineOf(args) } : {}),
  })
  const hashMatches = mapHashChecker(cfg.mapSearchDirs)
  const byId = new Map(scanRecords(cfg.capturesDir).map((c) => [c.record.id, c.record]))
  return { ok: true, captures: captures.map((c) => {
    const record = byId.get(c.id)
    return { ...c, mapSha256Matches: record === undefined ? null : hashMatches(record) }
  }) }
}
