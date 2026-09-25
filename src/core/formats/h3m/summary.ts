// Map summary (spec 007 research R4): version, size, levels and title read from the first inflated
// bytes of a map, with the same readers as the full parser. Filters and the map list never need more.

import { sizeClassOf } from '../../data/map-sizes.ts'
import type { SizeClass } from '../../data/map-sizes.ts'
import { ByteReader } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { makeContext } from './context.ts'
import { HOTA_MAX_SUBVERSION } from './features.ts'
import { KNOWN_OTHER_VERSIONS, versionFromCode } from './h3m.ts'
import { readHotaHeaderFields, readInfo } from './header.ts'
import type { H3mVersion } from './types.ts'

export interface MapSummary {
  version: H3mVersion
  size: number
  sizeClass: SizeClass
  levels: 1 | 2
  /** The map's own name (may be empty). */
  title: string
  /** HotA maps need the HotA archive. */
  needsHota: boolean
}

/**
 * Reads the summary from decompressed map bytes — the whole map or a prefix of it. A prefix that ends
 * before the map name throws a TRUNCATED FormatError, like the full parser would.
 */
export function readMapSummary(data: Uint8Array, fileName: string): MapSummary {
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
      message: `map format 0x${versionCode.toString(16)}${known !== undefined ? ` (${known})` : ''} is not supported`,
    })
  }
  const subVersion = version === 'HotA' ? r.scope('subVersion', () => r.u32()) : null
  if (subVersion !== null && subVersion > HOTA_MAX_SUBVERSION) {
    throw new FormatError({
      code: FORMAT_ERROR_CODES.UNSUPPORTED_VERSION,
      file: fileName,
      offset: 4,
      format: 'h3m',
      structure: 'subVersion',
      version: `HotA sub ${subVersion}`,
      message: `HotA map sub-version ${subVersion} is newer than this reader knows (up to ${HOTA_MAX_SUBVERSION})`,
    })
  }
  r.setVersion(subVersion === null ? version : `${version} sub ${subVersion}`)
  const c = makeContext(r, version, subVersion)
  if (version === 'HotA') readHotaHeaderFields(c)
  const info = readInfo(c)
  return { version, size: info.size, sizeClass: sizeClassOf(info.size), levels: info.hasUnderground ? 2 : 1, title: info.name.text, needsHota: version === 'HotA' }
}
