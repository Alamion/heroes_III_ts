// Placeholder values for the link strings of strings.ts (spec 006 research R4), with overridable store
// items so tests can check the "no store page yet" fallback (FR-014b).

import * as project from '../../src/adapters/shared/project.ts'

export interface LinkSet {
  repository: string
  issues: string
  newIssue: string
  releases: string
  latestRelease: string
  readme: string
  pages: string
  workshop: string | null
  kdeStore: string | null
}

export function projectLinks(overrides: { workshopId?: string | null; kdeStoreUrl?: string | null } = {}): LinkSet {
  return {
    repository: project.REPOSITORY_URL,
    issues: project.ISSUES_URL,
    newIssue: project.NEW_ISSUE_URL,
    releases: project.RELEASES_URL,
    latestRelease: project.LATEST_RELEASE_URL,
    readme: project.README_URL,
    pages: project.PAGES_URL,
    workshop: project.workshopUrl(overrides.workshopId !== undefined ? overrides.workshopId : project.WORKSHOP_ID),
    kdeStore: overrides.kdeStoreUrl !== undefined ? overrides.kdeStoreUrl : project.KDE_STORE_URL,
  }
}

/** `{name}` parameters for format(); unset store links are absent so callers can leave the line out. */
export function linkParams(links: LinkSet): Record<string, string> {
  return {
    repository: links.repository,
    issues: links.issues,
    releases: links.releases,
    readme: links.readme,
    pages: links.pages,
    ...(links.workshop !== null ? { workshop: links.workshop } : {}),
    ...(links.kdeStore !== null ? { kde_store: links.kdeStore } : {}),
  }
}
