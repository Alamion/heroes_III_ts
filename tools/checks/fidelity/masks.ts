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
import { resolveGameFile } from '../../shared/game-files.ts'
import { flagColors } from '../../../src/core/data/players.ts'
import { toDisplayColor } from '../../../src/core/render/atlas.ts'
import { buildObjectAtlas } from '../../../src/core/render/object-atlas.ts'
import type { ObjectAtlas } from '../../../src/core/render/object-atlas.ts'
import { parseRiffPal } from '../../../src/core/formats/pal/riff-pal.ts'
import { parseArtTraits } from '../../../src/core/formats/text/artraits.ts'
import { parseObjectsTxt } from '../../../src/core/formats/text/objects-txt.ts'
import { ObjectIndex } from '../../../src/core/state/object-index.ts'
import { buildRenderObjects } from '../../../src/core/state/render-objects.ts'
import type { RenderObject } from '../../../src/core/state/render-objects.ts'
import { createRng } from '../../../src/core/util/rng.ts'
import type { DefSprite } from '../../../src/core/formats/def/def.ts'
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

/** What the renderer draws for objects (spec 003), built from the user's archives in Node. */
export interface ObjectContext {
  seed: number
  objects: RenderObject[]
  index: ObjectIndex
  atlas: ObjectAtlas
  flagColors: Uint8Array
  missing: string[]
}

/** Render objects, their atlas and flag colours for a map context (data archive: h3bitmap.lod). */
export async function buildObjectContext(ctx: MapContext, opts: { seed?: number; dataArchive?: string } = {}): Promise<ObjectContext> {
  const seed = opts.seed ?? ctx.state.seed
  const data = await LodArchive.open(await NodeFileSource.open(opts.dataArchive ?? resolveGameFile('h3bitmap.lod')))
  const templates = parseObjectsTxt(await data.read('Objects.txt'))
  const artifactClasses = parseArtTraits(await data.read('artraits.txt'))
  const pal = parseRiffPal(await data.read('game.pal'), 'game.pal')
  const { objects } = buildRenderObjects(ctx.state, { templates, artifactClasses }, createRng(seed))
  const sprites = await LodArchive.open(await NodeFileSource.open(ctx.archivePath))
  const defs: DefSprite[] = []
  const missing: string[] = []
  for (const name of [...new Set(objects.map((o) => o.def))].sort()) {
    if (sprites.has(name)) defs.push(parseDef(await sprites.read(name), name))
    else missing.push(name)
  }
  return { seed, objects, index: new ObjectIndex(objects, ctx.state.size, ctx.state.levels), atlas: buildObjectAtlas(defs), flagColors: flagColors({ 'game.pal': pal }, toDisplayColor), missing }
}

/** `dataArchive` (h3bitmap.lod, for Objects.txt) defaults to the game install's. */
export async function buildMapContext(mapPath: string, archivePath: string, dataArchive?: string): Promise<MapContext> {
  const bytes = new Uint8Array(await readFile(mapPath))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const map = await parseH3mFile(bytes, basename(mapPath))
  const state = fromH3m(map, { sha256, name: basename(mapPath), version: map.version })
  const lod = await LodArchive.open(await NodeFileSource.open(archivePath))
  const inputs = []
  for (const n of terrainLayerDefs()) inputs.push({ def: parseDef(await lod.read(n), n), overlay: !TERRAINS.some((t) => t.defName === n) })
  const atlas = buildAtlas(inputs)
  const sprites = await openGameSprites({ sprites: [archivePath], ...(dataArchive !== undefined ? { bitmaps: dataArchive } : {}) })
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
