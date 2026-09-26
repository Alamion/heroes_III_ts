// Repository hygiene (constitution I, spec FR-027/FR-028): no game files or derived data tracked,
// the Windows-only sync script gone, attribution present.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(import.meta.dirname, '../..')

function tracked(): string[] {
  // Tracked plus untracked-but-not-ignored files: what a commit could include.
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: REPO })
  return out.toString('utf8').split('\0').filter(Boolean)
}

describe('repository hygiene', () => {
  const files = tracked()

  it('has no files from local-only folders', () => {
    const local = files.filter((f) => /^(public\/dev-assets|reference-captures|check-reports|context)\//.test(f) || f === 'reference-env.config.json')
    expect(local).toEqual([])
  })

  it('has no game archives, sprites, maps or derived images', () => {
    const game = files.filter((f) => /\.(lod|def|pcx|h3m|h3c|msk|snd|vid|pal)$/i.test(f))
    expect(game).toEqual([])
    // Documentation screenshots of the project's own output are the only images (constitution I).
    const images = files.filter((f) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f))
    expect(images.filter((f) => !f.startsWith('docs/img/'))).toEqual([])
  })

  it('has no leftover merge conflict markers', () => {
    // `git add` marks a conflict resolved even with the markers still in the file (a merge on
    // 2026-09-26 committed them into README.md and AGENTS.md).
    const text = files.filter((f) => /\.(md|ts|js|json|ya?ml|qml|html|css|txt)$/i.test(f) && existsSync(resolve(REPO, f)))
    const marked = text.filter((f) => /^(<{7}|={7}|>{7})( |$)/m.test(readFileSync(resolve(REPO, f), 'utf8')))
    expect(marked).toEqual([])
  })

  it('keeps documentation screenshots small (constitution I)', () => {
    const images = files.filter((f) => f.startsWith('docs/img/') && existsSync(resolve(REPO, f)))
    const sizes = images.map((f) => ({ f, bytes: statSync(resolve(REPO, f)).size }))
    expect(sizes.filter((s) => s.bytes > 2 * 1024 * 1024)).toEqual([])
    expect(sizes.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('has no committed archive entry-name list (spec 005 FR-028)', () => {
    // HotA archives store hashed names; the name list that resolves them is third-party data about
    // game files and is read from the git-ignored context/ folder, never committed.
    const lists = files.filter((f) => /hashes\.txt$/i.test(f) || /entry-names/i.test(f))
    expect(lists).toEqual([])
    // The runtime resolves names by hashing, so no source file may embed a name table either.
    const nameHash = readFileSync(resolve(REPO, 'src/core/formats/lod/name-hash.ts'), 'utf8')
    expect(nameHash).not.toMatch(/\.def['"]\s*,\s*['"]/)
  })

  it('generates synthetic HotA fixtures in code, with no game bytes (spec 005)', () => {
    for (const f of ['test/fixtures/synthetic/hota-lod.ts', 'test/fixtures/synthetic/hota-map.ts', 'test/fixtures/synthetic/hota-objects-txt.ts']) {
      const src = readFileSync(resolve(REPO, f), 'utf8')
      expect(src).toMatch(/no game content/i)
      // A fixture that embedded real data would carry a long literal blob.
      expect(src).not.toMatch(/[A-Za-z0-9+/]{200,}={0,2}/)
    }
  })

  it('stores flag colours as palette entries only (spec 003, constitution I)', () => {
    const players = readFileSync(resolve(REPO, 'src/core/data/players.ts'), 'utf8')
    // No RGB triples: colours are read from the user's game.pal at run time.
    expect(players).not.toMatch(/\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\]/)
    expect(players).toContain("file: 'game.pal'")
  })

  it('keeps packaging sources free of game content and Windows-only scripts (spec 004)', () => {
    const packaging = files.filter((f) => /^(packaging|tools\/package|tools\/accept|src\/adapters)\//.test(f))
    expect(packaging.filter((f) => /\.(lod|def|pcx|h3m|png|jpg|gif|bmp|ps1|bat|cmd|exe|dll)$/i.test(f))).toEqual([])
    for (const f of packaging) {
      const text = readFileSync(resolve(REPO, f), 'utf8')
      expect(text, f).not.toMatch(/[A-Z]:\\\\(Program Files|Games|Users)/)
    }
    // The proof-of-concept Wallpaper Engine manifest is generated into the package now.
    expect(existsSync(resolve(REPO, 'project.json'))).toBe(false)
  })

  it('removed the Windows-only sync script and keeps third-party notices', () => {
    expect(existsSync(resolve(REPO, 'scripts/sync.js'))).toBe(false)
    const notices = readFileSync(resolve(REPO, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notices).toContain('homm3-parser')
    expect(notices).toContain('src/core/formats/h3m')
  })
})
