// An ordered set of LOD archives with first-match-wins lookup
// (specs/005-hota-support/contracts/archives.md).
//
// HotA ships its own copies of base-game entries — grastl.def, watrtl.def, clrrvr.def, icyrvr.def
// and game.pal all exist in both archives — while several town sprites exist only in the base
// archive, so both directions of the merge matter. The HotA archive goes first, which is the order
// the game itself uses.

import { FORMAT_ERROR_CODES, FormatError } from '../../util/errors.ts'
import { log } from '../../util/log.ts'
import { LodArchive } from './lod.ts'
import type { LodEntry } from './lod.ts'

export interface ArchiveSetHit {
  archive: LodArchive
  entry: LodEntry
}

export class ArchiveSet {
  /** In lookup order: the first archive that has a name answers for it. */
  readonly archives: readonly LodArchive[]
  /** Read failures by archive and name, each reported once. */
  private readonly failures = new Map<string, string>()

  constructor(archives: readonly LodArchive[]) {
    if (archives.length === 0) throw new TypeError('an archive set needs at least one archive')
    this.archives = archives
    this.logOverrides()
  }

  /** Convenience for the common single-archive case. */
  static of(...archives: LodArchive[]): ArchiveSet {
    return new ArchiveSet(archives)
  }

  get names(): readonly string[] {
    return this.archives.map((a) => a.source.name)
  }

  find(name: string): ArchiveSetHit | undefined {
    for (const archive of this.archives) {
      const entry = archive.find(name)
      if (entry !== undefined) return { archive, entry }
    }
    return undefined
  }

  has(name: string): boolean {
    return this.find(name) !== undefined
  }

  get(name: string): ArchiveSetHit {
    const hit = this.find(name)
    if (hit === undefined) throw this.notFound(name)
    return hit
  }

  private notFound(name: string): FormatError {
    return new FormatError({
      code: FORMAT_ERROR_CODES.NOT_FOUND,
      file: this.names.join(', '),
      offset: 0,
      format: 'lod',
      structure: 'entries',
      message: `no entry named "${name}" in ${this.names.join(', ')}`,
    })
  }

  /**
   * Reads a name from the first archive that can deliver it. An entry that cannot be decoded (an
   * unsupported or corrupt compression, spec 008 FR-010) falls through to the next archive holding
   * the name, with a warning; only when no archive can deliver it does the first error propagate.
   */
  async read(name: string): Promise<Uint8Array> {
    let first: unknown
    for (const archive of this.archives) {
      const entry = archive.find(name)
      if (entry === undefined) continue
      try {
        return await archive.read(entry)
      } catch (err) {
        if (!(err instanceof FormatError)) throw err
        first ??= err
        this.noteReadFailure(name, archive, err)
      }
    }
    throw first ?? this.notFound(name)
  }

  /**
   * Reads a name the caller can do without (a sprite, an optional tile): undefined when no archive
   * has it or none can deliver it; the failure is kept in `readFailures`.
   */
  async readOptional(name: string): Promise<Uint8Array | undefined> {
    if (!this.has(name)) return undefined
    try {
      return await this.read(name)
    } catch (err) {
      if (err instanceof FormatError) return undefined
      throw err
    }
  }

  /** Entries that could not be read so far, each once (spec 008): archive, name and reason. */
  get readFailures(): readonly string[] {
    return [...this.failures.values()]
  }

  /** Warnings of every member, prefixed with the archive they came from. */
  get warnings(): readonly string[] {
    return this.archives.flatMap((a) => a.warnings.map((w) => `${a.source.name}: ${w}`))
  }

  private noteReadFailure(name: string, archive: LodArchive, err: FormatError): void {
    const key = `${archive.source.name}\u0000${name.toLowerCase()}`
    if (this.failures.has(key)) return
    const next = this.archives.slice(this.archives.indexOf(archive) + 1).find((a) => a.has(name))
    const line = `${archive.source.name}: entry "${name}" cannot be read (${err.detail}); ${next !== undefined ? `using the copy in ${next.source.name}` : 'skipped'}`
    this.failures.set(key, line)
    log.warn(line)
  }

  private logOverrides(): void {
    if (this.archives.length < 2) return
    const seen = new Set<number>()
    let shadowed = 0
    for (const archive of this.archives) {
      for (const entry of archive.entries) {
        if (seen.has(entry.nameHash)) shadowed++
        else seen.add(entry.nameHash)
      }
    }
    if (shadowed > 0) {
      log.debug(`archive set: ${shadowed} entries of later archives are shadowed by ${this.archives[0]?.source.name ?? 'the first archive'}`, {
        order: this.names,
      })
    }
  }
}
