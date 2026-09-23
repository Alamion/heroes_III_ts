// Exclusion masks for fidelity checks (research.md §10): object footprints (objects are not drawn
// yet), floating tiles (random objects and generated heroes), and the terrain data needed to
// know which tiles are palette-animated.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { terrainAtlasInputs } from '../../../src/core/render/terrain-atlas.ts'
import { ArchiveSet } from '../../../src/core/formats/lod/archive-set.ts'
import { resolveSpriteName } from '../../../src/core/data/hota-def-conventions.ts'
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
import { buildObjectAtlas, MAX_OBJECT_PAGE_SIZE } from '../../../src/core/render/object-atlas.ts'
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
  /** Sprite archives in lookup order, HotA first when a HotA archive is given (spec 005). */
  archivePaths: string[]
  /** The HotA archive, when this map needs one. */
  hotaArchive?: string
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
  const dataPaths = [...(ctx.hotaArchive !== undefined ? [ctx.hotaArchive] : []), opts.dataArchive ?? resolveGameFile('h3bitmap.lod')]
  const data = await openArchiveSet(dataPaths)
  const templates = parseObjectsTxt(await data.read('Objects.txt'))
  const artifactClasses = parseArtTraits(await data.read('artraits.txt'))
  const pal = parseRiffPal(await data.read('game.pal'), 'game.pal')
  const { objects } = buildRenderObjects(ctx.state, { templates, artifactClasses }, createRng(seed))
  const sprites = await openArchiveSet(ctx.archivePaths)
  const defs: DefSprite[] = []
  const missing: string[] = []
  for (const name of [...new Set(objects.map((o) => o.def))].sort()) {
    const stored = resolveSpriteName(name)
    if (sprites.has(stored)) defs.push(parseDef(await sprites.read(stored), name))
    else missing.push(name)
  }
  return { seed, objects, index: new ObjectIndex(objects, ctx.state.size, ctx.state.levels), // In Node there is no texture-size limit, so the largest page size is used: a whole-map HotA
// atlas needs 29.3 M pixels and does not fit six 2048² pages (spec 005 research R12a). Packing
// does not affect what is drawn, so this cannot move the comparison.
    atlas: buildObjectAtlas(defs, MAX_OBJECT_PAGE_SIZE), flagColors: flagColors({ 'game.pal': pal }, toDisplayColor), missing }
}

async function openArchiveSet(paths: readonly string[]): Promise<ArchiveSet> {
  return new ArchiveSet(await Promise.all(paths.map(async (p) => LodArchive.open(await NodeFileSource.open(p)))))
}

/**
 * `dataArchive` (h3bitmap.lod, for Objects.txt) defaults to the game install's; `hotaArchive` is
 * required for HotA maps and takes precedence over the base archives, as in the game.
 */
export async function buildMapContext(mapPath: string, archivePath: string, dataArchive?: string, hotaArchive?: string): Promise<MapContext> {
  const bytes = new Uint8Array(await readFile(mapPath))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const map = await parseH3mFile(bytes, basename(mapPath))
  const state = fromH3m(map, { sha256, name: basename(mapPath), version: map.version })
  const archivePaths = [...(hotaArchive !== undefined ? [hotaArchive] : []), archivePath]
  const { inputs, missingDefs, incompleteHotaTerrains } = await terrainAtlasInputs(await openArchiveSet(archivePaths))
  if (missingDefs.length > 0) throw new Error(`${archivePath} has no terrain sprites (${missingDefs.slice(0, 3).join(', ')})`)
  if (incompleteHotaTerrains.length > 0) {
    throw new Error(`incomplete HotA terrain tiles: ${incompleteHotaTerrains.map((t) => `${t.terrain} (${t.tile})`).join(', ')}`)
  }
  const atlas = buildAtlas(inputs)
  const bitmaps = [...(hotaArchive !== undefined ? [hotaArchive] : []), ...(dataArchive !== undefined ? [dataArchive] : ['h3bitmap.lod'])]
  const sprites = await openGameSprites({ sprites: archivePaths, bitmaps })
  await sprites.preloadForState(state)
  const floating = computeFloatingTiles(state, sprites.candidates, sprites.lookup)
  const objects: Footprint[] = Array.from({ length: state.levels }, () => new Map())
  for (const o of state.objects.values()) {
    const fp = objects[o.z]
    if (fp === undefined) continue
    placeMask(fp, sprites.lookup(o.template.defName) ?? templateAreaMask(o.template.defName, o.template.passable, o.template.active), o.x, o.y)
  }
  return { mapPath, archivePath, archivePaths, ...(hotaArchive !== undefined ? { hotaArchive } : {}), sha256, state, atlas, objects, floating }
}
