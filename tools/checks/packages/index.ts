// `yarn verify packages [--host …] [--no-build] [--reproducible]` (spec 004 contracts/cli.md,
// FR-020): static checks of built packages — completeness, no game content, no external URLs, no
// affiliation wording, strings, manifests, classic flavour, CSP, size, KDE validity, reproducibility.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { ACTIONS, SETTINGS } from '../../../src/adapters/shared/settings.ts'
import { en, ru } from '../../../src/adapters/shared/strings.ts'
import { AUTHOR, ISSUES_URL, NEW_ISSUE_URL, projectUrls, REPOSITORY_URL, WORKSHOP_ID } from '../../../src/adapters/shared/project.ts'
import { livelyVersion, parseVersion } from '../../release/semver.ts'
import { BUILTIN_LABELS, DISPLAY_KEYS } from '../../package/manifests/wallpaper-engine.ts'
import { flag, opt } from '../../shared/cli-runner.ts'
import type { CommandResult, ParsedArgs } from '../../shared/cli-runner.ts'
import type { HostId, PackageFiles } from '../../package/build.ts'
import { FLAVOUR } from '../../package/build.ts'
import { artifactName, assemble, packageHash, packageVersion, parseHosts, runtimeGzipBytes, writePackage } from '../../package/cli.ts'

export const RUNTIME_LIMIT_GZIP_BYTES = 102_400
export const MAX_FILE_BYTES = 2 * 1024 * 1024

export const REQUIRED_FILES: Record<HostId, readonly string[]> = {
  web: ['index.html', 'favicon.svg'],
  'wallpaper-engine': ['index.html', 'listener.js', 'main.js', 'page.css', 'project.json', 'preview.png', 'README.txt'],
  lively: ['index.html', 'listener.js', 'main.js', 'page.css', 'LivelyInfo.json', 'LivelyInfo.loc.json', 'LivelyProperties.json', 'LivelyProperties.loc.json', 'userfiles/.keep', 'preview.png', 'thumbnail.png', 'README.txt'],
  kde: ['metadata.json', 'contents/ui/main.qml', 'contents/ui/WebView.qml', 'contents/ui/config.qml', 'contents/ui/strings.js', 'contents/config/main.xml', 'contents/web/index.html', 'contents/web/main.js', 'contents/web/page.css', 'README.md'],
}

/** Extensions of game archives, sprites, maps, saves, palettes and fonts. */
const GAME_EXTENSIONS = ['.lod', '.snd', '.vid', '.def', '.pcx', '.h3m', '.h3c', '.gm1', '.gm2', '.cgm', '.pal', '.msk', '.fnt', '.p32', '.d32', '.bik', '.smk', '.82m', '.wav']
const TEXT_EXTENSIONS = ['.html', '.js', '.css', '.json', '.qml', '.xml', '.txt', '.md']
/** Absolute URLs allowed in shipped text: XML namespaces, and exactly the project's own links (spec 006 R4). */
const ALLOWED_URLS = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/www\.kde\.org\/standards\/kcfg\//]
// Sentence punctuation after a URL in prose is not part of it.
const trimSlash = (u: string): string => u.replace(/[.,;:!?]+$/, '').replace(/\/+$/, '')
const PROJECT_URLS = new Set(projectUrls().map(trimSlash))
const allowedUrl = (u: string): boolean => ALLOWED_URLS.some((re) => re.test(u)) || PROJECT_URLS.has(trimSlash(u))
const AFFILIATION = [/ubisoft/i, /\b3do\b/i, /new world computing/i, /\bnwc\b/i, /\bofficial\b/i, /licensed by/i, /endorsed by/i]

export interface CheckOutcome {
  id: string
  outcome: 'pass' | 'fail' | 'skip'
  details: string[]
}

const ext = (path: string): string => {
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i).toLowerCase()
}
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

function outcome(id: string, details: string[], skip = false): CheckOutcome {
  return { id, outcome: skip ? 'skip' : details.length === 0 ? 'pass' : 'fail', details }
}

export function readPackageDir(dir: string): PackageFiles {
  const out: PackageFiles = new Map()
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.set(relative(dir, full).split(sep).join('/'), new Uint8Array(readFileSync(full)))
    }
  }
  walk(dir)
  return out
}

