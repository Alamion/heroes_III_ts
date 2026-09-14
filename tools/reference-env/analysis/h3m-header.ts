// Minimal bounds-checked H3M header reader: only what capture requests need to validate.
import { gunzipSync } from 'node:zlib'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { FormatVersion } from '../model/types.ts'

export interface H3mHeader {
  formatVersion: FormatVersion
  sizeTiles: number
  hasUnderground: boolean
}

const VERSIONS: Record<number, FormatVersion> = { 0x0e: 'RoE', 0x15: 'AB', 0x1c: 'SoD' }

export function readH3mHeader(bytes: Uint8Array, fileName: string): H3mHeader {
  let data = bytes
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      data = gunzipSync(bytes)
    } catch (err) {
      throw new RefError(ERROR_CODES.MAP_UNSUPPORTED, `${fileName}: gzip stream is corrupt`, {
        details: { file: fileName, offset: 0, structure: 'gzip' },
        cause: err,
      })
    }
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const need = (offset: number, len: number, structure: string): void => {
    if (offset + len > data.byteLength) {
      throw new RefError(ERROR_CODES.MAP_UNSUPPORTED, `${fileName}: truncated while reading ${structure} at offset ${offset}`, {
        details: { file: fileName, offset, structure },
      })
    }
  }
  need(0, 4, 'version')
  const version = view.getUint32(0, true)
  const formatVersion = VERSIONS[version]
  if (formatVersion === undefined) {
    throw new RefError(
      ERROR_CODES.MAP_UNSUPPORTED,
      `${fileName}: map format version 0x${version.toString(16)} is not supported by the base game (RoE/AB/SoD only)`,
      { details: { file: fileName, offset: 0, version, structure: 'version' } },
    )
  }
  need(4, 1, 'hasHero')
  need(5, 4, 'size')
  const sizeTiles = view.getUint32(5, true)
  if (sizeTiles === 0 || sizeTiles > 252) {
    throw new RefError(ERROR_CODES.MAP_UNSUPPORTED, `${fileName}: implausible map size ${sizeTiles} at offset 5`, {
      details: { file: fileName, offset: 5, version, structure: 'size' },
    })
  }
  need(9, 1, 'twoLevel')
  const twoLevel = view.getUint8(9)
  return { formatVersion, sizeTiles, hasUnderground: twoLevel !== 0 }
}
