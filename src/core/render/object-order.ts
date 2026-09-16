// Draw order of render objects (specs/003-map-objects/research.md §4, measured T047).

import type { RenderObject } from '../state/render-objects.ts'

// The body's flagpole covers the last flag column in the game (research.md "Hero flags").
const KIND_RANK: Readonly<Record<RenderObject['kind'], number>> = { object: 0, heroFlag: 1, heroBody: 2 }

/**
 * Negative when `a` is drawn before `b`: flat objects first, then non-visitable before visitable
 * objects (a visitable building is drawn over trees in front of it), then anchor row, heroes after
 * other objects of the row, then map file order. Measured on test_map.h3m and Arrogance.h3m stills
 * (research.md T047); order differences in dense mountain clusters remain a known deviation.
 */
export function compareObjects(a: RenderObject, b: RenderObject): number {
  if (a.flat !== b.flat) return a.flat ? -1 : 1
  if (a.visitable !== b.visitable) return a.visitable ? 1 : -1
  if (a.y !== b.y) return a.y - b.y
  const heroA = a.kind === 'object' ? 0 : 1
  const heroB = b.kind === 'object' ? 0 : 1
  if (heroA !== heroB) return heroA - heroB
  if (a.order !== b.order) return a.order - b.order
  return KIND_RANK[a.kind] - KIND_RANK[b.kind]
}
