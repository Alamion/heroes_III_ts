// Synthetic LOD archive writer (no game content).

import { ByteWriter, zlib } from './writer.ts'

export interface SyntheticLodEntry {
  name: string
  data: Uint8Array
  compress?: boolean
  type?: number
}

export function writeLod(entries: SyntheticLodEntry[], opts: { version?: number } = {}): Uint8Array {
  const payloads = entries.map((e) => (e.compress === true ? zlib(e.data) : e.data))
  const header = new ByteWriter()
    .bytes([0x4c, 0x4f, 0x44, 0x00])
    .u32(opts.version ?? 200)
    .u32(entries.length)
  header.zeros(92 - header.length)
  const w = new ByteWriter().bytes(header.toBytes())
  let offset = 92 + entries.length * 32
  entries.forEach((e, i) => {
    const p = payloads[i] as Uint8Array
    w.fixedString(e.name, 16).u32(offset).u32(e.data.length).u32(e.type ?? 0x40).u32(e.compress === true ? p.length : 0)
    offset += p.length
  })
  for (const p of payloads) w.bytes(p)
  return w.toBytes()
}
