// Shared setup for object renderer tests: synthetic archives, map, render objects, atlases.
import { gunzipSync } from 'node:zlib'
import { parseDef } from '../../../src/core/formats/def/def.ts'
import type { DefSprite } from '../../../src/core/formats/def/def.ts'
import { parseH3m } from '../../../src/core/formats/h3m/h3m.ts'
import { LodArchive } from '../../../src/core/formats/lod/lod.ts'
import { parseObjectsTxt } from '../../../src/core/formats/text/objects-txt.ts'
import { parseRiffPal } from '../../../src/core/formats/pal/riff-pal.ts'
import { flagColors } from '../../../src/core/data/players.ts'
import { buildObjectAtlas } from '../../../src/core/render/object-atlas.ts'
import { ObjectIndex } from '../../../src/core/state/object-index.ts'
import { buildRenderObjects } from '../../../src/core/state/render-objects.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import { createRng } from '../../../src/core/util/rng.ts'
import { MemorySource } from '../../../src/core/util/byte-source.ts'
import { toDisplayColor } from '../../../src/core/render/atlas.ts'
import { syntheticDataArchive, syntheticTerrainArchive, syntheticTerrainMap } from '../../fixtures/synthetic/terrain-archive.ts'

export async function objectScene(size = 36) {
  const sprites = await LodArchive.open(new MemorySource('syn.lod', syntheticTerrainArchive()))
  const data = await LodArchive.open(new MemorySource('data.lod', syntheticDataArchive()))
  const templates = parseObjectsTxt(await data.read('Objects.txt'))
  const pal = parseRiffPal(await data.read('game.pal'), 'game.pal')
  const state = fromH3m(parseH3m(gunzipSync(syntheticTerrainMap(size, true)), 'syn.h3m'), { sha256: 's', name: 'syn.h3m', version: 'SoD' }, 1)
  const { objects } = buildRenderObjects(state, { templates, artifactClasses: [] }, createRng(state.seed))
  const defs: DefSprite[] = []
  for (const name of new Set(objects.map((o) => o.def))) if (sprites.has(name)) defs.push(parseDef(await sprites.read(name), name))
  const atlas = buildObjectAtlas(defs)
  const index = new ObjectIndex(objects, state.size, state.levels)
  const colors = flagColors({ 'game.pal': pal }, toDisplayColor)
  return { sprites, state, objects, defs, atlas, index, colors }
}
