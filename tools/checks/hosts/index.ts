// `yarn verify hosts [--host …] [--files synthetic|real] [--map NAME] [--no-build] [--require]` (spec 004
// contracts/cli.md): host simulations of built packages in headless Chromium.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { log } from '../../../src/core/util/log.ts'
import { flag, opt } from '../../shared/cli-runner.ts'
import type { CommandResult, ParsedArgs } from '../../shared/cli-runner.ts'
import { hasChromium, launchBrowser } from '../../shared/browser.ts'
import { usage } from '../../shared/errors.ts'
import { gameDirs, requireGameFile, requireTestMap } from '../../shared/game-files.ts'
import { HeadlessRenderer } from '../../shared/render-page.ts'
import { writeWallpaperSet } from '../../../test/fixtures/synthetic/wallpaper-set.ts'
import { writeHostFolders } from '../../../test/fixtures/synthetic/map-folder.ts'
import { assemble, packageVersion, parseHosts, writePackage } from '../../package/cli.ts'
import { DRIVERS } from './drivers.ts'
import { runInvariants } from './invariants.ts'
import type { FileSet, InvariantResult } from './invariants.ts'

export async function hostsCommand(args: ParsedArgs): Promise<CommandResult> {
  if (!hasChromium()) return { ok: true, exitCode: 4, outcome: 'skip', skipReason: 'no-chromium' }
  const repoRoot = process.cwd()
  const hosts = parseHosts(opt(args, 'host'))
  const which = opt(args, 'files') ?? 'synthetic'
  if (which !== 'synthetic' && which !== 'real') throw usage('--files must be synthetic or real')
  const mapName = opt(args, 'map')
  const onlyArg = opt(args, 'only')
  const only = onlyArg === undefined ? undefined : new Set(onlyArg.split(',').map((x) => Number(x.trim())))
  if (only !== undefined && [...only].some((x) => !Number.isFinite(x))) throw usage('--only takes invariant ids, e.g. --only 14,16.1')
  if (mapName !== undefined && which !== 'real') throw usage('--map needs --files real')
  const outDir = resolve(repoRoot, 'dist/packages')
  const reportDir = join(repoRoot, 'check-reports', 'hosts', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(reportDir, { recursive: true })

  const synthetic = writeWallpaperSet()
  // The HotA archive is optional: with it, the simulations also exercise the HotA slot (spec 005).
  const hotaDataDir = gameDirs().hotaDataDir
  const hotaCandidate = hotaDataDir === undefined ? undefined : join(hotaDataDir, 'HotA.lod')
  const hotaArchive = hotaCandidate !== undefined && existsSync(hotaCandidate) ? hotaCandidate : undefined
  // Spec 007: synthetic map folders for every run (they need no game content).
  const folders = writeHostFolders(join(synthetic.dir, 'folders'))
  let files: FileSet
  if (which === 'real') {
    const sprite = requireGameFile('h3sprite.lod')
    const data = requireGameFile('h3bitmap.lod')
    const map = mapName !== undefined ? requireGameFile(mapName) : requireTestMap()
    if (sprite === null || data === null || map === null) {
      rmSync(synthetic.dir, { recursive: true, force: true })
      return { ok: !flag(args, 'require'), exitCode: flag(args, 'require') ? 3 : 4, outcome: 'skip', skipReason: 'game-files-missing' }
    }
    files = { spriteArchive: sprite, dataArchive: data, map, ...(hotaArchive === undefined ? {} : { hotaArchive }), bad: { ...synthetic.bad, missing: join(synthetic.dir, 'Нет такого файла.lod') }, folders }
  } else {
    files = { spriteArchive: synthetic.spriteArchive, dataArchive: synthetic.dataArchive, map: synthetic.map, bad: { ...synthetic.bad, missing: join(synthetic.dir, 'Нет такого файла.lod') }, folders }
  }

  if (!flag(args, 'no-build')) {
    const version = packageVersion(repoRoot)
    for (const host of hosts) writePackage(outDir, host, await assemble(repoRoot, host), version)
  }

  // `gc()` in the page lets invariant 16 measure retained memory, not garbage not yet collected.
  const browser = await launchBrowser(['--js-flags=--expose-gc'])
  // Wallpaper Engine and KDE open the page from file:// and read user files with XHR, which their
  // hosts allow; headless Chromium needs the flag to stand in for that permission.
  const fileBrowser = await launchBrowser(['--allow-file-access-from-files', '--js-flags=--expose-gc'])
  const renderer = await HeadlessRenderer.open({ width: 640, height: 480 })
  const results: { host: string; outcome: 'pass' | 'fail'; invariants: InvariantResult[] }[] = []
  try {
    for (const host of hosts) {
      log.info(`simulating ${host}`)
      const driver = await DRIVERS[host](host === 'wallpaper-engine' || host === 'kde' ? fileBrowser : browser, join(outDir, host))
      try {
        const invariants = await runInvariants({ driver, files, renderer, reportDir, ...(only !== undefined ? { only } : {}) })
        results.push({ host, outcome: invariants.every((i) => i.outcome !== 'fail') ? 'pass' : 'fail', invariants })
      } finally {
        await driver.dispose()
      }
    }
  } finally {
    await renderer.close()
    await browser.close()
    await fileBrowser.close()
    rmSync(synthetic.dir, { recursive: true, force: true })
  }
  const ok = results.every((r) => r.outcome === 'pass')
  const report = { schema: '004-hosts', outcome: ok ? 'pass' : 'fail', files: which, hosts: results }
  writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return { ok, ...report, report: join(reportDir, 'report.json') }
}
