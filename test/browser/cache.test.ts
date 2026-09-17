import { describe, expect, it } from 'vitest'
import { openCache } from '../../src/runtime/cache.ts'
import { CACHE_STORES, noCache } from '../../src/runtime/cache-key.ts'

describe('decoded cache clear (spec 004)', () => {
  it('lists every store the database creates', () => {
    expect([...CACHE_STORES].sort()).toEqual(['atlas', 'objects', 'world'])
  })

  it('degrades to the no-op cache without IndexedDB and clear resolves', async () => {
    const cache = openCache(true)
    expect(cache).toBe(noCache)
    await expect(cache.clear()).resolves.toBeUndefined()
    expect(await cache.get('atlas', 'x')).toBeUndefined()
  })
})
