// SC-003 end to end against the original game: selfcheck with generated floating tiles passes.
// Runs only with H3REF_LIVE=1 and a ready reference environment (several minutes).
import { describe, expect, it } from 'vitest'
import { runTool } from '../fixtures/run-tool.ts'

async function skipReason(): Promise<string | undefined> {
  if (process.env.H3REF_LIVE !== '1') return 'set H3REF_LIVE=1 to run live reference-environment checks'
  const doctor = await runTool('tools/reference-env/cli.ts', ['doctor'])
  if (doctor.code !== 0) return `reference environment not ready (yarn ref doctor exited ${doctor.code})`
  return undefined
}

const reason = await skipReason()
if (reason !== undefined) process.stderr.write(`[floating selfcheck live test skipped] ${reason}\n`)

describe.skipIf(reason !== undefined)('live: selfcheck with generated floating tiles', () => {
  it('passes on Arrogance', async () => {
    const floating = await runTool('tools/inspect/cli.ts', ['map', 'floating', 'Arrogance.h3m', '--level', '0'])
    expect(floating.code).toBe(0)
    const r = await runTool('tools/reference-env/cli.ts', ['selfcheck', '--map', 'Arrogance.h3m', '--runs', '3', '--samples', '0', '--floating-tiles', String(floating.json.tiles)])
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true)
  }, 30 * 60_000)
})
