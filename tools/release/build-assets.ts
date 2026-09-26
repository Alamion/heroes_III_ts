// `yarn release assets` and `yarn release texts` (spec 006 contracts/cli.md): the working tree's
// version and changelog section → dist/release/<version>/.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { log } from '../../src/core/util/log.ts'
import type { CommandResult } from '../shared/cli-runner.ts'
import { ToolError, TOOL_ERROR_CODES } from '../shared/errors.ts'
import { HOSTS } from '../package/build.ts'
import { assemble, packageVersion, writePackage } from '../package/cli.ts'
import { writeReleaseAssets } from './assets.ts'
import { changelogSection, readChangelog } from './changelog.ts'
import { projectLinks } from './links.ts'
import { validateChangelogMarkup } from './markup.ts'
import { formatVersion, parseVersion } from './semver.ts'
import { checkStoreText, storeTexts, textSize } from './store-texts.ts'
import type { StoreText } from './store-texts.ts'
import { whichFileBlock } from './which-file.ts'

function failIfInvalid(texts: readonly StoreText[]): void {
  const problems = texts.flatMap(checkStoreText)
  if (problems.length > 0) throw new ToolError(TOOL_ERROR_CODES.FAILED, `store texts do not fit: ${problems.join('; ')}`, { details: { problems } })
}

function sectionBody(repoRoot: string, version: string): string {
  const section = changelogSection(readChangelog(join(repoRoot, 'CHANGELOG.md')), version)
  validateChangelogMarkup(section.body, section.line)
  return section.body
}

export async function buildReleaseAssets(opts: { repoRoot: string; version?: string; out: string; build: boolean }): Promise<CommandResult> {
  const version = formatVersion(parseVersion(opts.version ?? packageVersion(opts.repoRoot)))
  const packagesDir = resolve(opts.repoRoot, 'dist/packages')
  if (opts.build) {
    for (const host of HOSTS) writePackage(packagesDir, host, await assemble(opts.repoRoot, host), version)
  }
  const changelog = sectionBody(opts.repoRoot, version)
  const links = projectLinks()
  const texts = storeTexts(version, changelog, links)
  failIfInvalid(texts)
  const outDir = join(opts.out, version)
  const files = writeReleaseAssets({ version, packagesDir, outDir, changelog, notesFooter: whichFileBlock(version, links), texts: texts.map((t) => ({ name: t.name, content: t.content })) })
  log.info(`release assets for ${version} in ${outDir}`)
  return { ok: true, version, dir: outDir, files, texts: texts.map(textSize) }
}

export function writeStoreTexts(opts: { repoRoot: string; version?: string; out: string }): CommandResult {
  const version = formatVersion(parseVersion(opts.version ?? packageVersion(opts.repoRoot)))
  let changelog: string | undefined
  try {
    changelog = sectionBody(opts.repoRoot, version)
  } catch (err) {
    log.warn(`no change notes: ${(err as Error).message}`)
  }
  const all = storeTexts(version, changelog ?? '', projectLinks())
  const texts = changelog === undefined ? all.filter((t) => t.kind !== 'changenote') : all
  failIfInvalid(texts)
  const outDir = join(opts.out, version)
  mkdirSync(outDir, { recursive: true })
  for (const t of texts) writeFileSync(join(outDir, t.name), t.content)
  return { ok: true, version, dir: outDir, texts: texts.map(textSize) }
}
