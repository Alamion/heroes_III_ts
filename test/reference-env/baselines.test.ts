// The baseline dimension of the reference environment (spec 005 US4, FR-021, FR-022).

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baselineBundleDir, baselineForMapVersion, baselineProfile, mapSearchDirs, parseBaseline, recordBaseline } from '../../tools/reference-env/data/baselines.ts'
import { amendmentState, requireAmendment } from '../../tools/reference-env/env/amendment.ts'
import { stagingRoot } from '../../tools/reference-env/env/session.ts'
import { calibrationPath } from '../../tools/reference-env/env/calibration.ts'
import { captureDir } from '../../tools/reference-env/store/capture-store.ts'
import { splitByBaseline } from '../../tools/checks/fidelity/captures.ts'
import { ERROR_CODES } from '../../tools/reference-env/errors.ts'
import type { CaptureRecord, ReferenceConfig } from '../../tools/reference-env/model/types.ts'

const repoWith = (constitution: string | null): string => {
  const root = mkdtempSync(join(tmpdir(), 'h3ref-amend-'))
  if (constitution !== null) {
    mkdirSync(join(root, '.specify', 'memory'), { recursive: true })
    writeFileSync(join(root, '.specify', 'memory', 'constitution.md'), constitution)
  }
  return root
}

describe('baselines', () => {
  it('defaults to the Complete edition and rejects an unknown name', () => {
    expect(parseBaseline(undefined)).toBe('complete')
    expect(parseBaseline('hota')).toBe('hota')
    expect(() => parseBaseline('wog')).toThrow(expect.objectContaining({ code: ERROR_CODES.USAGE }))
  })

  it('keeps each baseline in its own game root, calibration and capture namespace', () => {
    expect(stagingRoot('/state', 'complete')).not.toBe(stagingRoot('/state', 'hota'))
    expect(calibrationPath('/state', 'complete')).not.toBe(calibrationPath('/state', 'hota'))
    // Complete-edition captures keep the place they had before the dimension existed.
    expect(captureDir('/c', 'complete', 'm-1234', 0, 'game', 'still', 'id')).toBe('/c/m-1234/0/game-still/id')
    expect(captureDir('/c', 'hota', 'm-1234', 0, 'game', 'still', 'id')).toBe('/c/hota/m-1234/0/game-still/id')
  })

  it('never stages the other build’s files', () => {
    const complete = baselineProfile('complete')
    const hota = baselineProfile('hota')
    expect(complete.whitelist.some((e) => /hota/i.test(e.path))).toBe(false)
    expect(hota.whitelist.some((e) => /^(hd_|_hd3_|hw_)/i.test(e.path))).toBe(false)
    // HotA loads its own modules by design; the Complete edition must load neither those nor HD Mod.
    expect(complete.forbiddenModules.some((p) => p.test('hota.dll'))).toBe(true)
    expect(hota.forbiddenModules.some((p) => p.test('hota.dll'))).toBe(false)
    expect(hota.forbiddenModules.some((p) => p.test('_hd3_.dll'))).toBe(true)
  })

  it('refuses the HotA baseline until the constitution allows it', () => {
    const without = repoWith('# Constitution\n\nII. Fidelity to the Complete Edition.\n')
    expect(amendmentState(without, 'hota').satisfied).toBe(false)
    expect(() => requireAmendment(without, 'hota')).toThrow(expect.objectContaining({ code: ERROR_CODES.PREREQ_MISSING }))
    // The Complete edition needs no amendment, with or without the file.
    expect(() => requireAmendment(repoWith(null), 'complete')).not.toThrow()
    const withClause = repoWith('- **HotA content has its own baseline.** ...\n')
    expect(amendmentState(withClause, 'hota').satisfied).toBe(true)
    expect(() => requireAmendment(withClause, 'hota')).not.toThrow()
  })

  it('says which install a baseline is built from, and refuses when it is not configured', () => {
    const cfg = { bundleDir: '/games/complete', hotaBundleDir: undefined } as unknown as ReferenceConfig
    expect(baselineBundleDir(cfg, 'complete')).toBe('/games/complete')
    expect(() => baselineBundleDir(cfg, 'hota')).toThrow(expect.objectContaining({ code: ERROR_CODES.PREREQ_MISSING }))
    expect(baselineBundleDir({ ...cfg, hotaBundleDir: '/games/hota' }, 'hota')).toBe('/games/hota')
  })

  it('looks maps up in every configured install, so a HotA-only map is found', () => {
    const cfg = { mapSearchDirs: ['/repo/public/dev-assets'], bundleDir: '/games/complete', hotaBundleDir: '/games/hota' } as unknown as ReferenceConfig
    expect(mapSearchDirs(cfg)).toEqual(['/repo/public/dev-assets', '/games/complete/Maps', '/games/hota/Maps'])
    // Without a HotA install configured its folder is simply absent, and nothing is duplicated.
    expect(mapSearchDirs({ ...cfg, hotaBundleDir: undefined } as unknown as ReferenceConfig)).toEqual(['/repo/public/dev-assets', '/games/complete/Maps'])
    expect(mapSearchDirs({ ...cfg, mapSearchDirs: ['/games/hota/Maps'] } as unknown as ReferenceConfig)).toEqual(['/games/hota/Maps', '/games/complete/Maps'])
  })

  it('derives the baseline from the map format: only HotA opens a HotA map', () => {
    expect(baselineForMapVersion('SoD')).toBe('complete')
    expect(baselineForMapVersion('RoE')).toBe('complete')
    expect(baselineForMapVersion('HotA')).toBe('hota')
  })

  it('compares a view only against captures of its own baseline', () => {
    const rec = (baseline?: 'complete' | 'hota'): { record: CaptureRecord } =>
      ({ record: { ...(baseline !== undefined ? { baseline } : {}) } as CaptureRecord })
    const candidates = [rec('hota'), rec('complete'), rec()]
    // A record written before the dimension existed counts as a Complete-edition capture.
    expect(recordBaseline(candidates[2]!.record)).toBe('complete')
    expect(splitByBaseline(candidates, 'hota').matching).toHaveLength(1)
    expect(splitByBaseline(candidates, 'hota').otherBaseline).toHaveLength(2)
    expect(splitByBaseline(candidates, 'complete').matching).toHaveLength(2)
  })
})
