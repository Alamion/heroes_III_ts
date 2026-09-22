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
    if (hit === undefined) {
      throw new FormatError({
        code: FORMAT_ERROR_CODES.NOT_FOUND,
        file: this.names.join(', '),
        offset: 0,
        format: 'lod',
        structure: 'entries',
        message: `no entry named "${name}" in ${this.names.join(', ')}`,
      })
    }
    return hit
  }

  async read(name: string): Promise<Uint8Array> {
    const { archive, entry } = this.get(name)
    return archive.read(entry)
  }

  /** Warnings of every member, prefixed with the archive they came from. */
  get warnings(): readonly string[] {
    return this.archives.flatMap((a) => a.warnings.map((w) => `${a.source.name}: ${w}`))
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
