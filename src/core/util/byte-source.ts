// Random-access input. Archives are read by range so a 64 MB LOD is never loaded whole
// (constitution IV). Implementations: in-memory (here), Node file handle (tools), browser File
// (runtime).

export interface ByteSource {
  readonly name: string
  readonly size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export class MemorySource implements ByteSource {
  readonly name: string
  readonly size: number
  private readonly bytes: Uint8Array

  constructor(name: string, bytes: Uint8Array) {
    this.name = name
    this.bytes = bytes
    this.size = bytes.byteLength
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      return Promise.reject(new RangeError(`${this.name}: read ${offset}+${length} outside 0..${this.size}`))
    }
    return Promise.resolve(this.bytes.subarray(offset, offset + length))
  }
}
