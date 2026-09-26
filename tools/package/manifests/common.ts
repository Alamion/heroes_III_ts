// Helpers shared by host manifest generators (spec 004 contracts/settings.md).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format } from '../../../src/adapters/shared/strings.ts'
import type { Language, StringKey } from '../../../src/adapters/shared/strings.ts'
import { linkParams, projectLinks } from '../../release/links.ts'
import { renderInline } from '../../release/markup.ts'

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
export const json = (value: unknown): Uint8Array => utf8(`${JSON.stringify(value, null, 2)}\n`)

/** The version in package.json (spec 006 FR-001: its only source). */
export function versionOf(repoRoot: string): string {
  return (JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { version: string }).version
}

/**
 * Plain-text user documentation (spec 004 FR-023) in English and Russian, with the version on top and
 * the repository and the GitHub Issues rule at the end (spec 006 FR-004, FR-015).
 */
export function readme(hostHelp: StringKey, version: string): Uint8Array {
  const params = linkParams(projectLinks())
  const t = (lang: Language, key: StringKey) => renderInline(format(lang, key, params), 'text')
  const section = (lang: Language, heading: string) =>
    [`${t(lang, 'package_title')} ${version} — ${heading}`, '', t(lang, 'package_description'), '', t(lang, hostHelp), '', t(lang, 'help_files'), '', t(lang, 'help_privacy'), '', t(lang, 'store_links'), '', t(lang, 'store_feedback')].join('\n')
  return utf8(`${section('en', 'English')}\n\n----------------------------------------\n\n${section('ru', 'Русский')}\n`)
}
