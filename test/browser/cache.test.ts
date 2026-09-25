import { describe, expect, it } from 'vitest'
import { openCache } from '../../src/runtime/cache.ts'
import { CACHE_STORES, evictionVictims, noCache, RECENT_MAPS } from '../../src/runtime/cache-key.ts'
import type { RecentMap } from '../../src/runtime/cache-key.ts'

describe('decoded cache clear (spec 004)', () => {
  it('lists every store the database creates', () => {
    expect([...CACHE_STORES].sort()).toEqual(['atlas', 'objects', 'recent', 'world'])
  })

  it('degrades to the no-op cache without IndexedDB and clear resolves', async () => {
    const cache = openCache(true)
    expect(cache).toBe(noCache)
    await expect(cache.clear()).resolves.toBeUndefined()
    expect(await cache.get('atlas', 'x')).toBeUndefined()
  })
})

describe('decoded cache bound (spec 007 research R10)', () => {
  const entry = (lastUsed: number): RecentMap => ({ lastUsed, keys: [{ store: 'world', key: `w${lastUsed}` }] })

  it('keeps the most recently used maps and evicts the oldest first', () => {
    const recent = new Map<string, RecentMap>(Array.from({ length: 10 }, (_, i) => [`map${i}`, entry(100 + ((i * 7) % 10))] as const))
    const victims = evictionVictims(recent)
    expect(RECENT_MAPS).toBe(8)
    expect(victims).toHaveLength(2)
    const kept = [...recent.keys()].filter((id) => !victims.includes(id))
    const oldestKept = Math.min(...kept.map((id) => (recent.get(id) as RecentMap).lastUsed))
    for (const v of victims) expect((recent.get(v) as RecentMap).lastUsed).toBeLessThan(oldestKept)
  })

  it('evicts nothing at or below the bound', () => {
    expect(evictionVictims(new Map([['a', entry(1)]]))).toEqual([])
    expect(evictionVictims(new Map<string, RecentMap>(Array.from({ length: 8 }, (_, i) => [`m${i}`, entry(i)] as const)))).toEqual([])
  })
})
