// yarn package [--host web|wallpaper-engine|lively|kde|all] [--out dist/packages]
// (spec 004 contracts/cli.md): builds packages without any game content.

import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { log } from '../../src/core/util/log.ts'
import { opt, runCli } from '../shared/cli-runner.ts'
import type { CommandResult, CommandSpec, ParsedArgs } from '../shared/cli-runner.ts'
import { usage } from '../shared/errors.ts'
import { writeTarGz, writeZip } from '../shared/archive.ts'
import { buildClassic, buildWeb, FLAVOUR, HOSTS } from './build.ts'
import type { HostId, PackageFiles } from './build.ts'
import { wallpaperEnginePackage } from './manifests/wallpaper-engine.ts'

export interface BuiltPackage {
  host: HostId
  flavour: 'esm' | 'classic'
  path: string
  artifact: string
  files: number
  runtimeGzipBytes: number
  sha256: string
}

export function packageVersion(repoRoot: string): string {
  return (JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { version: string }).version
}

/** gzip size of every shipped script (the embedded worker included). */
export function runtimeGzipBytes(files: PackageFiles): number {
  let total = 0
  for (const [path, bytes] of files) if (path.endsWith('.js')) total += gzipSync(bytes, { level: 9 }).length
  return total
}

export function packageHash(files: PackageFiles): string {
  const h = createHash('sha256')
  for (const path of [...files.keys()].sort()) {
    h.update(path)
    h.update('\0')
    h.update(files.get(path) as Uint8Array)
  }
  return h.digest('hex')
}

export async function assemble(repoRoot: string, host: HostId): Promise<PackageFiles> {
  if (host === 'web') return buildWeb(repoRoot)
  const bundle = await buildClassic(repoRoot, host)
  if (host === 'wallpaper-engine') return wallpaperEnginePackage(repoRoot, bundle)
  if (host === 'lively') return (await import('./manifests/lively.ts')).livelyPackage(repoRoot, bundle)
  return (await import('./manifests/kde.ts')).kdePackage(repoRoot, bundle)
}

function artifactName(host: HostId, version: string): string {
  if (host === 'lively') return `h3dynam-lively-${version}.zip`
  if (host === 'kde') return `h3dynam-kde-${version}.tar.gz`
  return host
}

export function writePackage(outDir: string, host: HostId, files: PackageFiles, version: string): BuiltPackage {
  const dir = join(outDir, host)
  rmSync(dir, { recursive: true, force: true })
  for (const [path, bytes] of files) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  const name = artifactName(host, version)
  let artifact = dir
  if (host === 'lively' || host === 'kde') {
    const entries = [...files].map(([path, data]) => ({ path, data }))
    artifact = join(outDir, name)
    writeFileSync(artifact, host === 'lively' ? writeZip(entries) : writeTarGz(entries))
  }
  return { host, flavour: FLAVOUR[host], path: dir, artifact, files: files.size, runtimeGzipBytes: runtimeGzipBytes(files), sha256: packageHash(files) }
}

export function parseHosts(value: string | undefined): HostId[] {
  if (value === undefined || value === 'all') return [...HOSTS]
  const hosts = value.split(',').map((h) => h.trim())
  for (const h of hosts) if (!(HOSTS as readonly string[]).includes(h)) throw usage(`unknown host "${h}" (web, wallpaper-engine, lively, kde, all)`)
  return hosts as HostId[]
}

async function packageCommand(args: ParsedArgs): Promise<CommandResult> {
  const repoRoot = process.cwd()
  const hosts = parseHosts(opt(args, 'host'))
  const outDir = resolve(repoRoot, opt(args, 'out') ?? 'dist/packages')
  const version = packageVersion(repoRoot)
  const packages: BuiltPackage[] = []
  for (const host of hosts) {
    const files = await assemble(repoRoot, host)
    packages.push(writePackage(outDir, host, files, version))
    log.info(`${host}: ${files.size} files`)
  }
  return { ok: true, version, packages }
}

export const PACKAGE_COMMANDS: Record<string, CommandSpec> = {
  build: { help: 'build packages [--host web|wallpaper-engine|lively|kde|all] [--out dist/packages]', load: async () => packageCommand },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // `yarn package [--host …]` is the build command.
  const argv = process.argv.slice(2)
  runCli('package', PACKAGE_COMMANDS, argv[0] === 'build' ? argv : ['build', ...argv]).then((code) => {
    process.exitCode = code
  })
}
