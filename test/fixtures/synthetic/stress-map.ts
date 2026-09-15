// Synthetic stress maps for budget checks (tasks.md T090): a 252×252 two-level map and a 36×36
// map from the same tile generator, so any view shows identical content on both (SC-007).

import { writeSyntheticFiles } from './terrain-archive.ts'

export const STRESS_MAP = 'synthetic-252x252x2.h3m'
export const SMALL_MAP = 'synthetic-36x36x2.h3m'

export function writeStressFiles(): ReturnType<typeof writeSyntheticFiles> {
  return writeSyntheticFiles([
    { name: SMALL_MAP, size: 36, underground: true },
    { name: STRESS_MAP, size: 252, underground: true },
  ])
}
