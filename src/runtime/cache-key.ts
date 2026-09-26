// Cache keys and the no-op cache (DOM-free so they can be unit-tested in Node).

/**
 * Bump when cached payload formats change. 6: archive identity became the ordered identity of an
 * archive set (spec 005 FR-004), so an entry cached under a single archive's identity must not be
 * reused. 7: special palette indices are shadows only when the sprite marks them as such, so object
 * atlases cached before that draw HotA sprites' dark details as shadows. 8: shadow indices 2 and 3
 * got their own strengths (marker alphas), so older atlases draw them too dark or too light. 9: the
 * `recent` store bounds the per-map entries (spec 007 research R10: a map folder would otherwise keep
 * a world and an object atlas of every map it ever showed).
 */
export const CACHE_SCHEMA = 9

export type CacheStore = 'atlas' | 'world' | 'objects' | 'recent'

/** Maps whose world and object entries are kept; older ones are evicted (spec 007 research R10). */
export const RECENT_MAPS = 8

/** Per map identity: when it was last used and the cache keys stored for it. */
export interface RecentMap {
  lastUsed: number
  keys: { store: 'world' | 'objects'; key: string }[]
}

export interface DecodedCache {
  get<T>(store: CacheStore, key: string): Promise<T | undefined>
  put(store: CacheStore, key: string, value: unknown): Promise<void>
  /** Removes every cached entry (all stores). */
  clear(): Promise<void>
  /**
   * Records that a map's world or object entry was used (read or written) and evicts the entries of
   * all but the RECENT_MAPS most recently used maps.
   */
  noteMapUse(mapIdentity: string, store: 'world' | 'objects', key: string): Promise<void>
}

export const CACHE_STORES: readonly CacheStore[] = ['atlas', 'world', 'objects', 'recent']

/** Map identities to evict so that at most `keep` remain, oldest first. */
export function evictionVictims(recent: ReadonlyMap<string, RecentMap>, keep = RECENT_MAPS): string[] {
  if (recent.size <= keep) return []
  return [...recent.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed || (a[0] < b[0] ? -1 : 1)).slice(0, recent.size - keep).map(([id]) => id)
}

export function cacheKey(kind: CacheStore, identity: string): string {
  return `${kind}:${CACHE_SCHEMA}:${identity}`
}

export const noCache: DecodedCache = {
  get: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
  clear: () => Promise.resolve(),
  noteMapUse: () => Promise.resolve(),
}
