// yarn accept <host> (spec 004 contracts/cli.md): real-host acceptance helpers. Only KDE Plasma is
// automated here; Wallpaper Engine and Lively are verified in a session on Windows.

import { runCli } from '../shared/cli-runner.ts'
import type { CommandSpec } from '../shared/cli-runner.ts'

export const ACCEPT_COMMANDS: Record<string, CommandSpec> = {
  kde: {
    help: 'install/upgrade the KDE package and restart plasmashell after an upgrade; --apply switches a screen to it with the dev files, screenshots and restores the plugin and its settings [--screen 0] [--seconds 20] [--keep] [--no-restart]; --simulate-missing-webengine installs a variant whose web view cannot load and waits for the missing-module message (spec 006 US5)',
    booleanFlags: ['apply', 'keep', 'no-restart', 'simulate-missing-webengine'],
    load: async () => (await import('./kde.ts')).acceptKdeCommand,
  },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli('accept', ACCEPT_COMMANDS, process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
