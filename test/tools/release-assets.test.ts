import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeReleaseAssets } from '../../tools/release/assets.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function fakePackages(version: string) {
  const root = mkdtempSync(join(tmpdir(), 'h3-assets-'))
  dirs.push(root)
  const pk = join(root, 'packages')
  mkdirSync(pk)
  for (const [host, ext] of [['web', 'zip'], ['wallpaper-engine', 'zip'], ['lively', 'zip'], ['kde', 'tar.gz']]) writeFileSync(join(pk, `heroes3-living-map-${host}-${version}.${ext}`), `${host} archive`)
  return { root, pk }
}

describe('release assets (spec 006 FR-005, data-model "ReleaseAssets")', () => {
  it('copies the archives, writes texts, notes and a sha256sum -c file', () => {
    const { root, pk } = fakePackages('0.1.0')
    const out = join(root, 'out')
    const files = writeReleaseAssets({ version: '0.1.0', packagesDir: pk, outDir: out, changelog: 'First release.\n', notesFooter: '### Which file do I need?', texts: [{ name: 'workshop-title.txt', content: 'Heroes 3 Living Map\n' }] })
    expect(files.map((f) => f.name)).toEqual([
      'heroes3-living-map-kde-0.1.0.tar.gz',
      'heroes3-living-map-lively-0.1.0.zip',
      'heroes3-living-map-wallpaper-engine-0.1.0.zip',
      'heroes3-living-map-web-0.1.0.zip',
      'workshop-title.txt',
    ])
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trim().split('\n')
    expect(sums).toHaveLength(5)
    for (const line of sums) {
      const [hash, name] = line.split('  ') as [string, string]
      expect(createHash('sha256').update(readFileSync(join(out, name))).digest('hex')).toBe(hash)
    }
    expect(readFileSync(join(out, 'release-notes.md'), 'utf8')).toBe('First release.\n\n### Which file do I need?\n')
  })

  it('writes byte-identical files on a second run', () => {
    const { root, pk } = fakePackages('0.1.0')
    const run = (out: string) => {
      writeReleaseAssets({ version: '0.1.0', packagesDir: pk, outDir: out, changelog: 'x' })
      return ['SHA256SUMS', 'release-notes.md'].map((f) => readFileSync(join(out, f), 'utf8'))
    }
    expect(run(join(root, 'a'))).toEqual(run(join(root, 'b')))
  })

  it('names a missing archive', () => {
    const { root, pk } = fakePackages('0.1.0')
    rmSync(join(pk, 'heroes3-living-map-kde-0.1.0.tar.gz'))
    expect(() => writeReleaseAssets({ version: '0.1.0', packagesDir: pk, outDir: join(root, 'o'), changelog: 'x' })).toThrow(/heroes3-living-map-kde-0.1.0.tar.gz is missing/)
  })
})
