// `yarn verify store-texts` (spec 006 FR-013): the store texts for the current version and the change
// notes of every changelog section fit their store's limits, markup and link rules.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandResult } from '../shared/cli-runner.ts'
import { packageVersion } from '../package/cli.ts'
import { readChangelog } from '../release/changelog.ts'
import { projectLinks } from '../release/links.ts'
import { validateChangelogMarkup } from '../release/markup.ts'
import { checkStoreText, storeTexts, textSize } from '../release/store-texts.ts'

export async function storeTextsCommand(): Promise<CommandResult> {
  const repoRoot = process.cwd()
  const version = packageVersion(repoRoot)
  const links = projectLinks()
  const problems: string[] = []
  const sizes: ReturnType<typeof textSize>[] = []
  const path = join(repoRoot, 'CHANGELOG.md')
  const sections = existsSync(path) ? readChangelog(path) : []
  const descriptions = storeTexts(version, '', links).filter((t) => t.kind !== 'changenote')
  for (const t of descriptions) {
    problems.push(...checkStoreText(t))
    sizes.push(textSize(t))
  }
  for (const s of sections) {
    try {
      validateChangelogMarkup(s.body, s.line)
    } catch (err) {
      problems.push(`CHANGELOG.md [${s.version}]: ${(err as Error).message}`)
      continue
    }
    for (const t of storeTexts(s.version, s.body, links).filter((x) => x.kind === 'changenote')) {
      problems.push(...checkStoreText(t))
      sizes.push(textSize(t))
    }
  }
  const ok = problems.length === 0
  const reportDir = join(repoRoot, 'check-reports', 'store-texts', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(reportDir, { recursive: true })
  const report = { schema: '006-store-texts', outcome: ok ? 'pass' : 'fail', version, problems, texts: sizes }
  writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return { ok, ...report, report: join(reportDir, 'report.json') }
}
