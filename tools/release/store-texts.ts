// Ready-to-paste store texts (spec 006 FR-011–FR-013, research R5): the Workshop title and
// description, the KDE Store description, and the change note of a version for each store — built
// from the same strings as the host manifests and package readmes, English then Russian, in each
// store's BBCode, checked against the store limits in UTF-8 bytes.

import { APP_NAME, format } from '../../src/adapters/shared/strings.ts'
import type { Language, StringKey } from '../../src/adapters/shared/strings.ts'
import { projectUrls } from '../../src/adapters/shared/project.ts'
import type { LinkSet } from './links.ts'
import { linkParams } from './links.ts'
import { checkBbcode, renderInline, renderMarkup } from './markup.ts'

export type Store = 'steam' | 'kde'

export interface StoreText {
  name: string
  store: Store
  kind: 'title' | 'description' | 'changenote'
  /** Maximum size in UTF-8 bytes (research R5: the stricter reading of Steam's limits). */
  limit: number
  content: string
}

export const LIMITS = { title: 128, description: 8000, changenote: 8000 } as const

const LANGUAGE_NAME: Record<Language, string> = { en: 'English', ru: 'Русский' }

function block(lang: Language, store: Store, links: LinkSet): string {
  const params = linkParams(links)
  const p = (key: StringKey) => renderInline(format(lang, key, params), store)
  const paras = [
    `[b]${LANGUAGE_NAME[lang]}[/b]`,
    p('package_description'),
    p('help_files'),
    ...(store === 'steam' ? [p('help_wallpaper_engine')] : [p('help_kde'), p('store_kde_requirements')]),
    p('help_privacy'),
    p('store_links'),
    // The other store, when its page exists (FR-014b).
    ...(store === 'steam' && links.kdeStore !== null ? [p('store_on_kde_store')] : []),
    ...(store === 'kde' && links.workshop !== null ? [p('store_on_workshop')] : []),
    `[b]${p('store_feedback')}[/b]`,
  ]
  return paras.join('\n\n')
}

export function storeDescription(store: Store, links: LinkSet): string {
  const separator = store === 'steam' ? '[hr][/hr]' : '— — —'
  return `${block('en', store, links)}\n\n${separator}\n\n${block('ru', store, links)}\n`
}

export function storeTexts(version: string, changelog: string, links: LinkSet): StoreText[] {
  return [
    { name: 'workshop-title.txt', store: 'steam', kind: 'title', limit: LIMITS.title, content: `${APP_NAME}\n` },
    { name: 'workshop-description.bbcode', store: 'steam', kind: 'description', limit: LIMITS.description, content: storeDescription('steam', links) },
    { name: 'kde-store-description.bbcode', store: 'kde', kind: 'description', limit: LIMITS.description, content: storeDescription('kde', links) },
    { name: `changenote-${version}.bbcode`, store: 'steam', kind: 'changenote', limit: LIMITS.changenote, content: `${renderMarkup(changelog, 'steam')}\n` },
    { name: `kde-changelog-${version}.bbcode`, store: 'kde', kind: 'changenote', limit: LIMITS.changenote, content: `${renderMarkup(changelog, 'kde')}\n` },
  ]
}

const ALLOWED = new Set(projectUrls().map((u) => u.replace(/\/+$/, '')))

/** Problems of one text: size, markup, links, wording (FR-013). Empty when it can be pasted. */
export function checkStoreText(t: StoreText): string[] {
  const problems: string[] = []
  const bytes = new TextEncoder().encode(t.content.trimEnd()).length
  if (bytes > t.limit) problems.push(`${t.name}: ${bytes} bytes, ${bytes - t.limit} over the limit of ${t.limit}`)
  if (t.kind !== 'title') problems.push(...checkBbcode(t.content, t.store).map((p) => `${t.name}: ${p}`))
  else if (t.content.includes('[')) problems.push(`${t.name}: a title takes no markup`)
  for (const m of t.content.matchAll(/https?:\/\/[^\s\]\[)]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, '').replace(/\/+$/, '')
    // Changelog sections may link anything a person wrote; store descriptions only project links.
    if (t.kind === 'description' && !ALLOWED.has(url)) problems.push(`${t.name}: link ${m[0]} is not a project link`)
  }
  if (/\bofficial\b/i.test(t.content)) problems.push(`${t.name}: says "official" (constitution I)`)
  if (/\{\w+\}/.test(t.content)) problems.push(`${t.name}: unfilled placeholder ${/\{\w+\}/.exec(t.content)?.[0]}`)
  return problems
}

/** Headroom per text for reports. */
export function textSize(t: StoreText): { name: string; bytes: number; limit: number; headroom: number } {
  const bytes = new TextEncoder().encode(t.content.trimEnd()).length
  return { name: t.name, bytes, limit: t.limit, headroom: t.limit - bytes }
}
