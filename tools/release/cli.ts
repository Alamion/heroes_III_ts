// yarn release check|assets|texts|notes-draft|publish (spec 006 contracts/cli.md): the release rules
// and steps as commands, so the workflow only calls them and every rule runs the same locally.

import { resolve } from 'node:path'
import { flag, opt, required, runCli } from '../shared/cli-runner.ts'
import type { CommandResult, CommandSpec, ParsedArgs } from '../shared/cli-runner.ts'
import { ToolError, TOOL_ERROR_CODES, usage } from '../shared/errors.ts'

async function checkCommand(args: ParsedArgs): Promise<CommandResult> {
  const { checkRelease } = await import('./tags.ts')
  const { validateChangelogMarkup } = await import('./markup.ts')
  const tag = required(args, 'tag')
  const res = checkRelease({ tag, repoRoot: process.cwd(), local: flag(args, 'local'), branch: opt(args, 'branch'), validateChangelog: validateChangelogMarkup })
  return { ...res }
}

async function assetsCommand(args: ParsedArgs): Promise<CommandResult> {
  const { buildReleaseAssets } = await import('./build-assets.ts')
  const repoRoot = process.cwd()
  return buildReleaseAssets({ repoRoot, version: opt(args, 'version'), out: resolve(repoRoot, opt(args, 'out') ?? 'dist/release'), build: flag(args, 'build') })
}

async function textsCommand(args: ParsedArgs): Promise<CommandResult> {
  const { writeStoreTexts } = await import('./build-assets.ts')
  const repoRoot = process.cwd()
  return writeStoreTexts({ repoRoot, version: opt(args, 'version'), out: resolve(repoRoot, opt(args, 'out') ?? 'dist/release') })
}

async function notesDraftCommand(args: ParsedArgs): Promise<CommandResult> {
  const { draftFromSubjects } = await import('./changelog.ts')
  const { commitSubjects, listTags } = await import('./git.ts')
  const { compareVersions, isPrerelease, parseVersion } = await import('./semver.ts')
  const repoRoot = process.cwd()
  let since = opt(args, 'since')
  if (since === undefined) {
    const finals = listTags(repoRoot)
      .flatMap((t) => {
        try {
          const v = parseVersion(t.slice(1))
          return isPrerelease(v) ? [] : [{ t, v }]
        } catch {
          return []
        }
      })
      .sort((a, b) => compareVersions(b.v, a.v))
    since = finals[0]?.t
  }
  const draft = draftFromSubjects(commitSubjects(repoRoot, since === undefined ? 'HEAD' : `${since}..HEAD`))
  // The draft is for the maintainer to rewrite; it goes to stderr as readable text and into the JSON.
  process.stderr.write(`${draft}\n`)
  return { ok: true, since: since ?? null, draft }
}

async function publishCommand(args: ParsedArgs): Promise<CommandResult> {
  const { publishRelease } = await import('./publish.ts')
  const { isPrerelease, parseVersion, formatVersion } = await import('./semver.ts')
  const tag = required(args, 'tag')
  if (!tag.startsWith('v')) throw usage(`--tag must be vX.Y.Z (got "${tag}")`)
  const version = parseVersion(tag.slice(1))
  if (process.env.GH_TOKEN === undefined && process.env.GITHUB_TOKEN === undefined) throw new ToolError(TOOL_ERROR_CODES.PREREQ_MISSING, 'GH_TOKEN is not set')
  const dir = resolve(process.cwd(), opt(args, 'dir') ?? `dist/release/${formatVersion(version)}`)
  const res = publishRelease({ tag, version: formatVersion(version), prerelease: isPrerelease(version), dir })
  return { ok: true, tag, ...res }
}

export const RELEASE_COMMANDS: Record<string, CommandSpec> = {
  check: { help: 'release rules for a tag: --tag vX.Y.Z [--local] [--branch REF]', booleanFlags: ['local'], load: async () => checkCommand },
  assets: { help: 'archives, store texts, notes and SHA256SUMS into dist/release/<version>/ [--version X.Y.Z] [--out DIR] [--build]', booleanFlags: ['build'], load: async () => assetsCommand },
  texts: { help: 'store texts only, for the current version [--version X.Y.Z] [--out DIR]', load: async () => textsCommand },
  'notes-draft': { help: 'draft of the next changelog section from feat/fix commits [--since vX.Y.Z]', load: async () => notesDraftCommand },
  publish: { help: 'create or fill the GitHub Release (CI; needs gh and GH_TOKEN): --tag vX.Y.Z [--dir DIR]', load: async () => publishCommand },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli('release', RELEASE_COMMANDS, process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
