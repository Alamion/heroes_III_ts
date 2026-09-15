// Runtime size (constitution budget ≤ 100 KB gzipped): JS the wallpaper runtime loads — the engine
// chunk(s) imported by the harness entry and the worker — excluding the harness UI entry itself.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

export interface SizeReport {
  files: { file: string; bytes: number; gzipBytes: number; role: 'runtime' | 'harness' }[]
  runtimeGzipBytes: number
}

/** Classifies built assets: entry chunks named after harness pages are harness UI, the rest is runtime. */
export function measureRuntimeSize(distDir: string, harnessEntries: readonly string[] = ['index', 'render']): SizeReport {
  const assets = join(distDir, 'assets')
  const files = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((file) => {
      const bytes = readFileSync(join(assets, file))
      const base = file.replace(/-[\w-]{8}\.js$/, '')
      const role: 'runtime' | 'harness' = harnessEntries.includes(base) ? 'harness' : 'runtime'
      return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, role }
    })
  return { files, runtimeGzipBytes: files.filter((f) => f.role === 'runtime').reduce((n, f) => n + f.gzipBytes, 0) }
}
