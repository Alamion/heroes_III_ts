// Exclusion masks for fidelity checks (research.md §10): object footprints (objects are not drawn
// yet), floating tiles (random objects and generated heroes), and the terrain data needed to
// know which tiles are palette-animated.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { terrainLayerDefs, TERRAINS } from '../../../src/core/data/terrain.ts'
import { parseDef } from '../../../src/core/formats/def/def.ts'
import { parseH3mFile } from '../../../src/core/formats/h3m/h3m.ts'
import { LodArchive } from '../../../src/core/formats/lod/lod.ts'
import { buildAtlas } from '../../../src/core/render/atlas.ts'
import type { Atlas } from '../../../src/core/render/atlas.ts'
import { computeFloatingTiles } from '../../../src/core/state/floating.ts'
import type { FloatingTileSet } from '../../../src/core/state/floating.ts'
import { placeMask, templateAreaMask } from '../../../src/core/state/footprint.ts'
import type { Footprint } from '../../../src/core/state/footprint.ts'
import { fromH3m } from '../../../src/core/state/world.ts'
import type { WorldState } from '../../../src/core/state/world.ts'
import { NodeFileSource } from '../../shared/node-source.ts'
import { openGameSprites } from '../../shared/game-sprites.ts'

export interface MapContext {
  mapPath: string
  archivePath: string
  sha256: string
  state: WorldState
  atlas: Atlas
  /** Per level: footprints of objects that are not random (drawn by a later feature). */
  objects: Footprint[]
  floating: FloatingTileSet
}

export async function buildMapContext(mapPath: string, archivePath: string): Promise<MapContext> {
  const bytes = new Uint8Array(await readFile(mapPath))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const map = await parseH3mFile(bytes, basename(mapPath))
  const state = fromH3m(map, { sha256, name: basename(mapPath), version: map.version })
  const lod = await LodArchive.open(await NodeFileSource.open(archivePath))
  const inputs = []
  for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await lod.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
  const atlas = buildAtlas(inputs)
  const sprites = await openGameSprites()
  await sprites.preloadForState(state)
  const floating = computeFloatingTiles(state, sprites.candidates, sprites.lookup)
  const objects: Footprint[] = Array.from({ length: state.levels }, () => new Map())
  for (const o of state.objects.values()) {
    const fp = objects[o.z]
    if (fp === undefined) continue
    placeMask(fp, sprites.lookup(o.template.defName) ?? templateAreaMask(o.template.defName, o.template.passable, o.template.active), o.x, o.y)
  }
  return { mapPath, archivePath, sha256, state, atlas, objects, floating }
}
