import type { BaselineProfile } from '../data/baselines.ts'
import { ERROR_CODES, RefError } from '../errors.ts'

/** Lowercase DLL base names from a Wine `WINEDEBUG=+loaddll` log. */
export function parseLoadedDlls(logText: string): string[] {
  const names = new Set<string>()
  const re = /trace:loaddll:\w+ Loaded L?"([^"]+)"/g
  for (const m of logText.matchAll(re)) {
    const path = m[1]
    if (path === undefined) continue
    const base = path.split(/[\\/]/).pop()
    if (base !== undefined) names.add(base.toLowerCase())
  }
  return [...names].sort()
}

/**
 * Modules loaded into the game that this baseline forbids: HotA and HD Mod for the Complete
 * edition, HD Mod for the HotA baseline (which loads HotA's own modules by design).
 */
export function forbiddenDlls(names: string[], profile: Pick<BaselineProfile, 'forbiddenModules'>): string[] {
  return names.filter((n) => profile.forbiddenModules.some((p) => p.test(n)))
}

export function assertNoForbiddenDlls(names: string[], profile: Pick<BaselineProfile, 'id' | 'forbiddenModules'>): void {
  const bad = forbiddenDlls(names, profile)
  if (bad.length > 0) {
    throw new RefError(ERROR_CODES.HASH_MISMATCH, `modules forbidden for the ${profile.id} baseline loaded into the game: ${bad.join(', ')}`, {
      details: { baseline: profile.id, forbidden: bad },
    })
  }
}
