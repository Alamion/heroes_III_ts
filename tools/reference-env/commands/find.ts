import type { Command } from '../cli.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Kind, Level, Source } from '../model/types.ts'
import { findCaptures, mapHashChecker } from '../store/lookup.ts'
import { baselineOf, config, intOpt, opt, required } from './common.ts'

export function parseRegion(value: string): { x0: number; y0: number; x1: number; y1: number } {
  const parts = value.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new RefError(ERROR_CODES.USAGE, '--region must be x0,y0,x1,y1 (non-negative integers)')
  }
  const [x0, y0, x1, y1] = parts as [number, number, number, number]
  if (x1 < x0 || y1 < y0) throw new RefError(ERROR_CODES.USAGE, '--region must have x0<=x1 and y0<=y1')
  return { x0, y0, x1, y1 }
}

export function parseSource(v: string | undefined): Source | undefined {
  if (v === undefined || v === 'game' || v === 'editor') return v
  throw new RefError(ERROR_CODES.USAGE, '--source must be game or editor')
}

export function parseKind(v: string | undefined): Kind | undefined {
  if (v === undefined || v === 'still' || v === 'clip') return v
  throw new RefError(ERROR_CODES.USAGE, '--kind must be still or clip')
}

export const findCommand: Command = async (args) => {
  const cfg = config()
  const level = intOpt(args, 'level', 0)
  if (level !== 0 && level !== 1) throw new RefError(ERROR_CODES.USAGE, '--level must be 0 or 1')
  const limit = opt(args, 'limit')
  const source = parseSource(opt(args, 'source'))
  const kind = parseKind(opt(args, 'kind'))
  const matches = findCaptures(cfg.capturesDir, {
    map: required(args, 'map'),
    level: level as Level,
    region: parseRegion(required(args, 'region')),
    ...(args.flags.has('baseline') ? { baseline: baselineOf(args) } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(limit !== undefined ? { limit: intOpt(args, 'limit') } : {}),
  })
  const hashMatches = mapHashChecker(cfg.mapSearchDirs)
  return { ok: true, matches: matches.map((m) => ({ ...m, mapSha256Matches: hashMatches(m.record) })) }
}
