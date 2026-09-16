import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { forbiddenDlls } from '../analysis/loaddll.ts'
import { CONFIG_FILE } from '../config.ts'
import { EDITOR_EXE, GAME_EXE } from '../data/staging-whitelist.ts'
import { REQUIRED_PROBES, readCalibration } from '../env/calibration.ts'
import { readActiveLock } from '../env/lock.ts'
import { runProcess } from '../env/process.ts'
import { stagingRoot } from '../env/session.ts'
import { bundleManifest, diffManifest, type ManifestEntry } from '../env/staging.ts'
import { wineContext } from '../env/wine.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { DoctorCheck, DoctorReport, FileHash, ReferenceConfig } from '../model/types.ts'
import { resolveMap } from '../store/capture-store.ts'
import { sha256File } from '../store/identity.ts'
import { mapHashChecker, scanRecords } from '../store/lookup.ts'
import { config } from './common.ts'
import { SETUP_FILE } from './setup-file.ts'

interface SetupInfo {
  expectedHashes: { game: string; editor: string; hdMod: string | null; archives: FileHash[] }
  bundleManifest: ManifestEntry[]
}

type Check = (cfg: ReferenceConfig) => Promise<DoctorCheck>

const pass = (id: string, detail: string): DoctorCheck => ({ id, status: 'pass', detail })
const fail = (id: string, detail: string, fix: string): DoctorCheck => ({ id, status: 'fail', detail, fix })
const warn = (id: string, detail: string, fix?: string): DoctorCheck => ({ id, status: 'warn', detail, ...(fix ? { fix } : {}) })

function readSetup(cfg: ReferenceConfig): SetupInfo | undefined {
  const p = join(cfg.stateDir, SETUP_FILE)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as SetupInfo) : undefined
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

async function hashCheck(id: string, file: string, expected: string | undefined): Promise<DoctorCheck> {
  if (expected === undefined) return fail(id, 'no expected hash recorded', 'yarn ref setup')
  if (!existsSync(file)) return fail(id, `${file} missing`, 'yarn ref setup')
  const actual = await sha256File(file)
  return actual === expected ? pass(id, `sha256 ${actual.slice(0, 12)}…`) : fail(id, `hash changed: ${actual.slice(0, 12)}… (expected ${expected.slice(0, 12)}…)`, 'verify the game files were not updated, then yarn ref setup --force && yarn ref calibrate')
}

