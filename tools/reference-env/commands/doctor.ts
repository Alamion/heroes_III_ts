import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { forbiddenDlls } from '../analysis/loaddll.ts'
import { CONFIG_FILE } from '../config.ts'
import { CONSTITUTION_PATH, amendmentState } from '../env/amendment.ts'
import { baselineBundleDir, baselineProfile, type BaselineProfile } from '../data/baselines.ts'
import { REQUIRED_PROBES, readCalibration } from '../env/calibration.ts'
import { readActiveLock } from '../env/lock.ts'
import { runProcess } from '../env/process.ts'
import { stagingRoot } from '../env/session.ts'
import { bundleManifest, diffManifest, type ManifestEntry } from '../env/staging.ts'
import { wineContext } from '../env/wine.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { Baseline, DoctorCheck, DoctorReport, FileHash, ReferenceConfig } from '../model/types.ts'
import { resolveMap } from '../store/capture-store.ts'
import { sha256File } from '../store/identity.ts'
import { mapHashChecker, scanRecords } from '../store/lookup.ts'
import { baselineOf, config } from './common.ts'
import { setupFile } from './setup-file.ts'

interface SetupInfo {
  expectedHashes: { game: string; editor: string; hdMod: string | null; archives: FileHash[] }
  bundleManifest: ManifestEntry[]
}

interface Ctx {
  cfg: ReferenceConfig
  baseline: Baseline
  profile: BaselineProfile
  /** The install this baseline is built from, or undefined when it is not configured. */
  bundleDir: string | undefined
}

type Check = (c: Ctx) => Promise<DoctorCheck>

const pass = (id: string, detail: string): DoctorCheck => ({ id, status: 'pass', detail })
const fail = (id: string, detail: string, fix: string): DoctorCheck => ({ id, status: 'fail', detail, fix })
const warn = (id: string, detail: string, fix?: string): DoctorCheck => ({ id, status: 'warn', detail, ...(fix ? { fix } : {}) })

function readSetup(c: Ctx): SetupInfo | undefined {
  const p = join(c.cfg.stateDir, setupFile(c.baseline))
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as SetupInfo) : undefined
}

/** `yarn ref <command>` for this baseline, as printed in fixes. */
function refCmd(c: Ctx, command: string): string {
  return c.baseline === 'complete' ? `yarn ref ${command}` : `yarn ref ${command} --baseline ${c.baseline}`
}

async function toolCheck(id: string, cmd: string, args: string[], pkg: string): Promise<DoctorCheck> {
  try {
    const r = await runProcess(cmd, args, { check: false, timeoutMs: 10_000 })
    const line = (r.stdout.toString() || r.stderr).split('\n').find((l) => l.trim()) ?? ''
    return pass(id, line.trim() || `${cmd} available`)
  } catch {
    return fail(id, `${cmd} not found`, `sudo dnf install ${pkg}`)
  }
}

async function gitIgnored(cfg: ReferenceConfig, id: string, path: string): Promise<DoctorCheck> {
  const r = await runProcess('git', ['-C', cfg.repoRoot, 'check-ignore', '-q', '--no-index', path], { check: false, timeoutMs: 10_000 })
  return r.code === 0 ? pass(id, `${path} is git-ignored`) : fail(id, `${path} is not git-ignored`, `add ${path} to .gitignore`)
}

async function hashCheck(id: string, file: string, expected: string | undefined, setupCmd: string): Promise<DoctorCheck> {
  if (expected === undefined) return fail(id, 'no expected hash recorded', setupCmd)
  if (!existsSync(file)) return fail(id, `${file} missing`, setupCmd)
  const actual = await sha256File(file)
  return actual === expected ? pass(id, `sha256 ${actual.slice(0, 12)}…`) : fail(id, `hash changed: ${actual.slice(0, 12)}… (expected ${expected.slice(0, 12)}…)`, `verify the game files were not updated, then ${setupCmd} --force && ${setupCmd.replace('setup', 'calibrate')}`)
}

