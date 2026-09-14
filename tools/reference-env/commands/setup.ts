import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { applyStaging, bundleManifest, planStaging } from '../env/staging.ts'
import { stagingRoot } from '../env/session.ts'
import { ensurePrefix, wineContext } from '../env/wine.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import { resolveMap } from '../store/capture-store.ts'
import { sha256File } from '../store/identity.ts'
import { config, flag, stagedHashes } from './common.ts'
import { SETUP_FILE } from './setup-file.ts'

export const setupCommand: Command = async (args) => {
  const cfg = config()
  if (!existsSync(cfg.bundleDir)) {
    throw new RefError(ERROR_CODES.PREREQ_MISSING, `game folder not found: ${cfg.bundleDir}`)
  }
  mkdirSync(cfg.stateDir, { recursive: true })
  const wine = wineContext(cfg.stateDir, cfg.wineBinary)
  await ensurePrefix(wine, flag(args, 'force'))

  const mapPath = resolveMap('Arrogance.h3m', cfg.mapSearchDirs)
  const root = stagingRoot(cfg.stateDir)
  applyStaging(planStaging(cfg.bundleDir, mapPath), root)
  const hashes = await stagedHashes(cfg)
  const hdExe = join(cfg.bundleDir, 'Heroes3_HD.exe')
  const setup = {
    createdAt: new Date().toISOString(),
    bundleDir: cfg.bundleDir,
    expectedHashes: {
      game: hashes.game,
      editor: hashes.editor,
      hdMod: existsSync(hdExe) ? await sha256File(hdExe) : null,
      archives: hashes.archives,
    },
    bundleManifest: bundleManifest(cfg.bundleDir),
  }
  writeFileSync(join(cfg.stateDir, SETUP_FILE), `${JSON.stringify(setup, null, 2)}\n`)
  log.info('setup complete; next: yarn ref calibrate')
  return { ok: true, prefix: wine.prefix, stagingRoots: [root], hashes: setup.expectedHashes }
}
