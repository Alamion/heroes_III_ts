// Deterministic zip and tar.gz writers for packages (spec 004 research R14): entries sorted by path,
// fixed timestamps and modes, so the same files always give the same bytes.

import { crc32, deflateRawSync, gzipSync } from 'node:zlib'

export interface ArchiveEntry {
  /** POSIX path inside the archive, no leading slash. Directories end with "/". */
  path: string
  data: Uint8Array
}

const sortEntries = (entries: readonly ArchiveEntry[]): ArchiveEntry[] => [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

function checkPath(path: string): void {
  if (path === '' || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`invalid archive path "${path}"`)
}

// DOS date 1980-01-01 00:00:00
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

export function writeZip(entries: readonly ArchiveEntry[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of sortEntries(entries)) {
    checkPath(e.path)
    const name = Buffer.from(e.path, 'utf8')
    const isDir = e.path.endsWith('/')
    const deflated = isDir ? Buffer.alloc(0) : deflateRawSync(e.data, { level: 9 })
    const store = isDir || deflated.length >= e.data.length
    const payload = store ? Buffer.from(e.data) : deflated
    const crc = isDir ? 0 : crc32(e.data)
    const method = store ? 0 : 8
    const flags = 0x0800 // UTF-8 names

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4) // made by UNIX, spec 2.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(((isDir ? 0o40755 : 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + payload.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  const count = centrals.length / 2
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]))
}

function tarHeader(path: string, size: number, isDir: boolean): Buffer {
  const h = Buffer.alloc(512)
  const name = Buffer.from(path, 'utf8')
  if (name.length > 100) {
    // ustar prefix/name split at a slash
    const cut = path.lastIndexOf('/', path.length - 1 - (isDir ? 1 : 0))
    const prefix = Buffer.from(path.slice(0, cut), 'utf8')
    const rest = Buffer.from(path.slice(cut + 1), 'utf8')
    if (cut < 0 || prefix.length > 155 || rest.length > 100) throw new Error(`tar path too long: ${path}`)
    rest.copy(h, 0)
    prefix.copy(h, 345)
  } else {
    name.copy(h, 0)
  }
  const octal = (v: number, len: number) => v.toString(8).padStart(len - 1, '0') + '\0'
  h.write(octal(isDir ? 0o755 : 0o644, 8), 100, 'ascii')
  h.write(octal(0, 8), 108, 'ascii')
  h.write(octal(0, 8), 116, 'ascii')
  h.write(octal(size, 12), 124, 'ascii')
  h.write(octal(0, 12), 136, 'ascii')
  h.write('        ', 148, 'ascii')
  h.write(isDir ? '5' : '0', 156, 'ascii')
  h.write('ustar\0', 257, 'ascii')
  h.write('00', 263, 'ascii')
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return h
}

export function writeTar(entries: readonly ArchiveEntry[]): Uint8Array {
  const parts: Buffer[] = []
  for (const e of sortEntries(entries)) {
    checkPath(e.path)
    const isDir = e.path.endsWith('/')
    parts.push(tarHeader(e.path, isDir ? 0 : e.data.length, isDir))
    if (!isDir) {
      parts.push(Buffer.from(e.data))
      const pad = (512 - (e.data.length % 512)) % 512
      if (pad > 0) parts.push(Buffer.alloc(pad))
    }
  }
  parts.push(Buffer.alloc(1024))
  return new Uint8Array(Buffer.concat(parts))
}

/** tar + gzip with a zeroed gzip timestamp and no file name. */
export function writeTarGz(entries: readonly ArchiveEntry[]): Uint8Array {
  const gz = gzipSync(writeTar(entries), { level: 9 })
  // Bytes 4–7 hold mtime; Node writes 0, force it anyway. Byte 9 is the OS: fix to 3 (Unix).
  gz.writeUInt32LE(0, 4)
  gz[9] = 3
  return new Uint8Array(gz)
}
