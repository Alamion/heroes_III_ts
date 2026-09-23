// Gate for baselines the constitution must allow first (spec 005 FR-021, T067).
//
// Principle II named the Complete edition as the only capture baseline. Capturing from another
// build is therefore not a tooling decision: it needs an owner-approved amendment. The tooling
// refuses rather than assuming, and says exactly what is missing.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Baseline } from '../model/types.ts'
import { baselineProfile } from '../data/baselines.ts'

export const CONSTITUTION_PATH = '.specify/memory/constitution.md'

/** The sentence an amendment must carry for each gated baseline. */
const REQUIRED_CLAUSE: Record<Baseline, RegExp | null> = {
  complete: null,
  hota: /HotA content has its own baseline/i,
}

export interface AmendmentState {
  baseline: Baseline
  required: boolean
  satisfied: boolean
  detail: string
}

export function amendmentState(repoRoot: string, baseline: Baseline): AmendmentState {
  const clause = REQUIRED_CLAUSE[baseline]
  if (!baselineProfile(baseline).needsAmendment || clause === null) {
    return { baseline, required: false, satisfied: true, detail: 'no amendment needed' }
  }
  const path = join(repoRoot, CONSTITUTION_PATH)
  if (!existsSync(path)) {
    return { baseline, required: true, satisfied: false, detail: `${CONSTITUTION_PATH} not found` }
  }
  const text = readFileSync(path, 'utf8')
  return clause.test(text)
    ? { baseline, required: true, satisfied: true, detail: `${CONSTITUTION_PATH} allows the ${baseline} baseline` }
    : { baseline, required: true, satisfied: false, detail: `${CONSTITUTION_PATH} does not allow the ${baseline} baseline` }
}

/** Throws unless the constitution allows this baseline. */
export function requireAmendment(repoRoot: string, baseline: Baseline): void {
  const state = amendmentState(repoRoot, baseline)
  if (state.satisfied) return
  throw new RefError(
    ERROR_CODES.PREREQ_MISSING,
    `the ${baseline} baseline needs a constitution amendment: ${state.detail}. ` +
      `Principle II allows only the Complete edition until the owner amends it to give ${baseline} content its own baseline.`,
    { details: { baseline, constitution: CONSTITUTION_PATH } },
  )
}
