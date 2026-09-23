import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { baselineBundleDir, baselineProfile, mapSearchDirs } from '../data/baselines.ts'
import { requireAmendment } from '../env/amendment.ts'
import { applyStaging, bundleManifest, planStaging } from '../env/staging.ts'
import { stagingRoot } from '../env/session.ts'
import { ensurePrefix, wineContext } from '../env/wine.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import { resolveMap } from '../store/capture-store.ts'
import { sha256File } from '../store/identity.ts'
import { baselineOf, config, flag, stagedHashes } from './common.ts'
import { setupFile } from './setup-file.ts'

export const setupCommand: Command = async (args) => {
  const cfg = config()
  const baseline = baselineOf(args)
  requireAmendment(cfg.repoRoot, baseline)
  const profile = baselineProfile(baseline)
  const bundleDir = baselineBundleDir(cfg, baseline)
  if (!existsSync(bundleDir)) {
    throw new RefError(ERROR_CODES.PREREQ_MISSING, `${baseline} game folder not found: ${bundleDir}`)
  }
  mkdirSync(cfg.stateDir, { recursive: true })
  const wine = wineContext(cfg.stateDir, cfg.wineBinary)
  await ensurePrefix(wine, flag(args, 'force'))

  // A map is staged so the layout matches a capture run; each baseline uses one it can open.
  const mapPath = resolveMap(baseline === 'complete' ? 'Arrogance.h3m' : 'test_map_hota.h3m', mapSearchDirs(cfg))
  const root = stagingRoot(cfg.stateDir, baseline)
  applyStaging(planStaging(profile, bundleDir, mapPath), root)
  const hashes = await stagedHashes(cfg, baseline)
  const hdExe = join(bundleDir, 'Heroes3_HD.exe')
  const setup = {
    createdAt: new Date().toISOString(),
    baseline,
    bundleDir,
    expectedHashes: {
      game: hashes.game,
      editor: hashes.editor,
      hdMod: existsSync(hdExe) ? await sha256File(hdExe) : null,
      archives: hashes.archives,
    },
    bundleManifest: bundleManifest(bundleDir),
  }
  writeFileSync(join(cfg.stateDir, setupFile(baseline)), `${JSON.stringify(setup, null, 2)}\n`)
  const suffix = baseline === 'complete' ? '' : ` --baseline ${baseline}`
  log.info(`setup complete; next: yarn ref calibrate${suffix}`)
  return { ok: true, baseline, prefix: wine.prefix, stagingRoots: [root], hashes: setup.expectedHashes }
}
