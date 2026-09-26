// Project links, store items and author (spec 006 research R4, data-model "ProjectLinks"): the one
// place every surface takes them from — the browser panel, package manifests and readmes, store texts
// and release notes. DOM-free; tools may import it (TOOL_IMPORTABLE_ADAPTER_FILES). The packages check
// allows exactly these URLs in shipped files.

// Full literals, not templates: a minified bundle then holds each URL whole, so the packages check can
// find it and the URL allowlist can match it.
export const REPOSITORY_URL = 'https://github.com/Alamion/heroes_III_ts'
export const ISSUES_URL = 'https://github.com/Alamion/heroes_III_ts/issues'
export const NEW_ISSUE_URL = 'https://github.com/Alamion/heroes_III_ts/issues/new/choose'
export const RELEASES_URL = 'https://github.com/Alamion/heroes_III_ts/releases'
export const LATEST_RELEASE_URL = 'https://github.com/Alamion/heroes_III_ts/releases/latest'
export const README_URL = 'https://github.com/Alamion/heroes_III_ts#readme'
export const PAGES_URL = 'https://alamion.github.io/heroes_III_ts/'

/**
 * Store items, created by hand on 2026-09-26 (spec 006 FR-014a/b). `null` until an item exists: texts
 * then leave the store link out and point to the package on the release instead.
 */
export const WORKSHOP_ID: string | null = '3808342201'
export const KDE_STORE_URL: string | null = 'https://store.kde.org/p/2374098/'

export const AUTHOR = 'Alamion'

export function workshopUrl(id: string | null = WORKSHOP_ID): string | null {
  return id === null ? null : `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
}

/** Every project URL that may appear in shipped files and texts. */
export function projectUrls(): string[] {
  return [REPOSITORY_URL, ISSUES_URL, NEW_ISSUE_URL, RELEASES_URL, LATEST_RELEASE_URL, README_URL, PAGES_URL, workshopUrl(), KDE_STORE_URL].filter(
    (u): u is string => u !== null,
  )
}