export const CHECKS: Record<string, Check> = {
  config: async (cfg) => pass('config', `bundleDir=${cfg.bundleDir} stateDir=${cfg.stateDir}`),
  'bundle-found': async (cfg) => {
    if (!existsSync(cfg.bundleDir)) return fail('bundle-found', `${cfg.bundleDir} does not exist`, `set bundleDir in ${CONFIG_FILE} or H3REF_BUNDLE_DIR`)
    const names = readdirSync(cfg.bundleDir).map((n) => n.toLowerCase())
    const missing = [GAME_EXE, EDITOR_EXE, 'data'].filter((n) => !names.includes(n.toLowerCase()))
    return missing.length === 0 ? pass('bundle-found', cfg.bundleDir) : fail('bundle-found', `missing ${missing.join(', ')} in ${cfg.bundleDir}`, 'point bundleDir at the Complete edition folder')
  },
  'game-exe-hash': async (cfg) => hashCheck('game-exe-hash', join(cfg.bundleDir, GAME_EXE), readSetup(cfg)?.expectedHashes.game),
  'editor-exe-hash': async (cfg) => hashCheck('editor-exe-hash', join(cfg.bundleDir, EDITOR_EXE), readSetup(cfg)?.expectedHashes.editor),
  'archives-hash': async (cfg) => {
    const setup = readSetup(cfg)
    if (setup === undefined) return fail('archives-hash', 'no expected hashes recorded', 'yarn ref setup')
    for (const a of setup.expectedHashes.archives) {
      const c = await hashCheck('archives-hash', join(stagingRoot(cfg.stateDir), a.file), a.sha256)
      if (c.status !== 'pass') return { ...c, detail: `${a.file}: ${c.detail}` }
    }
    return pass('archives-hash', `${setup.expectedHashes.archives.length} archives unchanged`)
  },
  'bundle-unchanged': async (cfg) => {
    const setup = readSetup(cfg)
    if (setup === undefined) return fail('bundle-unchanged', 'no manifest recorded', 'yarn ref setup')
    const changed = diffManifest(setup.bundleManifest, bundleManifest(cfg.bundleDir))
    return changed.length === 0 ? pass('bundle-unchanged', 'game folder unchanged since setup') : warn('bundle-unchanged', `changed since setup: ${changed.slice(0, 8).join(', ')}`, 'if intended (e.g. HotA update), rerun yarn ref setup')
  },
  wine: async (cfg) => toolCheck('wine', cfg.wineBinary, ['--version'], 'wine'),
  xvfb: async () => {
    const r = await runProcess('rpm', ['-q', 'xorg-x11-server-Xvfb'], { check: false, timeoutMs: 10_000 }).catch(() => undefined)
    const which = await runProcess('sh', ['-c', 'command -v Xvfb'], { check: false, timeoutMs: 10_000 })
    return which.code === 0 ? pass('xvfb', r?.stdout.toString().trim() || 'Xvfb available') : fail('xvfb', 'Xvfb not found', 'sudo dnf install xorg-x11-server-Xvfb')
  },
  xdotool: async () => toolCheck('xdotool', 'xdotool', ['version'], 'xdotool'),
  ffmpeg: async () => toolCheck('ffmpeg', 'ffmpeg', ['-version'], 'ffmpeg'),
  prefix: async (cfg) => {
    const w = wineContext(cfg.stateDir, cfg.wineBinary)
    return existsSync(join(w.prefix, 'system.reg')) ? pass('prefix', w.prefix) : fail('prefix', 'dedicated Wine prefix missing', 'yarn ref setup')
  },
  'staging-root': async (cfg) => {
    const root = stagingRoot(cfg.stateDir)
    const names = existsSync(root) ? readdirSync(root) : []
    const bad = names.filter((n) => /^(hota|h3hota|_hd3_|hd_|hw_|patcher_x86|heroes3_hd)/i.test(n))
    if (!names.includes(GAME_EXE)) return fail('staging-root', 'staging root not built', 'yarn ref setup')
    return bad.length === 0 ? pass('staging-root', root) : fail('staging-root', `forbidden files staged: ${bad.join(', ')}`, 'yarn ref setup --force')
  },
  'settings-profile': async () => pass('settings-profile', 'game defaults in a clean dedicated prefix (no overrides)'),
  'no-hota-loaded': async (cfg) => {
    const cal = readCalibration(cfg.stateDir)
    if (cal === undefined) return fail('no-hota-loaded', 'no module list recorded yet', 'yarn ref calibrate')
    const bad = forbiddenDlls(cal.loadedDlls, { allowHdMod: true })
    return bad.length === 0 ? pass('no-hota-loaded', `${cal.loadedDlls.length} modules, none from HotA`) : fail('no-hota-loaded', `loaded: ${bad.join(', ')}`, 'yarn ref setup --force')
  },
  'hd-mod-state': async (cfg) => {
    const cal = readCalibration(cfg.stateDir)
    if (cal === undefined) return fail('hd-mod-state', 'no module list recorded yet', 'yarn ref calibrate')
    const hd = forbiddenDlls(cal.loadedDlls, { allowHdMod: false }).filter((n) => !/hota/.test(n))
    return hd.length === 0 && cal.gameExecutable === 'original' ? pass('hd-mod-state', 'HD Mod not loaded (original executable)') : fail('hd-mod-state', `HD Mod modules: ${hd.join(', ')}`, 'yarn ref setup --force')
  },
  calibration: async (cfg) => {
    const cal = readCalibration(cfg.stateDir)
    const setup = readSetup(cfg)
    if (cal === undefined) return fail('calibration', 'not calibrated', 'yarn ref calibrate')
    if (setup !== undefined && cal.gameExeSha256 !== setup.expectedHashes.game) return fail('calibration', 'calibrated for another Heroes3.exe', 'yarn ref calibrate')
    const missing = REQUIRED_PROBES.filter((p) => cal.probes[p] === undefined)
    if (missing.length > 0) return fail('calibration', `calibration lacks probes: ${missing.join(', ')}`, 'yarn ref calibrate')
    return pass('calibration', `measured ${cal.measuredAt}, positioning ${cal.positioningMethod}`)
  },
  'maps-reachable': async (cfg) => {
    const missing: string[] = []
    for (const m of ['Arrogance.h3m', 'По праву силы.h3m']) {
      try {
        resolveMap(m, cfg.mapSearchDirs)
      } catch {
        missing.push(m)
      }
    }
    return missing.length === 0 ? pass('maps-reachable', 'reference maps found') : warn('maps-reachable', `not found: ${missing.join(', ')}`, 'copy them to public/dev-assets/')
  },
  'captures-gitignored': async (cfg) => gitIgnored(cfg, 'captures-gitignored', 'reference-captures/'),
  'captures-map-hash': async (cfg) => {
    const matches = mapHashChecker(cfg.mapSearchDirs)
    const stale = scanRecords(cfg.capturesDir).filter((c) => matches(c.record) === false)
    if (stale.length === 0) return pass('captures-map-hash', 'all captures match their current map files')
    const maps = [...new Set(stale.map((c) => c.record.map.name))]
    return warn('captures-map-hash', `${stale.length} captures were taken from an older version of ${maps.join(', ')}`, 'yarn ref prune --id … (or re-capture)')
  },
  'config-gitignored': async (cfg) => gitIgnored(cfg, 'config-gitignored', CONFIG_FILE),
  lock: async (cfg) => {
    const held = readActiveLock(cfg.stateDir)
    return held === undefined ? pass('lock', 'no capture running') : warn('lock', `capture running: pid ${held.pid} (${held.command})`)
  },
}

