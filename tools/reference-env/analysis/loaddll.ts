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

const ALWAYS_FORBIDDEN = [/^hota\.dll$/, /^hota_me\.dll$/, /^hw_hota\.dll$/, /^hd_hota\.dll$/, /^hota_.*\.dll$/]
const HD_MOD = [/^_hd3_\.dll$/, /^patcher_x86\.dll$/, /^hd_.*\.dll$/, /^hw_sod\.dll$/]

export function forbiddenDlls(names: string[], opts: { allowHdMod: boolean }): string[] {
  const patterns = opts.allowHdMod ? ALWAYS_FORBIDDEN : [...ALWAYS_FORBIDDEN, ...HD_MOD]
  return names.filter((n) => patterns.some((p) => p.test(n)))
}

export function assertNoForbiddenDlls(names: string[], opts: { allowHdMod: boolean }): void {
  const bad = forbiddenDlls(names, opts)
  if (bad.length > 0) {
    throw new RefError(ERROR_CODES.HASH_MISMATCH, `forbidden modules loaded into the game: ${bad.join(', ')}`, {
      details: { forbidden: bad },
    })
  }
}
