// Semantic Versioning 2.0 for release tags (spec 006 research R2): parse, compare, format, and the
// integer version Lively's LivelyInfo.json takes. Build metadata is rejected: tags must be comparable.

export interface Version {
  major: number
  minor: number
  patch: number
  /** Dot-separated identifiers after "-"; empty for a final version. */
  prerelease: string[]
}

const NUMERIC = /^(0|[1-9]\d*)$/
const IDENT = /^[0-9A-Za-z-]+$/

export function parseVersion(text: string): Version {
  const fail = (why: string): never => {
    throw new Error(`"${text}" is not a SemVer version: ${why}`)
  }
  if (text.includes('+')) fail('build metadata (+…) is not allowed')
  const dash = text.indexOf('-')
  const core = dash < 0 ? text : text.slice(0, dash)
  const pre = dash < 0 ? [] : text.slice(dash + 1).split('.')
  const parts = core.split('.')
  if (parts.length !== 3) fail('expected MAJOR.MINOR.PATCH')
  for (const p of parts) if (!NUMERIC.test(p)) fail(`"${p}" is not a number without leading zeros`)
  for (const id of pre) {
    if (id === '' || !IDENT.test(id)) fail(`bad pre-release identifier "${id}"`)
    if (/^\d+$/.test(id) && !NUMERIC.test(id)) fail(`numeric identifier "${id}" has a leading zero`)
  }
  const [major, minor, patch] = parts.map(Number) as [number, number, number]
  return { major, minor, patch, prerelease: pre }
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length > 0 ? `-${v.prerelease.join('.')}` : ''}`
}

export function isPrerelease(v: Version): boolean {
  return v.prerelease.length > 0
}

/** The final version a pre-release leads to (1.2.0-rc.1 → 1.2.0). */
export function coreVersion(v: Version): Version {
  return { ...v, prerelease: [] }
}

function compareIdent(a: string, b: string): number {
  const an = /^\d+$/.test(a)
  const bn = /^\d+$/.test(b)
  if (an && bn) return Number(a) - Number(b)
  if (an) return -1
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** SemVer precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: Version, b: Version): number {
  for (const k of ['major', 'minor', 'patch'] as const) if (a[k] !== b[k]) return a[k] - b[k]
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return b.prerelease.length - a.prerelease.length
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const c = compareIdent(a.prerelease[i] as string, b.prerelease[i] as string)
    if (c !== 0) return c
  }
  return a.prerelease.length - b.prerelease.length
}

/** LivelyInfo.json "Version": grows with every release while minor and patch stay below 100. */
export function livelyVersion(v: Version): number {
  if (v.minor >= 100 || v.patch >= 100) throw new Error(`${formatVersion(v)}: minor and patch must stay below 100 for Lively's integer version`)
  return v.major * 10000 + v.minor * 100 + v.patch
}
