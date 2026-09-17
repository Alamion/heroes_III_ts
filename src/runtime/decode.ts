// Decoding work shared by the worker and the in-thread fallback: archive → terrain atlas, map →
// world state, both cached by source identity.

import { terrainLayerDefs, TERRAINS } from '../core/data/terrain.ts'
import { parseDef } from '../core/formats/def/def.ts'
import { parseH3mFile } from '../core/formats/h3m/h3m.ts'
import { LodArchive } from '../core/formats/lod/lod.ts'
import { buildAtlas } from '../core/render/atlas.ts'
import type { Atlas, AtlasInput } from '../core/render/atlas.ts'
import { fromH3m } from '../core/state/world.ts'
import type { WorldState } from '../core/state/world.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../core/util/errors.ts'
import { cacheKey } from './cache-key.ts'
import type { DecodedCache } from './cache-key.ts'
import { archiveIdentity, BlobSource, mapIdentity } from './file-source.ts'
import type { WorkerDiagnostic } from './protocol.ts'
import { flagColors } from '../core/data/players.ts'
import { toDisplayColor } from '../core/render/atlas.ts'
import { buildObjectAtlas } from '../core/render/object-atlas.ts'
import type { ObjectAtlas } from '../core/render/object-atlas.ts'
import { parseRiffPal } from '../core/formats/pal/riff-pal.ts'
import { parseArtTraits } from '../core/formats/text/artraits.ts'
import { parseObjectsTxt } from '../core/formats/text/objects-txt.ts'
import type { DefSprite } from '../core/formats/def/def.ts'
import { buildRenderObjects } from '../core/state/render-objects.ts'
import type { RenderObject } from '../core/state/render-objects.ts'
import { createRng } from '../core/util/rng.ts'

export interface ArchiveResult {
  identity: string
  atlas: Atlas
  fromCache: boolean
  warnings: WorkerDiagnostic[]
}

export interface MapResult {
  identity: string
  world: WorldState
  fromCache: boolean
  warnings: WorkerDiagnostic[]
}

async function magic(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 4).arrayBuffer())
}

function wrongSlot(name: string, message: string): FormatError {
  return new FormatError({ code: FORMAT_ERROR_CODES.BAD_MAGIC, file: name, offset: 0, format: 'data', structure: 'file type', message })
}

export async function decodeArchive(file: Blob, name: string, cache: DecodedCache): Promise<ArchiveResult> {
  const head = await magic(file)
  if (head[0] === 0x1f && head[1] === 0x8b) throw wrongSlot(name, 'this looks like a map file (.h3m); supply the sprite archive (h3sprite.lod) here')
  const identity = await archiveIdentity(file)
  const key = cacheKey('atlas', identity)
  const cached = await cache.get<Atlas>('atlas', key)
  if (cached !== undefined) return { identity, atlas: cached, fromCache: true, warnings: [] }
  const lod = await LodArchive.open(new BlobSource(file, name))
  const missing = terrainLayerDefs().filter((d) => !lod.has(d))
  if (missing.length > 0) {
    throw new FormatError({
      code: FORMAT_ERROR_CODES.NOT_FOUND,
      file: name,
      offset: 0,
      format: 'lod',
      structure: 'entries',
      message: `archive has no terrain sprites (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}); supply the sprite archive (h3sprite.lod)`,
    })
  }
  const inputs: AtlasInput[] = []
  for (const defName of terrainLayerDefs()) {
    inputs.push({ def: parseDef(await lod.read(defName), defName), overlay: !TERRAINS.some((t) => t.defName === defName) })
  }
  const atlas = buildAtlas(inputs)
  await cache.put('atlas', key, atlas)
  return { identity, atlas, fromCache: false, warnings: lod.warnings.map((w) => ({ level: 'warn', code: 'LOD_WARNING', message: w, file: name })) }
}

/** Files of the data archive (h3bitmap.lod) the object layer needs. */
export const DATA_ARCHIVE_ENTRIES = ['Objects.txt', 'artraits.txt', 'game.pal'] as const

export interface DataArchiveResult {
  identity: string
  warnings: WorkerDiagnostic[]
}

