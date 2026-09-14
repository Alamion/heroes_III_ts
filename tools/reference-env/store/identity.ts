import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')))
  })
}

export function sha256Buffer(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Folder-safe, unambiguous map key: NFC file name without extension + first 8 hex of its sha256. */
export function mapKey(fileName: string, sha256: string): string {
  const name = basename(fileName.normalize('NFC'), extname(fileName))
  const safe = name.replace(/[/\\\x00-\x1f]/g, '_').trim() || 'map'
  return `${safe}-${sha256.slice(0, 8)}`
}
