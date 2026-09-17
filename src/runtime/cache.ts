// Local cache of decoded data keyed by source identity (constitution IV, research.md §8). Any
// failure (private mode, quota, blocked) degrades to a cache miss with a warning.

import { log } from '../core/util/log.ts'
import { CACHE_SCHEMA, CACHE_STORES, noCache } from './cache-key.ts'
import type { CacheStore, DecodedCache } from './cache-key.ts'

export { cacheKey, CACHE_SCHEMA, CACHE_STORES, noCache } from './cache-key.ts'
export type { CacheStore, DecodedCache } from './cache-key.ts'

export const CACHE_DB = 'h3dynam'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

class IdbCache implements DecodedCache {
  private db: Promise<IDBDatabase | undefined> | undefined

  private open(): Promise<IDBDatabase | undefined> {
    this.db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(CACHE_DB, CACHE_SCHEMA)
        req.onupgradeneeded = () => {
          const db = req.result
          for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
          for (const store of CACHE_STORES) db.createObjectStore(store)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => {
          log.warn('cache unavailable, decoding without cache', String(req.error))
          resolve(undefined)
        }
        req.onblocked = () => {
          log.warn('cache upgrade blocked, decoding without cache')
          resolve(undefined)
        }
      } catch (err) {
        log.warn('cache unavailable, decoding without cache', String(err))
        resolve(undefined)
      }
    })
    return this.db
  }

  async get<T>(store: CacheStore, key: string): Promise<T | undefined> {
    try {
      const db = await this.open()
      if (db === undefined) return undefined
      const value = await request(db.transaction(store, 'readonly').objectStore(store).get(key))
      return value as T | undefined
    } catch (err) {
      log.warn(`cache read failed for ${key}`, String(err))
      return undefined
    }
  }

  async put(store: CacheStore, key: string, value: unknown): Promise<void> {
    try {
      const db = await this.open()
      if (db === undefined) return
      await request(db.transaction(store, 'readwrite').objectStore(store).put(value, key))
    } catch (err) {
      log.warn(`cache write failed for ${key}`, String(err))
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.open()
      if (db === undefined) return
      const tx = db.transaction([...CACHE_STORES], 'readwrite')
      await Promise.all(CACHE_STORES.map((store) => request(tx.objectStore(store).clear())))
    } catch (err) {
      log.warn('cache clear failed', String(err))
    }
  }
}

export function openCache(enabled: boolean): DecodedCache {
  if (!enabled || typeof indexedDB === 'undefined') return noCache
  return new IdbCache()
}
