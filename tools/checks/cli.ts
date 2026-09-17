// Entry point: yarn verify <check> [options]. See specs/002-foundation-rewrite/contracts/checks-cli.md.
import { runCli } from '../shared/cli-runner.ts'
import type { CommandSpec } from '../shared/cli-runner.ts'

export const VERIFY_COMMANDS: Record<string, CommandSpec> = {
  all: {
    help: 'layers, determinism, budget and fidelity for every map with game captures',
    load: async () => (await import('./all.ts')).allCommand,
  },
  budget: {
    help: 'constitution budgets and SC-007 in headless Chromium [--map M]... [--no-build] [--throttle 4] [--viewport 1920x1080] [--idle-ms 5000]',
    booleanFlags: ['no-build'],
    load: async () => (await import('./budget/index.ts')).budgetCommand,
  },
  determinism: {
    help: 'same region rendered in fresh pages is identical [--runs 10] [--map M --archive A --level Z --region x0,y0,x1,y1] [--rebuild]',
    booleanFlags: ['rebuild'],
    load: async () => (await import('./determinism.ts')).determinismCommand,
  },
  fidelity: {
    help: 'compare renders with reference captures: --map M (--level Z --region x0,y0,x1,y1 | --all-regions) [--capture ID] [--kind still|clip] [--require] [--rebuild]',
    booleanFlags: ['all-regions', 'require', 'rebuild', 'exclude-objects'],
    load: async () => (await import('./fidelity/index.ts')).fidelityCommand,
  },
  hosts: {
    help: 'host simulations of built packages [--host web|wallpaper-engine|lively|kde|all] [--files synthetic|real] [--no-build] [--require]',
    booleanFlags: ['no-build', 'require'],
    load: async () => (await import('./hosts/index.ts')).hostsCommand,
  },
  packages: {
    help: 'static checks of built packages [--host web|wallpaper-engine|lively|kde|all] [--no-build] [--reproducible]',
    booleanFlags: ['no-build', 'reproducible'],
    load: async () => (await import('./packages/index.ts')).packagesCommand,
  },
  layers: {
    help: 'layer import order and platform globals',
    load: async () => (await import('./layers.ts')).layersCommand,
  },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli('verify', VERIFY_COMMANDS, process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
