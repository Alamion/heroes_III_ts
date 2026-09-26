// Small git helpers for the release tooling (spec 006 research R2). Every call takes the repository
// folder, so tests run against a temporary repository.

import { execFileSync } from 'node:child_process'

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitOk(cwd: string, args: readonly string[]): boolean {
  try {
    git(cwd, args)
    return true
  } catch {
    return false
  }
}

/** Commit a tag points at, or undefined when the tag does not exist. */
export function tagCommit(cwd: string, tag: string): string | undefined {
  try {
    return git(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])
  } catch {
    return undefined
  }
}

export function revParse(cwd: string, ref: string): string {
  return git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])
}

export function refExists(cwd: string, ref: string): boolean {
  return gitOk(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
}

export function isAncestor(cwd: string, commit: string, ref: string): boolean {
  return gitOk(cwd, ['merge-base', '--is-ancestor', commit, ref])
}

export function listTags(cwd: string, pattern = 'v*'): string[] {
  const out = git(cwd, ['tag', '--list', pattern])
  return out === '' ? [] : out.split('\n')
}

/** A file's content at a commit. */
export function showFile(cwd: string, commit: string, path: string): string | undefined {
  try {
    return execFileSync('git', ['show', `${commit}:${path}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return undefined
  }
}

export function commitSubjects(cwd: string, range: string): string[] {
  const out = git(cwd, ['log', '--format=%s', range])
  return out === '' ? [] : out.split('\n')
}
