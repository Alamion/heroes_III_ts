import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptureRecord } from '../model/types.ts'
import { runProcess } from './process.ts'

async function firstLine(cmd: string, args: string[]): Promise<string> {
  try {
    const r = await runProcess(cmd, args, { check: false, timeoutMs: 10_000 })
    const text = r.stdout.toString() || r.stderr
    return text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'unknown'
  } catch {
    return 'missing'
  }
}

export async function toolVersions(repoRoot: string, wineBinary: string): Promise<CaptureRecord['tooling']> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version?: string }
  const [gitCommit, wine, ffmpeg, xvfb, xdotool] = await Promise.all([
    firstLine('git', ['-C', repoRoot, 'rev-parse', 'HEAD']),
    firstLine(wineBinary, ['--version']),
    firstLine('ffmpeg', ['-version']),
    firstLine('rpm', ['-q', 'xorg-x11-server-Xvfb']),
    firstLine('xdotool', ['version']),
  ])
  return { version: pkg.version ?? '0.0.0', gitCommit, wine, ffmpeg, xvfb, xdotool }
}
