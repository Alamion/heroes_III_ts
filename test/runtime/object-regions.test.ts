import { describe, expect, it, vi } from 'vitest'
import { ArchiveSet } from '../../src/core/formats/lod/archive-set.ts'
import { ObjectIndex } from '../../src/core/state/object-index.ts'
import type { ObjectRegion } from '../../src/core/state/object-index.ts'
import { noCache } from '../../src/runtime/cache-key.ts'
import type { DecodedCache } from '../../src/runtime/cache-key.ts'
import { decodeMap, decodeObjects, objectRegionKey } from '../../src/runtime/decode.ts'
import { syntheticDataArchive, syntheticTerrainArchive, syntheticTerrainMap } from '../fixtures/synthetic/terrain-archive.ts'

const blob = (bytes: Uint8Array): Blob => new Blob([bytes as Uint8Array<ArrayBuffer>])
const region: ObjectRegion = { level: 0, range: { x0: 4, y0: 4, x1: 9, y1: 9 } }

async function inputs() {
  const world = await decodeMap(blob(syntheticTerrainMap(36, true)), 'region.h3m', noCache)
  return {
    sprites: { files: [{ file: blob(syntheticTerrainArchive()), name: 'sprites.lod' }], identity: 'sprites' },
    data: { files: [{ file: blob(syntheticDataArchive()), name: 'data.lod' }], identity: 'data' },
    map: { world: world.world, identity: world.identity },
  }
}

function memoryCache() {
  const values = new Map<string, unknown>()
  const cache: DecodedCache = {
    ...noCache,
    get: async <T>(_store: string, key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async (_store, key, value) => { values.set(key, structuredClone(value)) },
  }
  return { values, cache }
}

describe('region-scoped object decoding', () => {
  it('validates and canonically identifies regions, including off-map borders', () => {
    expect(objectRegionKey(region)).toBe('0:4,4,9,9')
    expect(objectRegionKey({ level: 1, range: { x0: -3, y0: -2, x1: 5, y1: 6 } })).toBe('1:-3,-2,5,6')
    for (const bad of [
      { ...region, level: -1 },
      { ...region, level: 0.5 },
      { ...region, range: { ...region.range, x0: NaN } },
      { ...region, range: { ...region.range, y1: Infinity } },
      { ...region, range: { ...region.range, x1: 1 } },
    ]) expect(() => objectRegionKey(bad)).toThrow(RangeError)
  })

  it('selects intersecting sprites before packing, preserving full-map outcomes', async () => {
    const { sprites, data, map } = await inputs()
    const full = await decodeObjects(sprites, data, map, 71, noCache, 2048)
    const reads = vi.spyOn(ArchiveSet.prototype, 'readOptional')
    let part: Awaited<ReturnType<typeof decodeObjects>>
    let names: string[]
    try {
      part = await decodeObjects(sprites, data, map, 71, noCache, 2048, region)
      names = reads.mock.calls.map(([name]) => name)
    } finally {
      reads.mockRestore()
    }
    const index = new ObjectIndex(full.objects, map.world.size, map.world.levels)
    const expected = index.query(region.level, region.range).map((i) => full.objects[i])
    expect(part.objects.map((o) => o.id)).toEqual(expected.map((o) => o!.id))
    expect(JSON.stringify(part.objects)).toBe(JSON.stringify(expected))
    expect(part.objects.length).toBeGreaterThan(0)
    expect(part.objects.length).toBeLessThan(full.objects.length)
    expect(part.objects.every((o) => o.z === region.level)).toBe(true)
    // At least one selected anchor is outside the viewport: do not clip wide sprites.
    expect(part.objects.some((o) => o.x > region.range.x1 || o.y > region.range.y1)).toBe(true)
    const wanted = [...new Set(part.objects.map((o) => o.def))].filter((n) => n in full.atlas.layout.sprites).sort()
    // Exercise the actual archive reader: no eager sprite entry reads outside the candidates.
    expect([...new Set(names)].sort()).toEqual([...new Set(part.objects.map((o) => o.def))].sort())
    expect(Object.keys(part.atlas.layout.sprites).sort()).toEqual(wanted)
    expect(part.atlas.layout.pageSize).toBe(2048)
    expect(part.identity).not.toBe(full.identity)
    for (const name of wanted) {
      const sprite = part.atlas.layout.sprites[name]!
      expect(sprite.groups.map((g) => g.length)).toEqual(full.atlas.layout.sprites[name]!.groups.map((g) => g.length))
    }
  })

  it('keeps one disk slot through region and seed changes, without returning a stale atlas', async () => {
    const { sprites, data, map } = await inputs()
    const { cache, values } = memoryCache()
    const first = await decodeObjects(sprites, data, map, 1, cache, 2048, region)
    expect(first.fromCache).toBe(false)
    const repeat = await decodeObjects(sprites, data, map, 1, cache, 2048, region)
    expect(repeat.fromCache).toBe(true)
    expect(repeat.identity).toBe(first.identity)
    const other = { ...region, level: 1 }
    const second = await decodeObjects(sprites, data, map, 2, cache, 2048, other)
    expect(second.fromCache).toBe(false)
    expect(second.identity).not.toBe(first.identity)
    expect(second.objects.every((o) => o.z === 1)).toBe(true)
    expect(values.size).toBe(1)
    const old = await decodeObjects(sprites, data, map, 1, cache, 2048, region)
    expect(old.fromCache).toBe(false)
    expect(old.identity).toBe(first.identity)
    expect(old.atlas.pages.length).toBe(first.atlas.pages.length)
    expect(old.atlas.pages.every((p, i) => Buffer.from(p).equals(Buffer.from(first.atlas.pages[i]!)))).toBe(true)
    expect(values.size).toBe(1)
  })

  it('does not decode or retain a thousand unseen sprite types', async () => {
    const { sprites, data, map } = await inputs()
    const first = await decodeObjects(sprites, data, map, 71, noCache, 2048, region)
    const objects = new Map(map.world.objects)
    const tree = [...objects.values()].find((o) => o.template.defName.toLowerCase() === 'syntree.def')!
    expect(tree).toBeDefined()
    for (let i = 0; i < 1000; i++) {
      const id = 100_000 + i
      objects.set(id, { ...tree, id, x: 35, y: 35, z: 1, template: { ...tree.template, defName: `unseen-${i}.def` } })
    }
    const extended = await decodeObjects(sprites, data, { world: { ...map.world, objects }, identity: 'with-unseen' }, 71, noCache, 2048, region)
    expect(extended.atlas.layout).toEqual(first.atlas.layout)
    expect(extended.atlas.pages.length).toBe(first.atlas.pages.length)
    expect(extended.atlas.pages.every((p, i) => Buffer.from(p).equals(Buffer.from(first.atlas.pages[i]!)))).toBe(true)
    expect(JSON.stringify(extended.warnings)).not.toContain('unseen-')
  })

  it('rejects a non-existent level instead of falling back to a whole-map atlas', async () => {
    const { sprites, data, map } = await inputs()
    const error = await decodeObjects(sprites, data, map, 1, noCache, 2048, { ...region, level: map.world.levels })
      .then(() => undefined, (err: unknown) => err)
    expect(error).toBeInstanceOf(RangeError)
  })
})
