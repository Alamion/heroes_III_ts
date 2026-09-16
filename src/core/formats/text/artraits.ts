// `artraits.txt` (ArtTraits) from h3bitmap.lod: one artifact per row in id order after two header lines;
// tab-separated, quoted fields may span lines. Only the class column (S, T, N, J, R) is read, so
// localized names and descriptions do not matter (specs/003-map-objects/research.md §6).

import { decodeCp1251 } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'

export type ArtifactClass = 'special' | 'treasure' | 'minor' | 'major' | 'relic'

const CLASS_BY_LETTER: Readonly<Record<string, ArtifactClass>> = { S: 'special', T: 'treasure', N: 'minor', J: 'major', R: 'relic' }

/** Column of the class letter: name, cost, 19 slot columns, class. */
const CLASS_COLUMN = 21

/** Splits tab-separated text with double-quoted fields (quotes may contain tabs and newlines). */
function records(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === '\t') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Artifact classes by artifact id. */
export function parseArtTraits(bytes: Uint8Array, fileName = 'artraits.txt'): ArtifactClass[] {
  const rows = records(decodeCp1251(bytes))
  const out: ArtifactClass[] = []
  for (const [i, row] of rows.entries()) {
    if (i < 2 || row.length <= CLASS_COLUMN) continue
    // The file ends with blank rows padded to the full column count.
    if ((row[0] as string).trim() === '' && (row[CLASS_COLUMN] as string).trim() === '') break
    const letter = (row[CLASS_COLUMN] as string).trim()
    const cls = CLASS_BY_LETTER[letter]
    if (cls === undefined) {
      throw new FormatError({ code: FORMAT_ERROR_CODES.INVALID_VALUE, file: fileName, offset: 0, format: 'text', structure: `record ${i + 1}`, message: `unknown artifact class "${letter}"` })
    }
    out.push(cls)
  }
  return out
}
