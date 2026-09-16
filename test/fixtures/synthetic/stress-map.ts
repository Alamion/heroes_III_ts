// Synthetic stress maps for budget checks (tasks.md T090): a 252×252 two-level map and a smaller
// map from the same tile and object generators, so any view inside both shows identical content
// (SC-007). The small map is 96×96 so a 1920×1080 view (60×34 tiles) fits in it (spec 003).

import { writeSyntheticFiles } from './terrain-archive.ts'

export const STRESS_MAP = 'synthetic-252x252x2.h3m'
export const SMALL_MAP = 'synthetic-96x96x2.h3m'

export function writeStressFiles(): ReturnType<typeof writeSyntheticFiles> {
  return writeSyntheticFiles([
    { name: SMALL_MAP, size: 96, underground: true },
    { name: STRESS_MAP, size: 252, underground: true },
  ])
}
