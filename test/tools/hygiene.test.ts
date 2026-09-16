// Repository hygiene (constitution I, spec FR-027/FR-028): no game files or derived data tracked,
// the Windows-only sync script gone, attribution present.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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
    const images = files.filter((f) => /\.png$/i.test(f))
    expect(images).toEqual([])
  })

  it('stores flag colours as palette entries only (spec 003, constitution I)', () => {
    const players = readFileSync(resolve(REPO, 'src/core/data/players.ts'), 'utf8')
    // No RGB triples: colours are read from the user's game.pal at run time.
    expect(players).not.toMatch(/\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\]/)
    expect(players).toContain("file: 'game.pal'")
  })

  it('removed the Windows-only sync script and keeps third-party notices', () => {
    expect(existsSync(resolve(REPO, 'scripts/sync.js'))).toBe(false)
    const notices = readFileSync(resolve(REPO, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notices).toContain('homm3-parser')
    expect(notices).toContain('src/core/formats/h3m')
  })
})
