// `yarn accept kde [--apply] [--screen N] [--seconds S] [--keep] [--no-restart]` (spec 004
// contracts/cli.md, FR-022): installs or upgrades the KDE package in the user's Plasma session and
// restarts plasmashell after an upgrade, because an open wallpaper page keeps running the old
// script until then (measured 2026-09-23: not even `location.reload()` picks up the new one). With
// --apply it switches one screen to the wallpaper with the development game files, takes a
// screenshot, and restores both the previous wallpaper plugin and every setting it wrote.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { log } from '../../src/core/util/log.ts'
import { flag, intOpt } from '../shared/cli-runner.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { requireGameFile, requireTestMap } from '../shared/game-files.ts'
import { artifactName, assemble, packageVersion, writePackage } from '../package/cli.ts'
import { KDE_PLUGIN_ID } from '../package/manifests/kde.ts'

type Outcome = 'pass' | 'fail' | 'manual' | 'skip'
interface Step {
  id: string
  outcome: Outcome
  evidence: string
}

function has(cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Runs a Plasma shell script and returns what it printed. */
export function plasmaScript(script: string): string {
  const out = execFileSync('gdbus', ['call', '--session', '--dest', 'org.kde.plasmashell', '--object-path', '/PlasmaShell', '--method', 'org.kde.PlasmaShell.evaluateScript', script], { encoding: 'utf8', timeout: 30_000 })
  // gdbus prints a GVariant tuple: ('printed text',)
  const m = /^\('([\s\S]*)',\)\s*$/.exec(out.trim())
  return (m?.[1] ?? out).replace(/\\n/g, '\n').replace(/\\'/g, "'")
}

const js = (v: unknown): string => JSON.stringify(v)

const SHELL_UNIT = 'plasma-plasmashell.service'

function shellRunning(): boolean {
  try {
    execFileSync('pgrep', ['-x', 'plasmashell'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Whether plasmashell answers scripting calls on the session bus. */
function shellAnswers(): boolean {
  try {
    plasmaScript('print("ok")')
    return true
  } catch {
    return false
  }
}

function unitLoaded(): boolean {
  try {
    return execFileSync('systemctl', ['--user', 'show', '-p', 'LoadState', '--value', SHELL_UNIT], { encoding: 'utf8' }).trim() === 'loaded'
  } catch {
    return false
  }
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return check()
}

/**
 * Quits plasmashell and starts it again, through its systemd unit when the session has one (Plasma 6
 * on systemd) so a shell that was started by hand goes back under the unit, else as a detached
 * process. Resolves once the new shell answers scripting calls.
 */
async function restartShell(): Promise<Step> {
  if (!has('kquitapp6')) return { id: 'restart-shell', outcome: 'fail', evidence: 'kquitapp6 not found; restart plasmashell yourself, or the open wallpaper keeps its old code' }
  try {
    execFileSync('kquitapp6', ['plasmashell'], { stdio: 'ignore', timeout: 30_000 })
  } catch {
    // Already gone, or it refused; the wait below decides.
  }
  if (!(await waitFor(() => !shellRunning(), 20_000))) return { id: 'restart-shell', outcome: 'fail', evidence: 'plasmashell did not quit within 20 s' }
  const viaUnit = unitLoaded()
  if (viaUnit) execFileSync('systemctl', ['--user', 'start', SHELL_UNIT], { stdio: 'ignore', timeout: 30_000 })
  else spawn('plasmashell', [], { detached: true, stdio: 'ignore' }).unref()
  const up = await waitFor(shellAnswers, 60_000)
  return up
    ? { id: 'restart-shell', outcome: 'pass', evidence: viaUnit ? `restarted through ${SHELL_UNIT}` : 'restarted as a detached process (no systemd unit)' }
    : { id: 'restart-shell', outcome: 'fail', evidence: 'plasmashell did not come back within 60 s' }
}

export async function acceptKdeCommand(args: ParsedArgs): Promise<CommandResult> {
  const steps: Step[] = []
  const repoRoot = process.cwd()
  if (!has('kpackagetool6')) return { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'kpackagetool6 not found', steps }
  const version = packageVersion(repoRoot)
  const outDir = resolve(repoRoot, 'dist/packages')
  writePackage(outDir, 'kde', await assemble(repoRoot, 'kde'), version)
  const archive = join(outDir, artifactName('kde', version))

  const installed = (() => {
    try {
      execFileSync('kpackagetool6', ['-t', 'Plasma/Wallpaper', '-s', KDE_PLUGIN_ID], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  try {
    execFileSync('kpackagetool6', ['-t', 'Plasma/Wallpaper', installed ? '-u' : '-i', archive], { stdio: 'pipe', timeout: 60_000 })
    steps.push({ id: installed ? 'upgrade' : 'install', outcome: 'pass', evidence: archive })
  } catch (err) {
    steps.push({ id: installed ? 'upgrade' : 'install', outcome: 'fail', evidence: String((err as { stderr?: Buffer }).stderr ?? err) })
    return { ok: false, host: 'kde', steps }
  }

  // A fresh install has no page running old code; an upgrade does, until the shell restarts.
  if (installed && shellRunning()) {
    if (flag(args, 'no-restart')) {
      steps.push({ id: 'restart-shell', outcome: 'manual', evidence: 'skipped (--no-restart): an open wallpaper keeps running the previous code until plasmashell restarts' })
    } else {
      const restarted = await restartShell()
      steps.push(restarted)
      if (restarted.outcome === 'fail') return { ok: false, host: 'kde', steps }
    }
  }

  if (!flag(args, 'apply')) {
    steps.push({ id: 'apply', outcome: 'manual', evidence: 'run with --apply to switch a screen to the wallpaper, or pick it in "Configure Desktop and Wallpaper"' })
    return { ok: true, host: 'kde', steps }
  }
  if (!has('gdbus')) return { ok: false, host: 'kde', steps: [...steps, { id: 'apply', outcome: 'fail', evidence: 'gdbus not found' }] }

  const sprite = requireGameFile('h3sprite.lod')
  const data = requireGameFile('h3bitmap.lod')
  const map = requireTestMap()
  if (sprite === null || data === null || map === null) return { ok: false, exitCode: 3, host: 'kde', steps: [...steps, { id: 'apply', outcome: 'skip', evidence: 'development game files missing' }] }

  const screen = intOpt(args, 'screen', 0)
  const seconds = intOpt(args, 'seconds', 20)
  const previous = plasmaScript(`var d = desktopForScreen(${screen}); print(d ? d.wallpaperPlugin : "");`).trim()
  if (previous === '') return { ok: false, host: 'kde', steps: [...steps, { id: 'apply', outcome: 'fail', evidence: `no desktop on screen ${screen}` }] }
  steps.push({ id: 'save-previous', outcome: 'pass', evidence: previous })

  const settings: Record<string, string | number | boolean> = {
    spritearchive: pathToFileURL(sprite).href,
    dataarchive: pathToFileURL(data).href,
    mapfile: pathToFileURL(map).href,
    viewmode: 'random',
  }
  const group = `d.currentConfigGroup = ["Wallpaper", ${js(KDE_PLUGIN_ID)}, "General"];`
  // The dev files go into the same config group as the owner's own settings for this plugin, so
  // every key written here is read first and written back afterwards.
  const savedRaw = plasmaScript(`var d = desktopForScreen(${screen}); ${group} var o = {}; ${Object.keys(settings).map((k) => `o[${js(k)}] = d.readConfig(${js(k)});`).join(' ')} print(JSON.stringify(o));`).trim()
  let saved: Record<string, unknown>
  try {
    saved = JSON.parse(savedRaw) as Record<string, unknown>
  } catch {
    return { ok: false, host: 'kde', steps: [...steps, { id: 'save-previous', outcome: 'fail', evidence: `could not read the screen's settings: ${savedRaw.slice(0, 200)}` }] }
  }
  steps.push({ id: 'save-settings', outcome: 'pass', evidence: Object.keys(saved).join(', ') })
  const writes = Object.entries(settings)
    .map(([k, v]) => `d.writeConfig(${js(k)}, ${js(v)});`)
    .join(' ')
  try {
    plasmaScript(`var d = desktopForScreen(${screen}); d.wallpaperPlugin = ${js(KDE_PLUGIN_ID)}; ${group} ${writes} d.reloadConfig();`)
    steps.push({ id: 'apply', outcome: 'pass', evidence: `screen ${screen}` })
    log.info(`waiting ${seconds} s for the wallpaper to load`)
    await new Promise((r) => setTimeout(r, seconds * 1000))
    if (has('spectacle')) {
      const dir = join(repoRoot, 'check-reports', 'accept', new Date().toISOString().replace(/[:.]/g, '-'))
      mkdirSync(dir, { recursive: true })
      const shot = join(dir, 'kde-desktop.png')
      try {
        execFileSync('spectacle', ['-b', '-n', '-f', '-o', shot], { stdio: 'ignore', timeout: 30_000 })
        steps.push({ id: 'screenshot', outcome: existsSync(shot) ? 'pass' : 'fail', evidence: shot })
      } catch (err) {
        steps.push({ id: 'screenshot', outcome: 'fail', evidence: String(err) })
      }
    }
    steps.push(
      { id: 'settings', outcome: 'manual', evidence: 'change level, view mode, sliders, scale, objects in the settings page; each applies after Apply' },
      { id: 'pause', outcome: 'manual', evidence: 'maximize a window: QtWebEngineProcess CPU drops to idle; lock the screen: plain background' },
      { id: 'second-screen', outcome: 'manual', evidence: 'a second screen with the wallpaper starts without a second long load' },
      { id: 'language', outcome: 'manual', evidence: 'system language Russian: the settings page is Russian' },
    )
  } finally {
    if (!flag(args, 'keep')) {
      // Unset keys read back as "" and are written back as "", which the plugin treats as unset.
      const restores = Object.entries(saved)
        .map(([k, v]) => `d.writeConfig(${js(k)}, ${js(v ?? '')});`)
        .join(' ')
      plasmaScript(`var d = desktopForScreen(${screen}); ${group} ${restores} d.wallpaperPlugin = ${js(previous)}; d.reloadConfig();`)
      steps.push({ id: 'restore', outcome: 'pass', evidence: `${previous}, settings ${Object.keys(saved).join(', ')}` })
    }
  }
  return { ok: steps.every((s) => s.outcome !== 'fail'), host: 'kde', steps }
}
