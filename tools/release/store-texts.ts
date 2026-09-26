// Ready-to-paste store texts (spec 006 FR-011–FR-013, research R5): the Workshop title and
// description, the KDE Store description, and the change note of a version for each store — built
// from the same strings as the host manifests and package readmes, English then Russian, in each
// store's BBCode, checked against the store limits in UTF-8 bytes.

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_NAME, format } from '../../src/adapters/shared/strings.ts'
import type { Language, StringKey } from '../../src/adapters/shared/strings.ts'
import { projectUrls, storeImageUrl } from '../../src/adapters/shared/project.ts'
import type { LinkSet } from './links.ts'
import { linkParams } from './links.ts'
import { checkBbcode, renderMarkup } from './markup.ts'

export type Store = 'steam' | 'kde'

export interface StoreText {
  name: string
  store: Store
  kind: 'title' | 'description' | 'changenote'
  /** Maximum size in UTF-8 bytes (research R5: the stricter reading of Steam's limits). */
  limit: number
  content: string
  /** The version whose tag the pictures are linked at. */
  version: string
}

export const LIMITS = { title: 128, description: 8000, changenote: 8000 } as const

const STORE_DIR = fileURLToPath(new URL('../../docs/store/', import.meta.url))
export const IMG_DIR = fileURLToPath(new URL('../../docs/img/', import.meta.url))
/** Constitution I: a documentation screenshot is at most 2 MB. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** The text a placeholder line of a template stands for, or null to leave the line out. */
function placeholder(name: string, lang: Language, store: Store, links: LinkSet): string | null {
  const t = (key: StringKey) => format(lang, key, linkParams(links))
  switch (name) {
    case 'pitch':
      return t('package_description')
    case 'files':
      return t('help_files')
    case 'host_setup':
      return store === 'steam' ? t('help_wallpaper_engine') : `${t('help_kde')}\n\n${t('store_kde_requirements')}`
    case 'privacy':
      return t('help_privacy')
    case 'links':
      return t('store_links')
    case 'other_store':
      // The other store, when its page exists (FR-014b).
      if (store === 'steam') return links.kdeStore !== null ? t('store_on_kde_store') : null
      return links.workshop !== null ? t('store_on_workshop') : null
    case 'feedback':
      return `**${t('store_feedback')}**`
    default:
      return undefined as never
  }
}

const PLACEHOLDER_LINE = /^\{(\w+)\}$/

function fill(source: string, fillLine: (name: string) => string | null | undefined): string {
  return source
    .split('\n')
    .flatMap((line) => {
      const m = PLACEHOLDER_LINE.exec(line.trim())
      if (m === null) return [line]
      const v = fillLine(m[1] as string)
      // Unknown placeholders stay, and the check reports them.
      return v === undefined ? [line] : v === null ? [] : [v]
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function readTemplate(name: string): string {
  return readFileSync(join(STORE_DIR, name), 'utf8').trim()
}

/** A store page from docs/store/ (spec 006 FR-012, FR-012a): pictures, English, Russian. */
export function storeDescription(store: Store, links: LinkSet, version: string): string {
  const lang = (l: Language) => fill(readTemplate(`description.${l}.md`), (n) => placeholder(n, l, store, links))
  const page = fill(readTemplate('layout.md'), (n) => (n === 'en' || n === 'ru' ? lang(n) : undefined))
  return `${renderMarkup(page, store, 1, { images: true, imageUrl: (file) => storeImageUrl(version, file) })}\n`
}

export function storeTexts(version: string, changelog: string, links: LinkSet): StoreText[] {
  return [
    { name: 'workshop-title.txt', store: 'steam', kind: 'title', limit: LIMITS.title, content: `${APP_NAME}\n`, version },
    { name: 'workshop-description.bbcode', store: 'steam', kind: 'description', limit: LIMITS.description, content: storeDescription('steam', links, version), version },
    { name: 'kde-store-description.bbcode', store: 'kde', kind: 'description', limit: LIMITS.description, content: storeDescription('kde', links, version), version },
    { name: `changenote-${version}.bbcode`, store: 'steam', kind: 'changenote', limit: LIMITS.changenote, content: `${renderMarkup(changelog, 'steam')}\n`, version },
    { name: `kde-changelog-${version}.bbcode`, store: 'kde', kind: 'changenote', limit: LIMITS.changenote, content: `${renderMarkup(changelog, 'kde')}\n`, version },
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
  // Pictures (FR-012a, FR-013): only docs/img/ at this version's tag, each file present and ≤ 2 MB.
  for (const m of t.content.matchAll(/\[img\]([^[]*)\[\/img\]/g)) {
    const url = m[1] as string
    const file = /\/docs\/img\/([\w.-]+)$/.exec(url)?.[1]
    if (file === undefined || url !== storeImageUrl(t.version, file)) {
      problems.push(`${t.name}: picture ${url} is not docs/img/ at tag v${t.version}`)
      continue
    }
    let bytes: number | undefined
    try {
      bytes = statSync(join(IMG_DIR, file)).size
    } catch {
      problems.push(`${t.name}: picture docs/img/${file} does not exist`)
    }
    if (bytes !== undefined && bytes > MAX_IMAGE_BYTES) problems.push(`${t.name}: picture docs/img/${file} is ${bytes} bytes, over ${MAX_IMAGE_BYTES}`)
  }
  for (const m of t.content.replace(/\[img\][^[]*\[\/img\]/g, '').matchAll(/https?:\/\/[^\s\]\[)]+/g)) {
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
