// Browser ByteSource over a File/Blob (range reads, research.md §8) and source identities for the
// cache.

import type { ByteSource } from '../core/util/byte-source.ts'
import { LOD_ENTRY_SIZE, LOD_HEADER_SIZE } from '../core/formats/lod/lod.ts'

export class BlobSource implements ByteSource {
  readonly name: string
  readonly size: number
  private readonly blob: Blob

  constructor(blob: Blob, name: string) {
    this.blob = blob
    this.name = name
    this.size = blob.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new RangeError(`${this.name}: read ${offset}+${length} outside 0..${this.size}`)
    }
    return new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer())
  }
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
}

/** Map identity: SHA-256 of the file (maps are small). */
export async function mapIdentity(file: Blob): Promise<string> {
  return sha256Hex(new Uint8Array(await file.arrayBuffer()))
}

/**
 * Archive identity: SHA-256 of size, lastModified and the header + index bytes. Hashing a 64 MB
 * archive in full would dominate cold start (research.md §8).
 */
export async function archiveIdentity(file: Blob & { lastModified?: number }): Promise<string> {
  const header = new Uint8Array(await file.slice(0, LOD_HEADER_SIZE).arrayBuffer())
  const count = header.byteLength >= 12 ? new DataView(header.buffer).getUint32(8, true) : 0
  const indexEnd = Math.min(file.size, LOD_HEADER_SIZE + count * LOD_ENTRY_SIZE)
  const index = new Uint8Array(await file.slice(0, indexEnd).arrayBuffer())
  const meta = new TextEncoder().encode(`${file.size}:${file.lastModified ?? 0}:`)
  const all = new Uint8Array(meta.byteLength + index.byteLength)
  all.set(meta, 0)
  all.set(index, meta.byteLength)
  return sha256Hex(all)
}
