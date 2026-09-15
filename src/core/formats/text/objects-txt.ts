// `Objects.txt` from h3bitmap.lod: the game's full list of adventure map object templates
// (research.md §9). First line: template count; then one template per line:
//   DEF passable(48) active(48) terrains(9) editorGroups(9) class subclass group overlay

import { decodeCp1251 } from '../../util/byte-reader.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'

export interface ObjectsTxtRow {
  defName: string
  /** Same 6-byte layout as H3M templates (see ObjectTemplate.passable); bit set = passable. */
  passable: Uint8Array
  /** Same layout; bit set = visitable ("active"). */
  active: Uint8Array
  /** Bit i set = allowed on terrain i (char 0 is the highest terrain id, as in the file). */
  allowedTerrains: number
  editorGroups: number
  classId: number
  subclassId: number
  group: number
  isOverlay: boolean
}

function bitString(s: string, fail: (msg: string) => never, what: string, len: number): boolean[] {
  if (s.length !== len || !/^[01]+$/.test(s)) fail(`${what} must be ${len} characters of 0/1 (got "${s}")`)
  return Array.from(s, (c) => c === '1')
}

/**
 * Converts a 48-character mask to the H3M 6-byte layout. Character 0 is the bottom-right tile;
 * characters run right to left within a row and rows run bottom to top.
 */
function templateMask(s: string, fail: (msg: string) => never, what: string): Uint8Array {
  const bits = bitString(s, fail, what, 48)
  const out = new Uint8Array(6)
  bits.forEach((b, i) => {
    if (!b) return
    const row = Math.floor(i / 8)
    const k = i % 8
    out[5 - row] = (out[5 - row] as number) | (1 << (7 - k))
  })
  return out
}

function maskFromBits(s: string, fail: (msg: string) => never, what: string): number {
  const bits = bitString(s, fail, what, 9)
  // The rightmost character is terrain 0.
  let mask = 0
  bits.forEach((b, i) => {
    if (b) mask |= 1 << (bits.length - 1 - i)
  })
  return mask
}

export function parseObjectsTxt(bytes: Uint8Array, fileName = 'Objects.txt'): ObjectsTxtRow[] {
  const text = decodeCp1251(bytes)
  const lines = text.split(/\r?\n/)
  let offset = 0
  const lineOffsets = lines.map((l) => {
    const at = offset
    offset += l.length + 1
    return at
  })
  const failAt = (line: number, message: string): never => {
    throw new FormatError({ code: FORMAT_ERROR_CODES.INVALID_VALUE, file: fileName, offset: lineOffsets[line] ?? 0, format: 'text', structure: `line ${line + 1}`, message })
  }
  const count = Number((lines[0] ?? '').trim())
  if (!Number.isInteger(count) || count < 0) failAt(0, `first line must be the template count (got "${lines[0]}")`)
  const rows: ObjectsTxtRow[] = []
  for (let i = 1; i <= count; i++) {
    const line = lines[i]
    if (line === undefined) {
      throw new FormatError({ code: FORMAT_ERROR_CODES.TRUNCATED, file: fileName, offset: text.length, format: 'text', structure: `line ${i + 1}`, message: `expected ${count} templates, file ends after ${i - 1}` })
    }
    const fail = (msg: string): never => failAt(i, msg)
    const parts = line.trim().split(/\s+/)
    if (parts.length !== 9) fail(`expected 9 fields, got ${parts.length}`)
    const [defName, passable, active, terrains, groups, cls, sub, group, overlay] = parts as [string, string, string, string, string, string, string, string, string]
    const int = (s: string, what: string): number => {
      const n = Number(s)
      if (!Number.isInteger(n) || n < 0) fail(`${what} must be a non-negative integer (got "${s}")`)
      return n
    }
    rows.push({
      defName,
      passable: templateMask(passable, fail, 'passable mask'),
      active: templateMask(active, fail, 'active mask'),
      allowedTerrains: maskFromBits(terrains, fail, 'terrain mask'),
      editorGroups: maskFromBits(groups, fail, 'editor group mask'),
      classId: int(cls, 'class'),
      subclassId: int(sub, 'subclass'),
      group: int(group, 'group'),
      isOverlay: int(overlay, 'overlay') !== 0,
    })
  }
  for (let i = count + 1; i < lines.length; i++) {
    if ((lines[i] as string).trim() !== '') failAt(i, `unexpected content after ${count} templates`)
  }
  return rows
}
