// The shared spatial selection must cover the installed adventure-map sprite dimensions.
import { describe, expect, it } from 'vitest'
import { MAX_SPRITE_EXTENT } from '../../src/core/state/object-index.ts'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { buildMapContext, buildObjectContext } from '../../tools/checks/fidelity/masks.ts'
import { hotaArchivePath, requireGameFile } from '../../tools/shared/game-files.ts'

const sprites = requireGameFile('h3sprite.lod')
const data = requireGameFile('h3bitmap.lod')
const base = requireGameFile('test_map.h3m')
const hotaMap = requireGameFile('test_map_hota.h3m')
const hota = hotaArchivePath()

for (const [map, override] of [[base, undefined], [hotaMap, hota]] as const) {
  const available = sprites !== null && data !== null && map !== null && (map !== hotaMap || override !== undefined)
  if (!available) process.stderr.write('[object extents skipped] local primary map and its game archives required\n')
  describe.skipIf(!available)(`object region reach (${override === undefined ? 'base' : 'HotA'})`, () => {
    it('covers every full sprite of the primary map, not only its current animation frame', async () => {
      const ctx = await buildMapContext(map!, sprites!, data!, override)
      const objects = await buildObjectContext(ctx, { dataArchive: data!, seed: 71 })
      const sizes = Object.values(objects.atlas.layout.sprites)
      expect(sizes.length).toBeGreaterThan(500)
      const oversized = sizes.filter((s) => s.fullWidth > MAX_SPRITE_EXTENT.left * TILE_SIZE || s.fullHeight > MAX_SPRITE_EXTENT.up * TILE_SIZE)
        .map((s) => ({ def: s.def, width: s.fullWidth, height: s.fullHeight }))
      expect(oversized).toEqual([])
    }, 120_000)
  })
}