export const CHECKS: Record<string, Check> = {
  config: async (c) => pass('config', `baseline=${c.baseline} bundleDir=${c.bundleDir ?? '(not set)'} stateDir=${c.cfg.stateDir}`),
  amendment: async (c) => {
    const state = amendmentState(c.cfg.repoRoot, c.baseline)
    if (!state.required) return pass('amendment', state.detail)
    return state.satisfied ? pass('amendment', state.detail) : fail('amendment', state.detail, `amend ${CONSTITUTION_PATH} (owner decision) before capturing from ${c.baseline}`)
  },
  'bundle-found': async (c) => {
    if (c.bundleDir === undefined) {
      return fail('bundle-found', `no install configured for the ${c.baseline} baseline`, `set hotaBundleDir in ${CONFIG_FILE} or H3REF_HOTA_BUNDLE_DIR`)
    }
    if (!existsSync(c.bundleDir)) return fail('bundle-found', `${c.bundleDir} does not exist`, `set the ${c.baseline} install folder in ${CONFIG_FILE}`)
    const names = readdirSync(c.bundleDir).map((n) => n.toLowerCase())
    const missing = [c.profile.gameExe, c.profile.editorExe, 'data'].filter((n) => !names.includes(n.toLowerCase()))
    return missing.length === 0 ? pass('bundle-found', c.bundleDir) : fail('bundle-found', `missing ${missing.join(', ')} in ${c.bundleDir}`, `point the ${c.baseline} install folder at a ${c.profile.label} installation`)
  },
  'game-exe-hash': async (c) => hashCheck('game-exe-hash', join(c.bundleDir ?? '', c.profile.gameExe), readSetup(c)?.expectedHashes.game, refCmd(c, 'setup')),
  'editor-exe-hash': async (c) => hashCheck('editor-exe-hash', join(c.bundleDir ?? '', c.profile.editorExe), readSetup(c)?.expectedHashes.editor, refCmd(c, 'setup')),
  'archives-hash': async (c) => {
    const setup = readSetup(c)
    if (setup === undefined) return fail('archives-hash', 'no expected hashes recorded', refCmd(c, 'setup'))
    for (const a of setup.expectedHashes.archives) {
      const check = await hashCheck('archives-hash', join(stagingRoot(c.cfg.stateDir, c.baseline), a.file), a.sha256, refCmd(c, 'setup'))
      if (check.status !== 'pass') return { ...check, detail: `${a.file}: ${check.detail}` }
    }
    return pass('archives-hash', `${setup.expectedHashes.archives.length} archives unchanged`)
  },
  'bundle-unchanged': async (c) => {
    const setup = readSetup(c)
    if (setup === undefined) return fail('bundle-unchanged', 'no manifest recorded', refCmd(c, 'setup'))
    const changed = diffManifest(setup.bundleManifest, bundleManifest(c.bundleDir ?? ''))
    return changed.length === 0 ? pass('bundle-unchanged', 'game folder unchanged since setup') : warn('bundle-unchanged', `changed since setup: ${changed.slice(0, 8).join(', ')}`, `if intended (e.g. a game update), rerun ${refCmd(c, 'setup')}`)
  },
  wine: async (c) => toolCheck('wine', c.cfg.wineBinary, ['--version'], 'wine'),
  xvfb: async () => {
    const r = await runProcess('rpm', ['-q', 'xorg-x11-server-Xvfb'], { check: false, timeoutMs: 10_000 }).catch(() => undefined)
    const which = await runProcess('sh', ['-c', 'command -v Xvfb'], { check: false, timeoutMs: 10_000 })
    return which.code === 0 ? pass('xvfb', r?.stdout.toString().trim() || 'Xvfb available') : fail('xvfb', 'Xvfb not found', 'sudo dnf install xorg-x11-server-Xvfb')
  },
  xdotool: async () => toolCheck('xdotool', 'xdotool', ['version'], 'xdotool'),
  ffmpeg: async () => toolCheck('ffmpeg', 'ffmpeg', ['-version'], 'ffmpeg'),
  prefix: async (c) => {
    const w = wineContext(c.cfg.stateDir, c.cfg.wineBinary)
    return existsSync(join(w.prefix, 'system.reg')) ? pass('prefix', w.prefix) : fail('prefix', 'dedicated Wine prefix missing', refCmd(c, 'setup'))
  },
  'staging-root': async (c) => {
    const root = stagingRoot(c.cfg.stateDir, c.baseline)
    const names = existsSync(root) ? readdirSync(root) : []
    const bad = names.filter((n) => c.profile.neverStage.some((p) => p.test(n)))
    if (!names.includes(c.profile.gameExe)) return fail('staging-root', `staging root not built for ${c.baseline}`, refCmd(c, 'setup'))
    return bad.length === 0 ? pass('staging-root', root) : fail('staging-root', `files forbidden for the ${c.baseline} baseline staged: ${bad.join(', ')}`, `${refCmd(c, 'setup')} --force`)
  },
  'settings-profile': async () => pass('settings-profile', 'game defaults in a clean dedicated prefix (no overrides)'),
  'modules-allowed': async (c) => {
    const cal = readCalibration(c.cfg.stateDir, c.baseline)
    if (cal === undefined) return fail('modules-allowed', 'no module list recorded yet', refCmd(c, 'calibrate'))
    const bad = forbiddenDlls(cal.loadedDlls, c.profile)
    return bad.length === 0
      ? pass('modules-allowed', `${cal.loadedDlls.length} modules, none forbidden for ${c.baseline}`)
      : fail('modules-allowed', `loaded: ${bad.join(', ')}`, `${refCmd(c, 'setup')} --force`)
  },
  calibration: async (c) => {
    const cal = readCalibration(c.cfg.stateDir, c.baseline)
    const setup = readSetup(c)
    if (cal === undefined) return fail('calibration', `not calibrated for ${c.baseline}`, refCmd(c, 'calibrate'))
    if (setup !== undefined && cal.gameExeSha256 !== setup.expectedHashes.game) return fail('calibration', `calibrated for another ${c.profile.gameExe}`, refCmd(c, 'calibrate'))
    const missing = REQUIRED_PROBES.filter((p) => cal.probes[p] === undefined)
    if (missing.length > 0) return fail('calibration', `calibration lacks probes: ${missing.join(', ')}`, refCmd(c, 'calibrate'))
    return pass('calibration', `measured ${cal.measuredAt}, positioning ${cal.positioningMethod}`)
  },
  'maps-reachable': async (c) => {
    const missing: string[] = []
    for (const m of REFERENCE_MAPS[c.baseline]) {
      try {
        resolveMap(m, c.cfg.mapSearchDirs)
      } catch {
        missing.push(m)
      }
    }
    return missing.length === 0 ? pass('maps-reachable', 'reference maps found') : warn('maps-reachable', `not found: ${missing.join(', ')}`, 'copy them to public/dev-assets/')
  },
  'captures-gitignored': async (c) => gitIgnored(c.cfg, 'captures-gitignored', 'reference-captures/'),
  'captures-map-hash': async (c) => {
    const matches = mapHashChecker(c.cfg.mapSearchDirs)
    const stale = scanRecords(c.cfg.capturesDir).filter((x) => matches(x.record) === false)
    if (stale.length === 0) return pass('captures-map-hash', 'all captures match their current map files')
    const maps = [...new Set(stale.map((x) => x.record.map.name))]
    return warn('captures-map-hash', `${stale.length} captures were taken from an older version of ${maps.join(', ')}`, 'yarn ref prune --id … (or re-capture)')
  },
  'config-gitignored': async (c) => gitIgnored(c.cfg, 'config-gitignored', CONFIG_FILE),
  lock: async (c) => {
    const held = readActiveLock(c.cfg.stateDir)
    return held === undefined ? pass('lock', 'no capture running') : warn('lock', `capture running: pid ${held.pid} (${held.command})`)
  },
}

