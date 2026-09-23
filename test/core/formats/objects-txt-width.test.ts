// Objects.txt terrain/editor mask width: 9 (base game) or 12 (HotA) — spec 005 FR-007.

import { describe, expect, it } from 'vitest'
import { parseObjectsTxt } from '../../../src/core/formats/text/objects-txt.ts'
import { writeObjectsTxt } from '../../fixtures/synthetic/hota-objects-txt.ts'

const row = {
  defName: 'avwmrnd0.def',
  // Allowed on dirt (0), sand (1), grass (2) and, in the HotA width, Highlands (10) + Wasteland (11).
  terrains: 0b1100_0000_0111,
  editorGroups: 0b0000_0000_0010,
  classId: 98,
  subclassId: 11,
  group: 10,
}

describe('Objects.txt mask width', () => {
  it('reads the base-game 9-character width', () => {
    const rows = parseObjectsTxt(writeObjectsTxt([{ ...row, terrains: 0b0_0000_0111 }], { maskWidth: 9 }), 'Objects.txt')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.allowedTerrains).toBe(0b111)
  })

  it('reads the HotA 12-character width, keeping terrain 0 rightmost', () => {
    const rows = parseObjectsTxt(writeObjectsTxt([row], { maskWidth: 12 }), 'Objects.txt')
    expect(rows[0]?.allowedTerrains).toBe(0b1100_0000_0111)
    // Highlands is id 10 and Wasteland id 11 (research M3, M4).
    expect((rows[0]?.allowedTerrains ?? 0) & (1 << 10)).toBeTruthy()
    expect((rows[0]?.allowedTerrains ?? 0) & (1 << 11)).toBeTruthy()
    // HotA widened the group column to 0-10.
    expect(rows[0]?.group).toBe(10)
  })

  it('rejects a width that is neither 9 nor 12', () => {
    expect(() => parseObjectsTxt(writeObjectsTxt([row], { maskWidth: 9, oddRow: { index: 0, width: 10 } }), 'Objects.txt')).toThrow(
      /terrain mask must be 9 or 12 characters/,
    )
  })

  it('rejects a file whose rows disagree about the width', () => {
    const bytes = writeObjectsTxt([row, { ...row, defName: 'avwmrnd1.def' }], { maskWidth: 12, oddRow: { index: 1, width: 9 } })
    expect(() => parseObjectsTxt(bytes, 'Objects.txt')).toThrow(/must be 12 characters/)
  })
})
