// `yarn verify all`: layers, map coverage (spec 005), determinism, packages and host simulations
// (spec 004), budget, and fidelity for every map with game captures.

import { loadConfig } from '../reference-env/config.ts'
import { scanRecords } from '../reference-env/store/lookup.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { determinismCommand } from './determinism.ts'
import { budgetCommand } from './budget/index.ts'
import { fidelityCommand } from './fidelity/index.ts'
import { hostsCommand } from './hosts/index.ts'
import { layersCommand } from './layers.ts'
import { mapsCommand } from './maps/index.ts'
import { packagesCommand } from './packages/index.ts'

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
  // Every kind of map the user owns opens (spec 005 FR-020).
  const maps = await mapsCommand(args({}, []))
  results.maps = outcome(maps)
  const determinism = await determinismCommand(args({ runs: '3' }, ['rebuild']))
  results.determinism = outcome(determinism)
  // Builds every package once; the checks after it reuse them.
  const packages = await packagesCommand(args({}))
  results.packages = outcome(packages)
  const hosts = await hostsCommand(args({ files: 'synthetic' }, ['no-build']))
  results.hosts = outcome(hosts)
  const budget = await budgetCommand(args({}, ['no-build']))
  results.budget = outcome(budget)
  for (const map of capturedMaps()) {
    const r = await fidelityCommand(args({ map }, ['all-regions']))
    results[`fidelity:${map}`] = outcome(r)
  }
  const ok = Object.values(results).every((v) => v !== 'fail')
  return { ok, results }
}
