// yarn accept <host> (spec 004 contracts/cli.md): real-host acceptance helpers. Only KDE Plasma is
// automated here; Wallpaper Engine and Lively are verified in a session on Windows.

import { runCli } from '../shared/cli-runner.ts'
import type { CommandSpec } from '../shared/cli-runner.ts'

export const ACCEPT_COMMANDS: Record<string, CommandSpec> = {
  kde: {
    help: 'install/upgrade the KDE package; --apply switches a screen to it with the dev files, screenshots and restores [--screen 0] [--seconds 20] [--keep]',
    booleanFlags: ['apply', 'keep'],
    load: async () => (await import('./kde.ts')).acceptKdeCommand,
  },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli('accept', ACCEPT_COMMANDS, process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
