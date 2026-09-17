// Helpers shared by host manifest generators (spec 004 contracts/settings.md).

import { en, ru } from '../../../src/adapters/shared/strings.ts'
import type { StringKey } from '../../../src/adapters/shared/strings.ts'

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
export const json = (value: unknown): Uint8Array => utf8(`${JSON.stringify(value, null, 2)}\n`)

/** Plain-text user documentation (FR-023) in English and Russian. */
export function readme(hostHelp: StringKey): Uint8Array {
  const section = (t: Record<StringKey, string>, heading: string) =>
    [`${t.package_title} — ${heading}`, '', t.package_description, '', t[hostHelp], '', t.help_files, '', t.help_privacy].join('\n')
  return utf8(`${section(en, 'English')}\n\n----------------------------------------\n\n${section(ru, 'Русский')}\n`)
}
