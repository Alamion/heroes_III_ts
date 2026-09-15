// Runs a repo CLI (one JSON document on stdout) as a child process.
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

export function runTool(cli: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; json: Record<string, unknown> }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(REPO, cli), ...args], { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('error', rej)
    child.on('close', (code) => {
      try {
        res({ code: code ?? -1, json: JSON.parse(out) as Record<string, unknown> })
      } catch (err) {
        rej(new Error(`non-JSON output: ${out.slice(0, 300)} (${(err as Error).message})`))
      }
    })
  })
}

