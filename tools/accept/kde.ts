// `yarn accept kde [--apply] [--screen N] [--seconds S] [--keep]` (spec 004 contracts/cli.md, FR-022):
// installs or upgrades the KDE package in the user's Plasma session; with --apply it switches one
// screen to the wallpaper with the development game files, takes a screenshot, and restores the
// previous wallpaper plugin (whose own settings stay untouched in their config group).

import { execFileSync } from 'node:child_process'
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
  const writes = Object.entries(settings)
    .map(([k, v]) => `d.writeConfig(${js(k)}, ${js(v)});`)
    .join(' ')
  try {
    plasmaScript(`var d = desktopForScreen(${screen}); d.wallpaperPlugin = ${js(KDE_PLUGIN_ID)}; d.currentConfigGroup = ["Wallpaper", ${js(KDE_PLUGIN_ID)}, "General"]; ${writes} d.reloadConfig();`)
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
      plasmaScript(`var d = desktopForScreen(${screen}); d.wallpaperPlugin = ${js(previous)};`)
      steps.push({ id: 'restore', outcome: 'pass', evidence: previous })
    }
  }
  return { ok: steps.every((s) => s.outcome !== 'fail'), host: 'kde', steps }
}
