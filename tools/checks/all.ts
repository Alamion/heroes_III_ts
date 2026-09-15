// `yarn verify all`: layers, determinism, budget, and fidelity for every map with game captures.

import { loadConfig } from '../reference-env/config.ts'
import { scanRecords } from '../reference-env/store/lookup.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { determinismCommand } from './determinism.ts'
import { budgetCommand } from './budget/index.ts'
import { fidelityCommand } from './fidelity/index.ts'
import { layersCommand } from './layers.ts'

function capturedMaps(): string[] {
  let dir: string
  try {
    dir = loadConfig(process.env, process.cwd()).capturesDir
  } catch {
    return []
  }
  return [...new Set(scanRecords(dir).filter((c) => c.record.source === 'game').map((c) => c.record.map.name))].sort()
}

const args = (flags: Record<string, string>, bools: string[] = []): ParsedArgs => ({
  positional: [],
  flags: new Map([...Object.entries(flags).map(([k, v]) => [k, [v]] as [string, string[]]), ...bools.map((b) => [b, ['true']] as [string, string[]])]),
})

export async function allCommand(): Promise<CommandResult> {
  const results: Record<string, unknown> = {}
  const outcome = (r: CommandResult): string => (typeof r.outcome === 'string' ? r.outcome : r.ok ? 'pass' : 'fail')
  const layers = await layersCommand()
  results.layers = outcome(layers)
  const determinism = await determinismCommand(args({ runs: '3' }, ['rebuild']))
  results.determinism = outcome(determinism)
  const budget = await budgetCommand(args({}, ['no-build']))
  results.budget = outcome(budget)
  for (const map of capturedMaps()) {
    const r = await fidelityCommand(args({ map }, ['all-regions']))
    results[`fidelity:${map}`] = outcome(r)
  }
  const ok = Object.values(results).every((v) => v !== 'fail')
  return { ok, results }
}
