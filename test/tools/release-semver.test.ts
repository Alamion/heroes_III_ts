import { describe, expect, it } from 'vitest'
import { compareVersions, formatVersion, livelyVersion, parseVersion } from '../../tools/release/semver.ts'

describe('semver (spec 006 research R2)', () => {
  it('parses and formats', () => {
    for (const s of ['0.1.0', '1.2.3', '0.2.0-beta.1', '1.0.0-rc.1', '10.20.30-alpha.0.x']) expect(formatVersion(parseVersion(s))).toBe(s)
    expect(parseVersion('0.2.0-beta.1')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: ['beta', '1'] })
  })

  it('orders by SemVer precedence', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0']
    for (let i = 0; i + 1 < chain.length; i++) {
      expect(compareVersions(parseVersion(chain[i] as string), parseVersion(chain[i + 1] as string)), `${chain[i]} < ${chain[i + 1]}`).toBeLessThan(0)
      expect(compareVersions(parseVersion(chain[i + 1] as string), parseVersion(chain[i] as string))).toBeGreaterThan(0)
    }
    expect(compareVersions(parseVersion('0.1.0'), parseVersion('0.1.0'))).toBe(0)
  })

  it('rejects anything that is not a plain SemVer version', () => {
    for (const s of ['v1.0.0', '1.0', '01.0.0', '1.0.0+build', '1.0.0-', '1.0.0-01', '1.0.0-a..b', 'x']) expect(() => parseVersion(s), s).toThrow()
  })

  it('derives the Lively integer version', () => {
    expect(livelyVersion(parseVersion('0.1.0'))).toBe(100)
    expect(livelyVersion(parseVersion('1.2.3'))).toBe(10203)
    expect(() => livelyVersion(parseVersion('0.100.0'))).toThrow()
    expect(() => livelyVersion(parseVersion('0.1.100'))).toThrow()
  })
})
