// H3M map parser (RoE/AB/SoD). Layout ported from homm3-parser (MIT, see THIRD_PARTY_NOTICES.md)
// with corrections verified against the base-game map corpus (research.md §3).

import { ByteReader } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { inflate, isGzip } from '../../util/inflate.ts'
import { makeContext } from './context.ts'
import { HOTA_MAX_SUBVERSION, HOTA_REQUIRED_SUBVERSIONS } from './features.ts'
import { readHeaderRest, readHotaHeaderFields, readInfo, readLoss, readPlayers, readVictory } from './header.ts'
import { readObjects } from './objects/index.ts'
import { readTemplates } from './templates.ts'
import { readTiles } from './tiles.ts'
import { readTimedEvent } from './objects/town.ts'
import { H3M_VERSION_CODES } from './types.ts'
import type { H3mMap, H3mVersion, HotaHeader, TimedEvent } from './types.ts'

export const KNOWN_OTHER_VERSIONS: Record<number, string> = {
  0x1d: 'Chronicles',
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
      message: `map format 0x${versionCode.toString(16)}${known !== undefined ? ` (${known})` : ''} is not supported; only RoE (0x0e), AB (0x15), SoD (0x1c) and HotA (0x20) maps are`,
    })
  }
  // HotA stores a sub-version right after the format code; 9 and 10 are the ones in the wild.
  const subVersion = version === 'HotA' ? r.scope('subVersion', () => r.u32()) : null
  if (subVersion !== null && subVersion > HOTA_MAX_SUBVERSION) {
    throw new FormatError({
      code: FORMAT_ERROR_CODES.UNSUPPORTED_VERSION,
      file: fileName,
      offset: 4,
      format: 'h3m',
      structure: 'subVersion',
      version: `HotA sub ${subVersion}`,
      message: `HotA map sub-version ${subVersion} is newer than this reader knows (up to ${HOTA_MAX_SUBVERSION}; ${HOTA_REQUIRED_SUBVERSIONS.join(' and ')} are verified)`,
    })
  }
  r.setVersion(subVersion === null ? version : `${version} sub ${subVersion}`)
  const c = makeContext(r, version, subVersion)
  const hotaFields = version === 'HotA' ? readHotaHeaderFields(c) : null
  const info = readInfo(c)
  const players = readPlayers(c)
  const victory = readVictory(c)
  const loss = readLoss(c)
  // hotaOptions and hotaScriptBytes belong to the HotA header block, not to the map's own fields.
  const { hotaOptions, hotaScriptBytes, ...rest } = readHeaderRest(c)
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
  const hota: HotaHeader | null =
    hotaFields === null
      ? null
      : {
          ...hotaFields,
          allowSpecialWeeks: hotaOptions?.allowSpecialWeeks ?? null,
          combinedArtifactBan: hotaOptions?.combinedArtifactBan ?? null,
          roundLimit: hotaOptions?.roundLimit ?? null,
          blockedRecruitment: hotaOptions?.blockedRecruitment ?? null,
          scriptBytes: hotaScriptBytes,
        }
  return { fileName, version, versionCode, subVersion, hota, info, players, victory, loss, ...rest, tiles, templates, objects, events, trailerLength, byteLength: data.length }
}
