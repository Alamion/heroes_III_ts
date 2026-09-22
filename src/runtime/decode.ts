// Decoding work shared by the worker and the in-thread fallback: archive → terrain atlas, map →
// world state, both cached by source identity.

import { HOTA_TERRAINS, terrainLayerDefs, terrainTileName, TERRAINS } from '../core/data/terrain.ts'
import { parseDef } from '../core/formats/def/def.ts'
import { parsePcx } from '../core/formats/pcx/pcx.ts'
import { parseH3mFile } from '../core/formats/h3m/h3m.ts'
import { ArchiveSet } from '../core/formats/lod/archive-set.ts'
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
import { resolveSpriteName } from '../core/data/hota-def-conventions.ts'
import { toDisplayColor } from '../core/render/atlas.ts'
import { buildObjectAtlas, OBJECT_PAGE_SIZE } from '../core/render/object-atlas.ts'
import type { ObjectAtlas } from '../core/render/object-atlas.ts'
import { parseRiffPal } from '../core/formats/pal/riff-pal.ts'
import { parseArtTraits } from '../core/formats/text/artraits.ts'
import { parseObjectsTxt } from '../core/formats/text/objects-txt.ts'
import type { DefSprite } from '../core/formats/def/def.ts'
import { buildRenderObjects } from '../core/state/render-objects.ts'
import type { RenderObject } from '../core/state/render-objects.ts'
import { createRng } from '../core/util/rng.ts'

/**
 * One user-supplied archive. Several of them form an ordered set (spec 005 FR-004): the HotA
 * archive comes first and overrides the base archives, and names it does not have fall through.
 */
export interface ArchiveFile {
  file: Blob
  name: string
}

/** Opens every member in order. */
async function openSet(files: readonly ArchiveFile[]): Promise<ArchiveSet> {
  const archives: LodArchive[] = []
  for (const f of files) archives.push(await LodArchive.open(new BlobSource(f.file, f.name)))
  return new ArchiveSet(archives)
}

/** Ordered identity of a set: order matters, because it decides which archive wins. */
export async function archiveSetIdentity(files: readonly ArchiveFile[]): Promise<string> {
  const parts: string[] = []
  for (const f of files) parts.push(await archiveIdentity(f.file))
  return parts.join('|')
}

function setWarnings(set: ArchiveSet, name: string): WorkerDiagnostic[] {
  return set.warnings.map((w) => ({ level: 'warn' as const, code: 'LOD_WARNING', message: w, file: name }))
}

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

export async function decodeArchive(files: readonly ArchiveFile[], cache: DecodedCache): Promise<ArchiveResult> {
  const primary = files[files.length - 1] as ArchiveFile
  const name = primary.name
  const head = await magic(primary.file)
  if (head[0] === 0x1f && head[1] === 0x8b) throw wrongSlot(name, 'this looks like a map file (.h3m); supply the sprite archive (h3sprite.lod) here')
  const identity = await archiveSetIdentity(files)
  const key = cacheKey('atlas', identity)
  const cached = await cache.get<Atlas>('atlas', key)
  if (cached !== undefined) return { identity, atlas: cached, fromCache: true, warnings: [] }
  const lod = await openSet(files)
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
  // HotA terrains ship as numbered PCX tiles and are appended, so the base-game rows and cells
  // keep the values they had before (spec 005 FR-011, US3).
  const hotaWarnings: WorkerDiagnostic[] = []
  for (const terrain of HOTA_TERRAINS) {
    if (!lod.has(terrainTileName(terrain.prefix, 0))) continue
    const tiles = []
    let missing = false
    for (let i = 0; i < terrain.count; i++) {
      const tileName = terrainTileName(terrain.prefix, i)
      if (!lod.has(tileName)) {
        missing = true
        hotaWarnings.push({ level: 'warn', code: 'MISSING_TERRAIN_TILE', message: `${terrain.name} tile ${tileName} is missing; the terrain is not drawn`, file: name })
        break
      }
      tiles.push(parsePcx(await lod.read(tileName), tileName))
    }
    if (!missing) inputs.push({ tileSet: { name: terrain.prefix, tiles }, overlay: false })
  }
  const atlas = buildAtlas(inputs)
  await cache.put('atlas', key, atlas)
  return { identity, atlas, fromCache: false, warnings: [...setWarnings(lod, name), ...hotaWarnings] }
}