/** Maps each baseline needs locally; the HotA ones only the HotA build can open. */
const REFERENCE_MAPS: Record<Baseline, readonly string[]> = {
  complete: ['Arrogance.h3m'],
  hota: ['test_map_hota.h3m', 'По праву силы.h3m'],
}

function context(cfg: ReferenceConfig, baseline: Baseline): Ctx {
  let bundleDir: string | undefined
  try {
    bundleDir = baselineBundleDir(cfg, baseline)
  } catch {
    bundleDir = undefined
  }
  return { cfg, baseline, profile: baselineProfile(baseline), bundleDir }
}

export async function runChecks(cfg: ReferenceConfig, baseline: Baseline, ids: string[] = Object.keys(CHECKS)): Promise<DoctorReport> {
  const c = context(cfg, baseline)
  const checks = await Promise.all(
    ids.map(async (id) => {
      const check = CHECKS[id]
      if (check === undefined) return fail(id, 'unknown check', 'fix the check id')
      try {
        return await check(c)
      } catch (err) {
        return fail(id, `check crashed: ${(err as Error).message}`, 'run with --log-level debug')
      }
    }),
  )
  return aggregate(checks)
}

export function aggregate(checks: DoctorCheck[]): DoctorReport {
  return { ok: checks.every((x) => x.status !== 'fail'), checks }
}

/** Fails fast with doctor diagnostics before a capture (Story 4 scenario 3). */
export async function requirePrereqs(cfg: ReferenceConfig, baseline: Baseline, ids: string[]): Promise<void> {
  const report = await runChecks(cfg, baseline, ids)
  const failed = report.checks.filter((c) => c.status === 'fail')
  if (failed.length > 0) {
    throw new RefError(ERROR_CODES.PREREQ_MISSING, `prerequisites missing: ${failed.map((c) => `${c.id} (${c.detail})`).join('; ')}`, {
      details: { baseline, checks: failed },
    })
  }
}

export const doctorCommand: Command = async (args) => {
  const cfg = config()
  const baseline = baselineOf(args)
  const report = await runChecks(cfg, baseline)
  for (const c of report.checks) {
    const line = `${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}${c.fix ? ` → ${c.fix}` : ''}`
    if (c.status === 'fail') log.error(line)
    else if (c.status === 'warn') log.warn(line)
    else log.info(line)
  }
  return { ...report, baseline, exitCode: report.ok ? 0 : 3 }
}
