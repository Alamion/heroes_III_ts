import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ByteSource } from '../../src/core/util/byte-source.ts'

/** ByteSource over a local file; opens the file per read so no handle is left behind. */
export class NodeFileSource implements ByteSource {
  readonly name: string
  readonly size: number
  readonly path: string

  private constructor(path: string, size: number) {
    this.path = path
    this.name = basename(path)
    this.size = size
  }

  static async open(path: string): Promise<NodeFileSource> {
    const s = await stat(path)
    return new NodeFileSource(path, s.size)
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new RangeError(`${this.name}: read ${offset}+${length} outside 0..${this.size}`)
    }
    const fh = await open(this.path, 'r')
    try {
      const buf = new Uint8Array(length)
      let done = 0
      while (done < length) {
        const { bytesRead } = await fh.read(buf, done, length - done, offset + done)
        if (bytesRead === 0) throw new RangeError(`${this.name}: unexpected end of file at ${offset + done}`)
        done += bytesRead
      }
      return buf
    } finally {
      await fh.close()
    }
  }
}