/** Files of the data archive (h3bitmap.lod) the object layer needs. */
export const DATA_ARCHIVE_ENTRIES = ['Objects.txt', 'artraits.txt', 'game.pal'] as const

export interface DataArchiveResult {
  identity: string
  warnings: WorkerDiagnostic[]
}

export async function checkDataArchive(files: readonly ArchiveFile[]): Promise<DataArchiveResult> {
  const primary = files[files.length - 1] as ArchiveFile
  const name = primary.name
  const head = await magic(primary.file)
  if (!(head[0] === 0x4c && head[1] === 0x4f && head[2] === 0x44 && head[3] === 0)) throw wrongSlot(name, 'this is not a LOD archive; supply the data archive (h3bitmap.lod) here')
  const lod = await openSet(files)
  const missing = DATA_ARCHIVE_ENTRIES.filter((e) => !lod.has(e))
  if (missing.length > 0) {
    throw new FormatError({ code: FORMAT_ERROR_CODES.NOT_FOUND, file: name, offset: 0, format: 'lod', structure: 'entries', message: `archive has no ${missing.join(', ')}; supply the data archive (h3bitmap.lod)` })
  }
  return { identity: await archiveSetIdentity(files), warnings: [] }
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
  sprites: { files: readonly ArchiveFile[]; identity: string },
  data: { files: readonly ArchiveFile[]; identity: string },
  map: { world: WorldState; identity: string },
  seed: number,
  cache: DecodedCache,
  pageSize = OBJECT_PAGE_SIZE,
): Promise<ObjectsResult> {
  // The page size is part of the identity: a cached atlas was packed for one page size.
  const identity = `${sprites.identity}:${data.identity}:${map.identity}:${seed}:${pageSize}`
  const key = cacheKey('objects', identity)
  const cached = await cache.get<Omit<ObjectsResult, 'fromCache' | 'identity'>>('objects', key)
  if (cached !== undefined) return { ...cached, identity, fromCache: true }
  const spritesName = (sprites.files[sprites.files.length - 1] as ArchiveFile).name
  const dataLod = await openSet(data.files)
  const templates = parseObjectsTxt(await dataLod.read('Objects.txt'))
  const artifactClasses = parseArtTraits(await dataLod.read('artraits.txt'))
  const pal = parseRiffPal(await dataLod.read('game.pal'), 'game.pal')
  const { objects } = buildRenderObjects({ ...map.world, seed }, { templates, artifactClasses }, createRng(seed))
  const spriteLod = await openSet(sprites.files)
  const defs: DefSprite[] = []
  const missing: string[] = []
  for (const name of [...new Set(objects.map((o) => o.def))].sort()) {
    // HotA's own tables name one sprite wrongly; the alias is what the archive stores it under.
    const stored = resolveSpriteName(name)
    if (spriteLod.has(stored)) defs.push(parseDef(await spriteLod.read(stored), name))
    else missing.push(name)
  }
  // An object whose sprite cannot be resolved is not drawn, but it is counted and named with the
  // objects that wanted it, so a check can fail on it (spec 005 FR-017).
  const unresolved = missing.map((def) => {
    const users = objects.filter((o) => o.def === def)
    const first = users[0]
    return {
      def,
      count: users.length,
      ...(first === undefined ? {} : { classId: first.classId, at: { x: first.x, y: first.y, z: first.z } }),
    }
  })
  const unresolvedObjects = unresolved.reduce((n, u) => n + u.count, 0)
  const warnings: WorkerDiagnostic[] =
    missing.length === 0
      ? []
      : [
          {
            level: 'warn',
            code: 'MISSING_SPRITE',
            message: `${unresolvedObjects} object(s) are not drawn: ${missing.length} sprite(s) not found in ${spritesName} (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''})`,
            file: spritesName,
            details: { unresolvedSprites: missing.length, unresolvedObjects, sprites: unresolved.slice(0, 50) },
          },
        ]
  let atlas: ObjectAtlas
  try {
    atlas = buildObjectAtlas(defs, pageSize)
  } catch (err) {
    if (!(err instanceof RangeError)) throw err
    return { identity, objects: [], atlas: buildObjectAtlas([], pageSize), flagColors: new Uint8Array(27), fromCache: false, warnings: [...warnings, { level: 'error', code: 'OBJECT_ATLAS_OVERFLOW', message: err.message, file: map.world.map.name }] }
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
