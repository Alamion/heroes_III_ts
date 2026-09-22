// Entry-name hash of the obfuscated HotA 1.8 LOD index (specs/005-hota-support/contracts/archives.md).
//
// HotA 1.8 replaced the 16-byte entry name with a 32-bit FNV-1a hash of the lower-cased name. The
// algorithm is not part of hota-lod-convert (that tool only ships a name dictionary); it was
// derived here and verified against all 5239 name/hash pairs of that dictionary, while FNV-1,
// upper-cased names and NUL-terminated names matched none of them.

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a 32-bit over the bytes of the lower-cased name, without a trailing NUL. */
export function lodNameHash(name: string): number {
  let hash = FNV_OFFSET_BASIS
  const lower = name.toLowerCase()
  for (let i = 0; i < lower.length; i++) {
    // Entry names are ASCII; anything else cannot match a stored hash anyway.
    hash = (hash ^ (lower.charCodeAt(i) & 0xff)) >>> 0
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash
}

/** Display form of a hash whose name is unknown, also accepted by `find`/`get`. */
export function hashDisplayName(hash: number): string {
  return `#${hash.toString(16).padStart(8, '0')}`
}

/** Parses `#<hex>` back into a hash; undefined for an ordinary name. */
export function parseHashDisplayName(name: string): number | undefined {
  const m = /^#([0-9a-f]{8})$/i.exec(name)
  return m === null ? undefined : Number.parseInt(m[1] as string, 16) >>> 0
}
