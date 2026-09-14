import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { CaptureRecord, Kind, Level, Source, TileRange } from '../model/types.ts'
import { validateRecord } from '../model/validate-record.ts'

/** Finds a map by file name (NFC-insensitive) in the search folders, or accepts a path. */
export function resolveMap(name: string, searchDirs: string[]): string {
  if (name.includes('/') && existsSync(name)) return name
  const wanted = name.normalize('NFC').toLowerCase()
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue
    const hit = readdirSync(dir).find((f) => f.normalize('NFC').toLowerCase() === wanted)
    if (hit !== undefined) return join(dir, hit)
  }
  throw new RefError(ERROR_CODES.PREREQ_MISSING, `map "${name}" not found in ${searchDirs.join(', ')}`)
}

export function captureId(createdAt: Date, visible: TileRange): string {
  const stamp = createdAt.toISOString().replace(/[:.]/g, '-')
  return `${stamp}_x${visible.x0}-${visible.x1}_y${visible.y0}-${visible.y1}`
}

export function captureDir(capturesDir: string, mapKey: string, level: Level, source: Source, kind: Kind, id: string): string {
  return join(capturesDir, mapKey, String(level), `${source}-${kind}`, id)
}

/**
 * Writes files into a temporary sibling directory, validates the record, then renames into place.
 * A failure leaves no partial capture; an existing capture is never overwritten.
 */
export async function writeCaptureAtomically(
  dir: string,
  record: CaptureRecord,
  writeFiles: (tmpDir: string) => Promise<void>,
): Promise<void> {
  if (existsSync(dir)) throw new RefError(ERROR_CODES.GRAB_FAILED, `capture directory already exists: ${dir}`)
  const parent = join(dir, '..')
  mkdirSync(parent, { recursive: true })
  const tmp = join(parent, `.tmp-${process.pid}-${Date.now()}`)
  mkdirSync(tmp)
  try {
    validateRecord(record)
    await writeFiles(tmp)
    for (const f of Object.values(record.files)) {
      if (f !== undefined && !existsSync(join(tmp, f))) {
        throw new RefError(ERROR_CODES.GRAB_FAILED, `record references missing file ${f}`)
      }
    }
    writeFileSync(join(tmp, 'record.json'), `${JSON.stringify(record, null, 2)}\n`)
    renameSync(tmp, dir)
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
}
