// Synthetic worlds for coverage and view-placement tests (spec 009): only the fields a coverage grid
// reads, objects with chosen templates, no game content.

import { HIDDEN_CLASSES } from '../../../src/core/data/object-classes.ts'
import type { WorldObject, WorldState } from '../../../src/core/state/world.ts'

export interface ObjectSpec {
  x: number
  y: number
  z: number
  classId?: number
  /** 6-byte mask, bit set = passable; default: only the anchor tile blocked. */
  passable?: Uint8Array
  /** 6-byte mask, bit set = visitable; default: none. */
  active?: Uint8Array
}

export type CoverageWorld = Pick<WorldState, 'size' | 'levels' | 'objects'>

/** Only the anchor tile (bit 7 of the bottom row) blocked. */
export const ANCHOR_ONLY = Uint8Array.of(255, 255, 255, 255, 255, 127)
const NONE = Uint8Array.of(0, 0, 0, 0, 0, 0)
const DECORATION = 0x3f

export function coverageWorld(spec: { size: number; levels: number; objects: Iterable<ObjectSpec> }): CoverageWorld {
  const objects = new Map<number, WorldObject>()
  let id = 0
  for (const o of spec.objects) {
    const classId = o.classId ?? DECORATION
    objects.set(id, {
      id,
      x: o.x,
      y: o.y,
      z: o.z,
      classId,
      subclassId: 0,
      owner: null,
      random: null,
      details: { kind: 'none' },
      template: { defName: 'syn.def', passable: o.passable ?? ANCHOR_ONLY, active: o.active ?? NONE, allowedTerrains: 0x1ff, editorGroups: 0, classId, subclassId: 0, group: 0, isOverlay: false },
    } as WorldObject)
    id++
  }
  return { size: spec.size, levels: spec.levels, objects }
}

/** One 1-tile blocked object on every `step`-th tile of the inclusive rectangle. */
export function* fillRect(z: number, x0: number, y0: number, x1: number, y1: number, step = 1): Generator<ObjectSpec> {
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) yield { x, y, z }
}

/** Objects of every hidden class (events, grail) on the given tiles: they must never count. */
export function* withHidden(z: number, tiles: Iterable<{ x: number; y: number }>): Generator<ObjectSpec> {
  for (const t of tiles) for (const classId of HIDDEN_CLASSES) yield { x: t.x, y: t.y, z, classId }
}
