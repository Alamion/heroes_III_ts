import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRelease } from '../../tools/release/tags.ts'

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const dirs: string[] = []

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'h3-release-'))
  dirs.push(dir)
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' }).trim()
  g('init', '-q', '-b', 'testing')
  const commit = (version: string, changelog: string) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }))
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog)
    g('add', '-A')
    g('commit', '-q', '-m', `v${version}`)
    return g('rev-parse', 'HEAD')
  }
  return { dir, g, commit }
}

const log = (...sections: [string, string][]) => `# Changelog\n\n${sections.map(([v, b]) => `## [${v}] - 2026-09-30\n\n${b}\n`).join('\n')}`

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('release tag rules (spec 006 FR-003)', () => {
  it('passes a matching tag on testing and returns the section', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.1.0', 'First release.']))
    r.g('tag', 'v0.1.0')
    const res = checkRelease({ tag: 'v0.1.0', repoRoot: r.dir, branch: 'testing' })
    expect(res).toMatchObject({ ok: true, version: '0.1.0', kind: 'final', livelyVersion: 100, changelog: 'First release.' })
  })

  it('fails in the documented order with named values', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.1.0', 'First.']))
    r.g('tag', 'v0.1.0')
    const code = (tag: string, extra: object = {}) => checkRelease({ tag, repoRoot: r.dir, branch: 'testing', ...extra }).failure?.code
    expect(code('0.1.0')).toBe('TAG_FORMAT')
    expect(code('v0.1')).toBe('TAG_FORMAT')
    expect(code('v0.2.0')).toBe('TAG_MISSING')
    r.g('tag', 'v0.2.0')
    const mismatch = checkRelease({ tag: 'v0.2.0', repoRoot: r.dir, branch: 'testing' })
    expect(mismatch.failure).toMatchObject({ code: 'VERSION_MISMATCH', message: 'tag v0.2.0 but package.json says 0.1.0' })
  })

  it('rejects a commit that is not on testing', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.1.0', 'First.']))
    r.g('checkout', '-q', '-b', 'side')
    r.commit('0.2.0', log(['0.2.0', 'Side.']))
    r.g('tag', 'v0.2.0')
    expect(checkRelease({ tag: 'v0.2.0', repoRoot: r.dir, branch: 'testing' }).failure?.code).toBe('NOT_ON_TESTING')
    expect(checkRelease({ tag: 'v0.2.0', repoRoot: r.dir, branch: 'origin/testing' }).failure?.code).toBe('NOT_ON_TESTING')
  })

  it('requires a final version higher than every released final, but allows pre-releases', () => {
    const r = repo()
    r.commit('0.2.0', log(['0.2.0', 'Two.']))
    r.g('tag', 'v0.2.0')
    r.commit('0.1.5', log(['0.1.5', 'Old.']))
    r.g('tag', 'v0.1.5')
    expect(checkRelease({ tag: 'v0.1.5', repoRoot: r.dir, branch: 'testing' }).failure).toMatchObject({ code: 'VERSION_NOT_HIGHER', message: '0.1.5 is not higher than the released 0.2.0 (v0.2.0)' })
    r.commit('0.1.6-rc.1', log(['0.1.6', 'Beta notes.']))
    r.g('tag', 'v0.1.6-rc.1')
    expect(checkRelease({ tag: 'v0.1.6-rc.1', repoRoot: r.dir, branch: 'testing' })).toMatchObject({ ok: true, kind: 'prerelease', changelog: 'Beta notes.' })
  })

  it('names missing and empty changelog sections and out-of-range Lively versions', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.0.9', 'Old.']))
    r.g('tag', 'v0.1.0')
    expect(checkRelease({ tag: 'v0.1.0', repoRoot: r.dir, branch: 'testing' }).failure?.code).toBe('CHANGELOG_MISSING')
    r.commit('0.1.1', log(['0.1.1', '   ']))
    r.g('tag', 'v0.1.1')
    expect(checkRelease({ tag: 'v0.1.1', repoRoot: r.dir, branch: 'testing' }).failure?.code).toBe('CHANGELOG_EMPTY')
    r.commit('0.100.0', log(['0.100.0', 'Big.']))
    r.g('tag', 'v0.100.0')
    expect(checkRelease({ tag: 'v0.100.0', repoRoot: r.dir, branch: 'testing' }).failure?.code).toBe('LIVELY_VERSION_RANGE')
  })

  it('reads package.json and CHANGELOG.md from the tagged commit, not the working tree', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.1.0', 'First.']))
    r.g('tag', 'v0.1.0')
    writeFileSync(join(r.dir, 'package.json'), JSON.stringify({ version: '9.9.9' }))
    expect(checkRelease({ tag: 'v0.1.0', repoRoot: r.dir, branch: 'testing' }).ok).toBe(true)
  })

  it('checks before tagging with --local (HEAD, working tree, local testing)', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.1.0', 'First.']))
    expect(checkRelease({ tag: 'v0.1.0', repoRoot: r.dir, local: true })).toMatchObject({ ok: true })
    r.g('tag', 'v0.1.0')
    r.commit('0.1.0', log(['0.1.0', 'First, reworded.']))
    expect(checkRelease({ tag: 'v0.1.0', repoRoot: r.dir, local: true }).failure?.code).toBe('TAG_TAKEN')
  })

  it('runs the extra changelog rule', () => {
    const r = repo()
    r.commit('0.1.0', log(['0.1.0', '| a | b |']))
    const validateChangelog = () => {
      throw Object.assign(new Error('table'), { code: 'MARKUP_UNSUPPORTED' })
    }
    expect(checkRelease({ tag: 'v0.1.0', repoRoot: r.dir, local: true, validateChangelog }).failure?.code).toBe('MARKUP_UNSUPPORTED')
  })
})
