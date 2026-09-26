import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishRelease } from '../../tools/release/publish.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(view: { body: string; isPrerelease: boolean } | 'missing') {
  const dir = mkdtempSync(join(tmpdir(), 'h3-publish-'))
  dirs.push(dir)
  for (const f of ['release-notes.md', 'SHA256SUMS', 'heroes3-living-map-web-0.1.0.zip']) writeFileSync(join(dir, f), f)
  const calls: string[][] = []
  const gh = (args: readonly string[]) => {
    calls.push([...args])
    if (args[1] === 'view') {
      if (view === 'missing') throw Object.assign(new Error('failed'), { stderr: 'release not found' })
      return JSON.stringify(view)
    }
    return ''
  }
  return { dir, calls, gh }
}

describe('publish (spec 006 FR-005, FR-008)', () => {
  it('creates a missing release with the notes, then uploads with --clobber', () => {
    const s = setup('missing')
    const res = publishRelease({ tag: 'v0.1.0', version: '0.1.0', prerelease: false, dir: s.dir, gh: s.gh })
    expect(res).toMatchObject({ created: true, notesWritten: true })
    expect(s.calls[1]).toEqual(['release', 'create', 'v0.1.0', '--verify-tag', '--title', 'Heroes 3 Living Map 0.1.0', '--notes-file', join(s.dir, 'release-notes.md')])
    expect(s.calls[2]).toEqual(['release', 'upload', 'v0.1.0', join(s.dir, 'SHA256SUMS'), join(s.dir, 'heroes3-living-map-web-0.1.0.zip'), '--clobber'])
  })

  it('keeps notes a person wrote and only replaces assets', () => {
    const s = setup({ body: 'Hand-written notes', isPrerelease: false })
    const res = publishRelease({ tag: 'v0.1.0', version: '0.1.0', prerelease: false, dir: s.dir, gh: s.gh })
    expect(res).toMatchObject({ created: false, notesWritten: false })
    expect(s.calls.map((c) => c[1])).toEqual(['view', 'upload'])
  })

  it('fills an empty body and marks a pre-release', () => {
    const s = setup({ body: '  ', isPrerelease: false })
    publishRelease({ tag: 'v0.2.0-rc.1', version: '0.2.0-rc.1', prerelease: true, dir: s.dir, gh: s.gh })
    expect(s.calls[1]).toEqual(['release', 'edit', 'v0.2.0-rc.1', '--notes-file', join(s.dir, 'release-notes.md'), '--prerelease'])
  })

  it('creates a pre-release as such and never uploads the notes file', () => {
    const s = setup('missing')
    publishRelease({ tag: 'v0.2.0-rc.1', version: '0.2.0-rc.1', prerelease: true, dir: s.dir, gh: s.gh })
    expect(s.calls[1]).toContain('--prerelease')
    expect(s.calls.flat().filter((a) => a.endsWith('release-notes.md') && !a.startsWith('--'))).toHaveLength(1)
    expect(s.calls[2]?.some((a) => a.endsWith('release-notes.md'))).toBe(false)
  })

  it('rethrows other gh errors', () => {
    const s = setup('missing')
    const gh = () => {
      throw Object.assign(new Error('x'), { stderr: 'HTTP 401: Bad credentials' })
    }
    expect(() => publishRelease({ tag: 'v0.1.0', version: '0.1.0', prerelease: false, dir: s.dir, gh })).toThrow()
  })
})
