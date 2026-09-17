// H3M map parser (RoE/AB/SoD). Layout ported from homm3-parser (MIT, see THIRD_PARTY_NOTICES.md)
// with corrections verified against the base-game map corpus (research.md §3).

import { ByteReader } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { inflate, isGzip } from '../../util/inflate.ts'
import { makeContext } from './context.ts'
import { readHeaderRest, readInfo, readLoss, readPlayers, readVictory } from './header.ts'
import { readObjects } from './objects/index.ts'
import { readTemplates } from './templates.ts'
import { readTiles } from './tiles.ts'
import { readTimedEvent } from './objects/town.ts'
import { H3M_VERSION_CODES } from './types.ts'
import type { H3mMap, H3mVersion, TimedEvent } from './types.ts'

export const KNOWN_OTHER_VERSIONS: Record<number, string> = {
  0x1d: 'Chronicles',
  0x20: 'HotA',
  0x33: 'WoG',
}

export function versionFromCode(code: number): H3mVersion | undefined {
  return (Object.keys(H3M_VERSION_CODES) as H3mVersion[]).find((v) => H3M_VERSION_CODES[v] === code)
}

/** Decompresses (if gzip) and parses a map file. */
export async function parseH3mFile(bytes: Uint8Array, fileName: string): Promise<H3mMap> {
  const data = isGzip(bytes) ? await inflate(bytes, 'gzip', { file: fileName, format: 'h3m', offset: 0, structure: 'gzip stream' }) : bytes
  return parseH3m(data, fileName)
}

/** Parses decompressed map data. */
export function parseH3m(data: Uint8Array, fileName: string): H3mMap {
  const r = new ByteReader(data, { file: fileName, format: 'h3m' })
  const versionCode = r.scope('version', () => r.u32())
  const version = versionFromCode(versionCode)
  if (version === undefined) {
    const known = KNOWN_OTHER_VERSIONS[versionCode]
    throw new FormatError({
      code: FORMAT_ERROR_CODES.UNSUPPORTED_VERSION,
      file: fileName,
      offset: 0,
      format: 'h3m',
      structure: 'version',
      version: `0x${versionCode.toString(16)}`,
      message: `map format 0x${versionCode.toString(16)}${known !== undefined ? ` (${known})` : ''} is not supported; only RoE (0x0e), AB (0x15) and SoD (0x1c) maps are`,
    })
  }
  r.setVersion(version)
  const c = makeContext(r, version)
  const info = readInfo(c)
  const players = readPlayers(c)
  const victory = readVictory(c)
  const loss = readLoss(c)
  const rest = readHeaderRest(c)
  const levels = info.hasUnderground ? 2 : 1
  const tiles = readTiles(c, info.size, levels)
  const templates = readTemplates(c)
  const objects = readObjects(c, templates, info.size, levels)
  const events: TimedEvent[] = r.scope('events', () => {
    const at = r.offset
    const count = r.u32()
    if (count > 10_000) r.invalid(`event count ${count} exceeds 10000`, at)
    return Array.from({ length: count }, (_, i) => r.scope(`[${i}]`, () => readTimedEvent(c)))
  })
  // The editor pads the file with zero bytes after the global events.
  const trailerLength = r.remaining
  r.scope('trailer', () => {
    if (trailerLength > 0) r.zeros(trailerLength, 'map trailer')
  })
  return { fileName, version, versionCode, info, players, victory, loss, ...rest, tiles, templates, objects, events, trailerLength, byteLength: data.length }
}
