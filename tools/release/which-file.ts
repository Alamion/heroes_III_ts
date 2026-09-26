// The "which file do I need" block at the end of every release's notes (spec 006 US2, FR-005). English
// only, like the notes; a host whose store page is not set gets its package and the README instead
// (FR-014b).

import { format } from '../../src/adapters/shared/strings.ts'
import { artifactName } from '../package/cli.ts'
import type { LinkSet } from './links.ts'
import { linkParams } from './links.ts'

export function whichFileBlock(version: string, links: LinkSet): string {
  const we = artifactName('wallpaper-engine', version)
  const lively = artifactName('lively', version)
  const kde = artifactName('kde', version)
  const lines = [
    '### Which file do I need?',
    '',
    `- **Browser**: nothing to download — open the [browser version](${links.pages}).`,
    links.workshop !== null
      ? `- **Wallpaper Engine**: subscribe on the [Steam Workshop](${links.workshop}), or unpack \`${we}\` into \`Wallpaper Engine/projects/myprojects/\` ([README](${links.readme})).`
      : `- **Wallpaper Engine**: unpack \`${we}\` into \`Wallpaper Engine/projects/myprojects/\` ([README](${links.readme})).`,
    `- **Lively Wallpaper**: drag \`${lively}\` into the Lively window ([README](${links.readme})).`,
    links.kdeStore !== null
      ? `- **KDE Plasma 6**: "Get New Plugins…" in the wallpaper settings ([KDE Store](${links.kdeStore})), or \`kpackagetool6 -t Plasma/Wallpaper -i ${kde}\`.`
      : `- **KDE Plasma 6**: \`kpackagetool6 -t Plasma/Wallpaper -i ${kde}\` ([README](${links.readme})).`,
    '- **Checksums**: `SHA256SUMS` lists every file (`sha256sum -c SHA256SUMS`).',
    '',
    `You need your own copy of Heroes of Might and Magic III; no game files are included. ${format('en', 'store_feedback', linkParams(links))}`,
  ]
  return lines.join('\n')
}
