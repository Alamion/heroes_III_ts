// `Objects.txt` from h3bitmap.lod: the game's full list of adventure map object templates
// (research.md §9). First line: template count; then one template per line:
//   DEF passable(48) active(48) terrains(N) editorGroups(N) class subclass group overlay
//
// N is 9 in the base game (terrain ids 0-8, rock omitted) and 12 in HotA, which stopped omitting
// rock and appended Highlands (10) and Wasteland (11). The width is a property of the file, not of
// the archive it came from: HotA's own objtmplt.txt is byte-identical to the vanilla one and still
// 9 wide (spec 005 research M3), so it is read per file and every row must agree.

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

/** Mask widths seen in the wild: 9 (base game) and 12 (HotA). */
export const TERRAIN_MASK_WIDTHS: readonly number[] = [9, 12]

function maskFromBits(s: string, fail: (msg: string) => never, what: string, len: number): number {
  const bits = bitString(s, fail, what, len)
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
  /** Set by the first row; every later row must use the same width. */
  let maskWidth: number | undefined
  for (let i = 1; i <= count; i++) {
    const line = lines[i]
    if (line === undefined) {
      throw new FormatError({ code: FORMAT_ERROR_CODES.TRUNCATED, file: fileName, offset: text.length, format: 'text', structure: `line ${i + 1}`, message: `expected ${count} templates, file ends after ${i - 1}` })
    }
    const fail = (msg: string): never => failAt(i, msg)
    const parts = line.trim().split(/\s+/)
    if (parts.length !== 9) fail(`expected 9 fields, got ${parts.length}`)
    const [defName, passable, active, terrains, groups, cls, sub, group, overlay] = parts as [string, string, string, string, string, string, string, string, string]
    if (maskWidth === undefined) {
      if (!TERRAIN_MASK_WIDTHS.includes(terrains.length)) {
        fail(`terrain mask must be ${TERRAIN_MASK_WIDTHS.join(' or ')} characters of 0/1 (got "${terrains}")`)
      }
      maskWidth = terrains.length
    }
    const int = (s: string, what: string): number => {
      const n = Number(s)
      if (!Number.isInteger(n) || n < 0) fail(`${what} must be a non-negative integer (got "${s}")`)
      return n
    }
    rows.push({
      defName,
      passable: templateMask(passable, fail, 'passable mask'),
      active: templateMask(active, fail, 'active mask'),
      allowedTerrains: maskFromBits(terrains, fail, 'terrain mask', maskWidth),
      editorGroups: maskFromBits(groups, fail, 'editor group mask', maskWidth),
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
