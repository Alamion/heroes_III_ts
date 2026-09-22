// Synthetic Objects.txt writer (no game content), in both mask widths.
//
// The base game writes 9-character terrain and editor-group masks, HotA 12 (spec 005 research M3).

export interface SyntheticObjectRow {
  defName: string
  /** Bit i set = allowed on terrain i; rendered right-to-left into `maskWidth` characters. */
  terrains: number
  editorGroups: number
  classId: number
  subclassId: number
  group: number
  isOverlay?: boolean
  /** 48-character masks; default: nothing passable, nothing active. */
  passable?: string
  active?: string
}

export interface SyntheticObjectsTxtOptions {
  maskWidth?: 9 | 12
  /** Overrides the width of one row's masks, to exercise the "all rows must agree" rule. */
  oddRow?: { index: number; width: number }
}

function mask(value: number, width: number): string {
  let out = ''
  for (let bit = width - 1; bit >= 0; bit--) out += (value >> bit) & 1 ? '1' : '0'
  return out
}

export function writeObjectsTxt(rows: SyntheticObjectRow[], opts: SyntheticObjectsTxtOptions = {}): Uint8Array {
  const width = opts.maskWidth ?? 9
  const lines = [String(rows.length)]
  rows.forEach((r, i) => {
    const w = opts.oddRow?.index === i ? opts.oddRow.width : width
    lines.push(
      [
        r.defName,
        r.passable ?? '0'.repeat(48),
        r.active ?? '0'.repeat(48),
        mask(r.terrains, w),
        mask(r.editorGroups, w),
        String(r.classId),
        String(r.subclassId),
        String(r.group),
        r.isOverlay === true ? '1' : '0',
      ].join(' '),
    )
  })
  // The real files use CRLF and end with one.
  return new TextEncoder().encode(`${lines.join('\r\n')}\r\n`)
}