export async function checkDataArchive(file: Blob, name: string): Promise<DataArchiveResult> {
  const head = await magic(file)
  if (!(head[0] === 0x4c && head[1] === 0x4f && head[2] === 0x44 && head[3] === 0)) throw wrongSlot(name, 'this is not a LOD archive; supply the data archive (h3bitmap.lod) here')
  const lod = await LodArchive.open(new BlobSource(file, name))
  const missing = DATA_ARCHIVE_ENTRIES.filter((e) => !lod.has(e))
  if (missing.length > 0) {
    throw new FormatError({ code: FORMAT_ERROR_CODES.NOT_FOUND, file: name, offset: 0, format: 'lod', structure: 'entries', message: `archive has no ${missing.join(', ')}; supply the data archive (h3bitmap.lod)` })
  }
  return { identity: await archiveIdentity(file), warnings: [] }
}

/** Object layer of a map: render objects, object atlas and flag colours (specs/003-map-objects). */
export interface ObjectsResult {
  identity: string
  objects: RenderObject[]
  atlas: ObjectAtlas
  flagColors: Uint8Array
  fromCache: boolean
  warnings: WorkerDiagnostic[]
}

export async function decodeObjects(
  sprites: { file: Blob; name: string; identity: string },
  data: { file: Blob; name: string; identity: string },
  map: { world: WorldState; identity: string },
  seed: number,
  cache: DecodedCache,
): Promise<ObjectsResult> {
  const identity = `${sprites.identity}:${data.identity}:${map.identity}:${seed}`
  const key = cacheKey('objects', identity)
  const cached = await cache.get<Omit<ObjectsResult, 'fromCache' | 'identity'>>('objects', key)
  if (cached !== undefined) return { ...cached, identity, fromCache: true }
  const dataLod = await LodArchive.open(new BlobSource(data.file, data.name))
  const templates = parseObjectsTxt(await dataLod.read('Objects.txt'))
  const artifactClasses = parseArtTraits(await dataLod.read('artraits.txt'))
  const pal = parseRiffPal(await dataLod.read('game.pal'), 'game.pal')
  const { objects } = buildRenderObjects({ ...map.world, seed }, { templates, artifactClasses }, createRng(seed))
  const spriteLod = await LodArchive.open(new BlobSource(sprites.file, sprites.name))
  const defs: DefSprite[] = []
  const missing: string[] = []
  for (const name of [...new Set(objects.map((o) => o.def))].sort()) {
    if (spriteLod.has(name)) defs.push(parseDef(await spriteLod.read(name), name))
    else missing.push(name)
  }
  const warnings: WorkerDiagnostic[] = missing.length === 0 ? [] : [{ level: 'warn', code: 'MISSING_SPRITE', message: `sprites not found in ${sprites.name}, objects skipped: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`, file: sprites.name }]
  let atlas: ObjectAtlas
  try {
    atlas = buildObjectAtlas(defs)
  } catch (err) {
    if (!(err instanceof RangeError)) throw err
    return { identity, objects: [], atlas: buildObjectAtlas([]), flagColors: new Uint8Array(27), fromCache: false, warnings: [...warnings, { level: 'error', code: 'OBJECT_ATLAS_OVERFLOW', message: err.message, file: map.world.map.name }] }
  }
  const result = { objects, atlas, flagColors: flagColors({ 'game.pal': pal }, toDisplayColor), warnings }
  await cache.put('objects', key, result)
  return { ...result, identity, fromCache: false }
}

export async function decodeMap(file: Blob, name: string, cache: DecodedCache): Promise<MapResult> {
  const head = await magic(file)
  if (head[0] === 0x4c && head[1] === 0x4f && head[2] === 0x44 && head[3] === 0) throw wrongSlot(name, 'this is a LOD archive; supply a map file (.h3m) here')
  const identity = await mapIdentity(file)
  const key = cacheKey('world', identity)
  const cached = await cache.get<WorldState>('world', key)
  if (cached !== undefined) return { identity, world: cached, fromCache: true, warnings: [] }
  const map = await parseH3mFile(new Uint8Array(await file.arrayBuffer()), name)
  const world = fromH3m(map, { sha256: identity, name, version: map.version })
  await cache.put('world', key, world)
  return { identity, world, fromCache: false, warnings: [] }
}