export async function runChecks(cfg: ReferenceConfig, ids: string[] = Object.keys(CHECKS)): Promise<DoctorReport> {
  const checks = await Promise.all(
    ids.map(async (id) => {
      const check = CHECKS[id]
      if (check === undefined) return fail(id, 'unknown check', 'fix the check id')
      try {
        return await check(cfg)
      } catch (err) {
        return fail(id, `check crashed: ${(err as Error).message}`, 'run with --log-level debug')
      }
    }),
  )
  return aggregate(checks)
}

export function aggregate(checks: DoctorCheck[]): DoctorReport {
  return { ok: checks.every((c) => c.status !== 'fail'), checks }
}

/** Fails fast with doctor diagnostics before a capture (Story 4 scenario 3). */
export async function requirePrereqs(cfg: ReferenceConfig, ids: string[]): Promise<void> {
  const report = await runChecks(cfg, ids)
  const failed = report.checks.filter((c) => c.status === 'fail')
  if (failed.length > 0) {
    throw new RefError(ERROR_CODES.PREREQ_MISSING, `prerequisites missing: ${failed.map((c) => `${c.id} (${c.detail})`).join('; ')}`, {
      details: { checks: failed },
    })
  }
}

export const doctorCommand: Command = async () => {
  const cfg = config()
  const report = await runChecks(cfg)
  for (const c of report.checks) {
    const line = `${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}${c.fix ? ` → ${c.fix}` : ''}`
    if (c.status === 'fail') log.error(line)
    else if (c.status === 'warn') log.warn(line)
    else log.info(line)
  }
  return { ...report, exitCode: report.ok ? 0 : 3 }
}
