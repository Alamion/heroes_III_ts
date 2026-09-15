// Cache keys and the no-op cache (DOM-free so they can be unit-tested in Node).

/** Bump when cached payload formats change. */
export const CACHE_SCHEMA = 3

export type CacheStore = 'atlas' | 'world'

export interface DecodedCache {
  get<T>(store: CacheStore, key: string): Promise<T | undefined>
  put(store: CacheStore, key: string, value: unknown): Promise<void>
}

export function cacheKey(kind: CacheStore, identity: string): string {
  return `${kind}:${CACHE_SCHEMA}:${identity}`
}

export const noCache: DecodedCache = {
  get: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
}
