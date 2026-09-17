// Package builds (spec 004 contracts/cli.md "yarn package", research R3/R14): the web package is an
// ESM Vite build; host packages (Wallpaper Engine, Lively, KDE) use classic IIFE scripts with the
// decode worker embedded as a string. Only repository sources are read.

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import { log } from '../../src/core/util/log.ts'

export const HOSTS = ['web', 'wallpaper-engine', 'lively', 'kde'] as const
export type HostId = (typeof HOSTS)[number]
export type Flavour = 'esm' | 'classic'

export const FLAVOUR: Record<HostId, Flavour> = { web: 'esm', 'wallpaper-engine': 'classic', lively: 'classic', kde: 'classic' }

/** Files of a package: POSIX path → bytes. */
export type PackageFiles = Map<string, Uint8Array>

export interface ClassicBundle {
  /** Host listener script (loaded first), when the host has one. */
  listener: string | undefined
  main: string
}

function readTree(dir: string): PackageFiles {
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

/**
 * Classic builds never create the module worker: its `new Worker(new URL(...), { type: 'module' })`
 * would make Vite emit a worker chunk with import.meta.url. Hosts pass a Blob worker factory instead.
 */
function stripModuleWorker(): Plugin {
  const pattern = "new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })"
  return {
    name: 'h3-strip-module-worker',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split(sep).join('/').endsWith('src/runtime/engine.ts')) return null
      if (!code.includes(pattern)) throw new Error('engine.ts module worker pattern changed; update tools/package/build.ts')
      return { code: code.replace(pattern, "(() => { throw new Error('module worker is not available in classic builds') })()"), map: null }
    },
  }
}

async function buildIife(repoRoot: string, entry: string, name: string, define: Record<string, string>, plugins: Plugin[]): Promise<string> {
  const vite = await import('vite')
  const out = mkdtempSync(join(tmpdir(), 'h3-pkg-'))
  try {
    await vite.build({
      configFile: false,
      root: repoRoot,
      logLevel: 'warn',
      publicDir: false,
      define,
      plugins,
      build: {
        outDir: out,
        emptyOutDir: true,
        target: 'es2022',
        minify: true,
        reportCompressedSize: false,
        copyPublicDir: false,
        lib: { entry: resolve(repoRoot, entry), formats: ['iife'], name, fileName: () => 'bundle.js' },
      },
    })
    return readFileSync(join(out, 'bundle.js'), 'utf8')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

let workerSource: Promise<string> | undefined

/** The decode worker as one classic script (shared by all classic hosts in one run). */
export function classicWorkerSource(repoRoot: string): Promise<string> {
  workerSource ??= buildIife(repoRoot, 'src/runtime/worker.ts', 'H3DecodeWorker', {}, [])
  return workerSource
}

export async function buildClassic(repoRoot: string, host: Exclude<HostId, 'web'>): Promise<ClassicBundle> {
  const worker = await classicWorkerSource(repoRoot)
  const dir = `src/adapters/${host}`
  let listener: string | undefined
  try {
    statSync(resolve(repoRoot, dir, 'listener.ts'))
    listener = await buildIife(repoRoot, `${dir}/listener.ts`, 'H3HostListener', {}, [])
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  log.info(`building ${host} bundle`)
  const main = await buildIife(repoRoot, `${dir}/main.ts`, 'H3Wallpaper', { __H3_WORKER_SOURCE__: JSON.stringify(worker) }, [stripModuleWorker()])
  return { listener, main }
}

/** ESM build of the browser version into a package file map. */
export async function buildWeb(repoRoot: string): Promise<PackageFiles> {
  const vite = await import('vite')
  const root = resolve(repoRoot, 'src/adapters/web')
  const out = mkdtempSync(join(tmpdir(), 'h3-web-'))
  try {
    log.info('building web bundle')
    await vite.build({
      configFile: false,
      root,
      base: './',
      logLevel: 'warn',
      publicDir: false,
      worker: { format: 'es' },
      build: {
        outDir: out,
        emptyOutDir: true,
        target: 'es2022',
        reportCompressedSize: false,
        copyPublicDir: false,
        modulePreload: { polyfill: false },
        rollupOptions: { input: { index: resolve(root, 'index.html') } },
      },
    })
    return readTree(out)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