export function checkRequired(host: HostId, files: PackageFiles): CheckOutcome {
  const details = REQUIRED_FILES[host].filter((f) => !files.has(f)).map((f) => `missing ${f}`)
  if (host === 'web' && ![...files.keys()].some((f) => f.startsWith('assets/') && f.endsWith('.js'))) details.push('missing assets/*.js')
  return outcome('required-files', details)
}

export function checkNoGameContent(files: PackageFiles): CheckOutcome {
  const details: string[] = []
  for (const [path, bytes] of files) {
    if (GAME_EXTENSIONS.includes(ext(path))) details.push(`${path}: game file extension`)
    if (bytes.length >= 4 && bytes[0] === 0x4c && bytes[1] === 0x4f && bytes[2] === 0x44 && bytes[3] === 0) details.push(`${path}: LOD archive signature`)
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) details.push(`${path}: gzip data (maps are gzip)`)
    if (bytes.length > MAX_FILE_BYTES) details.push(`${path}: ${bytes.length} bytes, larger than ${MAX_FILE_BYTES}`)
  }
  return outcome('no-game-content', details)
}

export function checkNoExternalUrls(files: PackageFiles): CheckOutcome {
  const details: string[] = []
  for (const [path, bytes] of files) {
    if (!TEXT_EXTENSIONS.includes(ext(path))) continue
    for (const m of text(bytes).matchAll(/\b(?:https?|wss?):\/\/[^\s"'`)<>\\]+/g)) {
      if (!allowedUrl(m[0])) details.push(`${path}: ${m[0]}`)
    }
  }
  return outcome('no-external-urls', details)
}

export function checkNoAffiliation(files: PackageFiles): CheckOutcome {
  const details: string[] = []
  for (const [path, bytes] of files) {
    // Manifests, pages and documentation carry names and descriptions; bundles only repeat strings.
    if (!['.html', '.json', '.txt', '.md', '.qml', '.xml'].includes(ext(path))) continue
    const t = text(bytes)
    for (const re of AFFILIATION) if (re.test(t)) details.push(`${path}: matches ${re}`)
  }
  return outcome('no-affiliation', details)
}

export function checkStrings(): CheckOutcome {
  const details: string[] = []
  const keys = Object.keys(en) as (keyof typeof en)[]
  for (const k of keys) if (typeof ru[k] !== 'string' || ru[k].trim() === '') details.push(`ru missing ${k}`)
  for (const k of Object.keys(ru)) if (!(k in en)) details.push(`ru has extra key ${k}`)
  return outcome('strings-complete', details)
}

/** Manifest settings keys must equal the settings definition; localized text complete. */
export function checkManifests(host: HostId, files: PackageFiles): CheckOutcome {
  const details: string[] = []
  const keys = [...SETTINGS, ...ACTIONS].map((d) => d.key).sort()
  const same = (label: string, found: string[]) => {
    if (JSON.stringify([...found].sort()) !== JSON.stringify(keys)) details.push(`${label} keys ${JSON.stringify(found.sort())} differ from settings ${JSON.stringify(keys)}`)
  }
  const json = (path: string): Record<string, unknown> | undefined => {
    const b = files.get(path)
    return b === undefined ? undefined : (JSON.parse(text(b)) as Record<string, unknown>)
  }
  if (host === 'wallpaper-engine') {
    const pj = json('project.json') as { general?: { properties?: Record<string, { text: string; options?: { label: string }[] }>; localization?: Record<string, Record<string, string>> } } | undefined
    const props = pj?.general?.properties ?? {}
    // The notice and spacer paragraphs are display elements, not settings (like Lively's labels).
    same('project.json', Object.keys(props).filter((k) => !DISPLAY_KEYS.includes(k)))
    for (const key of DISPLAY_KEYS) if (props[key]?.text === undefined) details.push(`project.json lacks the display element ${key}`)
    for (const locale of ['en-us', 'ru-ru']) {
      const table = pj?.general?.localization?.[locale] ?? {}
      for (const p of Object.values(props)) for (const t of [p.text, ...(p.options ?? []).map((o) => o.label)]) if (!BUILTIN_LABELS.includes(t) && (typeof table[t] !== 'string' || table[t] === '')) details.push(`project.json ${locale} missing ${t}`)
    }
  } else if (host === 'lively') {
    const props = (json('LivelyProperties.json') ?? {}) as Record<string, { type: string; items?: string[] }>
    same('LivelyProperties.json', Object.keys(props).filter((k) => props[k]?.type !== 'label'))
    const loc = (json('LivelyProperties.loc.json') as { Languages?: Record<string, Record<string, { text?: string; items?: string[] }>> } | undefined)?.Languages?.ru ?? {}
    for (const [k, p] of Object.entries(props)) {
      if (typeof loc[k]?.text !== 'string') details.push(`LivelyProperties.loc.json ru missing ${k}`)
      if (p.items !== undefined && loc[k]?.items?.length !== p.items.length) details.push(`LivelyProperties.loc.json ru items of ${k}`)
    }
    const info = json('LivelyInfo.json') as { Type?: number; Arguments?: string } | undefined
    if (info?.Type !== 1) details.push('LivelyInfo.json Type is not 1 (web)')
    if (!(info?.Arguments ?? '').includes('--pause-event true')) details.push('LivelyInfo.json lacks --pause-event true')
  } else if (host === 'kde') {
    const xml = files.get('contents/config/main.xml')
    const entries = xml === undefined ? [] : [...text(xml).matchAll(/<entry name="(\w+)"/g)].map((m) => m[1] as string)
    same('main.xml', entries)
    const strings = files.get('contents/ui/strings.js')
    const s = strings === undefined ? '' : text(strings)
    for (const lang of ['en', 'ru']) if (!new RegExp(`\\b${lang}\\s*:`).test(s)) details.push(`strings.js lacks ${lang}`)
    const meta = json('metadata.json') as { KPackageStructure?: string } | undefined
    if (meta?.KPackageStructure !== 'Plasma/Wallpaper') details.push('metadata.json KPackageStructure is not Plasma/Wallpaper')
  }
  return outcome('manifest-matches-settings', details)
}

const README: Record<HostId, string | undefined> = { web: undefined, 'wallpaper-engine': 'README.txt', lively: 'README.txt', kde: 'README.md' }

/**
 * Spec 006 FR-004, FR-014a, FR-015, FR-017: every surface carries the version, the repository and the
 * GitHub Issues rule, the author, and no e-mail address; Wallpaper Engine carries the Workshop item id.
 */
export function checkFeedback(host: HostId, files: PackageFiles, version: string): CheckOutcome {
  const details: string[] = []
  const read = (path: string): string | undefined => {
    const b = files.get(path)
    return b === undefined ? undefined : text(b)
  }
  const readmePath = README[host]
  if (readmePath !== undefined) {
    const r = read(readmePath) ?? ''
    if (!r.split('\n')[0]?.includes(version)) details.push(`${readmePath}: first line lacks version ${version}`)
    for (const url of [REPOSITORY_URL, ISSUES_URL]) if (!r.includes(url)) details.push(`${readmePath}: lacks ${url}`)
  }
  if (host === 'web') {
    const js = [...files].filter(([p]) => p.endsWith('.js')).map(([, b]) => text(b)).join('\n')
    if (!js.includes(NEW_ISSUE_URL)) details.push(`web bundle lacks the report link ${NEW_ISSUE_URL}`)
    // The minifier may quote it with any of the three quotes.
    if (![`"${version}"`, `'${version}'`, `\`${version}\``].some((q) => js.includes(q))) details.push(`web bundle lacks version ${version}`)
  }
  if (host === 'wallpaper-engine') {
    const pj = JSON.parse(read('project.json') ?? '{}') as { workshopid?: string }
    if (pj.workshopid !== (WORKSHOP_ID ?? undefined)) details.push(`project.json workshopid ${String(pj.workshopid)} differs from project.ts ${String(WORKSHOP_ID)}`)
  }
  if (host === 'lively') {
    const info = JSON.parse(read('LivelyInfo.json') ?? '{}') as { Author?: string; Contact?: string; Version?: number }
    if (info.Author !== AUTHOR) details.push(`LivelyInfo.json Author ${String(info.Author)}`)
    if (info.Contact !== ISSUES_URL) details.push(`LivelyInfo.json Contact ${String(info.Contact)}`)
    if (info.Version !== livelyVersion(parseVersion(version))) details.push(`LivelyInfo.json Version ${String(info.Version)}`)
  }
  if (host === 'kde') {
    const meta = (JSON.parse(read('metadata.json') ?? '{}') as { KPlugin?: { Version?: string; Website?: string; BugReportUrl?: string; Authors?: { Name?: string }[] } }).KPlugin ?? {}
    if (meta.Version !== version) details.push(`metadata.json Version ${String(meta.Version)}`)
    if (meta.Website !== REPOSITORY_URL) details.push(`metadata.json Website ${String(meta.Website)}`)
    if (meta.BugReportUrl !== NEW_ISSUE_URL) details.push(`metadata.json BugReportUrl ${String(meta.BugReportUrl)}`)
    if (meta.Authors?.[0]?.Name !== AUTHOR) details.push(`metadata.json Authors ${JSON.stringify(meta.Authors)}`)
  }
  // No e-mail address in manifests and readmes (FR-017).
  for (const [path, bytes] of files) {
    if (!/\.(json|txt|md)$/.test(path)) continue
    const t = text(bytes).replace(/\bhttps?:\/\/\S+/g, '')
    const m = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(t)
    if (m !== null) details.push(`${path}: e-mail address ${m[0]}`)
  }
  return outcome('feedback', details)
}

/**
 * Spec 006 US5, research R7: a missing Qt WebEngine QML module must fail only the Loader of
 * WebView.qml, never main.qml, and the message it leads to names the package for each distribution.
 */
export function checkKdeWebEngineFallback(host: HostId, files: PackageFiles): CheckOutcome {
  if (host !== 'kde') return outcome('kde-webengine-fallback', [], true)
  const details: string[] = []
  const read = (p: string) => (files.has(p) ? text(files.get(p) as Uint8Array) : undefined)
  const main = read('contents/ui/main.qml') ?? ''
  const view = read('contents/ui/WebView.qml')
  if (/^\s*import\s+QtWebEngine\b/m.test(main)) details.push('main.qml imports QtWebEngine')
  if (/^\s*import\s+"\."/m.test(main)) details.push('main.qml imports "." (the SharedProfile singleton needs QtWebEngine)')
  if (!/source:\s*"WebView\.qml"/.test(main)) details.push('main.qml does not load WebView.qml through a Loader source')
  if (!/Loader\.Error/.test(main) || !/kde_webengine_missing/.test(main)) details.push('main.qml has no Loader.Error branch showing kde_webengine_missing')
  if (!/webengine-missing/.test(main)) details.push('main.qml does not log "[h3dynam] webengine-missing"')
  if (view === undefined) details.push('contents/ui/WebView.qml is missing')
  else if (!/^\s*import\s+QtWebEngine\b/m.test(view)) details.push('WebView.qml does not import QtWebEngine')
  const strings = read('contents/ui/strings.js') ?? ''
  for (const lang of ['en', 'ru'] as const) {
    const msg = (lang === 'en' ? en : ru).kde_webengine_missing
    if (!strings.includes(JSON.stringify(msg).slice(1, -1))) details.push(`strings.js lacks the ${lang} kde_webengine_missing text`)
    for (const pkgName of ['qt6-qtwebengine', 'qml6-module-qtwebengine', 'qt6-webengine']) if (!msg.includes(pkgName)) details.push(`${lang} message lacks ${pkgName}`)
  }
  return outcome('kde-webengine-fallback', details)
}

export function checkClassicFlavour(host: HostId, files: PackageFiles): CheckOutcome {
  if (FLAVOUR[host] !== 'classic') return outcome('classic-flavour', [], true)
  const details: string[] = []
  for (const [path, bytes] of files) {
    const t = ['.html', '.js'].includes(ext(path)) ? text(bytes) : ''
    if (ext(path) === '.html' && /<script[^>]*type=["']module["']/i.test(t)) details.push(`${path}: module script`)
    if (ext(path) === '.js' && /import\.meta/.test(t)) details.push(`${path}: import.meta`)
    if (ext(path) === '.js' && /type:\s*["']module["']/.test(t)) details.push(`${path}: module worker`)
  }
  return outcome('classic-flavour', details)
}

export function checkNoInlineScripts(files: PackageFiles): CheckOutcome {
  const details: string[] = []
  for (const [path, bytes] of files) {
    if (ext(path) !== '.html') continue
    const t = text(bytes)
    if (!/<meta[^>]+http-equiv=["']Content-Security-Policy["']/i.test(t)) details.push(`${path}: no CSP meta`)
    else if (/unsafe-inline|unsafe-eval/.test(t)) details.push(`${path}: CSP allows unsafe-inline/unsafe-eval`)
    for (const m of t.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc=/.test(m[1] ?? '') || (m[2] ?? '').trim() !== '') details.push(`${path}: inline script`)
    if (/<style\b/i.test(t)) details.push(`${path}: inline <style>`)
    if (/\son[a-z]+\s*=/i.test(t)) details.push(`${path}: inline event handler attribute`)
    if (/\sstyle\s*=/i.test(t)) details.push(`${path}: style attribute`)
  }
  return outcome('no-inline-scripts', details)
}

export function checkRuntimeSize(files: PackageFiles): CheckOutcome & { runtimeGzipBytes: number } {
  const bytes = runtimeGzipBytes(files)
  return { ...outcome('runtime-size', bytes > RUNTIME_LIMIT_GZIP_BYTES ? [`${bytes} gzip bytes > ${RUNTIME_LIMIT_GZIP_BYTES}`] : []), runtimeGzipBytes: bytes }
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function checkKpackage(archive: string): CheckOutcome {
  if (!hasCommand('kpackagetool6')) return outcome('kpackage-valid', ['kpackagetool6 not found'], true)
  const root = mkdtempSync(join(tmpdir(), 'h3-kpackage-'))
  try {
    execFileSync('kpackagetool6', ['-t', 'Plasma/Wallpaper', '-p', root, '-i', archive], { stdio: 'pipe', timeout: 60_000 })
    return outcome('kpackage-valid', [])
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message: string }
    return outcome('kpackage-valid', [`${e.message} ${e.stdout?.toString() ?? ''} ${e.stderr?.toString() ?? ''}`.trim()])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export async function packagesCommand(args: ParsedArgs): Promise<CommandResult> {
  const repoRoot = process.cwd()
  const hosts = parseHosts(opt(args, 'host'))
  const outDir = resolve(repoRoot, 'dist/packages')
  const version = packageVersion(repoRoot)
  const packages: { host: HostId; outcome: 'pass' | 'fail'; runtimeGzipBytes: number; checks: CheckOutcome[] }[] = []
  for (const host of hosts) {
    if (!flag(args, 'no-build') || !existsSync(join(outDir, host))) writePackage(outDir, host, await assemble(repoRoot, host), version)
    const files = readPackageDir(join(outDir, host))
    const size = checkRuntimeSize(files)
    const checks: CheckOutcome[] = [
      checkRequired(host, files),
      checkNoGameContent(files),
      checkNoExternalUrls(files),
      checkNoAffiliation(files),
      checkStrings(),
      checkManifests(host, files),
      checkClassicFlavour(host, files),
      checkNoInlineScripts(files),
      checkFeedback(host, files, version),
      checkKdeWebEngineFallback(host, files),
      { id: size.id, outcome: size.outcome, details: size.details },
    ]
    if (host === 'kde') checks.push(checkKpackage(join(outDir, artifactName('kde', version))))
    if (flag(args, 'reproducible')) {
      const again = await assemble(repoRoot, host)
      const first = packageHash(files)
      const second = packageHash(again)
      checks.push(outcome('reproducible', first === second ? [] : [`second build differs: ${first} vs ${second}`]))
    }
    packages.push({ host, outcome: checks.some((c) => c.outcome === 'fail') ? 'fail' : 'pass', runtimeGzipBytes: size.runtimeGzipBytes, checks })
  }
  const ok = packages.every((p) => p.outcome === 'pass')
  const reportDir = join(repoRoot, 'check-reports', 'packages', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(reportDir, { recursive: true })
  const report = { schema: '004-packages', outcome: ok ? 'pass' : 'fail', packages }
  writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return { ok, ...report, report: join(reportDir, 'report.json') }
}
