// RIFF palette files (`PLAYERS.PAL`, `game.pal`): "RIFF" size "PAL " chunks; the "data" chunk holds
// version u16, count u16 and count × (r, g, b, flags).

import { ByteReader } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'

/** Returns the palette as count × 3 RGB bytes (256 entries in the base game's files). */
export function parseRiffPal(bytes: Uint8Array, fileName: string): Uint8Array {
  const r = new ByteReader(bytes, { file: fileName, format: 'pal' })
  const magic = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || magic(0) !== 'RIFF' || magic(8) !== 'PAL ') {
    throw new FormatError({ code: FORMAT_ERROR_CODES.INVALID_VALUE, file: fileName, offset: 0, format: 'pal', structure: 'header', message: 'not a RIFF PAL file' })
  }
  r.seek(12)
  while (r.remaining >= 8) {
    const at = r.offset
    const id = magic(at)
    r.skipKnown(4, 'chunk id')
    const size = r.u32()
    if (id === 'data') {
      r.u16()
      const count = r.u16()
      if (count * 4 + 4 > size) {
        throw new FormatError({ code: FORMAT_ERROR_CODES.INVALID_VALUE, file: fileName, offset: at, format: 'pal', structure: 'data chunk', message: `${count} entries do not fit a ${size}-byte chunk` })
      }
      const out = new Uint8Array(count * 3)
      for (let i = 0; i < count; i++) {
        out[i * 3] = r.u8()
        out[i * 3 + 1] = r.u8()
        out[i * 3 + 2] = r.u8()
        r.u8()
      }
      return out
    }
    r.skipKnown(size + (size & 1), `chunk ${id}`)
  }
  throw new FormatError({ code: FORMAT_ERROR_CODES.TRUNCATED, file: fileName, offset: bytes.length, format: 'pal', structure: 'chunks', message: 'no data chunk' })
}
