import type { Baseline } from '../model/types.ts'

export const SETUP_FILE = 'setup.json'

/** Each baseline records the install it was set up from separately. */
export function setupFile(baseline: Baseline): string {
  return baseline === 'complete' ? SETUP_FILE : `setup-${baseline}.json`
}
